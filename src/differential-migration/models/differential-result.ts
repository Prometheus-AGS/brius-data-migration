/**
 * DifferentialAnalysisResult Model
 * Contains lists of new, modified, and deleted records identified for migration
 */

import { v4 as uuidv4 } from 'uuid';

// Core interfaces
export interface DifferentialAnalysisResult {
  id: string;
  entity_type: string;
  analysis_timestamp: Date;
  source_record_count: number;
  destination_record_count: number;
  new_records: string[];
  modified_records: string[];
  deleted_records: string[];
  last_migration_timestamp: Date | null;
  analysis_metadata: object;
  created_at: Date;
  updated_at: Date;
}

export interface DifferentialAnalysisCreateInput {
  entity_type: string;
  source_record_count: number;
  destination_record_count: number;
  new_records: string[];
  modified_records: string[];
  deleted_records: string[];
  last_migration_timestamp?: Date | null;
  analysis_metadata?: object;
  analysis_timestamp?: Date;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface ChangeMetrics {
  totalNewRecords: number;
  totalModifiedRecords: number;
  totalDeletedRecords: number;
  totalChanges: number;
  changePercentage: number;
  recordGap: number;
  isSignificantChange: boolean;
  requiresAttention: boolean;
}

// Valid entity types for differential analysis
const VALID_ENTITY_TYPES = [
  'offices', 'doctors', 'doctor_offices', 'patients', 'orders',
  'cases', 'files', 'case_files', 'messages', 'message_files',
  'jaw', 'dispatch_records', 'system_messages', 'message_attachments',
  'technician_roles', 'order_cases', 'purchases', 'treatment_discussions',
  'template_view_groups', 'template_view_roles'
] as const;

export type ValidEntityType = typeof VALID_ENTITY_TYPES[number];
export type RecordType = 'new' | 'modified' | 'deleted';

// Configuration constants
const MAX_TOTAL_CHANGES = 1000000; // Performance limit: 1M record changes
const SIGNIFICANT_CHANGE_THRESHOLD = 5; // 5% change rate threshold
const ATTENTION_GAP_THRESHOLD = 100; // Record gap requiring attention
const ATTENTION_VOLUME_THRESHOLD = 10000; // High volume changes requiring attention

/**
 * DifferentialAnalysisResult Model Implementation
 *
 * Provides functionality for storing and analyzing differential migration results,
 * including change calculations, record management, and performance metrics.
 */
export class DifferentialAnalysisResultModel {
  /**
   * Creates a new differential analysis result with validation
   */
  static create(input: DifferentialAnalysisCreateInput): DifferentialAnalysisResult {
    // Input validation
    if (!input.entity_type || typeof input.entity_type !== 'string') {
      throw new Error('entity_type is required and must be a string');
    }

    if (typeof input.source_record_count !== 'number' || input.source_record_count < 0) {
      throw new Error('source_record_count must be a non-negative number');
    }

    if (typeof input.destination_record_count !== 'number' || input.destination_record_count < 0) {
      throw new Error('destination_record_count must be a non-negative number');
    }

    // Validate entity type
    if (!VALID_ENTITY_TYPES.includes(input.entity_type as ValidEntityType)) {
      throw new Error(`Invalid entity_type: ${input.entity_type}. Must be one of: ${VALID_ENTITY_TYPES.join(', ')}`);
    }

    // Validate arrays
    if (!Array.isArray(input.new_records)) {
      throw new Error('new_records must be an array');
    }

    if (!Array.isArray(input.modified_records)) {
      throw new Error('modified_records must be an array');
    }

    if (!Array.isArray(input.deleted_records)) {
      throw new Error('deleted_records must be an array');
    }

    // Validate total changes don't exceed limits
    const totalChanges = input.new_records.length + input.modified_records.length + input.deleted_records.length;
    if (totalChanges > MAX_TOTAL_CHANGES) {
      throw new Error(`Total changes (${totalChanges}) exceed maximum limit of ${MAX_TOTAL_CHANGES} records`);
    }

    const now = new Date();
    const analysisTimestamp = input.analysis_timestamp || now;

    // Validate analysis timestamp is reasonable
    const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
    if (analysisTimestamp > oneHourFromNow) {
      throw new Error('analysis_timestamp cannot be more than 1 hour in the future');
    }

    const result: DifferentialAnalysisResult = {
      id: uuidv4(),
      entity_type: input.entity_type,
      analysis_timestamp: analysisTimestamp,
      source_record_count: input.source_record_count,
      destination_record_count: input.destination_record_count,
      new_records: [...input.new_records], // Create copy to avoid mutation
      modified_records: [...input.modified_records],
      deleted_records: [...input.deleted_records],
      last_migration_timestamp: input.last_migration_timestamp || null,
      analysis_metadata: input.analysis_metadata ? { ...input.analysis_metadata } : {},
      created_at: now,
      updated_at: now
    };

    // Final validation
    const validation = this.validate(result);
    if (!validation.isValid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }

    return result;
  }

  /**
   * Validates a differential analysis result against all business rules
   */
  static validate(result: DifferentialAnalysisResult): ValidationResult {
    const errors: string[] = [];

    // Validate required fields
    if (!result.id) {
      errors.push('id is required');
    }

    if (!result.entity_type) {
      errors.push('entity_type is required');
    }

    // Validate entity_type
    if (result.entity_type && !VALID_ENTITY_TYPES.includes(result.entity_type as ValidEntityType)) {
      errors.push('Invalid entity_type');
    }

    // Validate non-negative counts
    if (result.source_record_count < 0) {
      errors.push('source_record_count must be non-negative');
    }

    if (result.destination_record_count < 0) {
      errors.push('destination_record_count must be non-negative');
    }

    // Validate arrays
    if (!Array.isArray(result.new_records)) {
      errors.push('new_records must be an array');
    }

    if (!Array.isArray(result.modified_records)) {
      errors.push('modified_records must be an array');
    }

    if (!Array.isArray(result.deleted_records)) {
      errors.push('deleted_records must be an array');
    }

    // Validate analysis timestamp is reasonable
    const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
    if (result.analysis_timestamp > oneHourFromNow) {
      errors.push('analysis_timestamp cannot be more than 1 hour in the future');
    }

    // Validate total changes don't exceed limits
    const totalChanges = result.new_records.length + result.modified_records.length + result.deleted_records.length;
    if (totalChanges > MAX_TOTAL_CHANGES) {
      errors.push('Total changes exceed maximum limit of 1,000,000 records');
    }

    // Validate timestamps
    if (result.created_at > result.updated_at) {
      errors.push('updated_at must be greater than or equal to created_at');
    }

    // Validate last_migration_timestamp is before analysis_timestamp
    if (result.last_migration_timestamp && result.last_migration_timestamp > result.analysis_timestamp) {
      errors.push('last_migration_timestamp must be before analysis_timestamp');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Calculates comprehensive change metrics for the analysis result
   */
  static calculateChangeMetrics(result: DifferentialAnalysisResult): ChangeMetrics {
    const totalNewRecords = result.new_records.length;
    const totalModifiedRecords = result.modified_records.length;
    const totalDeletedRecords = result.deleted_records.length;
    const totalChanges = totalNewRecords + totalModifiedRecords + totalDeletedRecords;

    // Calculate change percentage (new + modified / source count)
    const changePercentage = result.source_record_count > 0
      ? Math.round(((totalNewRecords + totalModifiedRecords) / result.source_record_count) * 100 * 100) / 100
      : 0;

    // Calculate record gap (difference between source and destination counts)
    const recordGap = result.source_record_count - result.destination_record_count;

    // Determine if change is significant (> threshold percentage)
    const isSignificantChange = changePercentage > SIGNIFICANT_CHANGE_THRESHOLD;

    // Determine if requires attention (large gaps or high volume)
    const requiresAttention = Math.abs(recordGap) > ATTENTION_GAP_THRESHOLD || totalChanges > ATTENTION_VOLUME_THRESHOLD;

    return {
      totalNewRecords,
      totalModifiedRecords,
      totalDeletedRecords,
      totalChanges,
      changePercentage,
      recordGap,
      isSignificantChange,
      requiresAttention
    };
  }

  /**
   * Filters records by type (new, modified, deleted)
   */
  static filterRecordsByType(result: DifferentialAnalysisResult, recordType: RecordType): string[] {
    switch (recordType) {
      case 'new':
        return [...result.new_records];
      case 'modified':
        return [...result.modified_records];
      case 'deleted':
        return [...result.deleted_records];
      default:
        return [];
    }
  }

  /**
   * Gets records that require migration (new + modified)
   */
  static getRecordsForMigration(result: DifferentialAnalysisResult): string[] {
    return [...result.new_records, ...result.modified_records];
  }

  /**
   * Splits large record sets into manageable batches
   */
  static batchRecords(recordIds: string[], batchSize: number = 1000): string[][] {
    if (batchSize <= 0) {
      throw new Error('batchSize must be greater than 0');
    }

    const batches: string[][] = [];

    for (let i = 0; i < recordIds.length; i += batchSize) {
      batches.push(recordIds.slice(i, i + batchSize));
    }

    return batches;
  }

  /**
   * Estimates migration processing time based on record counts and historical data
   */
  static estimateProcessingTime(
    result: DifferentialAnalysisResult,
    options: {
      recordsPerSecond?: number;
      baselineTimeSeconds?: number;
      entityComplexityMultiplier?: number;
    } = {}
  ): {
    estimatedSeconds: number;
    estimatedMinutes: number;
    estimatedHours: number;
    formattedEstimate: string;
  } {
    const recordsToMigrate = result.new_records.length + result.modified_records.length;

    if (recordsToMigrate === 0) {
      return {
        estimatedSeconds: 0,
        estimatedMinutes: 0,
        estimatedHours: 0,
        formattedEstimate: 'No migration required'
      };
    }

    // Default processing rates based on entity complexity
    const entityComplexityMap: Record<string, number> = {
      'offices': 1.0,
      'doctors': 1.2,
      'patients': 1.5,
      'orders': 2.0,
      'cases': 2.5,
      'messages': 1.8,
      'files': 3.0,
      'jaw': 2.2
    };

    const recordsPerSecond = options.recordsPerSecond || 100; // Conservative default
    const complexityMultiplier = options.entityComplexityMultiplier ||
                                 entityComplexityMap[result.entity_type] || 1.5;
    const baselineSeconds = options.baselineTimeSeconds || 0;

    // Calculate estimated processing time
    const estimatedSeconds = Math.round(
      baselineSeconds + (recordsToMigrate / recordsPerSecond) * complexityMultiplier
    );

    const estimatedMinutes = Math.round(estimatedSeconds / 60 * 100) / 100;
    const estimatedHours = Math.round(estimatedSeconds / 3600 * 100) / 100;

    // Format human-readable estimate
    let formattedEstimate: string;
    if (estimatedSeconds < 60) {
      formattedEstimate = `${estimatedSeconds} seconds`;
    } else if (estimatedMinutes < 60) {
      formattedEstimate = `${estimatedMinutes} minutes`;
    } else {
      formattedEstimate = `${estimatedHours} hours`;
    }

    return {
      estimatedSeconds,
      estimatedMinutes,
      estimatedHours,
      formattedEstimate
    };
  }

  /**
   * Creates analysis metadata with system information
   */
  static createAnalysisMetadata(options: {
    analysisDurationMs?: number;
    comparisonMethod?: string;
    detectedSchemaChanges?: boolean;
    performanceMetrics?: object;
    analysisVersion?: string;
    additionalMetadata?: object;
  } = {}): object {
    const metadata: any = {
      analysis_version: options.analysisVersion || '1.0.0',
      analysis_timestamp: new Date().toISOString(),
      comparison_method: options.comparisonMethod || 'timestamp_based',
      detected_schema_changes: options.detectedSchemaChanges || false,
      system_info: {
        node_version: process.version,
        platform: process.platform,
        memory_usage_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
      }
    };

    if (options.analysisDurationMs) {
      metadata.analysis_duration_ms = options.analysisDurationMs;
    }

    if (options.performanceMetrics) {
      metadata.performance_metrics = options.performanceMetrics;
    }

    if (options.additionalMetadata) {
      Object.assign(metadata, options.additionalMetadata);
    }

    return metadata;
  }

  /**
   * Merges multiple analysis results for the same entity (useful for incremental analysis)
   */
  static mergeAnalysisResults(
    baseResult: DifferentialAnalysisResult,
    incrementalResult: DifferentialAnalysisResult
  ): DifferentialAnalysisResult {
    if (baseResult.entity_type !== incrementalResult.entity_type) {
      throw new Error('Cannot merge results from different entity types');
    }

    // Use the more recent analysis timestamp
    const latestTimestamp = baseResult.analysis_timestamp > incrementalResult.analysis_timestamp
      ? baseResult.analysis_timestamp
      : incrementalResult.analysis_timestamp;

    // Merge record arrays (removing duplicates)
    const mergedNewRecords = [...new Set([...baseResult.new_records, ...incrementalResult.new_records])];
    const mergedModifiedRecords = [...new Set([...baseResult.modified_records, ...incrementalResult.modified_records])];
    const mergedDeletedRecords = [...new Set([...baseResult.deleted_records, ...incrementalResult.deleted_records])];

    // Remove any records that appear in multiple categories (prioritize: deleted > modified > new)
    const finalDeletedRecords = mergedDeletedRecords;
    const finalModifiedRecords = mergedModifiedRecords.filter(id => !finalDeletedRecords.includes(id));
    const finalNewRecords = mergedNewRecords.filter(id => !finalDeletedRecords.includes(id) && !finalModifiedRecords.includes(id));

    // Use the more recent counts
    const recentResult = baseResult.analysis_timestamp > incrementalResult.analysis_timestamp
      ? baseResult
      : incrementalResult;

    const mergedMetadata = {
      ...baseResult.analysis_metadata,
      ...incrementalResult.analysis_metadata,
      merge_info: {
        merged_at: new Date().toISOString(),
        base_analysis: baseResult.id,
        incremental_analysis: incrementalResult.id,
        merge_type: 'differential_incremental'
      }
    };

    return this.create({
      entity_type: baseResult.entity_type,
      source_record_count: recentResult.source_record_count,
      destination_record_count: recentResult.destination_record_count,
      new_records: finalNewRecords,
      modified_records: finalModifiedRecords,
      deleted_records: finalDeletedRecords,
      last_migration_timestamp: recentResult.last_migration_timestamp,
      analysis_metadata: mergedMetadata,
      analysis_timestamp: latestTimestamp
    });
  }

  /**
   * Creates a summary report for the analysis result
   */
  static createSummaryReport(result: DifferentialAnalysisResult): {
    entityType: string;
    analysisTimestamp: Date;
    recordCounts: {
      source: number;
      destination: number;
      gap: number;
    };
    changes: ChangeMetrics;
    processing: {
      estimatedTime: string;
      estimatedComplexity: 'low' | 'medium' | 'high';
      recommendedBatchSize: number;
    };
    recommendations: string[];
    riskLevel: 'low' | 'medium' | 'high';
  } {
    const metrics = this.calculateChangeMetrics(result);
    const timeEstimate = this.estimateProcessingTime(result);

    // Determine processing complexity
    let estimatedComplexity: 'low' | 'medium' | 'high';
    if (metrics.totalChanges < 1000) {
      estimatedComplexity = 'low';
    } else if (metrics.totalChanges < 10000) {
      estimatedComplexity = 'medium';
    } else {
      estimatedComplexity = 'high';
    }

    // Calculate recommended batch size
    const recommendedBatchSize = this.calculateOptimalBatchSize(result);

    // Generate recommendations
    const recommendations: string[] = [];
    if (metrics.isSignificantChange) {
      recommendations.push('Significant change detected - recommend careful monitoring during migration');
    }
    if (metrics.requiresAttention) {
      recommendations.push('High volume changes or large gaps detected - consider running during off-peak hours');
    }
    if (metrics.totalChanges > 50000) {
      recommendations.push('Large migration - enable checkpoint saving and consider parallel processing');
    }
    if (Math.abs(metrics.recordGap) > 1000) {
      recommendations.push('Significant record gap detected - verify source data consistency');
    }

    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high';
    if (metrics.totalChanges < 1000 && Math.abs(metrics.recordGap) < 100) {
      riskLevel = 'low';
    } else if (metrics.totalChanges < 10000 && Math.abs(metrics.recordGap) < 1000) {
      riskLevel = 'medium';
    } else {
      riskLevel = 'high';
    }

    return {
      entityType: result.entity_type,
      analysisTimestamp: result.analysis_timestamp,
      recordCounts: {
        source: result.source_record_count,
        destination: result.destination_record_count,
        gap: metrics.recordGap
      },
      changes: metrics,
      processing: {
        estimatedTime: timeEstimate.formattedEstimate,
        estimatedComplexity,
        recommendedBatchSize
      },
      recommendations,
      riskLevel
    };
  }

  /**
   * Calculates optimal batch size based on change volume and entity complexity
   */
  static calculateOptimalBatchSize(result: DifferentialAnalysisResult): number {
    const metrics = this.calculateChangeMetrics(result);

    // Base batch size on total changes
    let batchSize: number;
    if (metrics.totalChanges < 1000) {
      batchSize = 500;
    } else if (metrics.totalChanges < 10000) {
      batchSize = 1000;
    } else if (metrics.totalChanges < 100000) {
      batchSize = 1500;
    } else {
      batchSize = 2000;
    }

    // Adjust for entity complexity
    const complexEntityTypes = ['orders', 'cases', 'files', 'messages', 'jaw'];
    if (complexEntityTypes.includes(result.entity_type)) {
      batchSize = Math.round(batchSize * 0.7); // Reduce by 30% for complex entities
    }

    // Ensure minimum and maximum bounds
    const minBatchSize = 100;
    const maxBatchSize = 2000;

    return Math.max(minBatchSize, Math.min(maxBatchSize, batchSize));
  }

  /**
   * Checks for potential data quality issues in the analysis
   */
  static checkDataQuality(result: DifferentialAnalysisResult): {
    qualityScore: number; // 0-100
    issues: Array<{
      severity: 'low' | 'medium' | 'high';
      message: string;
      recommendation: string;
    }>;
    overallAssessment: 'excellent' | 'good' | 'fair' | 'poor';
  } {
    const issues: Array<{
      severity: 'low' | 'medium' | 'high';
      message: string;
      recommendation: string;
    }> = [];

    let qualityScore = 100;

    // Check for excessive deletions
    const deletionRate = result.source_record_count > 0
      ? (result.deleted_records.length / result.source_record_count) * 100
      : 0;

    if (deletionRate > 10) {
      issues.push({
        severity: 'high',
        message: `High deletion rate: ${deletionRate.toFixed(2)}% of records marked for deletion`,
        recommendation: 'Verify deleted records are intentionally removed and not due to data issues'
      });
      qualityScore -= 30;
    } else if (deletionRate > 5) {
      issues.push({
        severity: 'medium',
        message: `Moderate deletion rate: ${deletionRate.toFixed(2)}% of records marked for deletion`,
        recommendation: 'Review deleted records to ensure they are intentionally removed'
      });
      qualityScore -= 15;
    }

    // Check for unusual modification rates
    const modificationRate = result.source_record_count > 0
      ? (result.modified_records.length / result.source_record_count) * 100
      : 0;

    if (modificationRate > 25) {
      issues.push({
        severity: 'medium',
        message: `High modification rate: ${modificationRate.toFixed(2)}% of records have changes`,
        recommendation: 'Verify modifications are expected and not due to systematic data changes'
      });
      qualityScore -= 20;
    }

    // Check for large record gaps
    const metrics = this.calculateChangeMetrics(result);
    const gapPercentage = result.source_record_count > 0
      ? Math.abs(metrics.recordGap / result.source_record_count) * 100
      : 0;

    if (gapPercentage > 15) {
      issues.push({
        severity: 'high',
        message: `Significant record gap: ${metrics.recordGap} records (${gapPercentage.toFixed(2)}%)`,
        recommendation: 'Investigate source data consistency and previous migration completeness'
      });
      qualityScore -= 25;
    } else if (gapPercentage > 5) {
      issues.push({
        severity: 'medium',
        message: `Notable record gap: ${metrics.recordGap} records (${gapPercentage.toFixed(2)}%)`,
        recommendation: 'Review migration history to understand record gap'
      });
      qualityScore -= 10;
    }

    // Check for analysis staleness
    const hoursOld = (Date.now() - result.analysis_timestamp.getTime()) / (1000 * 60 * 60);
    if (hoursOld > 24) {
      issues.push({
        severity: 'medium',
        message: `Analysis is ${hoursOld.toFixed(1)} hours old`,
        recommendation: 'Run fresh analysis to ensure data is current'
      });
      qualityScore -= 15;
    } else if (hoursOld > 6) {
      issues.push({
        severity: 'low',
        message: `Analysis is ${hoursOld.toFixed(1)} hours old`,
        recommendation: 'Consider running fresh analysis for most current data'
      });
      qualityScore -= 5;
    }

    // Determine overall assessment
    let overallAssessment: 'excellent' | 'good' | 'fair' | 'poor';
    if (qualityScore >= 90) {
      overallAssessment = 'excellent';
    } else if (qualityScore >= 75) {
      overallAssessment = 'good';
    } else if (qualityScore >= 60) {
      overallAssessment = 'fair';
    } else {
      overallAssessment = 'poor';
    }

    return {
      qualityScore: Math.max(0, qualityScore),
      issues,
      overallAssessment
    };
  }

  /**
   * Serializes analysis result for database storage
   */
  static serialize(result: DifferentialAnalysisResult): {
    id: string;
    entity_type: string;
    analysis_timestamp: string;
    source_record_count: number;
    destination_record_count: number;
    new_records: string; // JSON string
    modified_records: string; // JSON string
    deleted_records: string; // JSON string
    last_migration_timestamp: string | null;
    analysis_metadata: string; // JSON string
    created_at: string;
    updated_at: string;
  } {
    return {
      id: result.id,
      entity_type: result.entity_type,
      analysis_timestamp: result.analysis_timestamp.toISOString(),
      source_record_count: result.source_record_count,
      destination_record_count: result.destination_record_count,
      new_records: JSON.stringify(result.new_records),
      modified_records: JSON.stringify(result.modified_records),
      deleted_records: JSON.stringify(result.deleted_records),
      last_migration_timestamp: result.last_migration_timestamp?.toISOString() || null,
      analysis_metadata: JSON.stringify(result.analysis_metadata),
      created_at: result.created_at.toISOString(),
      updated_at: result.updated_at.toISOString()
    };
  }

  /**
   * Deserializes analysis result from database storage
   */
  static deserialize(data: any): DifferentialAnalysisResult {
    try {
      return {
        id: data.id,
        entity_type: data.entity_type,
        analysis_timestamp: typeof data.analysis_timestamp === 'string' ? new Date(data.analysis_timestamp) : data.analysis_timestamp,
        source_record_count: parseInt(data.source_record_count),
        destination_record_count: parseInt(data.destination_record_count),
        new_records: typeof data.new_records === 'string' ? JSON.parse(data.new_records) : data.new_records,
        modified_records: typeof data.modified_records === 'string' ? JSON.parse(data.modified_records) : data.modified_records,
        deleted_records: typeof data.deleted_records === 'string' ? JSON.parse(data.deleted_records) : data.deleted_records,
        last_migration_timestamp: data.last_migration_timestamp ? new Date(data.last_migration_timestamp) : null,
        analysis_metadata: typeof data.analysis_metadata === 'string' ? JSON.parse(data.analysis_metadata) : data.analysis_metadata,
        created_at: typeof data.created_at === 'string' ? new Date(data.created_at) : data.created_at,
        updated_at: typeof data.updated_at === 'string' ? new Date(data.updated_at) : data.updated_at
      };
    } catch (error) {
      throw new Error(`Failed to deserialize differential analysis result: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Creates a comparison between two analysis results
   */
  static compareResults(
    previousResult: DifferentialAnalysisResult,
    currentResult: DifferentialAnalysisResult
  ): {
    entityType: string;
    timeBetweenAnalysis: number; // seconds
    sourceCountChange: number;
    destinationCountChange: number;
    newRecordsTrend: number; // change in new records count
    modifiedRecordsTrend: number; // change in modified records count
    changeVelocity: number; // changes per hour
    summary: string;
  } {
    if (previousResult.entity_type !== currentResult.entity_type) {
      throw new Error('Cannot compare results from different entity types');
    }

    const timeBetweenAnalysis = Math.round(
      (currentResult.analysis_timestamp.getTime() - previousResult.analysis_timestamp.getTime()) / 1000
    );

    const sourceCountChange = currentResult.source_record_count - previousResult.source_record_count;
    const destinationCountChange = currentResult.destination_record_count - previousResult.destination_record_count;
    const newRecordsTrend = currentResult.new_records.length - previousResult.new_records.length;
    const modifiedRecordsTrend = currentResult.modified_records.length - previousResult.modified_records.length;

    // Calculate change velocity (changes per hour)
    const totalCurrentChanges = currentResult.new_records.length + currentResult.modified_records.length;
    const totalPreviousChanges = previousResult.new_records.length + previousResult.modified_records.length;
    const changeIncrease = totalCurrentChanges - totalPreviousChanges;
    const hoursElapsed = timeBetweenAnalysis / 3600;
    const changeVelocity = hoursElapsed > 0 ? Math.round((changeIncrease / hoursElapsed) * 100) / 100 : 0;

    // Generate summary
    const summary = this.generateComparisonSummary({
      entityType: currentResult.entity_type,
      timeBetweenAnalysis,
      sourceCountChange,
      destinationCountChange,
      newRecordsTrend,
      modifiedRecordsTrend,
      changeVelocity
    });

    return {
      entityType: currentResult.entity_type,
      timeBetweenAnalysis,
      sourceCountChange,
      destinationCountChange,
      newRecordsTrend,
      modifiedRecordsTrend,
      changeVelocity,
      summary
    };
  }

  /**
   * Generates a human-readable comparison summary
   */
  private static generateComparisonSummary(data: {
    entityType: string;
    timeBetweenAnalysis: number;
    sourceCountChange: number;
    destinationCountChange: number;
    newRecordsTrend: number;
    modifiedRecordsTrend: number;
    changeVelocity: number;
  }): string {
    const timeDescription = data.timeBetweenAnalysis > 3600
      ? `${Math.round(data.timeBetweenAnalysis / 3600)} hours`
      : `${Math.round(data.timeBetweenAnalysis / 60)} minutes`;

    let summary = `${data.entityType} analysis comparison over ${timeDescription}: `;

    if (data.sourceCountChange > 0) {
      summary += `+${data.sourceCountChange} source records, `;
    } else if (data.sourceCountChange < 0) {
      summary += `${data.sourceCountChange} source records, `;
    }

    if (data.destinationCountChange > 0) {
      summary += `+${data.destinationCountChange} destination records, `;
    } else if (data.destinationCountChange < 0) {
      summary += `${data.destinationCountChange} destination records, `;
    }

    if (data.newRecordsTrend > 0) {
      summary += `+${data.newRecordsTrend} new records to migrate, `;
    } else if (data.newRecordsTrend < 0) {
      summary += `${data.newRecordsTrend} fewer new records, `;
    }

    if (data.modifiedRecordsTrend > 0) {
      summary += `+${data.modifiedRecordsTrend} modified records, `;
    } else if (data.modifiedRecordsTrend < 0) {
      summary += `${data.modifiedRecordsTrend} fewer modified records, `;
    }

    summary += `change velocity: ${data.changeVelocity} changes/hour`;

    return summary.replace(', change velocity', ' - change velocity');
  }

  /**
   * Validates record ID format and uniqueness
   */
  static validateRecordIds(recordIds: string[]): {
    isValid: boolean;
    duplicates: string[];
    invalidFormats: string[];
    errors: string[];
  } {
    const errors: string[] = [];
    const seen = new Set<string>();
    const duplicates: string[] = [];
    const invalidFormats: string[] = [];

    recordIds.forEach(recordId => {
      // Check for duplicates
      if (seen.has(recordId)) {
        duplicates.push(recordId);
      } else {
        seen.add(recordId);
      }

      // Validate format (basic check for non-empty strings)
      if (!recordId || typeof recordId !== 'string' || recordId.trim().length === 0) {
        invalidFormats.push(recordId);
      }
    });

    if (duplicates.length > 0) {
      errors.push(`Found ${duplicates.length} duplicate record IDs`);
    }

    if (invalidFormats.length > 0) {
      errors.push(`Found ${invalidFormats.length} invalid record ID formats`);
    }

    return {
      isValid: errors.length === 0,
      duplicates,
      invalidFormats,
      errors
    };
  }
}