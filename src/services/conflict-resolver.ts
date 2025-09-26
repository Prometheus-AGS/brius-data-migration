// Conflict Resolver Service
// Implements source-wins strategy for resolving data conflicts during migration

import { Pool, PoolClient } from 'pg';
import { DataDifferentialModel } from '../models/data-differential';
import {
  DataDifferential,
  ComparisonType,
  ResolutionStrategy,
  ConflictResolutionResult,
  ConflictResolutionError,
  MigrationError
} from '../types/migration-types';

export interface ResolutionOptions {
  batchSize?: number;
  dryRun?: boolean;
  createBackup?: boolean;
  validateAfterResolution?: boolean;
  maxRetries?: number;
}

export interface ConflictResolutionSummary {
  totalConflicts: number;
  resolvedConflicts: number;
  failedConflicts: number;
  skippedConflicts: number;
  backupCreated: boolean;
  resolutionTime: number;
  strategy: ResolutionStrategy;
}

export interface BackupInfo {
  backupId: string;
  entityType: string;
  recordCount: number;
  createdAt: Date;
  backupLocation: string;
}

export class ConflictResolverService {
  private dataModel: DataDifferentialModel;

  constructor(
    private sourceDb: Pool,
    private targetDb: Pool,
    private projectRoot: string = process.cwd()
  ) {
    this.dataModel = new DataDifferentialModel(targetDb);
  }

  /**
   * Resolve all unresolved conflicts using source-wins strategy
   */
  async resolveAllConflicts(options: ResolutionOptions = {}): Promise<ConflictResolutionResult> {
    const startTime = Date.now();
    const unresolved = await this.dataModel.list({ resolved: false });

    console.log(`Found ${unresolved.length} unresolved differentials to process`);

    const results: ConflictResolutionSummary[] = [];
    let totalConflictsDetected = 0;
    let totalConflictsResolved = 0;
    let totalFailedResolutions = 0;

    // Group by entity type for efficient processing
    const groupedByEntity = this.groupDifferentialsByEntity(unresolved);

    for (const [entityType, differentials] of Object.entries(groupedByEntity)) {
      try {
        const result = await this.resolveEntityConflicts(entityType, differentials, options);
        results.push(result);

        totalConflictsDetected += result.totalConflicts;
        totalConflictsResolved += result.resolvedConflicts;
        totalFailedResolutions += result.failedConflicts;
      } catch (error) {
        console.error(`Failed to resolve conflicts for ${entityType}:`, error.message);
        totalFailedResolutions += differentials.length;
      }
    }

    const resolutionDetails = {
      entity_summaries: results,
      total_execution_time: Date.now() - startTime,
      strategy_applied: ResolutionStrategy.SOURCE_WINS
    };

    return {
      conflicts_detected: totalConflictsDetected,
      conflicts_resolved: totalConflictsResolved,
      resolution_strategy: ResolutionStrategy.SOURCE_WINS,
      failed_resolutions: totalFailedResolutions,
      resolution_details: resolutionDetails
    };
  }

  /**
   * Resolve conflicts for a specific entity type
   */
  async resolveEntityConflicts(
    entityType: string,
    differentials: DataDifferential[],
    options: ResolutionOptions = {}
  ): Promise<ConflictResolutionSummary> {
    const startTime = Date.now();
    const { sourceTable, targetTable } = this.getTableNames(entityType);

    console.log(`Resolving ${differentials.length} conflicts for ${entityType}`);

    let resolvedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let backupCreated = false;

    // Create backup if requested
    if (options.createBackup && !options.dryRun) {
      backupCreated = await this.createBackup(entityType, targetTable);
    }

    // Process each differential
    for (const differential of differentials) {
      try {
        if (options.dryRun) {
          console.log(`[DRY RUN] Would resolve: ${differential.comparison_type} for ${differential.record_count} records`);
          skippedCount++;
          continue;
        }

        const resolved = await this.resolveDifferential(
          differential,
          sourceTable,
          targetTable,
          entityType,
          options
        );

        if (resolved) {
          resolvedCount++;
          await this.dataModel.markResolved(differential.id);
        } else {
          failedCount++;
        }
      } catch (error) {
        console.error(`Failed to resolve differential ${differential.id}:`, error.message);
        failedCount++;
      }
    }

    return {
      totalConflicts: differentials.length,
      resolvedConflicts: resolvedCount,
      failedConflicts: failedCount,
      skippedConflicts: skippedCount,
      backupCreated,
      resolutionTime: Date.now() - startTime,
      strategy: ResolutionStrategy.SOURCE_WINS
    };
  }

  /**
   * Resolve a specific differential record
   */
  private async resolveDifferential(
    differential: DataDifferential,
    sourceTable: string,
    targetTable: string,
    entityType: string,
    options: ResolutionOptions
  ): Promise<boolean> {
    const batchSize = options.batchSize || 100;
    const maxRetries = options.maxRetries || 3;

    switch (differential.comparison_type) {
      case ComparisonType.MISSING_RECORDS:
        return this.resolveMissingRecords(
          differential,
          sourceTable,
          targetTable,
          entityType,
          batchSize,
          maxRetries
        );

      case ComparisonType.CONFLICTED_RECORDS:
        return this.resolveConflictedRecords(
          differential,
          sourceTable,
          targetTable,
          entityType,
          batchSize,
          maxRetries
        );

      case ComparisonType.DELETED_RECORDS:
        return this.resolveDeletedRecords(
          differential,
          sourceTable,
          targetTable,
          entityType,
          batchSize,
          maxRetries
        );

      default:
        throw new ConflictResolutionError(
          `Unsupported comparison type: ${differential.comparison_type}`,
          differential.comparison_type,
          ResolutionStrategy.SOURCE_WINS
        );
    }
  }

  /**
   * Resolve missing records by inserting them into target
   */
  private async resolveMissingRecords(
    differential: DataDifferential,
    sourceTable: string,
    targetTable: string,
    entityType: string,
    batchSize: number,
    maxRetries: number
  ): Promise<boolean> {
    const legacyIds = differential.legacy_ids;
    const legacyIdField = this.getLegacyIdField(entityType);

    console.log(`Inserting ${legacyIds.length} missing records for ${entityType}`);

    // Process in batches
    for (let i = 0; i < legacyIds.length; i += batchSize) {
      const batch = legacyIds.slice(i, i + batchSize);
      let retries = 0;

      while (retries < maxRetries) {
        try {
          await this.insertMissingRecordsBatch(
            batch,
            sourceTable,
            targetTable,
            entityType,
            legacyIdField
          );
          break;
        } catch (error) {
          retries++;
          if (retries >= maxRetries) {
            console.error(`Failed to insert batch after ${maxRetries} retries:`, error.message);
            return false;
          }

          // Exponential backoff
          await this.delay(Math.pow(2, retries) * 1000);
        }
      }
    }

    return true;
  }

  /**
   * Insert a batch of missing records
   */
  private async insertMissingRecordsBatch(
    legacyIds: any[],
    sourceTable: string,
    targetTable: string,
    entityType: string,
    legacyIdField: string
  ): Promise<void> {
    const client = await this.targetDb.connect();

    try {
      await client.query('BEGIN');

      // Get source records
      const sourceQuery = `
        SELECT * FROM ${sourceTable}
        WHERE ${legacyIdField} = ANY($1::int[])
      `;

      const sourceResult = await this.sourceDb.query(
        sourceQuery,
        [legacyIds.map(id => parseInt(id.toString()))]
      );

      if (sourceResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return;
      }

      // Transform and insert records
      for (const sourceRecord of sourceResult.rows) {
        const { insertQuery, values, uuid } = this.transformRecordForInsertion(
          sourceRecord,
          targetTable,
          entityType
        );

        await client.query(insertQuery, values);

        // Create mapping entry
        await this.createMappingEntry(
          client,
          entityType,
          sourceRecord[legacyIdField],
          uuid,
          sourceTable,
          targetTable
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Resolve conflicted records by updating target with source data
   */
  private async resolveConflictedRecords(
    differential: DataDifferential,
    sourceTable: string,
    targetTable: string,
    entityType: string,
    batchSize: number,
    maxRetries: number
  ): Promise<boolean> {
    const legacyIds = differential.legacy_ids;

    console.log(`Updating ${legacyIds.length} conflicted records for ${entityType}`);

    // Process in batches
    for (let i = 0; i < legacyIds.length; i += batchSize) {
      const batch = legacyIds.slice(i, i + batchSize);
      let retries = 0;

      while (retries < maxRetries) {
        try {
          await this.updateConflictedRecordsBatch(
            batch,
            sourceTable,
            targetTable,
            entityType
          );
          break;
        } catch (error) {
          retries++;
          if (retries >= maxRetries) {
            console.error(`Failed to update batch after ${maxRetries} retries:`, error.message);
            return false;
          }

          await this.delay(Math.pow(2, retries) * 1000);
        }
      }
    }

    return true;
  }

  /**
   * Update a batch of conflicted records
   */
  private async updateConflictedRecordsBatch(
    legacyIds: any[],
    sourceTable: string,
    targetTable: string,
    entityType: string
  ): Promise<void> {
    const client = await this.targetDb.connect();
    const legacyIdField = this.getLegacyIdField(entityType);

    try {
      await client.query('BEGIN');

      // Get source records and their UUID mappings
      const mappingQuery = `
        SELECT mm.legacy_id, mm.uuid_id
        FROM migration_mappings mm
        WHERE mm.entity_type = $1 AND mm.legacy_id = ANY($2::text[])
      `;

      const mappingResult = await client.query(
        mappingQuery,
        [entityType, legacyIds.map(id => id.toString())]
      );

      if (mappingResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return;
      }

      // Get source records
      const sourceQuery = `
        SELECT * FROM ${sourceTable}
        WHERE ${legacyIdField} = ANY($1::int[])
      `;

      const sourceResult = await this.sourceDb.query(
        sourceQuery,
        [legacyIds.map(id => parseInt(id.toString()))]
      );

      // Update each record
      for (const sourceRecord of sourceResult.rows) {
        const mapping = mappingResult.rows.find(
          m => m.legacy_id === sourceRecord[legacyIdField].toString()
        );

        if (mapping) {
          const { updateQuery, values } = this.transformRecordForUpdate(
            sourceRecord,
            targetTable,
            entityType,
            mapping.uuid_id
          );

          await client.query(updateQuery, values);
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Resolve deleted records by removing them from target
   */
  private async resolveDeletedRecords(
    differential: DataDifferential,
    sourceTable: string,
    targetTable: string,
    entityType: string,
    batchSize: number,
    maxRetries: number
  ): Promise<boolean> {
    // For source-wins strategy, if records exist in target but not source,
    // we should remove them from target
    const legacyIds = differential.legacy_ids;

    console.log(`Removing ${legacyIds.length} deleted records from ${entityType}`);

    // Get UUID mappings for these legacy IDs
    const mappingQuery = `
      SELECT uuid_id FROM migration_mappings
      WHERE entity_type = $1 AND legacy_id = ANY($2::text[])
    `;

    try {
      const mappingResult = await this.targetDb.query(
        mappingQuery,
        [entityType, legacyIds.map(id => id.toString())]
      );

      const uuidsToDelete = mappingResult.rows.map(row => row.uuid_id);

      if (uuidsToDelete.length === 0) {
        return true; // Nothing to delete
      }

      // Delete in batches
      for (let i = 0; i < uuidsToDelete.length; i += batchSize) {
        const batch = uuidsToDelete.slice(i, i + batchSize);

        const deleteQuery = `DELETE FROM ${targetTable} WHERE id = ANY($1::uuid[])`;
        await this.targetDb.query(deleteQuery, [batch]);

        // Remove mappings
        const deleteMappingQuery = `
          DELETE FROM migration_mappings
          WHERE entity_type = $1 AND uuid_id = ANY($2::uuid[])
        `;
        await this.targetDb.query(deleteMappingQuery, [entityType, batch]);
      }

      return true;
    } catch (error) {
      console.error(`Failed to delete records for ${entityType}:`, error.message);
      return false;
    }
  }

  /**
   * Transform source record for insertion into target table
   */
  private transformRecordForInsertion(
    sourceRecord: any,
    targetTable: string,
    entityType: string
  ): { insertQuery: string; values: any[]; uuid: string } {
    const { v4: uuidv4 } = require('uuid');
    const uuid = uuidv4();
    const legacyIdField = this.getLegacyIdField(entityType);

    // Base transformation logic - adapt based on entity type
    const transformed = this.transformFields(sourceRecord, entityType);

    // Add common fields
    transformed.id = uuid;
    transformed.created_at = new Date();
    transformed.updated_at = new Date();
    transformed.metadata = {
      ...transformed.metadata,
      legacy_id: sourceRecord[legacyIdField],
      migrated_from: targetTable.replace('dispatch_', ''),
      migration_timestamp: new Date()
    };

    const fields = Object.keys(transformed);
    const placeholders = fields.map((_, index) => `$${index + 1}`).join(', ');
    const values = fields.map(field => transformed[field]);

    const insertQuery = `
      INSERT INTO ${targetTable} (${fields.join(', ')})
      VALUES (${placeholders})
    `;

    return { insertQuery, values, uuid };
  }

  /**
   * Transform source record for updating target table
   */
  private transformRecordForUpdate(
    sourceRecord: any,
    targetTable: string,
    entityType: string,
    uuid: string
  ): { updateQuery: string; values: any[] } {
    const transformed = this.transformFields(sourceRecord, entityType);
    const legacyIdField = this.getLegacyIdField(entityType);

    // Update metadata
    transformed.updated_at = new Date();
    transformed.metadata = {
      ...transformed.metadata,
      legacy_id: sourceRecord[legacyIdField],
      last_conflict_resolution: new Date(),
      resolution_strategy: 'source_wins'
    };

    // Remove fields that shouldn't be updated
    delete transformed.id;
    delete transformed.created_at;

    const fields = Object.keys(transformed);
    const setClause = fields.map((field, index) => `${field} = $${index + 1}`).join(', ');
    const values = [...fields.map(field => transformed[field]), uuid];

    const updateQuery = `
      UPDATE ${targetTable}
      SET ${setClause}
      WHERE id = $${fields.length + 1}
    `;

    return { updateQuery, values };
  }

  /**
   * Transform fields based on entity type
   */
  private transformFields(sourceRecord: any, entityType: string): any {
    // Base transformation - override in subclasses or extend for specific entities
    const transformed = { ...sourceRecord };

    // Common transformations
    if (transformed.created_at && typeof transformed.created_at === 'string') {
      transformed.created_at = new Date(transformed.created_at);
    }
    if (transformed.updated_at && typeof transformed.updated_at === 'string') {
      transformed.updated_at = new Date(transformed.updated_at);
    }

    // Entity-specific transformations
    switch (entityType) {
      case 'offices':
        return this.transformOfficeFields(transformed);
      case 'doctors':
        return this.transformDoctorFields(transformed);
      case 'patients':
        return this.transformPatientFields(transformed);
      default:
        return transformed;
    }
  }

  /**
   * Transform office-specific fields
   */
  private transformOfficeFields(record: any): any {
    return {
      name: record.name || record.office_name,
      address: record.address,
      phone: record.phone,
      email: record.email,
      status: record.status || 'active',
      metadata: record.metadata || {}
    };
  }

  /**
   * Transform doctor-specific fields
   */
  private transformDoctorFields(record: any): any {
    return {
      first_name: record.first_name,
      last_name: record.last_name,
      email: record.email,
      phone: record.phone,
      specialization: record.specialization,
      office_id: record.office_uuid, // Assumes FK already resolved
      status: record.status || 'active',
      metadata: record.metadata || {}
    };
  }

  /**
   * Transform patient-specific fields
   */
  private transformPatientFields(record: any): any {
    return {
      first_name: record.first_name,
      last_name: record.last_name,
      email: record.email,
      phone: record.phone,
      date_of_birth: record.date_of_birth ? new Date(record.date_of_birth) : null,
      doctor_id: record.doctor_uuid, // Assumes FK already resolved
      status: record.status || 'active',
      metadata: record.metadata || {}
    };
  }

  /**
   * Create backup of target table before resolution
   */
  private async createBackup(entityType: string, targetTable: string): Promise<boolean> {
    const backupTable = `${targetTable}_backup_${Date.now()}`;

    try {
      const backupQuery = `
        CREATE TABLE ${backupTable} AS
        SELECT * FROM ${targetTable}
      `;

      await this.targetDb.query(backupQuery);
      console.log(`Created backup table: ${backupTable}`);
      return true;
    } catch (error) {
      console.error(`Failed to create backup for ${targetTable}:`, error.message);
      return false;
    }
  }

  /**
   * Create mapping entry for migrated record
   */
  private async createMappingEntry(
    client: PoolClient,
    entityType: string,
    legacyId: any,
    uuid: string,
    sourceTable: string,
    targetTable: string
  ): Promise<void> {
    const mappingQuery = `
      INSERT INTO migration_mappings (
        entity_type, legacy_id, uuid_id, migration_batch,
        migration_timestamp, validation_status, source_table,
        target_table, checksum, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (entity_type, legacy_id) DO UPDATE SET
        uuid_id = EXCLUDED.uuid_id,
        migration_timestamp = EXCLUDED.migration_timestamp,
        validation_status = EXCLUDED.validation_status
    `;

    const values = [
      entityType,
      legacyId.toString(),
      uuid,
      `conflict_resolution_${Date.now()}`,
      new Date(),
      'validated',
      sourceTable,
      targetTable,
      this.generateChecksum(legacyId.toString() + uuid),
      { resolved_by: 'conflict_resolver', strategy: 'source_wins' }
    ];

    await client.query(mappingQuery, values);
  }

  /**
   * Generate simple checksum for validation
   */
  private generateChecksum(input: string): string {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(input).digest('hex');
  }

  /**
   * Group differentials by entity type
   */
  private groupDifferentialsByEntity(differentials: DataDifferential[]): Record<string, DataDifferential[]> {
    return differentials.reduce((groups, differential) => {
      const entityType = differential.metadata?.entity_type ||
                        differential.comparison_criteria?.entity_type ||
                        this.extractEntityFromTable(differential.source_table);

      if (!groups[entityType]) {
        groups[entityType] = [];
      }
      groups[entityType].push(differential);

      return groups;
    }, {} as Record<string, DataDifferential[]>);
  }

  /**
   * Extract entity type from table name
   */
  private extractEntityFromTable(tableName: string): string {
    return tableName.replace('dispatch_', '').replace(/_/g, '-');
  }

  /**
   * Get table names for entity type
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
      throw new ConflictResolutionError(`Unknown entity type: ${entityType}`);
    }

    return { sourceTable: tables.source, targetTable: tables.target };
  }

  /**
   * Get legacy ID field for entity type
   */
  private getLegacyIdField(entityType: string): string {
    const customFields = {
      'user-profiles': 'user_id',
      'profiles': 'user_id'
    };

    return customFields[entityType as keyof typeof customFields] || 'id';
  }

  /**
   * Delay execution for retry logic
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get resolution statistics
   */
  async getResolutionStatistics(): Promise<any> {
    const query = `
      SELECT
        (metadata->>'entity_type') as entity_type,
        comparison_type,
        resolution_strategy,
        COUNT(*) as total_differentials,
        COUNT(*) FILTER (WHERE resolved = true) as resolved_count,
        COUNT(*) FILTER (WHERE resolved = false) as unresolved_count,
        AVG(record_count) as avg_records_affected,
        MAX(resolved_at) as last_resolution
      FROM data_differentials
      GROUP BY (metadata->>'entity_type'), comparison_type, resolution_strategy
      ORDER BY entity_type, comparison_type
    `;

    try {
      const result = await this.targetDb.query(query);
      return result.rows;
    } catch (error) {
      throw new ConflictResolutionError(`Failed to get resolution statistics: ${error.message}`);
    }
  }
}