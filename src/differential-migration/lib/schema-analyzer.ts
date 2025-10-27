/**
 * SchemaAnalyzer Library
 * Implements schema introspection, difference analysis, and automatic mapping generation
 */

import { Pool, PoolClient } from 'pg';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

// Type definitions
export interface SchemaAnalysisConfig {
  sourcePool: Pool;
  destinationPool: Pool;
  ignoreTables?: string[];
  includeViews?: boolean;
  includeIndexes?: boolean;
  includeConstraints?: boolean;
  enableCompatibilityCheck?: boolean;
  cacheEnabled?: boolean;
  cacheExpiryMs?: number;
}

export interface ColumnSchema {
  name: string;
  dataType: string;
  isNullable?: boolean;
  hasDefault?: boolean;
  defaultValue?: string;
  maxLength?: number;
  precision?: number;
  scale?: number;
  isPrimaryKey?: boolean;
  isUnique?: boolean;
  isForeignKey?: boolean;
  enumValues?: string[];
}

export interface ConstraintSchema {
  name: string;
  type: 'PRIMARY KEY' | 'FOREIGN KEY' | 'UNIQUE' | 'CHECK' | 'NOT NULL';
  columns: string[];
  referencedTable?: string;
  referencedColumns?: string[];
  definition?: string;
}

export interface IndexSchema {
  name: string;
  columns: string[];
  isUnique: boolean;
  indexType: 'btree' | 'hash' | 'gin' | 'gist' | 'spgist' | 'brin';
  definition: string;
}

export interface ForeignKeyRelationship {
  name: string;
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  onUpdate?: string;
  onDelete?: string;
}

export interface TableSchema {
  tableName: string;
  columns: ColumnSchema[];
  primaryKey: string[];
  uniqueConstraints: ConstraintSchema[];
  foreignKeys: ForeignKeyRelationship[];
  indexes: IndexSchema[];
  tableSize?: string;
  recordCount?: number;
  exists?: boolean;
}

export interface EnumType {
  typeName: string;
  values: string[];
  usageCount?: number;
}

export interface SchemaDifference {
  sourceTable: string;
  destinationTable: string;
  differences: Array<{
    type: 'column' | 'constraint' | 'index';
    name: string;
    action: 'added' | 'removed' | 'modified';
    details: string;
    severity: 'low' | 'medium' | 'high';
  }>;
  compatibilityScore: number;
  migrationComplexity: 'low' | 'medium' | 'high';
}

export interface CompatibilityIssue {
  field: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  recommendation: string;
  isBlocking: boolean;
}

export interface CompatibilityAssessment {
  isCompatible: boolean;
  compatibilityScore: number;
  issues: CompatibilityIssue[];
  recommendations: string[];
  estimatedMigrationTime: string;
}

export interface FieldMapping {
  sourceField: string;
  destinationField: string;
  transformationType: 'direct_mapping' | 'concatenation' | 'split' | 'foreign_key_lookup' | 'preserve_as_legacy' | 'enum_conversion' | 'type_conversion';
  transformationLogic?: string;
  confidence: number;
  dependencies?: string[];
  validationRules?: string[];
}

export interface MappingRecommendation {
  sourceTable: string;
  destinationTable: string;
  fieldMappings: FieldMapping[];
  overallConfidence: number;
  complexityScore: number;
  estimatedEffort: 'low' | 'medium' | 'high';
  prerequisites: string[];
}

export interface EnumMapping {
  sourceEnum: string;
  destinationEnum: string;
  valueMappings: Record<string, string>;
  unmappedValues: string[];
  confidence: number;
}

export interface SchemaEvolution {
  tableName: string;
  fromVersion: string;
  toVersion: string;
  changes: Array<{
    columnName: string;
    changeType: 'column_added' | 'column_removed' | 'column_modified' | 'constraint_added' | 'constraint_removed';
    oldDefinition?: string;
    newDefinition?: string;
    isBreaking: boolean;
  }>;
  isBackwardCompatible: boolean;
  migrationComplexity: 'low' | 'medium' | 'high';
}

export interface MigrationScript {
  version: string;
  upScript: string;
  downScript: string;
  isReversible: boolean;
  estimatedExecutionTime: string;
  dependencies: string[];
  warnings: string[];
}

/**
 * SchemaAnalyzer Implementation
 *
 * Provides comprehensive schema analysis functionality including introspection,
 * difference detection, compatibility assessment, and automatic mapping generation.
 */
export class SchemaAnalyzer {
  private config: SchemaAnalysisConfig;
  private schemaCache: Map<string, { data: any; timestamp: number }> = new Map();
  private cacheExpiryMs: number;

  constructor(config: SchemaAnalysisConfig) {
    // Validate configuration
    const validation = SchemaAnalyzer.validateConfig(config);
    if (!validation.isValid) {
      throw new Error(`Invalid schema analysis config: ${validation.errors.join(', ')}`);
    }

    this.config = {
      ignoreTables: ['pg_*', 'information_schema.*'],
      includeViews: false,
      includeIndexes: true,
      includeConstraints: true,
      enableCompatibilityCheck: true,
      cacheEnabled: true,
      cacheExpiryMs: 300000, // 5 minutes
      ...config
    };

    this.cacheExpiryMs = this.config.cacheExpiryMs || 300000;
  }

  /**
   * Validates schema analysis configuration
   */
  static validateConfig(config: SchemaAnalysisConfig): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.sourcePool) {
      errors.push('sourcePool is required');
    }

    if (!config.destinationPool) {
      errors.push('destinationPool is required');
    }

    if (config.ignoreTables && !Array.isArray(config.ignoreTables)) {
      errors.push('ignoreTables must be an array');
    }

    if (config.cacheExpiryMs && (config.cacheExpiryMs < 1000 || config.cacheExpiryMs > 3600000)) {
      errors.push('cacheExpiryMs must be between 1000ms and 3600000ms (1 hour)');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Analyzes complete table schema including columns, constraints, and indexes
   */
  async analyzeTableSchema(tableName: string, database: 'source' | 'destination'): Promise<TableSchema> {
    const cacheKey = `${database}_${tableName}_schema`;

    // Check cache first
    if (this.config.cacheEnabled) {
      const cached = this.getCachedData(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const pool = database === 'source' ? this.config.sourcePool : this.config.destinationPool;

    try {
      // Get column information
      const columnsQuery = `
        SELECT
          column_name,
          data_type,
          is_nullable,
          column_default,
          character_maximum_length,
          numeric_precision,
          numeric_scale,
          udt_name
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position
      `;

      // Get constraints
      const constraintsQuery = `
        SELECT
          tc.constraint_name,
          tc.constraint_type,
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name,
          rc.update_rule,
          rc.delete_rule
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
        LEFT JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
        LEFT JOIN information_schema.referential_constraints AS rc
          ON rc.constraint_name = tc.constraint_name
        WHERE tc.table_name = $1
      `;

      // Get indexes
      const indexesQuery = `
        SELECT
          indexname,
          indexdef,
          schemaname
        FROM pg_indexes
        WHERE tablename = $1
      `;

      const [columnsResult, constraintsResult, indexesResult] = await Promise.all([
        pool.query(columnsQuery, [tableName]),
        pool.query(constraintsQuery, [tableName]),
        this.config.includeIndexes ? pool.query(indexesQuery, [tableName]) : Promise.resolve({ rows: [] })
      ]);

      // Process columns
      const columns: ColumnSchema[] = columnsResult.rows.map(row => ({
        name: row.column_name,
        dataType: row.data_type,
        isNullable: row.is_nullable === 'YES',
        hasDefault: row.column_default !== null,
        defaultValue: row.column_default,
        maxLength: row.character_maximum_length,
        precision: row.numeric_precision,
        scale: row.numeric_scale
      }));

      // Process constraints
      const constraintMap = new Map<string, ConstraintSchema>();
      const foreignKeys: ForeignKeyRelationship[] = [];
      let primaryKey: string[] = [];

      for (const row of constraintsResult.rows) {
        if (row.constraint_type === 'PRIMARY KEY') {
          primaryKey.push(row.column_name);
          const column = columns.find(c => c.name === row.column_name);
          if (column) column.isPrimaryKey = true;
        } else if (row.constraint_type === 'UNIQUE') {
          const column = columns.find(c => c.name === row.column_name);
          if (column) column.isUnique = true;
        } else if (row.constraint_type === 'FOREIGN KEY') {
          foreignKeys.push({
            name: row.constraint_name,
            sourceTable: tableName,
            sourceColumn: row.column_name,
            targetTable: row.foreign_table_name,
            targetColumn: row.foreign_column_name,
            onUpdate: row.update_rule,
            onDelete: row.delete_rule
          });
          const column = columns.find(c => c.name === row.column_name);
          if (column) column.isForeignKey = true;
        }

        if (!constraintMap.has(row.constraint_name)) {
          constraintMap.set(row.constraint_name, {
            name: row.constraint_name,
            type: row.constraint_type,
            columns: [row.column_name],
            referencedTable: row.foreign_table_name,
            referencedColumns: row.foreign_column_name ? [row.foreign_column_name] : undefined
          });
        } else {
          constraintMap.get(row.constraint_name)!.columns.push(row.column_name);
        }
      }

      const uniqueConstraints = Array.from(constraintMap.values())
        .filter(c => c.type === 'UNIQUE');

      // Process indexes
      const indexes: IndexSchema[] = indexesResult.rows.map(row => {
        const indexDef = row.indexdef;
        const isUnique = indexDef.includes('UNIQUE');
        const indexType = this.extractIndexType(indexDef);
        const columns = this.extractIndexColumns(indexDef);

        return {
          name: row.indexname,
          columns,
          isUnique,
          indexType,
          definition: indexDef
        };
      });

      // Get table size and record count
      let tableSize: string | undefined;
      let recordCount: number | undefined;

      try {
        const sizeQuery = `
          SELECT
            pg_size_pretty(pg_total_relation_size($1)) as table_size,
            (SELECT COUNT(*) FROM ${tableName}) as record_count
        `;
        const sizeResult = await pool.query(sizeQuery, [tableName]);
        if (sizeResult.rows.length > 0) {
          tableSize = sizeResult.rows[0].table_size;
          recordCount = parseInt(sizeResult.rows[0].record_count);
        }
      } catch (error) {
        // Size query failed, continue without size info
      }

      const schema: TableSchema = {
        tableName,
        columns,
        primaryKey,
        uniqueConstraints,
        foreignKeys,
        indexes,
        tableSize,
        recordCount,
        exists: columns.length > 0
      };

      // Cache the result
      if (this.config.cacheEnabled) {
        this.setCachedData(cacheKey, schema);
      }

      return schema;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to analyze table schema: ${errorMessage}`);
    }
  }

  /**
   * Discovers all tables in the specified database
   */
  async discoverTables(database: 'source' | 'destination'): Promise<string[]> {
    const cacheKey = `${database}_tables_list`;

    // Check cache first
    if (this.config.cacheEnabled) {
      const cached = this.getCachedData(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const pool = database === 'source' ? this.config.sourcePool : this.config.destinationPool;

    let query = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `;

    if (!this.config.includeViews) {
      query += ` AND table_type = 'BASE TABLE'`;
    }

    query += ` ORDER BY table_name`;

    const result = await pool.query(query);
    let tables = result.rows.map(row => row.table_name);

    // Apply ignore filters
    if (this.config.ignoreTables && this.config.ignoreTables.length > 0) {
      tables = tables.filter(tableName => {
        return !this.config.ignoreTables!.some(pattern => {
          // Simple pattern matching - could be enhanced with full regex
          if (pattern.endsWith('*')) {
            return tableName.startsWith(pattern.slice(0, -1));
          }
          return tableName === pattern;
        });
      });
    }

    // Cache the result
    if (this.config.cacheEnabled) {
      this.setCachedData(cacheKey, tables);
    }

    return tables;
  }

  /**
   * Analyzes foreign key relationships in the database
   */
  async analyzeForeignKeyRelationships(database: 'source' | 'destination'): Promise<ForeignKeyRelationship[]> {
    const pool = database === 'source' ? this.config.sourcePool : this.config.destinationPool;

    const query = `
      SELECT
        tc.constraint_name,
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.update_rule,
        rc.delete_rule
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      JOIN information_schema.referential_constraints AS rc
        ON rc.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
      ORDER BY tc.table_name, kcu.column_name
    `;

    const result = await pool.query(query);

    return result.rows.map(row => ({
      name: row.constraint_name,
      sourceTable: row.table_name,
      sourceColumn: row.column_name,
      targetTable: row.foreign_table_name,
      targetColumn: row.foreign_column_name,
      onUpdate: row.update_rule,
      onDelete: row.delete_rule
    }));
  }

  /**
   * Discovers enum types and their values
   */
  async discoverEnumTypes(database: 'source' | 'destination'): Promise<EnumType[]> {
    const pool = database === 'source' ? this.config.sourcePool : this.config.destinationPool;

    const query = `
      SELECT
        t.typname as type_name,
        e.enumlabel as enum_value
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      ORDER BY t.typname, e.enumsortorder
    `;

    const result = await pool.query(query);

    const enumMap = new Map<string, string[]>();

    for (const row of result.rows) {
      if (!enumMap.has(row.type_name)) {
        enumMap.set(row.type_name, []);
      }
      enumMap.get(row.type_name)!.push(row.enum_value);
    }

    return Array.from(enumMap.entries()).map(([typeName, values]) => ({
      typeName,
      values
    }));
  }

  /**
   * Compares schemas between source and destination tables
   */
  async compareSchemas(sourceSchema: TableSchema, destSchema: TableSchema): Promise<SchemaDifference> {
    const differences: SchemaDifference['differences'] = [];

    // Compare columns
    const sourceColumnMap = new Map(sourceSchema.columns.map(c => [c.name, c]));
    const destColumnMap = new Map(destSchema.columns.map(c => [c.name, c]));

    // Check for added columns
    for (const [columnName, column] of destColumnMap) {
      if (!sourceColumnMap.has(columnName) &&
          !columnName.startsWith('legacy_') &&
          !['id', 'created_at', 'updated_at'].includes(columnName)) {
        differences.push({
          type: 'column',
          name: columnName,
          action: 'added',
          details: `Column added: ${column.dataType}${column.isNullable ? ' (nullable)' : ' (not null)'}`,
          severity: column.isNullable ? 'low' : 'medium'
        });
      }
    }

    // Check for removed and modified columns
    for (const [columnName, sourceColumn] of sourceColumnMap) {
      const destColumn = destColumnMap.get(columnName);

      if (!destColumn && !destColumnMap.has(`legacy_${columnName}`)) {
        differences.push({
          type: 'column',
          name: columnName,
          action: 'removed',
          details: `Column removed: ${sourceColumn.dataType}`,
          severity: sourceColumn.isNullable ? 'medium' : 'high'
        });
      } else if (destColumn) {
        const changes: string[] = [];

        if (sourceColumn.dataType !== destColumn.dataType) {
          changes.push(`${sourceColumn.dataType} → ${destColumn.dataType}`);
        }

        if (sourceColumn.isNullable !== destColumn.isNullable) {
          changes.push(`nullable: ${sourceColumn.isNullable} → ${destColumn.isNullable}`);
        }

        if (sourceColumn.maxLength !== destColumn.maxLength) {
          changes.push(`length: ${sourceColumn.maxLength} → ${destColumn.maxLength}`);
        }

        if (changes.length > 0) {
          differences.push({
            type: 'column',
            name: columnName,
            action: 'modified',
            details: `Column modified: ${changes.join(', ')}`,
            severity: this.assessColumnChangeSeverity(sourceColumn, destColumn)
          });
        }
      }
    }

    // Compare constraints if enabled
    if (this.config.includeConstraints) {
      this.compareConstraints(sourceSchema, destSchema, differences);
    }

    // Compare indexes if enabled
    if (this.config.includeIndexes) {
      this.compareIndexes(sourceSchema, destSchema, differences);
    }

    // Calculate compatibility score
    const totalDifferences = differences.length;
    const highSeverityCount = differences.filter(d => d.severity === 'high').length;
    const mediumSeverityCount = differences.filter(d => d.severity === 'medium').length;

    let compatibilityScore = 1.0;
    compatibilityScore -= (highSeverityCount * 0.3);
    compatibilityScore -= (mediumSeverityCount * 0.1);
    compatibilityScore -= ((totalDifferences - highSeverityCount - mediumSeverityCount) * 0.02);
    compatibilityScore = Math.max(0, Math.min(1, compatibilityScore));

    // Determine migration complexity
    let migrationComplexity: 'low' | 'medium' | 'high' = 'low';
    if (highSeverityCount > 0 || totalDifferences > 10) {
      migrationComplexity = 'high';
    } else if (mediumSeverityCount > 2 || totalDifferences > 5) {
      migrationComplexity = 'medium';
    }

    return {
      sourceTable: sourceSchema.tableName,
      destinationTable: destSchema.tableName,
      differences,
      compatibilityScore: Math.round(compatibilityScore * 100) / 100,
      migrationComplexity
    };
  }

  /**
   * Assesses migration compatibility between schemas
   */
  async assessMigrationCompatibility(
    sourceSchema: TableSchema,
    destSchema: TableSchema
  ): Promise<CompatibilityAssessment> {
    const differences = await this.compareSchemas(sourceSchema, destSchema);
    const issues: CompatibilityIssue[] = [];
    const recommendations: string[] = [];

    // Analyze each difference for compatibility issues
    for (const diff of differences.differences) {
      if (diff.severity === 'high') {
        issues.push({
          field: diff.name,
          severity: diff.severity,
          description: diff.details,
          recommendation: this.generateCompatibilityRecommendation(diff),
          isBlocking: true
        });
      } else if (diff.severity === 'medium') {
        issues.push({
          field: diff.name,
          severity: diff.severity,
          description: diff.details,
          recommendation: this.generateCompatibilityRecommendation(diff),
          isBlocking: false
        });
      }
    }

    // Generate overall recommendations
    if (differences.migrationComplexity === 'high') {
      recommendations.push('High complexity migration - consider phased approach');
    }

    if (differences.differences.some(d => d.action === 'removed' && d.severity === 'high')) {
      recommendations.push('Required fields removed - data loss prevention required');
    }

    const primaryKeyChanges = differences.differences.filter(d => d.name === 'id' && d.action === 'modified');
    if (primaryKeyChanges.length > 0) {
      recommendations.push('Map integer ID to UUID with legacy_id preservation');
    }

    if (recommendations.length === 0) {
      recommendations.push('Migration appears straightforward - standard procedures apply');
    }

    const isCompatible = issues.filter(i => i.isBlocking).length === 0;
    const estimatedMigrationTime = this.estimateMigrationTime(differences, sourceSchema.recordCount || 0);

    return {
      isCompatible,
      compatibilityScore: differences.compatibilityScore,
      issues,
      recommendations,
      estimatedMigrationTime
    };
  }

  /**
   * Generates field mapping recommendations between schemas
   */
  async generateMappingRecommendations(
    sourceSchema: TableSchema,
    destSchema: TableSchema
  ): Promise<MappingRecommendation> {
    const fieldMappings: FieldMapping[] = [];
    const sourceColumns = new Map(sourceSchema.columns.map(c => [c.name, c]));
    const destColumns = new Map(destSchema.columns.map(c => [c.name, c]));

    // Process each source column
    for (const [sourceField, sourceColumn] of sourceColumns) {
      let bestMapping: FieldMapping | null = null;
      let bestConfidence = 0;

      // Try direct mapping first
      if (destColumns.has(sourceField)) {
        bestMapping = {
          sourceField,
          destinationField: sourceField,
          transformationType: 'direct_mapping',
          confidence: 0.95
        };
        bestConfidence = 0.95;
      }

      // Check for legacy field mapping
      const legacyField = `legacy_${sourceField}`;
      if (destColumns.has(legacyField)) {
        const legacyMapping: FieldMapping = {
          sourceField,
          destinationField: legacyField,
          transformationType: 'preserve_as_legacy',
          confidence: 0.9
        };

        if (legacyMapping.confidence > bestConfidence) {
          bestMapping = legacyMapping;
          bestConfidence = legacyMapping.confidence;
        }
      }

      // Check for fuzzy name matches
      for (const [destField, destColumn] of destColumns) {
        const similarity = this.calculateFieldSimilarity(sourceField, destField);

        if (similarity > 0.7 && similarity > bestConfidence * 0.8) {
          const transformationType = this.determineTransformationType(sourceColumn, destColumn);
          const mapping: FieldMapping = {
            sourceField,
            destinationField: destField,
            transformationType,
            confidence: similarity * 0.85,
            transformationLogic: this.generateTransformationLogic(sourceField, destField, transformationType)
          };

          if (mapping.confidence > bestConfidence) {
            bestMapping = mapping;
            bestConfidence = mapping.confidence;
          }
        }
      }

      // Special case for name fields (first_name + last_name → full_name)
      if ((sourceField === 'first_name' || sourceField === 'last_name') && destColumns.has('full_name')) {
        const nameMapping: FieldMapping = {
          sourceField,
          destinationField: 'full_name',
          transformationType: 'concatenation',
          confidence: 0.85,
          transformationLogic: `CONCAT(first_name, ' ', last_name)`,
          dependencies: sourceField === 'first_name' ? ['last_name'] : ['first_name']
        };

        if (nameMapping.confidence > bestConfidence) {
          bestMapping = nameMapping;
          bestConfidence = nameMapping.confidence;
        }
      }

      // Handle foreign key mappings
      if (sourceColumn.isForeignKey) {
        const fkMapping: FieldMapping = {
          sourceField,
          destinationField: sourceField,
          transformationType: 'foreign_key_lookup',
          confidence: 0.8,
          transformationLogic: `SELECT new_id FROM migration_mappings WHERE entity_type = '${this.inferEntityFromForeignKey(sourceField)}' AND legacy_id = ${sourceField}`,
          dependencies: [this.inferEntityFromForeignKey(sourceField)]
        };

        if (fkMapping.confidence > bestConfidence) {
          bestMapping = fkMapping;
          bestConfidence = fkMapping.confidence;
        }
      }

      if (bestMapping) {
        fieldMappings.push(bestMapping);
      }
    }

    // Calculate overall confidence and complexity
    const overallConfidence = fieldMappings.length > 0
      ? fieldMappings.reduce((sum, mapping) => sum + mapping.confidence, 0) / fieldMappings.length
      : 0;

    const complexityScore = this.calculateMappingComplexity(fieldMappings);
    const estimatedEffort = complexityScore > 0.7 ? 'high' : complexityScore > 0.4 ? 'medium' : 'low';

    // Determine prerequisites
    const prerequisites = Array.from(new Set(
      fieldMappings
        .filter(m => m.dependencies)
        .flatMap(m => m.dependencies!)
    ));

    return {
      sourceTable: sourceSchema.tableName,
      destinationTable: destSchema.tableName,
      fieldMappings,
      overallConfidence: Math.round(overallConfidence * 100) / 100,
      complexityScore: Math.round(complexityScore * 100) / 100,
      estimatedEffort,
      prerequisites
    };
  }

  /**
   * Generates enum value mappings between databases
   */
  async generateEnumMappings(
    sourceDatabase: 'source' | 'destination',
    destDatabase: 'source' | 'destination'
  ): Promise<EnumMapping[]> {
    const [sourceEnums, destEnums] = await Promise.all([
      this.discoverEnumTypes(sourceDatabase),
      this.discoverEnumTypes(destDatabase)
    ]);

    const mappings: EnumMapping[] = [];

    for (const sourceEnum of sourceEnums) {
      // Find best matching destination enum
      let bestMatch: EnumType | null = null;
      let bestSimilarity = 0;

      for (const destEnum of destEnums) {
        const similarity = this.calculateEnumSimilarity(sourceEnum, destEnum);
        if (similarity > bestSimilarity && similarity > 0.5) {
          bestMatch = destEnum;
          bestSimilarity = similarity;
        }
      }

      if (bestMatch) {
        const valueMappings: Record<string, string> = {};
        const unmappedValues: string[] = [];

        // Map individual enum values
        for (const sourceValue of sourceEnum.values) {
          let bestValueMatch: string | null = null;
          let bestValueSimilarity = 0;

          for (const destValue of bestMatch.values) {
            const similarity = this.calculateStringSimilarity(sourceValue, destValue);
            if (similarity > bestValueSimilarity && similarity > 0.6) {
              bestValueMatch = destValue;
              bestValueSimilarity = similarity;
            }
          }

          if (bestValueMatch) {
            valueMappings[sourceValue] = bestValueMatch;
          } else {
            unmappedValues.push(sourceValue);
          }
        }

        mappings.push({
          sourceEnum: sourceEnum.typeName,
          destinationEnum: bestMatch.typeName,
          valueMappings,
          unmappedValues,
          confidence: Math.round(bestSimilarity * 100) / 100
        });
      }
    }

    return mappings;
  }

  /**
   * Tracks schema evolution between versions
   */
  async trackSchemaEvolution(
    baseSchema: TableSchema,
    evolvedSchema: TableSchema,
    fromVersion: string,
    toVersion: string
  ): Promise<SchemaEvolution> {
    const changes: SchemaEvolution['changes'] = [];
    const baseColumns = new Map(baseSchema.columns.map(c => [c.name, c]));
    const evolvedColumns = new Map(evolvedSchema.columns.map(c => [c.name, c]));

    // Detect column changes
    for (const [columnName, evolvedColumn] of evolvedColumns) {
      if (!baseColumns.has(columnName)) {
        changes.push({
          columnName,
          changeType: 'column_added',
          newDefinition: `${columnName} ${evolvedColumn.dataType}${evolvedColumn.isNullable ? '' : ' NOT NULL'}`,
          isBreaking: !evolvedColumn.isNullable && !evolvedColumn.hasDefault
        });
      }
    }

    for (const [columnName, baseColumn] of baseColumns) {
      const evolvedColumn = evolvedColumns.get(columnName);

      if (!evolvedColumn) {
        changes.push({
          columnName,
          changeType: 'column_removed',
          oldDefinition: `${columnName} ${baseColumn.dataType}`,
          isBreaking: true
        });
      } else if (this.hasColumnChanged(baseColumn, evolvedColumn)) {
        changes.push({
          columnName,
          changeType: 'column_modified',
          oldDefinition: `${columnName} ${baseColumn.dataType}`,
          newDefinition: `${columnName} ${evolvedColumn.dataType}`,
          isBreaking: this.isColumnChangeBreaking(baseColumn, evolvedColumn)
        });
      }
    }

    const isBackwardCompatible = !changes.some(c => c.isBreaking);
    const migrationComplexity = changes.length > 5 ? 'high' : changes.length > 2 ? 'medium' : 'low';

    return {
      tableName: baseSchema.tableName,
      fromVersion,
      toVersion,
      changes,
      isBackwardCompatible,
      migrationComplexity
    };
  }

  /**
   * Generates migration script for schema evolution
   */
  async generateEvolutionMigrationScript(evolution: SchemaEvolution): Promise<MigrationScript> {
    const upStatements: string[] = [];
    const downStatements: string[] = [];
    const warnings: string[] = [];

    for (const change of evolution.changes) {
      switch (change.changeType) {
        case 'column_added':
          upStatements.push(`ALTER TABLE ${evolution.tableName} ADD COLUMN ${change.newDefinition};`);
          downStatements.unshift(`ALTER TABLE ${evolution.tableName} DROP COLUMN ${change.columnName};`);
          break;

        case 'column_removed':
          upStatements.push(`ALTER TABLE ${evolution.tableName} DROP COLUMN ${change.columnName};`);
          downStatements.unshift(`ALTER TABLE ${evolution.tableName} ADD COLUMN ${change.oldDefinition};`);
          if (change.isBreaking) {
            warnings.push(`Column ${change.columnName} will be permanently removed - data loss will occur`);
          }
          break;

        case 'column_modified':
          const oldType = change.oldDefinition?.split(' ')[1];
          const newType = change.newDefinition?.split(' ')[1];

          upStatements.push(`ALTER TABLE ${evolution.tableName} ALTER COLUMN ${change.columnName} TYPE ${newType};`);
          downStatements.unshift(`ALTER TABLE ${evolution.tableName} ALTER COLUMN ${change.columnName} TYPE ${oldType};`);

          if (change.isBreaking) {
            warnings.push(`Column ${change.columnName} type change may cause data loss or compatibility issues`);
          }
          break;
      }
    }

    const upScript = upStatements.join('\n');
    const downScript = downStatements.join('\n');
    const isReversible = !evolution.changes.some(c => c.isBreaking);

    return {
      version: evolution.toVersion,
      upScript,
      downScript,
      isReversible,
      estimatedExecutionTime: this.estimateScriptExecutionTime(evolution.changes.length),
      dependencies: [],
      warnings
    };
  }

  /**
   * Private helper methods
   */

  private getCachedData(key: string): any {
    if (!this.config.cacheEnabled) return null;

    const cached = this.schemaCache.get(key);
    if (cached && (Date.now() - cached.timestamp) < this.cacheExpiryMs) {
      return cached.data;
    }

    if (cached) {
      this.schemaCache.delete(key);
    }

    return null;
  }

  private setCachedData(key: string, data: any): void {
    if (!this.config.cacheEnabled) return;

    this.schemaCache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  private extractIndexType(indexDef: string): IndexSchema['indexType'] {
    if (indexDef.includes('USING btree')) return 'btree';
    if (indexDef.includes('USING hash')) return 'hash';
    if (indexDef.includes('USING gin')) return 'gin';
    if (indexDef.includes('USING gist')) return 'gist';
    if (indexDef.includes('USING spgist')) return 'spgist';
    if (indexDef.includes('USING brin')) return 'brin';
    return 'btree'; // Default
  }

  private extractIndexColumns(indexDef: string): string[] {
    const match = indexDef.match(/\(([^)]+)\)/);
    if (match) {
      return match[1].split(',').map(col => col.trim());
    }
    return [];
  }

  private compareConstraints(
    sourceSchema: TableSchema,
    destSchema: TableSchema,
    differences: SchemaDifference['differences']
  ): void {
    // Compare unique constraints
    const sourceConstraints = new Set(
      sourceSchema.uniqueConstraints.map(c => `${c.name}:${c.columns.join(',')}`);
    const destConstraints = new Set(
      destSchema.uniqueConstraints.map(c => `${c.name}:${c.columns.join(',')}`);

    for (const constraint of destConstraints) {
      if (!sourceConstraints.has(constraint)) {
        const [name] = constraint.split(':');
        differences.push({
          type: 'constraint',
          name,
          action: 'added',
          details: 'Unique constraint added',
          severity: 'low'
        });
      }
    }

    for (const constraint of sourceConstraints) {
      if (!destConstraints.has(constraint)) {
        const [name] = constraint.split(':');
        differences.push({
          type: 'constraint',
          name,
          action: 'removed',
          details: 'Unique constraint removed',
          severity: 'medium'
        });
      }
    }
  }

  private compareIndexes(
    sourceSchema: TableSchema,
    destSchema: TableSchema,
    differences: SchemaDifference['differences']
  ): void {
    const sourceIndexes = new Set(sourceSchema.indexes.map(i => `${i.name}:${i.columns.join(',')}`));
    const destIndexes = new Set(destSchema.indexes.map(i => `${i.name}:${i.columns.join(',')}`));

    for (const index of destIndexes) {
      if (!sourceIndexes.has(index)) {
        const [name] = index.split(':');
        differences.push({
          type: 'index',
          name,
          action: 'added',
          details: 'Index added',
          severity: 'low'
        });
      }
    }

    for (const index of sourceIndexes) {
      if (!destIndexes.has(index)) {
        const [name] = index.split(':');
        differences.push({
          type: 'index',
          name,
          action: 'removed',
          details: 'Index removed',
          severity: 'low'
        });
      }
    }
  }

  private assessColumnChangeSeverity(
    sourceColumn: ColumnSchema,
    destColumn: ColumnSchema
  ): 'low' | 'medium' | 'high' {
    // Type changes are generally high severity
    if (sourceColumn.dataType !== destColumn.dataType) {
      // Exception: integer to UUID is expected for ID fields
      if (sourceColumn.name === 'id' &&
          sourceColumn.dataType === 'integer' &&
          destColumn.dataType === 'uuid') {
        return 'medium';
      }
      return 'high';
    }

    // Nullable changes
    if (sourceColumn.isNullable && !destColumn.isNullable) {
      return 'high'; // Data loss potential
    }

    if (!sourceColumn.isNullable && destColumn.isNullable) {
      return 'low'; // Safe change
    }

    // Length reductions
    if (sourceColumn.maxLength && destColumn.maxLength &&
        sourceColumn.maxLength > destColumn.maxLength) {
      return 'medium';
    }

    return 'low';
  }

  private generateCompatibilityRecommendation(diff: SchemaDifference['differences'][0]): string {
    if (diff.action === 'removed' && diff.severity === 'high') {
      return `Consider preserving ${diff.name} data before migration or provide default values`;
    }

    if (diff.action === 'modified' && diff.details.includes('→')) {
      return `Verify data compatibility and implement transformation logic for ${diff.name}`;
    }

    if (diff.action === 'added' && diff.severity === 'medium') {
      return `Ensure ${diff.name} has appropriate default values or migration logic`;
    }

    return `Review ${diff.name} changes and implement appropriate migration strategy`;
  }

  private estimateMigrationTime(differences: SchemaDifference, recordCount: number): string {
    let baseTimeMinutes = 5; // Base migration time

    // Add time based on complexity
    baseTimeMinutes += differences.differences.length * 2;

    // Add time for high-severity changes
    const highSeverityCount = differences.differences.filter(d => d.severity === 'high').length;
    baseTimeMinutes += highSeverityCount * 10;

    // Add time based on record count
    if (recordCount > 100000) {
      baseTimeMinutes += Math.ceil(recordCount / 10000) * 2;
    }

    if (baseTimeMinutes < 60) {
      return `${baseTimeMinutes} minutes`;
    } else {
      const hours = Math.ceil(baseTimeMinutes / 60);
      return `${hours} hour${hours > 1 ? 's' : ''}`;
    }
  }

  private calculateFieldSimilarity(sourceField: string, destField: string): number {
    // Remove common prefixes/suffixes
    const normalize = (str: string) =>
      str.toLowerCase()
         .replace(/^(legacy_|old_|new_)/, '')
         .replace(/(_id|_key|_ref)$/, '');

    const normalizedSource = normalize(sourceField);
    const normalizedDest = normalize(destField);

    return this.calculateStringSimilarity(normalizedSource, normalizedDest);
  }

  private calculateStringSimilarity(str1: string, str2: string): number {
    // Simple Levenshtein distance-based similarity
    if (str1 === str2) return 1.0;

    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  private calculateEnumSimilarity(enum1: EnumType, enum2: EnumType): number {
    // Name similarity
    const nameSimilarity = this.calculateStringSimilarity(enum1.typeName, enum2.typeName);

    // Value similarity
    const commonValues = enum1.values.filter(v => enum2.values.includes(v));
    const valueSimilarity = commonValues.length / Math.max(enum1.values.length, enum2.values.length);

    // Weighted average
    return (nameSimilarity * 0.3) + (valueSimilarity * 0.7);
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + indicator
        );
      }
    }

    return matrix[str2.length][str1.length];
  }

  private determineTransformationType(
    sourceColumn: ColumnSchema,
    destColumn: ColumnSchema
  ): FieldMapping['transformationType'] {
    if (sourceColumn.dataType !== destColumn.dataType) {
      return 'type_conversion';
    }

    if (sourceColumn.isForeignKey) {
      return 'foreign_key_lookup';
    }

    return 'direct_mapping';
  }

  private generateTransformationLogic(
    sourceField: string,
    destField: string,
    transformationType: FieldMapping['transformationType']
  ): string | undefined {
    switch (transformationType) {
      case 'concatenation':
        return `CONCAT(first_name, ' ', last_name)`;
      case 'foreign_key_lookup':
        return `SELECT new_id FROM migration_mappings WHERE entity_type = ? AND legacy_id = ${sourceField}`;
      case 'type_conversion':
        return `CAST(${sourceField} AS target_type)`;
      case 'enum_conversion':
        return `CASE ${sourceField} WHEN 'old_value' THEN 'new_value' END`;
      default:
        return undefined;
    }
  }

  private inferEntityFromForeignKey(fieldName: string): string {
    // Remove _id suffix and make plural
    const base = fieldName.replace(/_id$/, '');
    return base.endsWith('s') ? base : `${base}s`;
  }

  private calculateMappingComplexity(mappings: FieldMapping[]): number {
    let complexity = 0;

    for (const mapping of mappings) {
      switch (mapping.transformationType) {
        case 'direct_mapping':
          complexity += 0.1;
          break;
        case 'type_conversion':
          complexity += 0.3;
          break;
        case 'foreign_key_lookup':
          complexity += 0.5;
          break;
        case 'concatenation':
        case 'split':
          complexity += 0.4;
          break;
        case 'enum_conversion':
          complexity += 0.3;
          break;
        case 'preserve_as_legacy':
          complexity += 0.2;
          break;
      }

      if (mapping.dependencies && mapping.dependencies.length > 0) {
        complexity += mapping.dependencies.length * 0.1;
      }
    }

    return Math.min(1, complexity / mappings.length);
  }

  private hasColumnChanged(baseColumn: ColumnSchema, evolvedColumn: ColumnSchema): boolean {
    return baseColumn.dataType !== evolvedColumn.dataType ||
           baseColumn.isNullable !== evolvedColumn.isNullable ||
           baseColumn.maxLength !== evolvedColumn.maxLength ||
           baseColumn.precision !== evolvedColumn.precision ||
           baseColumn.scale !== evolvedColumn.scale;
  }

  private isColumnChangeBreaking(baseColumn: ColumnSchema, evolvedColumn: ColumnSchema): boolean {
    // Making a nullable column non-nullable without a default is breaking
    if (baseColumn.isNullable && !evolvedColumn.isNullable && !evolvedColumn.hasDefault) {
      return true;
    }

    // Reducing length is potentially breaking
    if (baseColumn.maxLength && evolvedColumn.maxLength &&
        baseColumn.maxLength > evolvedColumn.maxLength) {
      return true;
    }

    // Reducing precision is potentially breaking
    if (baseColumn.precision && evolvedColumn.precision &&
        baseColumn.precision > evolvedColumn.precision) {
      return true;
    }

    return false;
  }

  private estimateScriptExecutionTime(changeCount: number): string {
    const baseTimeSeconds = 10;
    const timePerChange = 5;
    const totalSeconds = baseTimeSeconds + (changeCount * timePerChange);

    if (totalSeconds < 60) {
      return `${totalSeconds} seconds`;
    } else {
      const minutes = Math.ceil(totalSeconds / 60);
      return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    }
  }
}