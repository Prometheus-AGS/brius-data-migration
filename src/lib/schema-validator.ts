/**
 * Database Schema Validation Utilities
 *
 * Comprehensive schema validation system for the database migration process.
 * Validates table structures, relationships, constraints, and data integrity
 * across source and destination databases.
 */

import { Pool, PoolClient } from 'pg';
import { getLogger, Logger, DatabaseError, ValidationError } from './error-handler';
import { dbConnections, DatabaseConnectionManager } from './database-connections';

// ===== SCHEMA TYPES =====

export interface TableSchema {
  table_name: string;
  schema_name: string;
  table_type: 'BASE TABLE' | 'VIEW' | 'MATERIALIZED VIEW';
  is_insertable_into: boolean;
  comment?: string;
}

export interface ColumnSchema {
  table_name: string;
  column_name: string;
  ordinal_position: number;
  column_default?: string;
  is_nullable: boolean;
  data_type: string;
  character_maximum_length?: number;
  numeric_precision?: number;
  numeric_scale?: number;
  is_identity: boolean;
  identity_generation?: string;
  is_generated: boolean;
  generation_expression?: string;
  comment?: string;
}

export interface IndexSchema {
  table_name: string;
  index_name: string;
  is_unique: boolean;
  is_primary: boolean;
  index_type: string;
  columns: string[];
  condition?: string;
  comment?: string;
}

export interface ConstraintSchema {
  table_name: string;
  constraint_name: string;
  constraint_type: 'PRIMARY KEY' | 'FOREIGN KEY' | 'UNIQUE' | 'CHECK' | 'EXCLUDE';
  column_names: string[];
  foreign_table_name?: string;
  foreign_column_names?: string[];
  match_option?: string;
  update_rule?: string;
  delete_rule?: string;
  check_clause?: string;
  is_deferrable: boolean;
  initially_deferred: boolean;
}

export interface DatabaseSchema {
  tables: TableSchema[];
  columns: ColumnSchema[];
  indexes: IndexSchema[];
  constraints: ConstraintSchema[];
  functions?: FunctionSchema[];
  triggers?: TriggerSchema[];
  sequences?: SequenceSchema[];
}

export interface FunctionSchema {
  function_name: string;
  schema_name: string;
  return_type: string;
  argument_types: string[];
  language: string;
  definition: string;
}

export interface TriggerSchema {
  trigger_name: string;
  table_name: string;
  event_manipulation: string;
  trigger_timing: 'BEFORE' | 'AFTER' | 'INSTEAD OF';
  action_statement: string;
}

export interface SequenceSchema {
  sequence_name: string;
  schema_name: string;
  data_type: string;
  start_value: number;
  minimum_value: number;
  maximum_value: number;
  increment: number;
  cycle_option: boolean;
}

// ===== VALIDATION TYPES =====

export enum ValidationSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical'
}

export enum ValidationType {
  TABLE_EXISTENCE = 'table_existence',
  COLUMN_DEFINITION = 'column_definition',
  DATA_TYPE_COMPATIBILITY = 'data_type_compatibility',
  CONSTRAINT_VALIDATION = 'constraint_validation',
  INDEX_VALIDATION = 'index_validation',
  REFERENTIAL_INTEGRITY = 'referential_integrity',
  SCHEMA_COMPARISON = 'schema_comparison',
  DATA_CONSISTENCY = 'data_consistency'
}

export interface ValidationIssue {
  id: string;
  type: ValidationType;
  severity: ValidationSeverity;
  message: string;
  details: Record<string, any>;
  table_name?: string;
  column_name?: string;
  constraint_name?: string;
  recommendation?: string;
  auto_fixable: boolean;
}

export interface ValidationResult {
  database_name: string;
  validation_timestamp: Date;
  overall_status: 'passed' | 'warning' | 'failed';
  total_checks: number;
  passed_checks: number;
  warning_count: number;
  error_count: number;
  critical_count: number;
  issues: ValidationIssue[];
  schema_summary: {
    table_count: number;
    column_count: number;
    constraint_count: number;
    index_count: number;
  };
  execution_time_ms: number;
}

export interface SchemaComparisonResult {
  source_schema: string;
  destination_schema: string;
  comparison_timestamp: Date;
  tables_missing_in_destination: string[];
  tables_extra_in_destination: string[];
  column_differences: ColumnDifference[];
  constraint_differences: ConstraintDifference[];
  index_differences: IndexDifference[];
  compatibility_score: number; // 0-100
  migration_complexity: 'low' | 'medium' | 'high' | 'critical';
}

export interface ColumnDifference {
  table_name: string;
  column_name: string;
  difference_type: 'missing' | 'extra' | 'type_mismatch' | 'nullable_mismatch' | 'default_mismatch';
  source_definition?: ColumnSchema;
  destination_definition?: ColumnSchema;
  compatibility_impact: 'none' | 'low' | 'medium' | 'high';
}

export interface ConstraintDifference {
  table_name: string;
  constraint_name: string;
  difference_type: 'missing' | 'extra' | 'definition_mismatch';
  source_definition?: ConstraintSchema;
  destination_definition?: ConstraintSchema;
  impact_level: 'none' | 'low' | 'medium' | 'high';
}

export interface IndexDifference {
  table_name: string;
  index_name: string;
  difference_type: 'missing' | 'extra' | 'definition_mismatch';
  source_definition?: IndexSchema;
  destination_definition?: IndexSchema;
  performance_impact: 'none' | 'low' | 'medium' | 'high';
}

// ===== SCHEMA VALIDATOR CLASS =====

export class SchemaValidator {
  private logger: Logger;
  private dbManager: DatabaseConnectionManager;

  constructor(dbManager?: DatabaseConnectionManager) {
    this.logger = getLogger();
    this.dbManager = dbManager || dbConnections;
  }

  /**
   * Validate database schema
   */
  async validateSchema(
    poolName: string,
    options?: {
      includeTables?: string[];
      excludeTables?: string[];
      validationTypes?: ValidationType[];
      schemaName?: string;
    }
  ): Promise<ValidationResult> {
    const startTime = Date.now();
    this.logger.info(`Starting schema validation for ${poolName}`, { pool_name: poolName, options });

    try {
      const schema = await this.extractSchema(poolName, options?.schemaName);
      const issues: ValidationIssue[] = [];

      const validationTypes = options?.validationTypes || Object.values(ValidationType);

      // Run validation checks
      for (const validationType of validationTypes) {
        const typeIssues = await this.runValidationType(poolName, schema, validationType, options);
        issues.push(...typeIssues);
      }

      // Calculate overall status
      const criticalCount = issues.filter(i => i.severity === ValidationSeverity.CRITICAL).length;
      const errorCount = issues.filter(i => i.severity === ValidationSeverity.ERROR).length;
      const warningCount = issues.filter(i => i.severity === ValidationSeverity.WARNING).length;

      let overallStatus: 'passed' | 'warning' | 'failed';
      if (criticalCount > 0 || errorCount > 0) {
        overallStatus = 'failed';
      } else if (warningCount > 0) {
        overallStatus = 'warning';
      } else {
        overallStatus = 'passed';
      }

      const result: ValidationResult = {
        database_name: poolName,
        validation_timestamp: new Date(),
        overall_status: overallStatus,
        total_checks: validationTypes.length,
        passed_checks: validationTypes.length - issues.length,
        warning_count: warningCount,
        error_count: errorCount,
        critical_count: criticalCount,
        issues,
        schema_summary: {
          table_count: schema.tables.length,
          column_count: schema.columns.length,
          constraint_count: schema.constraints.length,
          index_count: schema.indexes.length
        },
        execution_time_ms: Date.now() - startTime
      };

      this.logger.info(`Schema validation completed for ${poolName}`, {
        pool_name: poolName,
        overall_status: overallStatus,
        total_issues: issues.length,
        execution_time_ms: result.execution_time_ms
      });

      return result;

    } catch (error) {
      this.logger.error(`Schema validation failed for ${poolName}`, error);
      throw new DatabaseError(
        `Schema validation failed: ${(error as Error).message}`,
        'SCHEMA_VALIDATION_ERROR',
        { pool_name: poolName }
      );
    }
  }

  /**
   * Compare schemas between source and destination
   */
  async compareSchemas(
    sourcePoolName: string,
    destinationPoolName: string,
    options?: {
      includeTables?: string[];
      excludeTables?: string[];
      schemaName?: string;
    }
  ): Promise<SchemaComparisonResult> {
    this.logger.info('Comparing schemas', {
      source: sourcePoolName,
      destination: destinationPoolName,
      options
    });

    try {
      const [sourceSchema, destinationSchema] = await Promise.all([
        this.extractSchema(sourcePoolName, options?.schemaName),
        this.extractSchema(destinationPoolName, options?.schemaName)
      ]);

      const result = this.performSchemaComparison(sourceSchema, destinationSchema, options);

      this.logger.info('Schema comparison completed', {
        source: sourcePoolName,
        destination: destinationPoolName,
        compatibility_score: result.compatibility_score,
        migration_complexity: result.migration_complexity
      });

      return result;

    } catch (error) {
      this.logger.error('Schema comparison failed', error);
      throw new DatabaseError(
        `Schema comparison failed: ${(error as Error).message}`,
        'SCHEMA_COMPARISON_ERROR',
        { source: sourcePoolName, destination: destinationPoolName }
      );
    }
  }

  /**
   * Extract complete database schema
   */
  async extractSchema(poolName: string, schemaName: string = 'public'): Promise<DatabaseSchema> {
    const pool = this.dbManager.getPool(poolName);

    const [tables, columns, indexes, constraints] = await Promise.all([
      this.extractTables(pool, schemaName),
      this.extractColumns(pool, schemaName),
      this.extractIndexes(pool, schemaName),
      this.extractConstraints(pool, schemaName)
    ]);

    return {
      tables,
      columns,
      indexes,
      constraints
    };
  }

  /**
   * Extract table information
   */
  private async extractTables(pool: Pool, schemaName: string): Promise<TableSchema[]> {
    const query = `
      SELECT
        table_name,
        table_schema as schema_name,
        table_type,
        CASE WHEN is_insertable_into = 'YES' THEN true ELSE false END as is_insertable_into,
        obj_description(c.oid) as comment
      FROM information_schema.tables t
      LEFT JOIN pg_class c ON c.relname = t.table_name
      LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.table_schema
      WHERE table_schema = $1
        AND table_type IN ('BASE TABLE', 'VIEW', 'MATERIALIZED VIEW')
      ORDER BY table_name
    `;

    const result = await pool.query(query, [schemaName]);
    return result.rows;
  }

  /**
   * Extract column information
   */
  private async extractColumns(pool: Pool, schemaName: string): Promise<ColumnSchema[]> {
    const query = `
      SELECT
        c.table_name,
        c.column_name,
        c.ordinal_position,
        c.column_default,
        CASE WHEN c.is_nullable = 'YES' THEN true ELSE false END as is_nullable,
        c.data_type,
        c.character_maximum_length,
        c.numeric_precision,
        c.numeric_scale,
        CASE WHEN c.is_identity = 'YES' THEN true ELSE false END as is_identity,
        c.identity_generation,
        CASE WHEN c.is_generated = 'ALWAYS' THEN true ELSE false END as is_generated,
        c.generation_expression,
        col_description(pgc.oid, c.ordinal_position) as comment
      FROM information_schema.columns c
      LEFT JOIN pg_class pgc ON pgc.relname = c.table_name
      LEFT JOIN pg_namespace pgn ON pgn.oid = pgc.relnamespace AND pgn.nspname = c.table_schema
      WHERE c.table_schema = $1
      ORDER BY c.table_name, c.ordinal_position
    `;

    const result = await pool.query(query, [schemaName]);
    return result.rows;
  }

  /**
   * Extract index information
   */
  private async extractIndexes(pool: Pool, schemaName: string): Promise<IndexSchema[]> {
    const query = `
      SELECT DISTINCT
        t.relname as table_name,
        i.relname as index_name,
        ix.indisunique as is_unique,
        ix.indisprimary as is_primary,
        am.amname as index_type,
        array_agg(a.attname ORDER BY i.ordinality) as columns,
        pg_get_expr(ix.indpred, ix.indrelid) as condition,
        obj_description(i.oid) as comment
      FROM pg_class t
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_am am ON i.relam = am.oid
      JOIN unnest(ix.indkey) WITH ORDINALITY i(key, ordinality) ON true
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.key
      WHERE n.nspname = $1
        AND t.relkind = 'r'
      GROUP BY t.relname, i.relname, ix.indisunique, ix.indisprimary, am.amname, ix.indpred, i.oid
      ORDER BY table_name, index_name
    `;

    const result = await pool.query(query, [schemaName]);
    return result.rows;
  }

  /**
   * Extract constraint information
   */
  private async extractConstraints(pool: Pool, schemaName: string): Promise<ConstraintSchema[]> {
    const query = `
      SELECT
        tc.table_name,
        tc.constraint_name,
        tc.constraint_type,
        array_agg(kcu.column_name ORDER BY kcu.ordinal_position) as column_names,
        ccu.table_name as foreign_table_name,
        array_agg(ccu.column_name ORDER BY ccu.ordinal_position) as foreign_column_names,
        rc.match_option,
        rc.update_rule,
        rc.delete_rule,
        cc.check_clause,
        CASE WHEN tc.is_deferrable = 'YES' THEN true ELSE false END as is_deferrable,
        CASE WHEN tc.initially_deferred = 'YES' THEN true ELSE false END as initially_deferred
      FROM information_schema.table_constraints tc
      LEFT JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      LEFT JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
        AND tc.table_schema = ccu.table_schema
      LEFT JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name
        AND tc.table_schema = rc.constraint_schema
      LEFT JOIN information_schema.check_constraints cc
        ON tc.constraint_name = cc.constraint_name
        AND tc.table_schema = cc.constraint_schema
      WHERE tc.table_schema = $1
      GROUP BY tc.table_name, tc.constraint_name, tc.constraint_type,
               ccu.table_name, rc.match_option, rc.update_rule, rc.delete_rule,
               cc.check_clause, tc.is_deferrable, tc.initially_deferred
      ORDER BY tc.table_name, tc.constraint_name
    `;

    const result = await pool.query(query, [schemaName]);
    return result.rows;
  }

  /**
   * Run specific validation type
   */
  private async runValidationType(
    poolName: string,
    schema: DatabaseSchema,
    validationType: ValidationType,
    options?: any
  ): Promise<ValidationIssue[]> {
    switch (validationType) {
      case ValidationType.TABLE_EXISTENCE:
        return this.validateTableExistence(schema, options);
      case ValidationType.COLUMN_DEFINITION:
        return this.validateColumnDefinitions(schema, options);
      case ValidationType.DATA_TYPE_COMPATIBILITY:
        return this.validateDataTypeCompatibility(schema, options);
      case ValidationType.CONSTRAINT_VALIDATION:
        return this.validateConstraints(schema, options);
      case ValidationType.INDEX_VALIDATION:
        return this.validateIndexes(schema, options);
      case ValidationType.REFERENTIAL_INTEGRITY:
        return await this.validateReferentialIntegrity(poolName, schema, options);
      default:
        return [];
    }
  }

  /**
   * Validate table existence
   */
  private validateTableExistence(schema: DatabaseSchema, options?: any): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check for tables that should exist
    const expectedTables = options?.expectedTables || [];
    for (const expectedTable of expectedTables) {
      const exists = schema.tables.some(t => t.table_name === expectedTable);
      if (!exists) {
        issues.push({
          id: `table_missing_${expectedTable}`,
          type: ValidationType.TABLE_EXISTENCE,
          severity: ValidationSeverity.ERROR,
          message: `Required table '${expectedTable}' does not exist`,
          details: { expected_table: expectedTable },
          table_name: expectedTable,
          recommendation: `Create table '${expectedTable}' before proceeding with migration`,
          auto_fixable: false
        });
      }
    }

    return issues;
  }

  /**
   * Validate column definitions
   */
  private validateColumnDefinitions(schema: DatabaseSchema, options?: any): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    for (const column of schema.columns) {
      // Check for nullable primary key columns
      if (column.column_name.endsWith('_id') && column.is_nullable) {
        issues.push({
          id: `nullable_id_column_${column.table_name}_${column.column_name}`,
          type: ValidationType.COLUMN_DEFINITION,
          severity: ValidationSeverity.WARNING,
          message: `ID column '${column.column_name}' in table '${column.table_name}' is nullable`,
          details: { table_name: column.table_name, column_name: column.column_name },
          table_name: column.table_name,
          column_name: column.column_name,
          recommendation: 'Consider making ID columns NOT NULL for better data integrity',
          auto_fixable: false
        });
      }

      // Check for very long column names
      if (column.column_name.length > 63) {
        issues.push({
          id: `long_column_name_${column.table_name}_${column.column_name}`,
          type: ValidationType.COLUMN_DEFINITION,
          severity: ValidationSeverity.ERROR,
          message: `Column name '${column.column_name}' exceeds PostgreSQL limit of 63 characters`,
          details: { table_name: column.table_name, column_name: column.column_name, length: column.column_name.length },
          table_name: column.table_name,
          column_name: column.column_name,
          recommendation: 'Shorten column name to 63 characters or less',
          auto_fixable: false
        });
      }
    }

    return issues;
  }

  /**
   * Validate data type compatibility
   */
  private validateDataTypeCompatibility(schema: DatabaseSchema, options?: any): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Define incompatible data types for migration
    const problematicTypes = ['xml', 'json', 'jsonb', 'array', 'hstore'];

    for (const column of schema.columns) {
      if (problematicTypes.some(type => column.data_type.includes(type))) {
        issues.push({
          id: `complex_data_type_${column.table_name}_${column.column_name}`,
          type: ValidationType.DATA_TYPE_COMPATIBILITY,
          severity: ValidationSeverity.WARNING,
          message: `Column '${column.column_name}' uses complex data type '${column.data_type}' that may require special handling during migration`,
          details: {
            table_name: column.table_name,
            column_name: column.column_name,
            data_type: column.data_type
          },
          table_name: column.table_name,
          column_name: column.column_name,
          recommendation: 'Verify that the destination system supports this data type or plan for data transformation',
          auto_fixable: false
        });
      }
    }

    return issues;
  }

  /**
   * Validate constraints
   */
  private validateConstraints(schema: DatabaseSchema, options?: any): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check for missing primary keys
    const tablesWithoutPK = schema.tables.filter(table => {
      const hasPrimaryKey = schema.constraints.some(constraint =>
        constraint.table_name === table.table_name &&
        constraint.constraint_type === 'PRIMARY KEY'
      );
      return !hasPrimaryKey && table.table_type === 'BASE TABLE';
    });

    for (const table of tablesWithoutPK) {
      issues.push({
        id: `missing_primary_key_${table.table_name}`,
        type: ValidationType.CONSTRAINT_VALIDATION,
        severity: ValidationSeverity.WARNING,
        message: `Table '${table.table_name}' does not have a primary key`,
        details: { table_name: table.table_name },
        table_name: table.table_name,
        recommendation: 'Consider adding a primary key for better data integrity and performance',
        auto_fixable: false
      });
    }

    return issues;
  }

  /**
   * Validate indexes
   */
  private validateIndexes(schema: DatabaseSchema, options?: any): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check for tables without any indexes
    const tablesWithoutIndexes = schema.tables.filter(table => {
      const hasIndexes = schema.indexes.some(index =>
        index.table_name === table.table_name
      );
      return !hasIndexes && table.table_type === 'BASE TABLE';
    });

    for (const table of tablesWithoutIndexes) {
      issues.push({
        id: `no_indexes_${table.table_name}`,
        type: ValidationType.INDEX_VALIDATION,
        severity: ValidationSeverity.INFO,
        message: `Table '${table.table_name}' has no indexes`,
        details: { table_name: table.table_name },
        table_name: table.table_name,
        recommendation: 'Consider adding indexes for better query performance',
        auto_fixable: false
      });
    }

    return issues;
  }

  /**
   * Validate referential integrity
   */
  private async validateReferentialIntegrity(
    poolName: string,
    schema: DatabaseSchema,
    options?: any
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    const pool = this.dbManager.getPool(poolName);

    // Check foreign key constraints
    const foreignKeys = schema.constraints.filter(c => c.constraint_type === 'FOREIGN KEY');

    for (const fk of foreignKeys) {
      if (!fk.foreign_table_name || !fk.foreign_column_names) continue;

      try {
        // Check if there are orphaned records
        const orphanQuery = `
          SELECT COUNT(*) as orphan_count
          FROM ${fk.table_name} child
          LEFT JOIN ${fk.foreign_table_name} parent
            ON child.${fk.column_names[0]} = parent.${fk.foreign_column_names[0]}
          WHERE child.${fk.column_names[0]} IS NOT NULL
            AND parent.${fk.foreign_column_names[0]} IS NULL
        `;

        const result = await pool.query(orphanQuery);
        const orphanCount = parseInt(result.rows[0].orphan_count);

        if (orphanCount > 0) {
          issues.push({
            id: `orphaned_records_${fk.table_name}_${fk.constraint_name}`,
            type: ValidationType.REFERENTIAL_INTEGRITY,
            severity: ValidationSeverity.ERROR,
            message: `Found ${orphanCount} orphaned records in table '${fk.table_name}' for constraint '${fk.constraint_name}'`,
            details: {
              table_name: fk.table_name,
              constraint_name: fk.constraint_name,
              orphan_count: orphanCount,
              foreign_table: fk.foreign_table_name
            },
            table_name: fk.table_name,
            constraint_name: fk.constraint_name,
            recommendation: 'Clean up orphaned records before migration or disable referential integrity checks',
            auto_fixable: false
          });
        }

      } catch (error) {
        this.logger.warn(`Could not validate referential integrity for ${fk.constraint_name}`, { error: (error as Error).message });
      }
    }

    return issues;
  }

  /**
   * Perform schema comparison
   */
  private performSchemaComparison(
    sourceSchema: DatabaseSchema,
    destinationSchema: DatabaseSchema,
    options?: any
  ): SchemaComparisonResult {
    const sourceTableNames = new Set(sourceSchema.tables.map(t => t.table_name));
    const destTableNames = new Set(destinationSchema.tables.map(t => t.table_name));

    const tablesMissingInDest = Array.from(sourceTableNames).filter(name => !destTableNames.has(name));
    const tablesExtraInDest = Array.from(destTableNames).filter(name => !sourceTableNames.has(name));

    const columnDifferences = this.compareColumns(sourceSchema, destinationSchema);
    const constraintDifferences = this.compareConstraints(sourceSchema, destinationSchema);
    const indexDifferences = this.compareIndexes(sourceSchema, destinationSchema);

    // Calculate compatibility score
    const totalIssues = tablesMissingInDest.length + tablesExtraInDest.length +
                       columnDifferences.length + constraintDifferences.length + indexDifferences.length;
    const totalElements = sourceSchema.tables.length + sourceSchema.columns.length +
                         sourceSchema.constraints.length + sourceSchema.indexes.length;
    const compatibilityScore = Math.max(0, Math.round(100 - (totalIssues / totalElements) * 100));

    // Determine migration complexity
    let migrationComplexity: 'low' | 'medium' | 'high' | 'critical';
    if (compatibilityScore >= 90) {
      migrationComplexity = 'low';
    } else if (compatibilityScore >= 70) {
      migrationComplexity = 'medium';
    } else if (compatibilityScore >= 50) {
      migrationComplexity = 'high';
    } else {
      migrationComplexity = 'critical';
    }

    return {
      source_schema: 'source',
      destination_schema: 'destination',
      comparison_timestamp: new Date(),
      tables_missing_in_destination: tablesMissingInDest,
      tables_extra_in_destination: tablesExtraInDest,
      column_differences: columnDifferences,
      constraint_differences: constraintDifferences,
      index_differences: indexDifferences,
      compatibility_score: compatibilityScore,
      migration_complexity: migrationComplexity
    };
  }

  /**
   * Compare columns between schemas
   */
  private compareColumns(sourceSchema: DatabaseSchema, destinationSchema: DatabaseSchema): ColumnDifference[] {
    const differences: ColumnDifference[] = [];
    const destColumnMap = new Map<string, ColumnSchema>();

    // Build destination column lookup
    destinationSchema.columns.forEach(col => {
      destColumnMap.set(`${col.table_name}.${col.column_name}`, col);
    });

    // Check source columns
    sourceSchema.columns.forEach(sourceCol => {
      const key = `${sourceCol.table_name}.${sourceCol.column_name}`;
      const destCol = destColumnMap.get(key);

      if (!destCol) {
        differences.push({
          table_name: sourceCol.table_name,
          column_name: sourceCol.column_name,
          difference_type: 'missing',
          source_definition: sourceCol,
          compatibility_impact: 'high'
        });
      } else {
        // Check for type mismatches
        if (sourceCol.data_type !== destCol.data_type) {
          differences.push({
            table_name: sourceCol.table_name,
            column_name: sourceCol.column_name,
            difference_type: 'type_mismatch',
            source_definition: sourceCol,
            destination_definition: destCol,
            compatibility_impact: 'medium'
          });
        }

        // Check for nullable mismatches
        if (sourceCol.is_nullable !== destCol.is_nullable) {
          differences.push({
            table_name: sourceCol.table_name,
            column_name: sourceCol.column_name,
            difference_type: 'nullable_mismatch',
            source_definition: sourceCol,
            destination_definition: destCol,
            compatibility_impact: 'low'
          });
        }
      }
    });

    return differences;
  }

  /**
   * Compare constraints between schemas
   */
  private compareConstraints(sourceSchema: DatabaseSchema, destinationSchema: DatabaseSchema): ConstraintDifference[] {
    const differences: ConstraintDifference[] = [];
    const destConstraintMap = new Map<string, ConstraintSchema>();

    destinationSchema.constraints.forEach(constraint => {
      destConstraintMap.set(`${constraint.table_name}.${constraint.constraint_name}`, constraint);
    });

    sourceSchema.constraints.forEach(sourceConstraint => {
      const key = `${sourceConstraint.table_name}.${sourceConstraint.constraint_name}`;
      const destConstraint = destConstraintMap.get(key);

      if (!destConstraint) {
        differences.push({
          table_name: sourceConstraint.table_name,
          constraint_name: sourceConstraint.constraint_name,
          difference_type: 'missing',
          source_definition: sourceConstraint,
          impact_level: sourceConstraint.constraint_type === 'PRIMARY KEY' ? 'high' : 'medium'
        });
      }
    });

    return differences;
  }

  /**
   * Compare indexes between schemas
   */
  private compareIndexes(sourceSchema: DatabaseSchema, destinationSchema: DatabaseSchema): IndexDifference[] {
    const differences: IndexDifference[] = [];
    const destIndexMap = new Map<string, IndexSchema>();

    destinationSchema.indexes.forEach(index => {
      destIndexMap.set(`${index.table_name}.${index.index_name}`, index);
    });

    sourceSchema.indexes.forEach(sourceIndex => {
      const key = `${sourceIndex.table_name}.${sourceIndex.index_name}`;
      const destIndex = destIndexMap.get(key);

      if (!destIndex) {
        differences.push({
          table_name: sourceIndex.table_name,
          index_name: sourceIndex.index_name,
          difference_type: 'missing',
          source_definition: sourceIndex,
          performance_impact: sourceIndex.is_primary ? 'high' : 'medium'
        });
      }
    });

    return differences;
  }

  /**
   * Generate validation report
   */
  generateValidationReport(result: ValidationResult): string {
    const report = [];

    report.push('# Database Schema Validation Report');
    report.push('');
    report.push(`**Database:** ${result.database_name}`);
    report.push(`**Validation Date:** ${result.validation_timestamp.toISOString()}`);
    report.push(`**Overall Status:** ${result.overall_status.toUpperCase()}`);
    report.push(`**Execution Time:** ${result.execution_time_ms}ms`);
    report.push('');

    report.push('## Summary');
    report.push(`- Total Checks: ${result.total_checks}`);
    report.push(`- Passed: ${result.passed_checks}`);
    report.push(`- Warnings: ${result.warning_count}`);
    report.push(`- Errors: ${result.error_count}`);
    report.push(`- Critical: ${result.critical_count}`);
    report.push('');

    report.push('## Schema Overview');
    report.push(`- Tables: ${result.schema_summary.table_count}`);
    report.push(`- Columns: ${result.schema_summary.column_count}`);
    report.push(`- Constraints: ${result.schema_summary.constraint_count}`);
    report.push(`- Indexes: ${result.schema_summary.index_count}`);
    report.push('');

    if (result.issues.length > 0) {
      report.push('## Issues Found');
      report.push('');

      const severityOrder = [ValidationSeverity.CRITICAL, ValidationSeverity.ERROR, ValidationSeverity.WARNING, ValidationSeverity.INFO];

      severityOrder.forEach(severity => {
        const severityIssues = result.issues.filter(issue => issue.severity === severity);
        if (severityIssues.length > 0) {
          report.push(`### ${severity.toUpperCase()} (${severityIssues.length})`);
          report.push('');

          severityIssues.forEach((issue, index) => {
            report.push(`${index + 1}. **${issue.message}**`);
            if (issue.table_name) {
              report.push(`   - Table: ${issue.table_name}`);
            }
            if (issue.column_name) {
              report.push(`   - Column: ${issue.column_name}`);
            }
            if (issue.recommendation) {
              report.push(`   - Recommendation: ${issue.recommendation}`);
            }
            report.push('');
          });
        }
      });
    } else {
      report.push('## ✅ No Issues Found');
      report.push('');
      report.push('All validation checks passed successfully.');
    }

    return report.join('\n');
  }

  /**
   * Generate schema comparison report
   */
  generateComparisonReport(result: SchemaComparisonResult): string {
    const report = [];

    report.push('# Schema Comparison Report');
    report.push('');
    report.push(`**Source Schema:** ${result.source_schema}`);
    report.push(`**Destination Schema:** ${result.destination_schema}`);
    report.push(`**Comparison Date:** ${result.comparison_timestamp.toISOString()}`);
    report.push(`**Compatibility Score:** ${result.compatibility_score}%`);
    report.push(`**Migration Complexity:** ${result.migration_complexity.toUpperCase()}`);
    report.push('');

    if (result.tables_missing_in_destination.length > 0) {
      report.push('## Tables Missing in Destination');
      result.tables_missing_in_destination.forEach(table => {
        report.push(`- ${table}`);
      });
      report.push('');
    }

    if (result.column_differences.length > 0) {
      report.push('## Column Differences');
      result.column_differences.forEach(diff => {
        report.push(`- **${diff.table_name}.${diff.column_name}**: ${diff.difference_type} (Impact: ${diff.compatibility_impact})`);
      });
      report.push('');
    }

    if (result.constraint_differences.length > 0) {
      report.push('## Constraint Differences');
      result.constraint_differences.forEach(diff => {
        report.push(`- **${diff.table_name}.${diff.constraint_name}**: ${diff.difference_type} (Impact: ${diff.impact_level})`);
      });
      report.push('');
    }

    return report.join('\n');
  }
}

// ===== SINGLETON INSTANCE =====

let globalSchemaValidator: SchemaValidator | null = null;

/**
 * Get global schema validator instance
 */
export function getSchemaValidator(): SchemaValidator {
  if (!globalSchemaValidator) {
    globalSchemaValidator = new SchemaValidator();
  }
  return globalSchemaValidator;
}

/**
 * Create schema validator with custom database manager
 */
export function createSchemaValidator(dbManager: DatabaseConnectionManager): SchemaValidator {
  return new SchemaValidator(dbManager);
}

// ===== UTILITY FUNCTIONS =====

/**
 * Quick schema validation
 */
export async function validateDatabaseSchema(
  poolName: string,
  options?: {
    includeTables?: string[];
    excludeTables?: string[];
    validationTypes?: ValidationType[];
  }
): Promise<ValidationResult> {
  const validator = getSchemaValidator();
  return validator.validateSchema(poolName, options);
}

/**
 * Quick schema comparison
 */
export async function compareDatabaseSchemas(
  sourcePoolName: string,
  destinationPoolName: string,
  options?: {
    includeTables?: string[];
    excludeTables?: string[];
  }
): Promise<SchemaComparisonResult> {
  const validator = getSchemaValidator();
  return validator.compareSchemas(sourcePoolName, destinationPoolName, options);
}

/**
 * Extract schema for a single table
 */
export async function extractTableSchema(
  poolName: string,
  tableName: string,
  schemaName: string = 'public'
): Promise<{
  table: TableSchema | null;
  columns: ColumnSchema[];
  indexes: IndexSchema[];
  constraints: ConstraintSchema[];
}> {
  const validator = getSchemaValidator();
  const fullSchema = await validator.extractSchema(poolName, schemaName);

  return {
    table: fullSchema.tables.find(t => t.table_name === tableName) || null,
    columns: fullSchema.columns.filter(c => c.table_name === tableName),
    indexes: fullSchema.indexes.filter(i => i.table_name === tableName),
    constraints: fullSchema.constraints.filter(c => c.table_name === tableName)
  };
}