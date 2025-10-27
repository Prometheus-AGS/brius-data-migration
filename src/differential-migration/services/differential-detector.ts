/**
 * DifferentialDetector Service
 * Implements timestamp-based change detection, content hashing, and record classification
 */

import { Pool, PoolClient } from 'pg';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

// Import our models
import {
  DifferentialAnalysisResultModel,
  type DifferentialAnalysisResult
} from '../models/differential-result';
import {
  MigrationExecutionLogModel,
  type MigrationExecutionLog
} from '../models/execution-log';

// Service interfaces
export interface DetectionConfig {
  timestampField: string;
  contentHashField?: string;
  enableContentHashing: boolean;
  batchSize: number;
  parallelConnections: number;
  excludeFields?: string[]; // Fields to exclude from content hashing
  hashAlgorithm?: 'md5' | 'sha1' | 'sha256';
}

export interface ChangeRecord {
  recordId: string;
  changeType: 'new' | 'modified' | 'deleted';
  sourceTimestamp: Date;
  destinationTimestamp?: Date;
  contentHash?: string;
  previousContentHash?: string;
  metadata: {
    sourceTable: string;
    destinationTable: string;
    fields?: string[];
    confidence: number; // 0-1 confidence in change detection
  };
}

export interface DifferentialAnalysisOptions {
  entityType: string;
  sinceTimestamp?: Date;
  untilTimestamp?: Date;
  enableContentHashing?: boolean;
  samplePercentage?: number; // For large datasets, analyze a sample
  includeDeletes?: boolean;
  batchSize?: number;
  maxRecordsToAnalyze?: number;
}

export interface DetectionResult {
  analysisId: string;
  entityType: string;
  analysisTimestamp: Date;
  baselineTimestamp: Date;
  detectionMethod: 'timestamp_only' | 'timestamp_with_hash' | 'full_content_hash';
  totalRecordsAnalyzed: number;
  changesDetected: ChangeRecord[];
  summary: {
    newRecords: number;
    modifiedRecords: number;
    deletedRecords: number;
    totalChanges: number;
    changePercentage: number;
  };
  performance: {
    analysisDurationMs: number;
    recordsPerSecond: number;
    queriesExecuted: number;
  };
  recommendations: string[];
}

// Entity table mapping (imported from baseline analyzer pattern)
const ENTITY_TABLE_MAPPING: Record<string, { source: string; destination: string; idField: string; timestampField?: string }> = {
  offices: { source: 'dispatch_office', destination: 'offices', idField: 'id', timestampField: 'updated_at' },
  doctors: { source: 'dispatch_doctor', destination: 'doctors', idField: 'id', timestampField: 'updated_at' },
  doctor_offices: { source: 'dispatch_doctor_office', destination: 'doctor_offices', idField: 'id', timestampField: 'updated_at' },
  patients: { source: 'dispatch_patient', destination: 'patients', idField: 'id', timestampField: 'updated_at' },
  orders: { source: 'dispatch_order', destination: 'orders', idField: 'id', timestampField: 'updated_at' },
  cases: { source: 'dispatch_case', destination: 'cases', idField: 'id', timestampField: 'updated_at' },
  files: { source: 'dispatch_file', destination: 'files', idField: 'id', timestampField: 'updated_at' },
  case_files: { source: 'dispatch_case_file', destination: 'case_files', idField: 'id', timestampField: 'updated_at' },
  messages: { source: 'dispatch_message', destination: 'messages', idField: 'id', timestampField: 'updated_at' },
  message_files: { source: 'dispatch_message_file', destination: 'message_files', idField: 'id', timestampField: 'updated_at' },
  jaw: { source: 'dispatch_jaw', destination: 'jaw', idField: 'id', timestampField: 'updated_at' },
  dispatch_records: { source: 'dispatch_record', destination: 'dispatch_records', idField: 'id', timestampField: 'updated_at' },
  system_messages: { source: 'dispatch_system_message', destination: 'system_messages', idField: 'id', timestampField: 'updated_at' },
  message_attachments: { source: 'dispatch_message_attachment', destination: 'message_attachments', idField: 'id', timestampField: 'updated_at' }
};

/**
 * DifferentialDetector Service Implementation
 *
 * Provides comprehensive change detection functionality using timestamp-based analysis
 * with optional content hash verification for high-accuracy differential migrations.
 */
export class DifferentialDetector {
  private sourcePool: Pool;
  private destinationPool: Pool;
  private config: DetectionConfig;
  private entityType: string;
  private sessionId: string;

  constructor(
    sourcePool: Pool,
    destinationPool: Pool,
    entityType: string,
    config: DetectionConfig,
    sessionId?: string
  ) {
    // Validate configuration
    const validation = DifferentialDetector.validateDetectionConfig(config);
    if (!validation.isValid) {
      throw new Error(`Invalid detection config: ${validation.errors.join(', ')}`);
    }

    if (!ENTITY_TABLE_MAPPING[entityType]) {
      throw new Error(`Unknown entity type: ${entityType}`);
    }

    this.sourcePool = sourcePool;
    this.destinationPool = destinationPool;
    this.entityType = entityType;
    this.config = config;
    this.sessionId = sessionId || uuidv4();
  }

  /**
   * Validates detection configuration
   */
  static validateDetectionConfig(config: DetectionConfig): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.timestampField || config.timestampField.trim().length === 0) {
      errors.push('timestampField is required');
    }

    if (config.batchSize && (config.batchSize < 1 || config.batchSize > 10000)) {
      errors.push('batchSize must be between 1 and 10000');
    }

    if (config.parallelConnections && (config.parallelConnections < 1 || config.parallelConnections > 10)) {
      errors.push('parallelConnections must be between 1 and 10');
    }

    if (config.enableContentHashing && !config.contentHashField) {
      errors.push('contentHashField is required when enableContentHashing is true');
    }

    if (config.excludeFields && !Array.isArray(config.excludeFields)) {
      errors.push('excludeFields must be an array');
    }

    const validHashAlgorithms = ['md5', 'sha1', 'sha256'];
    if (config.hashAlgorithm && !validHashAlgorithms.includes(config.hashAlgorithm)) {
      errors.push(`hashAlgorithm must be one of: ${validHashAlgorithms.join(', ')}`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Detects changes for the configured entity type
   */
  async detectChanges(options: DifferentialAnalysisOptions): Promise<DetectionResult> {
    const startTime = Date.now();
    const analysisId = uuidv4();

    await this.logDetection('info',
      `Starting differential detection for ${options.entityType}`,
      { analysisId, options }
    );

    try {
      const mapping = ENTITY_TABLE_MAPPING[options.entityType];
      if (!mapping) {
        throw new Error(`Unknown entity type: ${options.entityType}`);
      }

      const timestampField = mapping.timestampField || this.config.timestampField;
      const sinceTimestamp = options.sinceTimestamp || new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: 24 hours ago
      const batchSize = options.batchSize || this.config.batchSize;

      let queriesExecuted = 0;
      const changesDetected: ChangeRecord[] = [];

      // Detect new and modified records
      const { newRecords, modifiedRecords, analyzed } = await this.detectNewAndModified(
        mapping, timestampField, sinceTimestamp, options, batchSize
      );
      queriesExecuted += Math.ceil(analyzed / batchSize) * 2; // Source and destination queries

      changesDetected.push(...newRecords, ...modifiedRecords);

      // Detect deleted records if requested
      let deletedRecords: ChangeRecord[] = [];
      if (options.includeDeletes) {
        deletedRecords = await this.detectDeleted(mapping, sinceTimestamp, batchSize);
        queriesExecuted += Math.ceil(deletedRecords.length / batchSize);
        changesDetected.push(...deletedRecords);
      }

      const totalRecordsAnalyzed = analyzed;

      const summary = {
        newRecords: newRecords.length,
        modifiedRecords: modifiedRecords.length,
        deletedRecords: deletedRecords.length,
        totalChanges: changesDetected.length,
        changePercentage: totalRecordsAnalyzed > 0
          ? Math.round((changesDetected.length / totalRecordsAnalyzed) * 100 * 100) / 100
          : 0
      };

      const endTime = Date.now();
      const analysisDurationMs = endTime - startTime;

      // Generate recommendations
      const recommendations = this.generateRecommendations(summary, analysisDurationMs, options);

      const detectionMethod = this.config.enableContentHashing
        ? (options.enableContentHashing ? 'full_content_hash' : 'timestamp_with_hash')
        : 'timestamp_only';

      const result: DetectionResult = {
        analysisId,
        entityType: options.entityType,
        analysisTimestamp: new Date(),
        baselineTimestamp: sinceTimestamp,
        detectionMethod,
        totalRecordsAnalyzed,
        changesDetected,
        summary,
        performance: {
          analysisDurationMs,
          recordsPerSecond: analysisDurationMs > 0 ? Math.round((totalRecordsAnalyzed / analysisDurationMs) * 1000) : 0,
          queriesExecuted
        },
        recommendations
      };

      await this.logDetection('info',
        `Differential detection completed for ${options.entityType}`,
        {
          analysisId,
          totalChanges: summary.totalChanges,
          changePercentage: summary.changePercentage,
          analysisDurationMs
        }
      );

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.logDetection('error',
        `Differential detection failed for ${options.entityType}: ${errorMessage}`,
        { analysisId, error: errorMessage, analysisDurationMs: Date.now() - startTime }
      );

      throw new Error(`Differential detection failed: ${errorMessage}`);
    }
  }

  /**
   * Detects new and modified records using timestamp comparison
   */
  private async detectNewAndModified(
    mapping: { source: string; destination: string; idField: string },
    timestampField: string,
    sinceTimestamp: Date,
    options: DifferentialAnalysisOptions,
    batchSize: number
  ): Promise<{
    newRecords: ChangeRecord[];
    modifiedRecords: ChangeRecord[];
    analyzed: number;
  }> {
    const newRecords: ChangeRecord[] = [];
    const modifiedRecords: ChangeRecord[] = [];

    // Build the source query with timestamp filtering
    let sourceQuery = `
      SELECT ${mapping.idField}, ${timestampField}, *
      FROM ${mapping.source}
      WHERE ${timestampField} >= $1
    `;

    const queryParams: any[] = [sinceTimestamp];

    if (options.untilTimestamp) {
      sourceQuery += ` AND ${timestampField} <= $2`;
      queryParams.push(options.untilTimestamp);
    }

    // Add sampling if requested
    if (options.samplePercentage && options.samplePercentage < 100) {
      sourceQuery += ` AND random() < ${options.samplePercentage / 100}`;
    }

    // Add limit if specified
    if (options.maxRecordsToAnalyze) {
      sourceQuery += ` LIMIT ${options.maxRecordsToAnalyze}`;
    }

    sourceQuery += ` ORDER BY ${mapping.idField}`;

    const sourceResult = await this.sourcePool.query(sourceQuery, queryParams);
    const sourceRecords = sourceResult.rows;

    // Process in batches
    for (let i = 0; i < sourceRecords.length; i += batchSize) {
      const batch = sourceRecords.slice(i, i + batchSize);
      const batchIds = batch.map(record => record[mapping.idField]);

      // Check which records exist in destination
      const destQuery = `
        SELECT ${mapping.idField}, ${timestampField}, legacy_${mapping.idField}
        FROM ${mapping.destination}
        WHERE legacy_${mapping.idField} = ANY($1)
      `;

      const destResult = await this.destinationPool.query(destQuery, [batchIds]);
      const destRecordMap = new Map(
        destResult.rows.map(row => [row[`legacy_${mapping.idField}`], row])
      );

      // Classify changes
      for (const sourceRecord of batch) {
        const recordId = sourceRecord[mapping.idField].toString();
        const sourceTimestamp = new Date(sourceRecord[timestampField]);
        const destRecord = destRecordMap.get(parseInt(recordId));

        if (!destRecord) {
          // New record
          newRecords.push({
            recordId,
            changeType: 'new',
            sourceTimestamp,
            contentHash: options.enableContentHashing
              ? await this.calculateContentHash(recordId, sourceRecord)
              : undefined,
            metadata: {
              sourceTable: mapping.source,
              destinationTable: mapping.destination,
              confidence: 0.95
            }
          });
        } else {
          const destTimestamp = new Date(destRecord[timestampField]);

          // Check if modified (source timestamp is newer)
          if (sourceTimestamp > destTimestamp) {
            let isModified = true;
            let contentHash: string | undefined;
            let previousContentHash: string | undefined;

            // Verify with content hash if enabled
            if (options.enableContentHashing && this.config.enableContentHashing) {
              contentHash = await this.calculateContentHash(recordId, sourceRecord);
              previousContentHash = destRecord[this.config.contentHashField!];

              // If hashes match, it's a false positive (timestamp updated but content same)
              isModified = contentHash !== previousContentHash;
            }

            if (isModified) {
              modifiedRecords.push({
                recordId,
                changeType: 'modified',
                sourceTimestamp,
                destinationTimestamp: destTimestamp,
                contentHash,
                previousContentHash,
                metadata: {
                  sourceTable: mapping.source,
                  destinationTable: mapping.destination,
                  confidence: options.enableContentHashing ? 0.98 : 0.85
                }
              });
            }
          }
        }
      }
    }

    return {
      newRecords,
      modifiedRecords,
      analyzed: sourceRecords.length
    };
  }

  /**
   * Detects deleted records by finding destination records not in source
   */
  private async detectDeleted(
    mapping: { source: string; destination: string; idField: string },
    sinceTimestamp: Date,
    batchSize: number
  ): Promise<ChangeRecord[]> {
    const deletedRecords: ChangeRecord[] = [];

    // Find destination records that don't exist in source (within timestamp window)
    const destQuery = `
      SELECT d.${mapping.idField}, d.updated_at, d.legacy_${mapping.idField}
      FROM ${mapping.destination} d
      WHERE d.updated_at >= $1
      AND NOT EXISTS (
        SELECT 1 FROM ${mapping.source} s
        WHERE s.${mapping.idField} = d.legacy_${mapping.idField}
      )
      ORDER BY d.${mapping.idField}
    `;

    const destResult = await this.destinationPool.query(destQuery, [sinceTimestamp]);

    // Process results
    for (const destRecord of destResult.rows) {
      deletedRecords.push({
        recordId: destRecord[`legacy_${mapping.idField}`].toString(),
        changeType: 'deleted',
        sourceTimestamp: new Date(destRecord.updated_at), // Use destination timestamp
        destinationTimestamp: new Date(destRecord.updated_at),
        metadata: {
          sourceTable: mapping.source,
          destinationTable: mapping.destination,
          confidence: 0.90
        }
      });
    }

    return deletedRecords;
  }

  /**
   * Calculates content hash for a record
   */
  async calculateContentHash(recordId: string, fields: object): Promise<string> {
    // Remove excluded fields and system fields
    const excludeFields = new Set([
      ...(this.config.excludeFields || []),
      'id', 'created_at', 'updated_at', 'deleted_at'
    ]);

    const filteredFields: any = {};
    Object.entries(fields).forEach(([key, value]) => {
      if (!excludeFields.has(key)) {
        // Normalize values for consistent hashing
        if (value instanceof Date) {
          filteredFields[key] = value.toISOString();
        } else if (value === null || value === undefined) {
          filteredFields[key] = null;
        } else {
          filteredFields[key] = value;
        }
      }
    });

    // Create deterministic JSON string
    const contentString = JSON.stringify(filteredFields, Object.keys(filteredFields).sort());

    // Calculate hash
    const algorithm = this.config.hashAlgorithm || 'sha256';
    const hash = createHash(algorithm).update(contentString).digest('hex');

    return `${algorithm}_${hash.substring(0, 16)}`;
  }

  /**
   * Processes records in batches for change detection
   */
  async batchDetectChanges(
    recordIds: string[],
    batchSize?: number
  ): Promise<ChangeRecord[]> {
    const actualBatchSize = batchSize || this.config.batchSize;
    const mapping = ENTITY_TABLE_MAPPING[this.entityType];

    if (!mapping) {
      throw new Error(`Unknown entity type: ${this.entityType}`);
    }

    const changes: ChangeRecord[] = [];

    for (let i = 0; i < recordIds.length; i += actualBatchSize) {
      const batch = recordIds.slice(i, i + actualBatchSize);
      const batchChanges = await this.detectChangesForBatch(batch, mapping);
      changes.push(...batchChanges);
    }

    return changes;
  }

  /**
   * Detects changes for a specific batch of records
   */
  private async detectChangesForBatch(
    recordIds: string[],
    mapping: { source: string; destination: string; idField: string }
  ): Promise<ChangeRecord[]> {
    const changes: ChangeRecord[] = [];
    const timestampField = this.config.timestampField;

    // Get source records
    const sourceQuery = `
      SELECT ${mapping.idField}, ${timestampField}, *
      FROM ${mapping.source}
      WHERE ${mapping.idField} = ANY($1)
    `;

    const destQuery = `
      SELECT ${mapping.idField}, ${timestampField}, legacy_${mapping.idField}
      FROM ${mapping.destination}
      WHERE legacy_${mapping.idField} = ANY($1)
    `;

    const numericIds = recordIds.map(id => parseInt(id));

    const [sourceResult, destResult] = await Promise.all([
      this.sourcePool.query(sourceQuery, [numericIds]),
      this.destinationPool.query(destQuery, [numericIds])
    ]);

    const sourceMap = new Map(sourceResult.rows.map(row => [row[mapping.idField], row]));
    const destMap = new Map(destResult.rows.map(row => [row[`legacy_${mapping.idField}`], row]));

    for (const recordIdStr of recordIds) {
      const recordId = parseInt(recordIdStr);
      const sourceRecord = sourceMap.get(recordId);
      const destRecord = destMap.get(recordId);

      if (sourceRecord && !destRecord) {
        // New record
        changes.push({
          recordId: recordIdStr,
          changeType: 'new',
          sourceTimestamp: new Date(sourceRecord[timestampField]),
          contentHash: this.config.enableContentHashing
            ? await this.calculateContentHash(recordIdStr, sourceRecord)
            : undefined,
          metadata: {
            sourceTable: mapping.source,
            destinationTable: mapping.destination,
            confidence: 0.95
          }
        });
      } else if (sourceRecord && destRecord) {
        const sourceTimestamp = new Date(sourceRecord[timestampField]);
        const destTimestamp = new Date(destRecord[timestampField]);

        // Check if modified
        if (sourceTimestamp > destTimestamp) {
          let isReallyModified = true;
          let contentHash: string | undefined;

          // Verify with content hash if available
          if (this.config.enableContentHashing) {
            contentHash = await this.calculateContentHash(recordIdStr, sourceRecord);
            const existingHash = destRecord[this.config.contentHashField!];

            if (existingHash && contentHash === existingHash) {
              isReallyModified = false; // False positive - timestamp changed but content same
            }
          }

          if (isReallyModified) {
            changes.push({
              recordId: recordIdStr,
              changeType: 'modified',
              sourceTimestamp,
              destinationTimestamp: destTimestamp,
              contentHash,
              metadata: {
                sourceTable: mapping.source,
                destinationTable: mapping.destination,
                confidence: this.config.enableContentHashing ? 0.98 : 0.85
              }
            });
          }
        }
      }
    }

    return changes;
  }

  /**
   * Validates timestamps for consistency
   */
  async validateTimestamps(
    sourceTimestamp: Date,
    destinationTimestamp?: Date
  ): Promise<{
    isValid: boolean;
    issues: string[];
    confidence: number;
  }> {
    const issues: string[] = [];
    let confidence = 1.0;

    // Check if source timestamp is reasonable
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000);

    if (sourceTimestamp < oneYearAgo) {
      issues.push('Source timestamp is older than 1 year - verify data accuracy');
      confidence -= 0.2;
    }

    if (sourceTimestamp > oneDayFromNow) {
      issues.push('Source timestamp is in the future - clock synchronization issue');
      confidence -= 0.3;
    }

    // Check timestamp relationship
    if (destinationTimestamp && sourceTimestamp < destinationTimestamp) {
      issues.push('Source timestamp is older than destination - potential data inconsistency');
      confidence -= 0.4;
    }

    return {
      isValid: issues.length === 0,
      issues,
      confidence: Math.max(0, confidence)
    };
  }

  /**
   * Provides query optimization recommendations
   */
  async optimizeDetectionQuery(entityType: string): Promise<{
    recommendedIndexes: Array<{
      table: string;
      columns: string[];
      type: 'btree' | 'hash' | 'composite';
      priority: 'high' | 'medium' | 'low';
    }>;
    estimatedPerformanceGain: number;
    queryOptimizations: string[];
  }> {
    const mapping = ENTITY_TABLE_MAPPING[entityType];
    if (!mapping) {
      throw new Error(`Unknown entity type: ${entityType}`);
    }

    const timestampField = mapping.timestampField || this.config.timestampField;
    const recommendedIndexes: Array<{
      table: string;
      columns: string[];
      type: 'btree' | 'hash' | 'composite';
      priority: 'high' | 'medium' | 'low';
    }> = [];
    const queryOptimizations: string[] = [];

    // Check if timestamp index exists on source table
    try {
      const indexQuery = `
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = $1
        AND indexdef ILIKE '%${timestampField}%'
      `;

      const sourceIndexes = await this.sourcePool.query(indexQuery, [mapping.source]);
      const destIndexes = await this.destinationPool.query(indexQuery, [mapping.destination]);

      // Recommend timestamp index for source if not exists
      if (sourceIndexes.rows.length === 0) {
        recommendedIndexes.push({
          table: mapping.source,
          columns: [timestampField],
          type: 'btree',
          priority: 'high'
        });
        queryOptimizations.push(`Add index on ${mapping.source}.${timestampField} for efficient timestamp queries`);
      }

      // Recommend composite index for better performance
      recommendedIndexes.push({
        table: mapping.source,
        columns: [timestampField, mapping.idField],
        type: 'composite',
        priority: 'medium'
      });

      // Recommend legacy ID index for destination joins
      recommendedIndexes.push({
        table: mapping.destination,
        columns: [`legacy_${mapping.idField}`],
        type: 'btree',
        priority: 'medium'
      });

    } catch (error) {
      queryOptimizations.push('Unable to analyze existing indexes - manual review recommended');
    }

    // Estimate performance gain based on record counts
    let estimatedPerformanceGain = 0;
    try {
      const sourceCountResult = await this.sourcePool.query(`SELECT COUNT(*) as count FROM ${mapping.source}`);
      const sourceCount = parseInt(sourceCountResult.rows[0].count);

      if (sourceCount > 10000) {
        estimatedPerformanceGain = 60; // High gain for large tables
      } else if (sourceCount > 1000) {
        estimatedPerformanceGain = 30; // Medium gain
      } else {
        estimatedPerformanceGain = 10; // Low gain
      }
    } catch (error) {
      estimatedPerformanceGain = 25; // Conservative estimate
    }

    return {
      recommendedIndexes,
      estimatedPerformanceGain,
      queryOptimizations
    };
  }

  /**
   * Generates recommendations based on detection results
   */
  private generateRecommendations(
    summary: DetectionResult['summary'],
    analysisDurationMs: number,
    options: DifferentialAnalysisOptions
  ): string[] {
    const recommendations: string[] = [];

    if (summary.changePercentage > 25) {
      recommendations.push('High change percentage detected - verify timestamp accuracy and consider data validation');
    }

    if (summary.newRecords > 1000) {
      recommendations.push('Large number of new records - consider batch processing with checkpoint intervals');
    }

    if (summary.modifiedRecords > summary.newRecords * 2) {
      recommendations.push('High modification rate - verify source data is not experiencing systematic updates');
    }

    if (analysisDurationMs > 60000) { // More than 1 minute
      recommendations.push('Analysis took longer than expected - consider adding database indexes or reducing batch size');
    }

    if (!options.enableContentHashing && this.config.enableContentHashing) {
      recommendations.push('Content hashing available but not enabled - enable for higher accuracy detection');
    }

    if (summary.totalChanges > 50000) {
      recommendations.push('Large migration detected - enable checkpoint saving and consider parallel processing');
    }

    if (summary.deletedRecords > 0 && !options.includeDeletes) {
      recommendations.push('Deleted record detection was not enabled - consider running with includeDeletes for complete analysis');
    }

    if (recommendations.length === 0) {
      recommendations.push('Change detection completed successfully - ready for migration execution');
    }

    return recommendations;
  }

  /**
   * Logs detection operations
   */
  private async logDetection(
    level: 'info' | 'warn' | 'error',
    message: string,
    contextData: object = {}
  ): Promise<void> {
    try {
      const log = MigrationExecutionLogModel.create({
        migration_session_id: this.sessionId,
        entity_type: this.entityType,
        operation_type: 'differential_detection',
        log_level: level,
        message,
        context_data: {
          service: 'DifferentialDetector',
          timestamp: new Date().toISOString(),
          ...contextData
        }
      });

      // In a real implementation, this would be persisted to the database
      console.log(`[${level.toUpperCase()}] DifferentialDetector: ${message}`, contextData);
    } catch (error) {
      // Don't let logging errors break the main functionality
      console.error('Failed to log detection operation:', error);
    }
  }
}