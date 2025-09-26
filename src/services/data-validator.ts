// Data Validator Service
// Provides comprehensive validation checks for data integrity and consistency

import { Pool } from 'pg';
import { MigrationValidationReportModel } from '../models/migration-validation-report';
import { DataComparatorService } from './data-comparator';
import { SyncLoggerService, OperationLogger } from './sync-logger';
import {
  ValidationType,
  ValidationOptions,
  ValidationResponse,
  ValidationReport,
  ValidationIssue,
  MigrationValidationReport,
  ValidationError
} from '../types/migration-types';

export interface ValidationConfig {
  defaultSamplingRate?: number;
  defaultTimeout?: number;
  enablePerformanceChecks?: boolean;
  maxIssuesPerType?: number;
}

export interface DataIntegrityResult {
  entityType: string;
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  issues: ValidationIssue[];
  constraints: ConstraintValidationResult[];
}

export interface RelationshipIntegrityResult {
  entityType: string;
  relationships: RelationshipCheck[];
  orphanedRecords: number;
  brokenReferences: number;
  issues: ValidationIssue[];
}

export interface CompletenessResult {
  entityType: string;
  expectedRecords: number;
  actualRecords: number;
  missingRecords: number;
  unexpectedRecords: number;
  completenessPercentage: number;
  issues: ValidationIssue[];
}

export interface PerformanceResult {
  entityType: string;
  queryPerformance: QueryPerformanceMetric[];
  indexUsage: IndexUsageMetric[];
  slowQueries: SlowQueryInfo[];
  recommendations: string[];
}

export interface ConstraintValidationResult {
  constraintName: string;
  constraintType: string;
  violationCount: number;
  sampleViolations: any[];
}

export interface RelationshipCheck {
  relationshipName: string;
  sourceTable: string;
  targetTable: string;
  sourceColumn: string;
  targetColumn: string;
  orphanedCount: number;
  sampleOrphans: any[];
}

export interface QueryPerformanceMetric {
  query: string;
  executionTime: number;
  recordsReturned: number;
  indexesUsed: string[];
}

export interface IndexUsageMetric {
  indexName: string;
  tableName: string;
  usageCount: number;
  lastUsed?: Date;
}

export interface SlowQueryInfo {
  query: string;
  executionTime: number;
  frequency: number;
  explanation: string;
}

export class DataValidatorService {
  private reportModel: MigrationValidationReportModel;
  private comparatorService: DataComparatorService;
  private logger: SyncLoggerService;
  private config: Required<ValidationConfig>;

  constructor(
    private sourceDb: Pool,
    private targetDb: Pool,
    config: ValidationConfig = {},
    private projectRoot: string = process.cwd()
  ) {
    this.reportModel = new MigrationValidationReportModel(targetDb);
    this.comparatorService = new DataComparatorService(sourceDb, targetDb, projectRoot);
    this.logger = new SyncLoggerService({
      logDir: `${projectRoot}/logs`,
      enableConsole: true,
      structuredFormat: true
    });

    this.config = {
      defaultSamplingRate: config.defaultSamplingRate || 0.1, // 10%
      defaultTimeout: config.defaultTimeout || 300000, // 5 minutes
      enablePerformanceChecks: config.enablePerformanceChecks ?? true,
      maxIssuesPerType: config.maxIssuesPerType || 100
    };
  }

  /**
   * Perform comprehensive validation across all types
   */
  async validateAll(options: ValidationOptions): Promise<ValidationResponse> {
    const operationLogger = this.logger.startOperation(
      'validation' as any,
      options.entities.join(','),
      `validate_all_${Date.now()}`
    );

    const startTime = Date.now();
    const reports: ValidationReport[] = [];

    try {
      operationLogger.info('Starting comprehensive validation', {
        validation_type: options.validationType,
        entities: options.entities,
        sampling_rate: options.samplingRate || this.config.defaultSamplingRate
      });

      // Run all validation types
      const validationTypes = [
        ValidationType.DATA_INTEGRITY,
        ValidationType.RELATIONSHIP_INTEGRITY,
        ValidationType.COMPLETENESS_CHECK
      ];

      if (this.config.enablePerformanceChecks) {
        validationTypes.push(ValidationType.PERFORMANCE_CHECK);
      }

      for (const validationType of validationTypes) {
        try {
          const typeReports = await this.validateByType({
            ...options,
            validationType
          });

          reports.push(...typeReports.reports);
        } catch (error) {
          operationLogger.error(`Validation failed for type ${validationType}`, error as Error);

          // Add error as validation issue
          reports.push({
            entity: 'system',
            recordsChecked: 0,
            issuesFound: 1,
            issues: [{
              type: 'validation_error',
              description: `Failed to validate ${validationType}: ${error.message}`,
              affectedRecords: 0
            }]
          });
        }
      }

      const executionTime = Date.now() - startTime;
      const totalRecordsValidated = reports.reduce((sum, r) => sum + r.recordsChecked, 0);
      const totalIssues = reports.reduce((sum, r) => sum + r.issuesFound, 0);
      const validationPassed = totalIssues === 0;

      // Generate comprehensive validation response
      const response = await this.reportModel.generateValidationResponse(
        options.validationType,
        options.entities,
        reports
      );

      operationLogger.logValidation(
        response.validationId,
        options.entities.join(','),
        totalRecordsValidated,
        validationPassed,
        totalIssues,
        executionTime
      );

      operationLogger.complete(totalRecordsValidated, validationPassed ? totalRecordsValidated : 0, validationPassed ? 0 : 1);

      return response;

    } catch (error) {
      operationLogger.fail(error as Error);
      throw new ValidationError(`Comprehensive validation failed: ${error.message}`, options.validationType);
    }
  }

  /**
   * Validate specific type across entities
   */
  async validateByType(options: ValidationOptions): Promise<ValidationResponse> {
    const operationLogger = this.logger.startOperation(
      'validation' as any,
      options.entities.join(','),
      `validate_${options.validationType}_${Date.now()}`
    );

    try {
      operationLogger.info('Starting type-specific validation', {
        validation_type: options.validationType,
        entities: options.entities
      });

      const reports: ValidationReport[] = [];

      for (const entity of options.entities) {
        const report = await this.validateEntity(entity, options, operationLogger);
        reports.push(report);
      }

      // Generate validation response
      const response = await this.reportModel.generateValidationResponse(
        options.validationType,
        options.entities,
        reports
      );

      operationLogger.info('Type-specific validation completed', {
        validation_id: response.validationId,
        records_validated: response.recordsValidated,
        validation_passed: response.validationPassed,
        discrepancies: response.discrepanciesFound
      });

      return response;

    } catch (error) {
      operationLogger.error('Type-specific validation failed', error as Error);
      throw new ValidationError(
        `Validation failed for type ${options.validationType}: ${error.message}`,
        options.validationType
      );
    }
  }

  /**
   * Validate a specific entity
   */
  private async validateEntity(
    entity: string,
    options: ValidationOptions,
    logger: OperationLogger
  ): Promise<ValidationReport> {
    logger.info(`Validating entity: ${entity}`, {
      validation_type: options.validationType,
      entity
    });

    try {
      switch (options.validationType) {
        case ValidationType.DATA_INTEGRITY:
          return await this.validateDataIntegrity(entity, options, logger);

        case ValidationType.RELATIONSHIP_INTEGRITY:
          return await this.validateRelationshipIntegrity(entity, options, logger);

        case ValidationType.COMPLETENESS_CHECK:
          return await this.validateCompleteness(entity, options, logger);

        case ValidationType.PERFORMANCE_CHECK:
          return await this.validatePerformance(entity, options, logger);

        default:
          throw new ValidationError(`Unsupported validation type: ${options.validationType}`, options.validationType, entity);
      }
    } catch (error) {
      logger.error(`Entity validation failed for ${entity}`, error as Error);

      return {
        entity,
        recordsChecked: 0,
        issuesFound: 1,
        issues: [{
          type: 'validation_error',
          description: `Validation failed: ${error.message}`,
          affectedRecords: 0
        }]
      };
    }
  }

  /**
   * Validate data integrity (constraints, data types, etc.)
   */
  private async validateDataIntegrity(
    entity: string,
    options: ValidationOptions,
    logger: OperationLogger
  ): Promise<ValidationReport> {
    const { targetTable } = this.getTableNames(entity);
    const samplingRate = options.samplingRate || this.config.defaultSamplingRate;

    logger.info(`Starting data integrity validation for ${entity}`);

    try {
      // Get total record count
      const totalRecords = await this.getRecordCount(this.targetDb, targetTable);
      const sampleSize = Math.max(1, Math.floor(totalRecords * samplingRate));

      const issues: ValidationIssue[] = [];

      // Check for NULL values in required fields
      const nullChecks = await this.checkNullConstraints(targetTable, sampleSize);
      issues.push(...nullChecks);

      // Check for invalid data types/formats
      const typeChecks = await this.checkDataTypes(targetTable, entity, sampleSize);
      issues.push(...typeChecks);

      // Check for unique constraint violations
      const uniqueChecks = await this.checkUniqueConstraints(targetTable, sampleSize);
      issues.push(...uniqueChecks);

      // Check for check constraint violations
      const checkConstraints = await this.checkConstraintViolations(targetTable, sampleSize);
      issues.push(...checkConstraints);

      logger.info(`Data integrity validation completed for ${entity}`, {
        records_checked: sampleSize,
        issues_found: issues.length
      });

      return {
        entity,
        recordsChecked: sampleSize,
        issuesFound: issues.length,
        issues: issues.slice(0, this.config.maxIssuesPerType)
      };

    } catch (error) {
      throw new ValidationError(`Data integrity validation failed for ${entity}: ${error.message}`, ValidationType.DATA_INTEGRITY, entity);
    }
  }

  /**
   * Validate relationship integrity (foreign keys, references)
   */
  private async validateRelationshipIntegrity(
    entity: string,
    options: ValidationOptions,
    logger: OperationLogger
  ): Promise<ValidationReport> {
    const { targetTable } = this.getTableNames(entity);
    const samplingRate = options.samplingRate || this.config.defaultSamplingRate;

    logger.info(`Starting relationship integrity validation for ${entity}`);

    try {
      const totalRecords = await this.getRecordCount(this.targetDb, targetTable);
      const sampleSize = Math.max(1, Math.floor(totalRecords * samplingRate));

      const issues: ValidationIssue[] = [];

      // Get foreign key relationships for this entity
      const relationships = await this.getForeignKeyRelationships(targetTable);

      for (const relationship of relationships) {
        const orphanedRecords = await this.checkForeignKeyIntegrity(
          targetTable,
          relationship,
          sampleSize
        );

        if (orphanedRecords.length > 0) {
          issues.push({
            type: 'foreign_key_violation',
            description: `${orphanedRecords.length} records have invalid ${relationship.sourceColumn} references`,
            affectedRecords: orphanedRecords.length
          });
        }
      }

      // Check for circular references
      const circularRefs = await this.checkCircularReferences(targetTable, entity);
      if (circularRefs.length > 0) {
        issues.push({
          type: 'circular_reference',
          description: `Found ${circularRefs.length} circular references`,
          affectedRecords: circularRefs.length
        });
      }

      logger.info(`Relationship integrity validation completed for ${entity}`, {
        relationships_checked: relationships.length,
        records_checked: sampleSize,
        issues_found: issues.length
      });

      return {
        entity,
        recordsChecked: sampleSize,
        issuesFound: issues.length,
        issues: issues.slice(0, this.config.maxIssuesPerType)
      };

    } catch (error) {
      throw new ValidationError(`Relationship integrity validation failed for ${entity}: ${error.message}`, ValidationType.RELATIONSHIP_INTEGRITY, entity);
    }
  }

  /**
   * Validate completeness (compare with source)
   */
  private async validateCompleteness(
    entity: string,
    options: ValidationOptions,
    logger: OperationLogger
  ): Promise<ValidationReport> {
    logger.info(`Starting completeness validation for ${entity}`);

    try {
      // Use data comparator to check completeness
      const comparisonResult = await this.comparatorService.compareEntity(entity, {
        batchSize: 1000,
        entityTypes: [entity]
      });

      const issues: ValidationIssue[] = [];

      // Missing records
      if (comparisonResult.missing.count > 0) {
        issues.push({
          type: 'missing_records',
          description: `${comparisonResult.missing.count} records are missing from target database`,
          affectedRecords: comparisonResult.missing.count
        });
      }

      // Unexpected records (in target but not source)
      if (comparisonResult.deleted.count > 0) {
        issues.push({
          type: 'unexpected_records',
          description: `${comparisonResult.deleted.count} records exist in target but not in source`,
          affectedRecords: comparisonResult.deleted.count
        });
      }

      // Conflicted records
      if (comparisonResult.conflicted.count > 0) {
        issues.push({
          type: 'data_conflicts',
          description: `${comparisonResult.conflicted.count} records have data conflicts between source and target`,
          affectedRecords: comparisonResult.conflicted.count
        });
      }

      const totalChecked = comparisonResult.totalSource + comparisonResult.totalTarget;

      logger.info(`Completeness validation completed for ${entity}`, {
        source_records: comparisonResult.totalSource,
        target_records: comparisonResult.totalTarget,
        missing: comparisonResult.missing.count,
        conflicts: comparisonResult.conflicted.count,
        issues_found: issues.length
      });

      return {
        entity,
        recordsChecked: totalChecked,
        issuesFound: issues.length,
        issues: issues.slice(0, this.config.maxIssuesPerType)
      };

    } catch (error) {
      throw new ValidationError(`Completeness validation failed for ${entity}: ${error.message}`, ValidationType.COMPLETENESS_CHECK, entity);
    }
  }

  /**
   * Validate performance (query performance, index usage)
   */
  private async validatePerformance(
    entity: string,
    options: ValidationOptions,
    logger: OperationLogger
  ): Promise<ValidationReport> {
    if (!this.config.enablePerformanceChecks) {
      return {
        entity,
        recordsChecked: 0,
        issuesFound: 0,
        issues: []
      };
    }

    const { targetTable } = this.getTableNames(entity);

    logger.info(`Starting performance validation for ${entity}`);

    try {
      const issues: ValidationIssue[] = [];

      // Check query performance
      const performanceIssues = await this.checkQueryPerformance(targetTable, entity);
      issues.push(...performanceIssues);

      // Check index usage
      const indexIssues = await this.checkIndexUsage(targetTable);
      issues.push(...indexIssues);

      // Check for table bloat
      const bloatIssues = await this.checkTableBloat(targetTable);
      issues.push(...bloatIssues);

      logger.info(`Performance validation completed for ${entity}`, {
        performance_checks: performanceIssues.length,
        index_checks: indexIssues.length,
        issues_found: issues.length
      });

      return {
        entity,
        recordsChecked: 1, // Performance checks don't check individual records
        issuesFound: issues.length,
        issues: issues.slice(0, this.config.maxIssuesPerType)
      };

    } catch (error) {
      throw new ValidationError(`Performance validation failed for ${entity}: ${error.message}`, ValidationType.PERFORMANCE_CHECK, entity);
    }
  }

  /**
   * Check NULL constraint violations
   */
  private async checkNullConstraints(tableName: string, sampleSize: number): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      // Get NOT NULL columns
      const columnQuery = `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = $1 AND is_nullable = 'NO'
      `;

      const columnResult = await this.targetDb.query(columnQuery, [tableName]);

      for (const column of columnResult.rows) {
        const nullCheckQuery = `
          SELECT COUNT(*) as null_count
          FROM ${tableName}
          WHERE ${column.column_name} IS NULL
          LIMIT $1
        `;

        const nullResult = await this.targetDb.query(nullCheckQuery, [sampleSize]);
        const nullCount = parseInt(nullResult.rows[0].null_count);

        if (nullCount > 0) {
          issues.push({
            type: 'null_constraint_violation',
            description: `Column ${column.column_name} has ${nullCount} NULL values`,
            affectedRecords: nullCount
          });
        }
      }
    } catch (error) {
      console.warn(`Failed to check NULL constraints for ${tableName}:`, error.message);
    }

    return issues;
  }

  /**
   * Check data type issues
   */
  private async checkDataTypes(tableName: string, entity: string, sampleSize: number): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      // Entity-specific data type checks
      switch (entity) {
        case 'profiles':
          // Check email format
          const emailQuery = `
            SELECT COUNT(*) as invalid_count
            FROM ${tableName}
            WHERE email IS NOT NULL AND email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$'
            LIMIT $1
          `;
          const emailResult = await this.targetDb.query(emailQuery, [sampleSize]);
          const invalidEmails = parseInt(emailResult.rows[0].invalid_count);

          if (invalidEmails > 0) {
            issues.push({
              type: 'invalid_email_format',
              description: `${invalidEmails} records have invalid email format`,
              affectedRecords: invalidEmails
            });
          }
          break;

        case 'patients':
          // Check date of birth validity
          const dobQuery = `
            SELECT COUNT(*) as invalid_count
            FROM ${tableName}
            WHERE date_of_birth > CURRENT_DATE OR date_of_birth < '1900-01-01'
            LIMIT $1
          `;
          const dobResult = await this.targetDb.query(dobQuery, [sampleSize]);
          const invalidDobs = parseInt(dobResult.rows[0].invalid_count);

          if (invalidDobs > 0) {
            issues.push({
              type: 'invalid_date_of_birth',
              description: `${invalidDobs} records have invalid date of birth`,
              affectedRecords: invalidDobs
            });
          }
          break;
      }
    } catch (error) {
      console.warn(`Failed to check data types for ${tableName}:`, error.message);
    }

    return issues;
  }

  /**
   * Check unique constraint violations
   */
  private async checkUniqueConstraints(tableName: string, sampleSize: number): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      // Get unique constraints
      const constraintQuery = `
        SELECT tc.constraint_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name = $1 AND tc.constraint_type = 'UNIQUE'
      `;

      const constraintResult = await this.targetDb.query(constraintQuery, [tableName]);

      for (const constraint of constraintResult.rows) {
        const duplicateQuery = `
          SELECT ${constraint.column_name}, COUNT(*) as duplicate_count
          FROM ${tableName}
          WHERE ${constraint.column_name} IS NOT NULL
          GROUP BY ${constraint.column_name}
          HAVING COUNT(*) > 1
          LIMIT $1
        `;

        const duplicateResult = await this.targetDb.query(duplicateQuery, [sampleSize]);

        if (duplicateResult.rows.length > 0) {
          const totalDuplicates = duplicateResult.rows.reduce((sum, row) => sum + parseInt(row.duplicate_count), 0);
          issues.push({
            type: 'unique_constraint_violation',
            description: `${totalDuplicates} duplicate values found in ${constraint.column_name}`,
            affectedRecords: totalDuplicates
          });
        }
      }
    } catch (error) {
      console.warn(`Failed to check unique constraints for ${tableName}:`, error.message);
    }

    return issues;
  }

  /**
   * Check constraint violations (CHECK constraints)
   */
  private async checkConstraintViolations(tableName: string, sampleSize: number): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    // This would require parsing CHECK constraint definitions
    // For now, return empty array
    return issues;
  }

  /**
   * Get foreign key relationships for a table
   */
  private async getForeignKeyRelationships(tableName: string): Promise<RelationshipCheck[]> {
    const query = `
      SELECT
        tc.constraint_name,
        kcu.column_name as source_column,
        ccu.table_name as target_table,
        ccu.column_name as target_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = $1
    `;

    const result = await this.targetDb.query(query, [tableName]);

    return result.rows.map(row => ({
      relationshipName: row.constraint_name,
      sourceTable: tableName,
      targetTable: row.target_table,
      sourceColumn: row.source_column,
      targetColumn: row.target_column,
      orphanedCount: 0,
      sampleOrphans: []
    }));
  }

  /**
   * Check foreign key integrity
   */
  private async checkForeignKeyIntegrity(
    tableName: string,
    relationship: RelationshipCheck,
    sampleSize: number
  ): Promise<any[]> {
    const query = `
      SELECT s.${relationship.sourceColumn}
      FROM ${tableName} s
      LEFT JOIN ${relationship.targetTable} t
        ON s.${relationship.sourceColumn} = t.${relationship.targetColumn}
      WHERE s.${relationship.sourceColumn} IS NOT NULL
        AND t.${relationship.targetColumn} IS NULL
      LIMIT $1
    `;

    try {
      const result = await this.targetDb.query(query, [sampleSize]);
      return result.rows;
    } catch (error) {
      console.warn(`Failed to check FK integrity for ${relationship.relationshipName}:`, error.message);
      return [];
    }
  }

  /**
   * Check for circular references
   */
  private async checkCircularReferences(tableName: string, entity: string): Promise<any[]> {
    // Simplified circular reference check
    // This would need more sophisticated logic for complex cases
    return [];
  }

  /**
   * Check query performance
   */
  private async checkQueryPerformance(tableName: string, entity: string): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      // Test common queries for performance
      const testQueries = [
        `SELECT COUNT(*) FROM ${tableName}`,
        `SELECT * FROM ${tableName} ORDER BY created_at DESC LIMIT 100`
      ];

      for (const query of testQueries) {
        const startTime = Date.now();

        try {
          await this.targetDb.query(query);
          const executionTime = Date.now() - startTime;

          if (executionTime > 5000) { // 5 seconds
            issues.push({
              type: 'slow_query',
              description: `Query took ${executionTime}ms to execute: ${query.substring(0, 50)}...`,
              affectedRecords: 1
            });
          }
        } catch (error) {
          issues.push({
            type: 'query_error',
            description: `Query failed: ${error.message}`,
            affectedRecords: 1
          });
        }
      }
    } catch (error) {
      console.warn(`Failed to check query performance for ${tableName}:`, error.message);
    }

    return issues;
  }

  /**
   * Check index usage
   */
  private async checkIndexUsage(tableName: string): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      // Check if table has appropriate indexes
      const indexQuery = `
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = $1
      `;

      const result = await this.targetDb.query(indexQuery, [tableName]);

      if (result.rows.length === 1) { // Only primary key index
        issues.push({
          type: 'missing_indexes',
          description: `Table may benefit from additional indexes for frequently queried columns`,
          affectedRecords: 1
        });
      }
    } catch (error) {
      console.warn(`Failed to check index usage for ${tableName}:`, error.message);
    }

    return issues;
  }

  /**
   * Check table bloat
   */
  private async checkTableBloat(tableName: string): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      // Basic table size check
      const sizeQuery = `
        SELECT pg_size_pretty(pg_total_relation_size($1)) as table_size,
               pg_total_relation_size($1) as size_bytes
      `;

      const result = await this.targetDb.query(sizeQuery, [tableName]);
      const sizeBytes = parseInt(result.rows[0].size_bytes);

      // If table is larger than 1GB, flag for review
      if (sizeBytes > 1024 * 1024 * 1024) {
        issues.push({
          type: 'large_table',
          description: `Table size is ${result.rows[0].table_size}, consider partitioning or archiving`,
          affectedRecords: 1
        });
      }
    } catch (error) {
      console.warn(`Failed to check table bloat for ${tableName}:`, error.message);
    }

    return issues;
  }

  /**
   * Get record count for a table
   */
  private async getRecordCount(db: Pool, tableName: string): Promise<number> {
    try {
      const result = await db.query(`SELECT COUNT(*) as count FROM ${tableName}`);
      return parseInt(result.rows[0].count);
    } catch (error) {
      console.warn(`Failed to get record count for ${tableName}:`, error.message);
      return 0;
    }
  }

  /**
   * Get table names for entity
   */
  private getTableNames(entityType: string): { sourceTable: string; targetTable: string } {
    const mapping = {
      'offices': { source: 'dispatch_offices', target: 'offices' },
      'profiles': { source: 'dispatch_user_profiles', target: 'profiles' },
      'doctors': { source: 'dispatch_doctors', target: 'doctors' },
      'patients': { source: 'dispatch_patients', target: 'patients' },
      'orders': { source: 'dispatch_orders', target: 'orders' },
      'products': { source: 'dispatch_products', target: 'products' },
      'jaws': { source: 'dispatch_jaws', target: 'jaws' },
      'projects': { source: 'dispatch_projects', target: 'projects' },
      'treatment-plans': { source: 'dispatch_treatment_plans', target: 'treatment_plans' }
    };

    const tables = mapping[entityType as keyof typeof mapping];
    if (!tables) {
      throw new ValidationError(`Unknown entity type: ${entityType}`, undefined, entityType);
    }

    return { sourceTable: tables.source, targetTable: tables.target };
  }

  /**
   * Get validation summary for dashboard
   */
  async getValidationSummary(): Promise<any> {
    try {
      return await this.reportModel.getValidationSummary();
    } catch (error) {
      throw new ValidationError(`Failed to get validation summary: ${error.message}`);
    }
  }

  /**
   * Cleanup old validation reports
   */
  async cleanup(): Promise<number> {
    try {
      return await this.reportModel.cleanup();
    } catch (error) {
      throw new ValidationError(`Failed to cleanup validation reports: ${error.message}`);
    }
  }
}