// Data Comparator Service
// Identifies missing and conflicted records between source and target databases

import { Pool, PoolClient } from 'pg';
import { DataDifferentialModel } from '../models/data-differential';
import {
  DataComparisonResult,
  DataDifferential,
  ComparisonType,
  ResolutionStrategy,
  MigrationError
} from '../types/migration-types';

export interface ComparisonOptions {
  batchSize?: number;
  entityTypes?: string[];
  sourceSchema?: string;
  targetSchema?: string;
  includeSoftDeleted?: boolean;
}

export interface EntityComparisonResult {
  entityType: string;
  sourceTable: string;
  targetTable: string;
  missing: ComparisonResultDetail;
  conflicted: ComparisonResultDetail;
  deleted: ComparisonResultDetail;
  identical: number;
  totalSource: number;
  totalTarget: number;
}

export interface ComparisonResultDetail {
  count: number;
  legacyIds: any[];
  sampleRecords?: any[];
}

export interface RecordComparison {
  legacyId: any;
  sourceRecord: any;
  targetRecord?: any;
  differences?: string[];
}

export class DataComparatorService {
  private dataModel: DataDifferentialModel;

  constructor(
    private sourceDb: Pool,
    private targetDb: Pool,
    private projectRoot: string = process.cwd()
  ) {
    this.dataModel = new DataDifferentialModel(targetDb);
  }

  /**
   * Compare all entities between source and target databases
   */
  async compareAllEntities(options: ComparisonOptions = {}): Promise<DataComparisonResult> {
    const entityTypes = options.entityTypes || this.getDefaultEntityTypes();
    const results: EntityComparisonResult[] = [];

    for (const entityType of entityTypes) {
      try {
        const result = await this.compareEntity(entityType, options);
        results.push(result);
      } catch (error) {
        console.error(`Failed to compare entity ${entityType}:`, error.message);
        throw new MigrationError(
          `Entity comparison failed: ${error.message}`,
          entityType
        );
      }
    }

    return this.aggregateResults(results);
  }

  /**
   * Compare a specific entity between source and target
   */
  async compareEntity(
    entityType: string,
    options: ComparisonOptions = {}
  ): Promise<EntityComparisonResult> {
    const { sourceTable, targetTable } = this.getTableNames(entityType);
    const batchSize = options.batchSize || 1000;

    console.log(`Comparing ${entityType}: ${sourceTable} -> ${targetTable}`);

    // Get total counts
    const [totalSource, totalTarget] = await Promise.all([
      this.getRecordCount(this.sourceDb, sourceTable, options.sourceSchema),
      this.getRecordCount(this.targetDb, targetTable, options.targetSchema)
    ]);

    // Find missing records (in source but not in target)
    const missing = await this.findMissingRecords(
      sourceTable,
      targetTable,
      entityType,
      batchSize,
      options
    );

    // Find conflicted records (exist in both but with differences)
    const conflicted = await this.findConflictedRecords(
      sourceTable,
      targetTable,
      entityType,
      batchSize,
      options
    );

    // Find deleted records (in target but not in source - if tracking deletions)
    const deleted = options.includeSoftDeleted
      ? await this.findDeletedRecords(sourceTable, targetTable, entityType, batchSize, options)
      : { count: 0, legacyIds: [], sampleRecords: [] };

    // Calculate identical records
    const identical = totalTarget - conflicted.count - deleted.count;

    const result: EntityComparisonResult = {
      entityType,
      sourceTable,
      targetTable,
      missing,
      conflicted,
      deleted,
      identical: Math.max(0, identical),
      totalSource,
      totalTarget
    };

    // Store differential records in database
    await this.storeDifferentials(result);

    return result;
  }

  /**
   * Find records that exist in source but not in target
   */
  private async findMissingRecords(
    sourceTable: string,
    targetTable: string,
    entityType: string,
    batchSize: number,
    options: ComparisonOptions
  ): Promise<ComparisonResultDetail> {
    const legacyIdField = this.getLegacyIdField(entityType);
    const sourceSchema = options.sourceSchema || 'public';
    const targetSchema = options.targetSchema || 'public';

    // Query to find records in source that don't have mapping in target
    const missingQuery = `
      SELECT s.${legacyIdField}
      FROM ${sourceSchema}.${sourceTable} s
      LEFT JOIN migration_mappings mm ON mm.legacy_id = s.${legacyIdField}::text
        AND mm.entity_type = $1
      WHERE mm.legacy_id IS NULL
      ORDER BY s.${legacyIdField}
      LIMIT $2
    `;

    // Get sample of missing records for analysis
    const sampleQuery = `
      SELECT s.*
      FROM ${sourceSchema}.${sourceTable} s
      LEFT JOIN migration_mappings mm ON mm.legacy_id = s.${legacyIdField}::text
        AND mm.entity_type = $1
      WHERE mm.legacy_id IS NULL
      ORDER BY s.${legacyIdField}
      LIMIT 10
    `;

    try {
      const [missingResult, sampleResult] = await Promise.all([
        this.sourceDb.query(missingQuery, [entityType, batchSize * 10]), // Get more for counting
        this.sourceDb.query(sampleQuery, [entityType])
      ]);

      const legacyIds = missingResult.rows.map(row => row[legacyIdField]);
      const sampleRecords = sampleResult.rows;

      return {
        count: legacyIds.length,
        legacyIds,
        sampleRecords
      };
    } catch (error) {
      throw new MigrationError(
        `Failed to find missing records for ${entityType}: ${error.message}`,
        entityType
      );
    }
  }

  /**
   * Find records that exist in both databases but have differences
   */
  private async findConflictedRecords(
    sourceTable: string,
    targetTable: string,
    entityType: string,
    batchSize: number,
    options: ComparisonOptions
  ): Promise<ComparisonResultDetail> {
    const legacyIdField = this.getLegacyIdField(entityType);
    const sourceSchema = options.sourceSchema || 'public';
    const targetSchema = options.targetSchema || 'public';

    // Get mapped records that exist in both databases
    const mappedQuery = `
      SELECT mm.legacy_id, mm.uuid_id
      FROM migration_mappings mm
      WHERE mm.entity_type = $1
      ORDER BY mm.legacy_id::integer
      LIMIT $2
    `;

    try {
      const mappedResult = await this.targetDb.query(mappedQuery, [entityType, batchSize]);
      const conflicts: RecordComparison[] = [];

      // Compare records in batches
      for (let i = 0; i < mappedResult.rows.length; i += 50) {
        const batch = mappedResult.rows.slice(i, i + 50);
        const batchConflicts = await this.compareBatchRecords(
          batch,
          sourceTable,
          targetTable,
          entityType,
          sourceSchema,
          targetSchema
        );
        conflicts.push(...batchConflicts);
      }

      const legacyIds = conflicts.map(c => c.legacyId);
      const sampleRecords = conflicts.slice(0, 10).map(c => ({
        legacy_id: c.legacyId,
        source: c.sourceRecord,
        target: c.targetRecord,
        differences: c.differences
      }));

      return {
        count: conflicts.length,
        legacyIds,
        sampleRecords
      };
    } catch (error) {
      throw new MigrationError(
        `Failed to find conflicted records for ${entityType}: ${error.message}`,
        entityType
      );
    }
  }

  /**
   * Compare a batch of records between source and target
   */
  private async compareBatchRecords(
    mappings: any[],
    sourceTable: string,
    targetTable: string,
    entityType: string,
    sourceSchema: string,
    targetSchema: string
  ): Promise<RecordComparison[]> {
    if (mappings.length === 0) return [];

    const legacyIdField = this.getLegacyIdField(entityType);
    const legacyIds = mappings.map(m => m.legacy_id);
    const uuidIds = mappings.map(m => m.uuid_id);

    // Get source records
    const sourceQuery = `
      SELECT * FROM ${sourceSchema}.${sourceTable}
      WHERE ${legacyIdField} = ANY($1::int[])
      ORDER BY ${legacyIdField}
    `;

    // Get target records
    const targetQuery = `
      SELECT * FROM ${targetSchema}.${targetTable}
      WHERE id = ANY($1::uuid[])
      ORDER BY (metadata->>'legacy_id')::int
    `;

    try {
      const [sourceResult, targetResult] = await Promise.all([
        this.sourceDb.query(sourceQuery, [legacyIds.map(id => parseInt(id))]),
        this.targetDb.query(targetQuery, [uuidIds])
      ]);

      const conflicts: RecordComparison[] = [];
      const sourceRecords = new Map(sourceResult.rows.map(r => [r[legacyIdField].toString(), r]));
      const targetRecords = new Map(targetResult.rows.map(r => [r.metadata?.legacy_id?.toString(), r]));

      for (const mapping of mappings) {
        const legacyId = mapping.legacy_id;
        const sourceRecord = sourceRecords.get(legacyId);
        const targetRecord = targetRecords.get(legacyId);

        if (sourceRecord && targetRecord) {
          const differences = this.findRecordDifferences(sourceRecord, targetRecord, entityType);
          if (differences.length > 0) {
            conflicts.push({
              legacyId,
              sourceRecord,
              targetRecord,
              differences
            });
          }
        }
      }

      return conflicts;
    } catch (error) {
      throw new MigrationError(
        `Failed to compare batch records for ${entityType}: ${error.message}`,
        entityType
      );
    }
  }

  /**
   * Find differences between source and target records
   */
  private findRecordDifferences(sourceRecord: any, targetRecord: any, entityType: string): string[] {
    const differences: string[] = [];
    const compareFields = this.getCompareFields(entityType);

    for (const field of compareFields) {
      const sourceValue = this.normalizeValue(sourceRecord[field]);
      const targetValue = this.normalizeValue(this.extractTargetValue(targetRecord, field));

      if (sourceValue !== targetValue) {
        differences.push(`${field}: '${sourceValue}' != '${targetValue}'`);
      }
    }

    return differences;
  }

  /**
   * Find records that exist in target but not in source (deletions)
   */
  private async findDeletedRecords(
    sourceTable: string,
    targetTable: string,
    entityType: string,
    batchSize: number,
    options: ComparisonOptions
  ): Promise<ComparisonResultDetail> {
    const sourceSchema = options.sourceSchema || 'public';
    const targetSchema = options.targetSchema || 'public';
    const legacyIdField = this.getLegacyIdField(entityType);

    // Find target records that don't have corresponding source records
    const deletedQuery = `
      SELECT (t.metadata->>'legacy_id') as legacy_id
      FROM ${targetSchema}.${targetTable} t
      WHERE NOT EXISTS (
        SELECT 1 FROM ${sourceSchema}.${sourceTable} s
        WHERE s.${legacyIdField}::text = t.metadata->>'legacy_id'
      )
      AND t.metadata->>'legacy_id' IS NOT NULL
      ORDER BY (t.metadata->>'legacy_id')::int
      LIMIT $1
    `;

    try {
      const result = await this.targetDb.query(deletedQuery, [batchSize]);
      const legacyIds = result.rows.map(row => row.legacy_id);

      return {
        count: legacyIds.length,
        legacyIds,
        sampleRecords: result.rows.slice(0, 10)
      };
    } catch (error) {
      throw new MigrationError(
        `Failed to find deleted records for ${entityType}: ${error.message}`,
        entityType
      );
    }
  }

  /**
   * Store differential results in the database
   */
  private async storeDifferentials(result: EntityComparisonResult): Promise<void> {
    const { entityType, sourceTable, targetTable } = result;

    // Store missing records differential
    if (result.missing.count > 0) {
      await this.dataModel.create({
        source_table: sourceTable,
        target_table: targetTable,
        comparison_type: ComparisonType.MISSING_RECORDS,
        legacy_ids: result.missing.legacyIds,
        record_count: result.missing.count,
        comparison_criteria: { entity_type: entityType },
        resolution_strategy: ResolutionStrategy.SOURCE_WINS,
        resolved: false,
        metadata: {
          sample_records: result.missing.sampleRecords?.slice(0, 5),
          total_source: result.totalSource,
          total_target: result.totalTarget
        }
      });
    }

    // Store conflicted records differential
    if (result.conflicted.count > 0) {
      await this.dataModel.create({
        source_table: sourceTable,
        target_table: targetTable,
        comparison_type: ComparisonType.CONFLICTED_RECORDS,
        legacy_ids: result.conflicted.legacyIds,
        record_count: result.conflicted.count,
        comparison_criteria: { entity_type: entityType },
        resolution_strategy: ResolutionStrategy.SOURCE_WINS,
        resolved: false,
        metadata: {
          sample_records: result.conflicted.sampleRecords?.slice(0, 5),
          conflicts_sample: result.conflicted.sampleRecords
        }
      });
    }

    // Store deleted records differential
    if (result.deleted.count > 0) {
      await this.dataModel.create({
        source_table: sourceTable,
        target_table: targetTable,
        comparison_type: ComparisonType.DELETED_RECORDS,
        legacy_ids: result.deleted.legacyIds,
        record_count: result.deleted.count,
        comparison_criteria: { entity_type: entityType },
        resolution_strategy: ResolutionStrategy.MANUAL_REVIEW,
        resolved: false,
        metadata: {
          sample_records: result.deleted.sampleRecords?.slice(0, 5)
        }
      });
    }
  }

  /**
   * Get record count for a table
   */
  private async getRecordCount(db: Pool, tableName: string, schema: string = 'public'): Promise<number> {
    try {
      const query = `SELECT COUNT(*) as count FROM ${schema}.${tableName}`;
      const result = await db.query(query);
      return parseInt(result.rows[0].count);
    } catch (error) {
      console.warn(`Could not get count for ${schema}.${tableName}: ${error.message}`);
      return 0;
    }
  }

  /**
   * Aggregate results from multiple entities
   */
  private aggregateResults(results: EntityComparisonResult[]): DataComparisonResult {
    const totals = results.reduce(
      (acc, result) => ({
        missing_records: acc.missing_records + result.missing.count,
        conflicted_records: acc.conflicted_records + result.conflicted.count,
        deleted_records: acc.deleted_records + result.deleted.count,
        identical_records: acc.identical_records + result.identical,
        total_source_records: acc.total_source_records + result.totalSource,
        total_target_records: acc.total_target_records + result.totalTarget
      }),
      {
        missing_records: 0,
        conflicted_records: 0,
        deleted_records: 0,
        identical_records: 0,
        total_source_records: 0,
        total_target_records: 0
      }
    );

    return {
      ...totals,
      comparison_timestamp: new Date()
    };
  }

  /**
   * Get default entity types for comparison
   */
  private getDefaultEntityTypes(): string[] {
    return [
      'offices',
      'profiles',
      'doctors',
      'patients',
      'orders',
      'products',
      'jaws',
      'projects',
      'treatment-plans'
    ];
  }

  /**
   * Get source and target table names for an entity
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
      throw new MigrationError(`Unknown entity type: ${entityType}`, entityType);
    }

    return { sourceTable: tables.source, targetTable: tables.target };
  }

  /**
   * Get the legacy ID field name for an entity
   */
  private getLegacyIdField(entityType: string): string {
    // Most entities use 'id' as the legacy field
    const customFields = {
      'user-profiles': 'user_id'
    };

    return customFields[entityType as keyof typeof customFields] || 'id';
  }

  /**
   * Get fields to compare for an entity type
   */
  private getCompareFields(entityType: string): string[] {
    const baseFields = ['name', 'email', 'phone', 'address', 'status'];

    const entityFields = {
      'offices': ['name', 'address', 'phone', 'email'],
      'profiles': ['first_name', 'last_name', 'email', 'phone'],
      'doctors': ['first_name', 'last_name', 'email', 'phone', 'specialization'],
      'patients': ['first_name', 'last_name', 'email', 'phone', 'date_of_birth'],
      'orders': ['status', 'total_amount', 'order_date'],
      'products': ['name', 'price', 'category', 'status'],
      'jaws': ['patient_id', 'upper_arch', 'lower_arch'],
      'projects': ['name', 'status', 'start_date', 'end_date'],
      'treatment-plans': ['patient_id', 'treatment_type', 'status']
    };

    return entityFields[entityType as keyof typeof entityFields] || baseFields;
  }

  /**
   * Extract value from target record (handles metadata and direct fields)
   */
  private extractTargetValue(record: any, field: string): any {
    // Direct field access
    if (record[field] !== undefined) {
      return record[field];
    }

    // Check in metadata
    if (record.metadata && record.metadata[field] !== undefined) {
      return record.metadata[field];
    }

    return null;
  }

  /**
   * Normalize values for comparison (handles nulls, dates, etc.)
   */
  private normalizeValue(value: any): string {
    if (value === null || value === undefined) {
      return '';
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return String(value).trim();
  }

  /**
   * Get unresolved differentials for an entity
   */
  async getUnresolvedDifferentials(entityType?: string): Promise<DataDifferential[]> {
    const filters: any = { resolved: false };

    if (entityType) {
      filters.comparison_criteria = { entity_type: entityType };
    }

    return this.dataModel.list(filters);
  }

  /**
   * Get comparison summary
   */
  async getComparisonSummary(): Promise<any> {
    const query = `
      SELECT
        (metadata->>'entity_type') as entity_type,
        comparison_type,
        COUNT(*) as differential_count,
        SUM(record_count) as total_records,
        COUNT(*) FILTER (WHERE resolved = true) as resolved_count
      FROM data_differentials
      WHERE created_at > NOW() - INTERVAL '7 days'
      GROUP BY (metadata->>'entity_type'), comparison_type
      ORDER BY entity_type, comparison_type
    `;

    try {
      const result = await this.targetDb.query(query);
      return result.rows;
    } catch (error) {
      throw new MigrationError(`Failed to get comparison summary: ${error.message}`);
    }
  }
}