/**
 * BaselineAnalyzer Service
 * Implements database comparison logic, record counting, mapping validation, status assessment
 */

import { Pool, PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';

// Import our models
import {
  MigrationCheckpointModel,
  type MigrationCheckpoint
} from '../models/migration-checkpoint';
import {
  DifferentialAnalysisResultModel,
  type DifferentialAnalysisResult
} from '../models/differential-result';
import {
  MigrationExecutionLogModel,
  type MigrationExecutionLog
} from '../models/execution-log';

// Service interfaces
export interface DatabaseConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
  maxConnections?: number;
  idleTimeoutMs?: number;
  connectionTimeoutMs?: number;
}

export interface EntityAnalysisResult {
  entityType: string;
  sourceCount: number;
  destinationCount: number;
  recordGap: number;
  gapPercentage: number;
  hasData: boolean;
  lastMigrationTimestamp: Date | null;
  analysisTimestamp: Date;
}

export interface MappingValidationResult {
  entityType: string;
  isValid: boolean;
  missingMappings: string[];
  orphanedMappings: string[];
  schemaChanges: Array<{
    field: string;
    changeType: 'added' | 'removed' | 'modified';
    details: string;
  }>;
}

export interface BaselineAnalysisReport {
  analysisId: string;
  sessionId: string;
  totalEntities: number;
  entitiesAnalyzed: string[];
  overallStatus: 'healthy' | 'gaps_detected' | 'critical_issues';
  entityResults: EntityAnalysisResult[];
  mappingValidation: MappingValidationResult[];
  recommendations: string[];
  summary: {
    totalSourceRecords: number;
    totalDestinationRecords: number;
    overallGap: number;
    averageGapPercentage: number;
    entitiesWithGaps: number;
  };
  performanceMetrics: {
    analysisDurationMs: number;
    queriesExecuted: number;
    averageQueryTimeMs: number;
  };
  generatedAt: Date;
}

// Entity table mapping configuration
const ENTITY_TABLE_MAPPING: Record<string, { source: string; destination: string; idField: string }> = {
  offices: { source: 'dispatch_office', destination: 'offices', idField: 'id' },
  doctors: { source: 'dispatch_doctor', destination: 'doctors', idField: 'id' },
  doctor_offices: { source: 'dispatch_doctor_office', destination: 'doctor_offices', idField: 'id' },
  patients: { source: 'dispatch_patient', destination: 'patients', idField: 'id' },
  orders: { source: 'dispatch_order', destination: 'orders', idField: 'id' },
  cases: { source: 'dispatch_case', destination: 'cases', idField: 'id' },
  files: { source: 'dispatch_file', destination: 'files', idField: 'id' },
  case_files: { source: 'dispatch_case_file', destination: 'case_files', idField: 'id' },
  messages: { source: 'dispatch_message', destination: 'messages', idField: 'id' },
  message_files: { source: 'dispatch_message_file', destination: 'message_files', idField: 'id' },
  jaw: { source: 'dispatch_jaw', destination: 'jaw', idField: 'id' },
  dispatch_records: { source: 'dispatch_record', destination: 'dispatch_records', idField: 'id' },
  system_messages: { source: 'dispatch_system_message', destination: 'system_messages', idField: 'id' },
  message_attachments: { source: 'dispatch_message_attachment', destination: 'message_attachments', idField: 'id' },
  technician_roles: { source: 'dispatch_technician_role', destination: 'technician_roles', idField: 'id' },
  order_cases: { source: 'dispatch_order_case', destination: 'order_cases', idField: 'id' },
  purchases: { source: 'dispatch_purchase', destination: 'purchases', idField: 'id' },
  treatment_discussions: { source: 'dispatch_treatment_discussion', destination: 'treatment_discussions', idField: 'id' },
  template_view_groups: { source: 'dispatch_template_view_group', destination: 'template_view_groups', idField: 'id' },
  template_view_roles: { source: 'dispatch_template_view_role', destination: 'template_view_roles', idField: 'id' }
};

/**
 * BaselineAnalyzer Service Implementation
 *
 * Provides comprehensive database comparison and mapping validation functionality
 * for differential migration operations with performance optimization and error handling.
 */
export class BaselineAnalyzer {
  private sourcePool: Pool;
  private destinationPool: Pool;
  private sessionId: string;

  constructor(
    sourceConfig: DatabaseConnectionConfig,
    destinationConfig: DatabaseConnectionConfig,
    sessionId?: string
  ) {
    // Validate configurations
    const sourceValidation = BaselineAnalyzer.validateConfig(sourceConfig);
    if (!sourceValidation.isValid) {
      throw new Error(`Invalid source config: ${sourceValidation.errors.join(', ')}`);
    }

    const destValidation = BaselineAnalyzer.validateConfig(destinationConfig);
    if (!destValidation.isValid) {
      throw new Error(`Invalid destination config: ${destValidation.errors.join(', ')}`);
    }

    // Create connection pools
    this.sourcePool = new Pool({
      host: sourceConfig.host,
      port: sourceConfig.port,
      database: sourceConfig.database,
      user: sourceConfig.user,
      password: sourceConfig.password,
      ssl: sourceConfig.ssl,
      max: sourceConfig.maxConnections || 10,
      idleTimeoutMillis: sourceConfig.idleTimeoutMs || 30000,
      connectionTimeoutMillis: sourceConfig.connectionTimeoutMs || 10000
    });

    this.destinationPool = new Pool({
      host: destinationConfig.host,
      port: destinationConfig.port,
      database: destinationConfig.database,
      user: destinationConfig.user,
      password: destinationConfig.password,
      ssl: destinationConfig.ssl,
      max: destinationConfig.maxConnections || 10,
      idleTimeoutMillis: destinationConfig.idleTimeoutMs || 30000,
      connectionTimeoutMillis: destinationConfig.connectionTimeoutMs || 10000
    });

    this.sessionId = sessionId || uuidv4();
  }

  /**
   * Validates database connection configuration
   */
  static validateConfig(config: DatabaseConnectionConfig): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.host || config.host.trim().length === 0) {
      errors.push('host is required');
    }

    if (!config.database || config.database.trim().length === 0) {
      errors.push('database is required');
    }

    if (!config.user || config.user.trim().length === 0) {
      errors.push('user is required');
    }

    if (!config.password || config.password.trim().length === 0) {
      errors.push('password is required');
    }

    if (config.port && (config.port < 1 || config.port > 65535)) {
      errors.push('port must be between 1 and 65535');
    }

    if (config.maxConnections && (config.maxConnections < 1 || config.maxConnections > 50)) {
      errors.push('maxConnections must be between 1 and 50');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Analyzes a single entity for record counts and gaps
   */
  async analyzeEntity(entityType: string): Promise<EntityAnalysisResult> {
    const startTime = Date.now();

    if (!ENTITY_TABLE_MAPPING[entityType]) {
      throw new Error(`Unknown entity type: ${entityType}`);
    }

    const mapping = ENTITY_TABLE_MAPPING[entityType];

    try {
      // Get source record count
      const sourceCountQuery = `SELECT COUNT(*) as count FROM ${mapping.source}`;
      const sourceResult = await this.sourcePool.query(sourceCountQuery);
      const sourceCount = parseInt(sourceResult.rows[0].count);

      // Get destination record count
      const destCountQuery = `SELECT COUNT(*) as count FROM ${mapping.destination}`;
      const destResult = await this.destinationPool.query(destCountQuery);
      const destinationCount = parseInt(destResult.rows[0].count);

      // Get last migration timestamp
      let lastMigrationTimestamp: Date | null = null;
      try {
        const migrationQuery = `
          SELECT MAX(completed_at) as last_migration
          FROM migration_control
          WHERE entity_type = $1 AND status = 'completed'
        `;
        const migrationResult = await this.destinationPool.query(migrationQuery, [entityType]);
        if (migrationResult.rows[0].last_migration) {
          lastMigrationTimestamp = new Date(migrationResult.rows[0].last_migration);
        }
      } catch (error) {
        // Migration control table might not exist, continue without timestamp
      }

      const recordGap = sourceCount - destinationCount;
      const gapPercentage = sourceCount > 0
        ? Math.round((recordGap / sourceCount) * 100 * 100) / 100
        : 0;

      const analysisTimestamp = new Date();

      // Log the analysis
      await this.logAnalysis('baseline_analysis', 'info',
        `Analyzed ${entityType}: ${sourceCount} source, ${destinationCount} destination, gap: ${recordGap}`,
        {
          entityType,
          sourceCount,
          destinationCount,
          recordGap,
          gapPercentage,
          analysisDurationMs: Date.now() - startTime
        }
      );

      return {
        entityType,
        sourceCount,
        destinationCount,
        recordGap,
        gapPercentage,
        hasData: sourceCount > 0,
        lastMigrationTimestamp,
        analysisTimestamp
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.logAnalysis('baseline_analysis', 'error',
        `Failed to analyze ${entityType}: ${errorMessage}`,
        {
          entityType,
          error: errorMessage,
          analysisDurationMs: Date.now() - startTime
        }
      );

      throw new Error(`Failed to analyze entity ${entityType}: ${errorMessage}`);
    }
  }

  /**
   * Validates schema mappings for an entity
   */
  async validateMappings(entityType: string): Promise<MappingValidationResult> {
    const startTime = Date.now();

    if (!ENTITY_TABLE_MAPPING[entityType]) {
      throw new Error(`Unknown entity type: ${entityType}`);
    }

    const mapping = ENTITY_TABLE_MAPPING[entityType];
    const result: MappingValidationResult = {
      entityType,
      isValid: true,
      missingMappings: [],
      orphanedMappings: [],
      schemaChanges: []
    };

    try {
      // Get source table schema
      const sourceSchemaQuery = `
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position
      `;
      const sourceSchema = await this.sourcePool.query(sourceSchemaQuery, [mapping.source]);

      // Get destination table schema
      const destSchemaQuery = `
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position
      `;
      const destSchema = await this.destinationPool.query(destSchemaQuery, [mapping.destination]);

      const sourceColumns = new Map(sourceSchema.rows.map(row => [row.column_name, row]));
      const destColumns = new Map(destSchema.rows.map(row => [row.column_name, row]));

      // Check for missing mappings (fields in source but not in destination)
      for (const [columnName, columnInfo] of sourceColumns) {
        if (!destColumns.has(columnName) && !destColumns.has(`legacy_${columnName}`)) {
          result.missingMappings.push(columnName);
          result.isValid = false;
        }
      }

      // Check for orphaned mappings (fields in destination that don't map to source)
      for (const [columnName, columnInfo] of destColumns) {
        if (columnName.startsWith('legacy_')) continue; // Skip legacy ID fields
        if (['id', 'created_at', 'updated_at'].includes(columnName)) continue; // Skip standard fields

        if (!sourceColumns.has(columnName)) {
          result.orphanedMappings.push(columnName);
        }
      }

      // Check for schema changes (type mismatches)
      for (const [columnName, sourceInfo] of sourceColumns) {
        const destInfo = destColumns.get(columnName) || destColumns.get(`legacy_${columnName}`);

        if (destInfo && sourceInfo.data_type !== destInfo.data_type) {
          result.schemaChanges.push({
            field: columnName,
            changeType: 'modified',
            details: `Type changed from ${sourceInfo.data_type} to ${destInfo.data_type}`
          });
        }
      }

      // Log the validation
      await this.logAnalysis('validation',
        result.isValid ? 'info' : 'warn',
        `Mapping validation for ${entityType}: ${result.isValid ? 'valid' : 'issues found'}`,
        {
          entityType,
          isValid: result.isValid,
          missingMappings: result.missingMappings.length,
          orphanedMappings: result.orphanedMappings.length,
          schemaChanges: result.schemaChanges.length,
          analysisDurationMs: Date.now() - startTime
        }
      );

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.logAnalysis('validation', 'error',
        `Failed to validate mappings for ${entityType}: ${errorMessage}`,
        {
          entityType,
          error: errorMessage,
          analysisDurationMs: Date.now() - startTime
        }
      );

      throw new Error(`Failed to validate mappings for entity ${entityType}: ${errorMessage}`);
    }
  }

  /**
   * Analyzes all specified entities
   */
  async analyzeAllEntities(entityTypes: string[]): Promise<EntityAnalysisResult[]> {
    const results: EntityAnalysisResult[] = [];

    for (const entityType of entityTypes) {
      try {
        const result = await this.analyzeEntity(entityType);
        results.push(result);
      } catch (error) {
        // Log error but continue with other entities
        await this.logAnalysis('baseline_analysis', 'error',
          `Failed to analyze ${entityType}`,
          { entityType, error: error instanceof Error ? error.message : 'Unknown error' }
        );
      }
    }

    return results;
  }

  /**
   * Generates a comprehensive baseline analysis report
   */
  async generateBaselineReport(
    entityTypes: string[],
    sessionId?: string
  ): Promise<BaselineAnalysisReport> {
    const startTime = Date.now();
    const analysisId = uuidv4();
    const actualSessionId = sessionId || this.sessionId;
    let queriesExecuted = 0;

    try {
      await this.logAnalysis('baseline_analysis', 'info',
        `Starting baseline analysis for ${entityTypes.length} entities`,
        { entityTypes, sessionId: actualSessionId }
      );

      // Analyze entities
      const entityResults = await this.analyzeAllEntities(entityTypes);
      queriesExecuted += entityTypes.length * 2; // 2 queries per entity

      // Validate mappings
      const mappingValidation: MappingValidationResult[] = [];
      for (const entityType of entityTypes) {
        try {
          const validation = await this.validateMappings(entityType);
          mappingValidation.push(validation);
          queriesExecuted += 2; // Schema queries
        } catch (error) {
          // Continue with other entities
        }
      }

      // Calculate summary
      const totalSourceRecords = entityResults.reduce((sum, result) => sum + result.sourceCount, 0);
      const totalDestinationRecords = entityResults.reduce((sum, result) => sum + result.destinationCount, 0);
      const overallGap = totalSourceRecords - totalDestinationRecords;
      const averageGapPercentage = entityResults.length > 0
        ? Math.round((entityResults.reduce((sum, result) => sum + result.gapPercentage, 0) / entityResults.length) * 100) / 100
        : 0;
      const entitiesWithGaps = entityResults.filter(result => result.recordGap > 0).length;

      // Determine overall status
      let overallStatus: 'healthy' | 'gaps_detected' | 'critical_issues' = 'healthy';
      const hasSignificantGaps = entitiesWithGaps > 0 && averageGapPercentage > 5;
      const hasMappingIssues = mappingValidation.some(v => !v.isValid);
      const hasCriticalIssues = averageGapPercentage > 15 || mappingValidation.some(v => v.missingMappings.length > 5);

      if (hasCriticalIssues) {
        overallStatus = 'critical_issues';
      } else if (hasSignificantGaps || hasMappingIssues) {
        overallStatus = 'gaps_detected';
      }

      // Generate recommendations
      const recommendations: string[] = [];

      if (entitiesWithGaps > 0) {
        recommendations.push(`${entitiesWithGaps} entities have record gaps - investigate missing data`);
      }

      if (hasMappingIssues) {
        const entitiesWithMappingIssues = mappingValidation.filter(v => !v.isValid).length;
        recommendations.push(`${entitiesWithMappingIssues} entities have mapping validation issues - review schema changes`);
      }

      if (averageGapPercentage > 10) {
        recommendations.push('High average gap percentage - consider full re-sync for affected entities');
      }

      if (overallGap > 100000) {
        recommendations.push('Large overall gap detected - verify migration completeness');
      }

      if (recommendations.length === 0) {
        recommendations.push('All entities appear healthy - ready for differential migration');
      }

      const endTime = Date.now();
      const analysisDurationMs = endTime - startTime;
      const averageQueryTimeMs = queriesExecuted > 0 ? Math.round(analysisDurationMs / queriesExecuted) : 0;

      const report: BaselineAnalysisReport = {
        analysisId,
        sessionId: actualSessionId,
        totalEntities: entityTypes.length,
        entitiesAnalyzed: entityResults.map(r => r.entityType),
        overallStatus,
        entityResults,
        mappingValidation,
        recommendations,
        summary: {
          totalSourceRecords,
          totalDestinationRecords,
          overallGap,
          averageGapPercentage,
          entitiesWithGaps
        },
        performanceMetrics: {
          analysisDurationMs,
          queriesExecuted,
          averageQueryTimeMs
        },
        generatedAt: new Date()
      };

      // Log completion
      await this.logAnalysis('baseline_analysis', 'info',
        `Baseline analysis completed: ${overallStatus}`,
        {
          analysisId,
          totalEntities: entityTypes.length,
          overallStatus,
          totalSourceRecords,
          totalDestinationRecords,
          overallGap,
          analysisDurationMs
        }
      );

      return report;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.logAnalysis('baseline_analysis', 'error',
        `Baseline analysis failed: ${errorMessage}`,
        {
          analysisId,
          entityTypes,
          error: errorMessage,
          analysisDurationMs: Date.now() - startTime
        }
      );

      throw new Error(`Baseline analysis failed: ${errorMessage}`);
    }
  }

  /**
   * Compares schema versions between source and destination
   */
  async compareSchemaVersions(entityType: string): Promise<{
    sourceSchema: object;
    destinationSchema: object;
    differences: Array<{
      type: 'column_added' | 'column_removed' | 'column_modified' | 'constraint_changed';
      field: string;
      sourceValue: any;
      destinationValue: any;
    }>;
    isCompatible: boolean;
  }> {
    if (!ENTITY_TABLE_MAPPING[entityType]) {
      throw new Error(`Unknown entity type: ${entityType}`);
    }

    const mapping = ENTITY_TABLE_MAPPING[entityType];

    try {
      // Get detailed schema information for both tables
      const schemaQuery = `
        SELECT
          column_name,
          data_type,
          is_nullable,
          column_default,
          character_maximum_length,
          numeric_precision,
          numeric_scale
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position
      `;

      const [sourceSchema, destSchema] = await Promise.all([
        this.sourcePool.query(schemaQuery, [mapping.source]),
        this.destinationPool.query(schemaQuery, [mapping.destination])
      ]);

      const sourceColumns = new Map(sourceSchema.rows.map(row => [row.column_name, row]));
      const destColumns = new Map(destSchema.rows.map(row => [row.column_name, row]));

      const differences = [];

      // Check for added columns (in destination but not in source)
      for (const [columnName, columnInfo] of destColumns) {
        if (!sourceColumns.has(columnName) && !columnName.startsWith('legacy_') &&
            !['id', 'created_at', 'updated_at'].includes(columnName)) {
          differences.push({
            type: 'column_added' as const,
            field: columnName,
            sourceValue: null,
            destinationValue: columnInfo.data_type
          });
        }
      }

      // Check for removed columns (in source but not in destination)
      for (const [columnName, columnInfo] of sourceColumns) {
        if (!destColumns.has(columnName) && !destColumns.has(`legacy_${columnName}`)) {
          differences.push({
            type: 'column_removed' as const,
            field: columnName,
            sourceValue: columnInfo.data_type,
            destinationValue: null
          });
        }
      }

      // Check for modified columns
      for (const [columnName, sourceInfo] of sourceColumns) {
        const destInfo = destColumns.get(columnName);

        if (destInfo) {
          if (sourceInfo.data_type !== destInfo.data_type ||
              sourceInfo.is_nullable !== destInfo.is_nullable ||
              sourceInfo.character_maximum_length !== destInfo.character_maximum_length) {
            differences.push({
              type: 'column_modified' as const,
              field: columnName,
              sourceValue: {
                type: sourceInfo.data_type,
                nullable: sourceInfo.is_nullable,
                maxLength: sourceInfo.character_maximum_length
              },
              destinationValue: {
                type: destInfo.data_type,
                nullable: destInfo.is_nullable,
                maxLength: destInfo.character_maximum_length
              }
            });
          }
        }
      }

      // Determine compatibility
      const isCompatible = differences.every(diff =>
        diff.type === 'column_added' ||
        (diff.type === 'column_modified' && this.isCompatibleModification(diff))
      );

      return {
        sourceSchema: {
          table: mapping.source,
          columns: sourceSchema.rows
        },
        destinationSchema: {
          table: mapping.destination,
          columns: destSchema.rows
        },
        differences,
        isCompatible
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.logAnalysis('validation', 'error',
        `Schema comparison failed for ${entityType}: ${errorMessage}`,
        { entityType, error: errorMessage }
      );

      throw new Error(`Schema comparison failed for ${entityType}: ${errorMessage}`);
    }
  }

  /**
   * Tests database connections
   */
  async testConnections(): Promise<{
    sourceConnection: { successful: boolean; error?: string; latencyMs?: number };
    destinationConnection: { successful: boolean; error?: string; latencyMs?: number };
  }> {
    const testSource = async () => {
      const startTime = Date.now();
      try {
        const client = await this.sourcePool.connect();
        await client.query('SELECT 1');
        client.release();

        return {
          successful: true,
          latencyMs: Date.now() - startTime
        };
      } catch (error) {
        return {
          successful: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    };

    const testDestination = async () => {
      const startTime = Date.now();
      try {
        const client = await this.destinationPool.connect();
        await client.query('SELECT 1');
        client.release();

        return {
          successful: true,
          latencyMs: Date.now() - startTime
        };
      } catch (error) {
        return {
          successful: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    };

    const [sourceResult, destResult] = await Promise.all([
      testSource(),
      testDestination()
    ]);

    return {
      sourceConnection: sourceResult,
      destinationConnection: destResult
    };
  }

  /**
   * Closes database connections
   */
  async close(): Promise<void> {
    try {
      await Promise.all([
        this.sourcePool.end(),
        this.destinationPool.end()
      ]);

      await this.logAnalysis('baseline_analysis', 'info',
        'Database connections closed successfully',
        { sessionId: this.sessionId }
      );
    } catch (error) {
      await this.logAnalysis('baseline_analysis', 'error',
        'Error closing database connections',
        { error: error instanceof Error ? error.message : 'Unknown error' }
      );
    }
  }

  /**
   * Checks if a schema modification is compatible
   */
  private isCompatibleModification(diff: any): boolean {
    // Allow widening of string types
    if (diff.sourceValue?.type === 'character varying' &&
        diff.destinationValue?.type === 'character varying') {
      return (diff.destinationValue.maxLength || 0) >= (diff.sourceValue.maxLength || 0);
    }

    // Allow nullable to non-nullable if there's a default
    if (diff.sourceValue?.nullable === 'YES' &&
        diff.destinationValue?.nullable === 'NO') {
      return diff.destinationValue.default !== null;
    }

    return false;
  }

  /**
   * Logs analysis operations
   */
  private async logAnalysis(
    operationType: 'baseline_analysis' | 'validation',
    level: 'info' | 'warn' | 'error',
    message: string,
    contextData: object = {}
  ): Promise<void> {
    try {
      const log = MigrationExecutionLogModel.create({
        migration_session_id: this.sessionId,
        operation_type: operationType,
        log_level: level,
        message,
        context_data: {
          service: 'BaselineAnalyzer',
          timestamp: new Date().toISOString(),
          ...contextData
        }
      });

      // In a real implementation, this would be persisted to the database
      console.log(`[${level.toUpperCase()}] ${message}`, contextData);
    } catch (error) {
      // Don't let logging errors break the main functionality
      console.error('Failed to log analysis operation:', error);
    }
  }
}