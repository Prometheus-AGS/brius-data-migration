/**
 * MigrationMapping Model
 *
 * Preserves legacy ID to UUID relationships for referential integrity.
 * Essential for maintaining relationships and providing backward compatibility
 * during the migration from integer IDs to UUID-based architecture.
 */

import { Pool, PoolClient } from 'pg';
import {
  MigrationMapping,
  CreateMigrationMappingData,
  MigrationMappingFilters,
  MigrationModelValidation
} from './migration-models';
import { getLogger, Logger, DatabaseError, ValidationError, generateCorrelationId } from '../lib/error-handler';

export interface MappingStatistics {
  total_mappings: number;
  by_entity_type: Record<string, number>;
  by_source_table: Record<string, number>;
  by_destination_table: Record<string, number>;
  active_mappings: number;
  recent_mappings: number;
  largest_entity_mapping_count: number;
}

export interface BulkMappingResult {
  created_count: number;
  failed_count: number;
  duplicate_count: number;
  errors: string[];
  created_mappings: MigrationMapping[];
}

export class MigrationMappingModel {
  private db: Pool;
  private logger: Logger;
  private readonly tableName = 'migration_mappings';

  constructor(db: Pool) {
    this.db = db;
    this.logger = getLogger();
  }

  /**
   * Create new migration mapping
   */
  async create(data: CreateMigrationMappingData): Promise<MigrationMapping> {
    const correlationId = generateCorrelationId();
    this.logger.setCorrelationId(correlationId);

    try {
      this.logger.info('Creating migration mapping', {
        migration_id: data.migration_id,
        source_table: data.source_table,
        source_id: data.source_id,
        destination_table: data.destination_table,
        destination_id: data.destination_id,
        entity_type: data.entity_type
      });

      // Validate input data
      await this.validateCreateData(data);

      const query = `
        INSERT INTO ${this.tableName} (
          id, migration_id, source_table, source_id, destination_table,
          destination_id, entity_type, mapping_metadata, created_at, is_active
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), $8
        )
        RETURNING *
      `;

      const values = [
        data.migration_id,
        data.source_table,
        data.source_id,
        data.destination_table,
        data.destination_id,
        data.entity_type,
        JSON.stringify(data.mapping_metadata || {}),
        data.is_active !== false // Default to true
      ];

      const result = await this.db.query(query, values);
      const mapping = this.mapDatabaseRow(result.rows[0]);

      this.logger.info('Migration mapping created successfully', {
        mapping_id: mapping.id,
        source: `${mapping.source_table}:${mapping.source_id}`,
        destination: `${mapping.destination_table}:${mapping.destination_id}`,
        correlation_id: correlationId
      });

      return mapping;

    } catch (error) {
      // Check for duplicate key violation
      if ((error as any).code === '23505') { // PostgreSQL unique constraint violation
        throw new ValidationError(
          `Mapping already exists for ${data.source_table}:${data.source_id} in migration ${data.migration_id}`,
          'DUPLICATE_MAPPING',
          {
            source_table: data.source_table,
            source_id: data.source_id,
            migration_id: data.migration_id
          }
        );
      }

      this.logger.error('Failed to create migration mapping', error);
      throw new DatabaseError(
        `Failed to create migration mapping: ${(error as Error).message}`,
        'MIGRATION_MAPPING_CREATE_ERROR',
        { data, correlation_id: correlationId }
      );
    } finally {
      this.logger.clearContext();
    }
  }

  /**
   * Create mappings in bulk for better performance
   */
  async createBulk(mappings: CreateMigrationMappingData[]): Promise<BulkMappingResult> {
    const correlationId = generateCorrelationId();
    this.logger.setCorrelationId(correlationId);

    try {
      this.logger.info('Creating bulk migration mappings', {
        count: mappings.length,
        correlation_id: correlationId
      });

      const result: BulkMappingResult = {
        created_count: 0,
        failed_count: 0,
        duplicate_count: 0,
        errors: [],
        created_mappings: []
      };

      // Process in batches to avoid memory issues
      const batchSize = 500;
      for (let i = 0; i < mappings.length; i += batchSize) {
        const batch = mappings.slice(i, i + batchSize);
        const batchResult = await this.processBulkBatch(batch);

        result.created_count += batchResult.created_count;
        result.failed_count += batchResult.failed_count;
        result.duplicate_count += batchResult.duplicate_count;
        result.errors.push(...batchResult.errors);
        result.created_mappings.push(...batchResult.created_mappings);
      }

      this.logger.info('Bulk migration mappings completed', {
        created_count: result.created_count,
        failed_count: result.failed_count,
        duplicate_count: result.duplicate_count,
        correlation_id: correlationId
      });

      return result;

    } catch (error) {
      this.logger.error('Failed to create bulk migration mappings', error);
      throw new DatabaseError(
        `Failed to create bulk migration mappings: ${(error as Error).message}`,
        'MIGRATION_MAPPING_BULK_CREATE_ERROR',
        { count: mappings.length, correlation_id: correlationId }
      );
    } finally {
      this.logger.clearContext();
    }
  }

  /**
   * Process a batch of bulk mappings
   */
  private async processBulkBatch(batch: CreateMigrationMappingData[]): Promise<BulkMappingResult> {
    const result: BulkMappingResult = {
      created_count: 0,
      failed_count: 0,
      duplicate_count: 0,
      errors: [],
      created_mappings: []
    };

    // Build bulk insert query
    const valueRows: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    batch.forEach(mapping => {
      valueRows.push(`(gen_random_uuid(), $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, NOW(), $${paramIndex++})`);
      values.push(
        mapping.migration_id,
        mapping.source_table,
        mapping.source_id,
        mapping.destination_table,
        mapping.destination_id,
        mapping.entity_type,
        JSON.stringify(mapping.mapping_metadata || {}),
        mapping.is_active !== false
      );
    });

    const query = `
      INSERT INTO ${this.tableName} (
        id, migration_id, source_table, source_id, destination_table,
        destination_id, entity_type, mapping_metadata, created_at, is_active
      ) VALUES ${valueRows.join(', ')}
      ON CONFLICT (migration_id, source_table, source_id) DO NOTHING
      RETURNING *
    `;

    try {
      const queryResult = await this.db.query(query, values);
      result.created_count = queryResult.rowCount || 0;
      result.created_mappings = queryResult.rows.map(row => this.mapDatabaseRow(row));
      result.duplicate_count = batch.length - result.created_count;

    } catch (error) {
      result.failed_count = batch.length;
      result.errors.push((error as Error).message);
    }

    return result;
  }

  /**
   * Find mapping by legacy reference
   */
  async findByLegacyId(
    sourceTable: string,
    sourceId: string,
    migrationId?: string
  ): Promise<MigrationMapping | null> {
    try {
      let query = `SELECT * FROM ${this.tableName} WHERE source_table = $1 AND source_id = $2`;
      const values: any[] = [sourceTable, sourceId];

      if (migrationId) {
        query += ` AND migration_id = $3`;
        values.push(migrationId);
      }

      query += ` AND is_active = true ORDER BY created_at DESC LIMIT 1`;

      const result = await this.db.query(query, values);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapDatabaseRow(result.rows[0]);

    } catch (error) {
      this.logger.error('Failed to find mapping by legacy ID', error);
      throw new DatabaseError(
        `Failed to find mapping by legacy ID: ${(error as Error).message}`,
        'MIGRATION_MAPPING_FIND_BY_LEGACY_ERROR',
        { source_table: sourceTable, source_id: sourceId, migration_id: migrationId }
      );
    }
  }

  /**
   * Find mapping by destination UUID
   */
  async findByDestinationId(
    destinationTable: string,
    destinationId: string,
    migrationId?: string
  ): Promise<MigrationMapping | null> {
    try {
      let query = `SELECT * FROM ${this.tableName} WHERE destination_table = $1 AND destination_id = $2`;
      const values: any[] = [destinationTable, destinationId];

      if (migrationId) {
        query += ` AND migration_id = $3`;
        values.push(migrationId);
      }

      query += ` AND is_active = true ORDER BY created_at DESC LIMIT 1`;

      const result = await this.db.query(query, values);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapDatabaseRow(result.rows[0]);

    } catch (error) {
      this.logger.error('Failed to find mapping by destination ID', error);
      throw new DatabaseError(
        `Failed to find mapping by destination ID: ${(error as Error).message}`,
        'MIGRATION_MAPPING_FIND_BY_DESTINATION_ERROR',
        { destination_table: destinationTable, destination_id: destinationId, migration_id: migrationId }
      );
    }
  }

  /**
   * Find migration mapping by ID
   */
  async findById(id: string): Promise<MigrationMapping | null> {
    try {
      const query = `SELECT * FROM ${this.tableName} WHERE id = $1`;
      const result = await this.db.query(query, [id]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapDatabaseRow(result.rows[0]);

    } catch (error) {
      this.logger.error('Failed to find migration mapping by ID', error);
      throw new DatabaseError(
        `Failed to find migration mapping: ${(error as Error).message}`,
        'MIGRATION_MAPPING_FIND_ERROR',
        { mapping_id: id }
      );
    }
  }

  /**
   * List migration mappings with filters
   */
  async list(filters: MigrationMappingFilters = {}): Promise<MigrationMapping[]> {
    try {
      const whereClauses: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      // Build WHERE clauses based on filters
      if (filters.migration_id) {
        whereClauses.push(`migration_id = $${paramIndex++}`);
        values.push(filters.migration_id);
      }

      if (filters.source_table) {
        whereClauses.push(`source_table = $${paramIndex++}`);
        values.push(filters.source_table);
      }

      if (filters.destination_table) {
        whereClauses.push(`destination_table = $${paramIndex++}`);
        values.push(filters.destination_table);
      }

      if (filters.entity_type) {
        whereClauses.push(`entity_type = $${paramIndex++}`);
        values.push(filters.entity_type);
      }

      if (filters.is_active !== undefined) {
        whereClauses.push(`is_active = $${paramIndex++}`);
        values.push(filters.is_active);
      }

      // Build complete query
      let query = `SELECT * FROM ${this.tableName}`;

      if (whereClauses.length > 0) {
        query += ` WHERE ${whereClauses.join(' AND ')}`;
      }

      query += ` ORDER BY created_at DESC`;

      if (filters.limit) {
        query += ` LIMIT $${paramIndex++}`;
        values.push(filters.limit);
      }

      if (filters.offset) {
        query += ` OFFSET $${paramIndex++}`;
        values.push(filters.offset);
      }

      const result = await this.db.query(query, values);
      return result.rows.map(row => this.mapDatabaseRow(row));

    } catch (error) {
      this.logger.error('Failed to list migration mappings', error);
      throw new DatabaseError(
        `Failed to list migration mappings: ${(error as Error).message}`,
        'MIGRATION_MAPPING_LIST_ERROR',
        { filters }
      );
    }
  }

  /**
   * Get all mappings for an entity type
   */
  async getByEntityType(entityType: string, migrationId?: string): Promise<MigrationMapping[]> {
    return this.list({
      entity_type: entityType,
      migration_id: migrationId,
      is_active: true
    });
  }

  /**
   * Get all mappings for a source table
   */
  async getBySourceTable(sourceTable: string, migrationId?: string): Promise<MigrationMapping[]> {
    return this.list({
      source_table: sourceTable,
      migration_id: migrationId,
      is_active: true
    });
  }

  /**
   * Batch lookup of destination IDs from source IDs
   */
  async lookupDestinationIds(
    sourceTable: string,
    sourceIds: string[],
    migrationId?: string
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();

    if (sourceIds.length === 0) {
      return result;
    }

    try {
      // Build IN clause with parameterized values
      const placeholders = sourceIds.map((_, index) => `$${index + 2}`).join(', ');

      let query = `
        SELECT source_id, destination_id
        FROM ${this.tableName}
        WHERE source_table = $1 AND source_id IN (${placeholders})
          AND is_active = true
      `;

      const values = [sourceTable, ...sourceIds];

      if (migrationId) {
        query += ` AND migration_id = $${values.length + 1}`;
        values.push(migrationId);
      }

      const queryResult = await this.db.query(query, values);

      queryResult.rows.forEach(row => {
        result.set(row.source_id, row.destination_id);
      });

      this.logger.debug('Batch destination ID lookup completed', {
        source_table: sourceTable,
        source_ids_count: sourceIds.length,
        found_mappings: result.size
      });

      return result;

    } catch (error) {
      this.logger.error('Failed to lookup destination IDs', error);
      throw new DatabaseError(
        `Failed to lookup destination IDs: ${(error as Error).message}`,
        'MIGRATION_MAPPING_LOOKUP_ERROR',
        { source_table: sourceTable, source_ids_count: sourceIds.length }
      );
    }
  }

  /**
   * Batch lookup of source IDs from destination IDs
   */
  async lookupSourceIds(
    destinationTable: string,
    destinationIds: string[],
    migrationId?: string
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();

    if (destinationIds.length === 0) {
      return result;
    }

    try {
      // Build IN clause with parameterized values
      const placeholders = destinationIds.map((_, index) => `$${index + 2}`).join(', ');

      let query = `
        SELECT destination_id, source_id
        FROM ${this.tableName}
        WHERE destination_table = $1 AND destination_id IN (${placeholders})
          AND is_active = true
      `;

      const values = [destinationTable, ...destinationIds];

      if (migrationId) {
        query += ` AND migration_id = $${values.length + 1}`;
        values.push(migrationId);
      }

      const queryResult = await this.db.query(query, values);

      queryResult.rows.forEach(row => {
        result.set(row.destination_id, row.source_id);
      });

      this.logger.debug('Batch source ID lookup completed', {
        destination_table: destinationTable,
        destination_ids_count: destinationIds.length,
        found_mappings: result.size
      });

      return result;

    } catch (error) {
      this.logger.error('Failed to lookup source IDs', error);
      throw new DatabaseError(
        `Failed to lookup source IDs: ${(error as Error).message}`,
        'MIGRATION_MAPPING_REVERSE_LOOKUP_ERROR',
        { destination_table: destinationTable, destination_ids_count: destinationIds.length }
      );
    }
  }

  /**
   * Deactivate mapping (soft delete)
   */
  async deactivate(id: string): Promise<boolean> {
    try {
      this.logger.info('Deactivating migration mapping', { mapping_id: id });

      const query = `UPDATE ${this.tableName} SET is_active = false WHERE id = $1`;
      const result = await this.db.query(query, [id]);

      const deactivated = result.rowCount > 0;

      if (deactivated) {
        this.logger.info('Migration mapping deactivated successfully', { mapping_id: id });
      } else {
        this.logger.warn('Migration mapping not found for deactivation', { mapping_id: id });
      }

      return deactivated;

    } catch (error) {
      this.logger.error('Failed to deactivate migration mapping', error);
      throw new DatabaseError(
        `Failed to deactivate migration mapping: ${(error as Error).message}`,
        'MIGRATION_MAPPING_DEACTIVATE_ERROR',
        { mapping_id: id }
      );
    }
  }

  /**
   * Hard delete migration mapping
   */
  async delete(id: string): Promise<boolean> {
    try {
      this.logger.info('Deleting migration mapping', { mapping_id: id });

      const query = `DELETE FROM ${this.tableName} WHERE id = $1`;
      const result = await this.db.query(query, [id]);

      const deleted = result.rowCount > 0;

      if (deleted) {
        this.logger.info('Migration mapping deleted successfully', { mapping_id: id });
      } else {
        this.logger.warn('Migration mapping not found for deletion', { mapping_id: id });
      }

      return deleted;

    } catch (error) {
      this.logger.error('Failed to delete migration mapping', error);
      throw new DatabaseError(
        `Failed to delete migration mapping: ${(error as Error).message}`,
        'MIGRATION_MAPPING_DELETE_ERROR',
        { mapping_id: id }
      );
    }
  }

  /**
   * Get mapping statistics
   */
  async getStatistics(migrationId?: string): Promise<MappingStatistics> {
    try {
      // Get overall statistics
      let query = `
        SELECT
          COUNT(*) as total_mappings,
          COUNT(CASE WHEN is_active = true THEN 1 END) as active_mappings,
          COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as recent_mappings
        FROM ${this.tableName}
      `;

      const values: any[] = [];
      if (migrationId) {
        query += ` WHERE migration_id = $1`;
        values.push(migrationId);
      }

      const result = await this.db.query(query, values);
      const row = result.rows[0];

      // Get statistics by entity type
      let entityTypeQuery = `
        SELECT entity_type, COUNT(*) as count
        FROM ${this.tableName}
        WHERE is_active = true
      `;

      if (migrationId) {
        entityTypeQuery += ` AND migration_id = $1`;
      }

      entityTypeQuery += ` GROUP BY entity_type ORDER BY count DESC`;

      const entityTypeResult = await this.db.query(entityTypeQuery, values);

      const byEntityType: Record<string, number> = {};
      entityTypeResult.rows.forEach(entityRow => {
        byEntityType[entityRow.entity_type] = parseInt(entityRow.count);
      });

      // Get statistics by source table
      let sourceTableQuery = `
        SELECT source_table, COUNT(*) as count
        FROM ${this.tableName}
        WHERE is_active = true
      `;

      if (migrationId) {
        sourceTableQuery += ` AND migration_id = $1`;
      }

      sourceTableQuery += ` GROUP BY source_table ORDER BY count DESC LIMIT 10`;

      const sourceTableResult = await this.db.query(sourceTableQuery, values);

      const bySourceTable: Record<string, number> = {};
      sourceTableResult.rows.forEach(sourceRow => {
        bySourceTable[sourceRow.source_table] = parseInt(sourceRow.count);
      });

      // Get statistics by destination table
      let destTableQuery = `
        SELECT destination_table, COUNT(*) as count
        FROM ${this.tableName}
        WHERE is_active = true
      `;

      if (migrationId) {
        destTableQuery += ` AND migration_id = $1`;
      }

      destTableQuery += ` GROUP BY destination_table ORDER BY count DESC LIMIT 10`;

      const destTableResult = await this.db.query(destTableQuery, values);

      const byDestinationTable: Record<string, number> = {};
      destTableResult.rows.forEach(destRow => {
        byDestinationTable[destRow.destination_table] = parseInt(destRow.count);
      });

      // Find largest entity mapping count
      const largestCount = Math.max(...Object.values(byEntityType), 0);

      return {
        total_mappings: parseInt(row.total_mappings) || 0,
        by_entity_type: byEntityType,
        by_source_table: bySourceTable,
        by_destination_table: byDestinationTable,
        active_mappings: parseInt(row.active_mappings) || 0,
        recent_mappings: parseInt(row.recent_mappings) || 0,
        largest_entity_mapping_count: largestCount
      };

    } catch (error) {
      this.logger.error('Failed to get mapping statistics', error);
      throw new DatabaseError(
        `Failed to get mapping statistics: ${(error as Error).message}`,
        'MIGRATION_MAPPING_STATS_ERROR',
        { migration_id: migrationId }
      );
    }
  }

  /**
   * Validate referential integrity of mappings
   */
  async validateMappingIntegrity(migrationId: string): Promise<{
    valid: boolean;
    issues: Array<{
      issue_type: 'orphaned_mapping' | 'duplicate_destination' | 'invalid_uuid';
      mapping_id: string;
      description: string;
      auto_fixable: boolean;
    }>;
  }> {
    const issues: Array<{
      issue_type: 'orphaned_mapping' | 'duplicate_destination' | 'invalid_uuid';
      mapping_id: string;
      description: string;
      auto_fixable: boolean;
    }> = [];

    try {
      // Check for duplicate destination IDs
      const duplicateQuery = `
        SELECT destination_table, destination_id, array_agg(id) as mapping_ids
        FROM ${this.tableName}
        WHERE migration_id = $1 AND is_active = true
        GROUP BY destination_table, destination_id
        HAVING COUNT(*) > 1
      `;

      const duplicateResult = await this.db.query(duplicateQuery, [migrationId]);

      duplicateResult.rows.forEach(row => {
        const mappingIds = row.mapping_ids.slice(1); // Keep first, mark others as issues
        mappingIds.forEach((mappingId: string) => {
          issues.push({
            issue_type: 'duplicate_destination',
            mapping_id: mappingId,
            description: `Duplicate destination ID ${row.destination_id} in table ${row.destination_table}`,
            auto_fixable: true
          });
        });
      });

      // Check for invalid UUIDs in destination_id
      const invalidUuidQuery = `
        SELECT id, destination_id
        FROM ${this.tableName}
        WHERE migration_id = $1 AND is_active = true
          AND NOT (destination_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
      `;

      const invalidUuidResult = await this.db.query(invalidUuidQuery, [migrationId]);

      invalidUuidResult.rows.forEach(row => {
        issues.push({
          issue_type: 'invalid_uuid',
          mapping_id: row.id,
          description: `Invalid UUID format in destination_id: ${row.destination_id}`,
          auto_fixable: false
        });
      });

      return {
        valid: issues.length === 0,
        issues
      };

    } catch (error) {
      this.logger.error('Failed to validate mapping integrity', error);
      throw new DatabaseError(
        `Failed to validate mapping integrity: ${(error as Error).message}`,
        'MIGRATION_MAPPING_VALIDATION_ERROR',
        { migration_id: migrationId }
      );
    }
  }

  /**
   * Ensure migration mappings table exists
   */
  async ensureTableExists(): Promise<void> {
    try {
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          migration_id UUID NOT NULL,
          source_table VARCHAR(255) NOT NULL,
          source_id VARCHAR(255) NOT NULL,
          destination_table VARCHAR(255) NOT NULL,
          destination_id UUID NOT NULL,
          entity_type VARCHAR(100) NOT NULL,
          mapping_metadata JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          is_active BOOLEAN NOT NULL DEFAULT true,

          CONSTRAINT unique_source_mapping UNIQUE (migration_id, source_table, source_id),
          CONSTRAINT valid_destination_uuid CHECK (destination_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
        )
      `;

      await this.db.query(createTableQuery);

      // Create indexes for performance
      const indexes = [
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_migration_id ON ${this.tableName} (migration_id)`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_source_lookup ON ${this.tableName} (source_table, source_id) WHERE is_active = true`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_destination_lookup ON ${this.tableName} (destination_table, destination_id) WHERE is_active = true`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_entity_type ON ${this.tableName} (entity_type) WHERE is_active = true`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_created_at ON ${this.tableName} (created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_active ON ${this.tableName} (is_active) WHERE is_active = true`
      ];

      for (const indexQuery of indexes) {
        await this.db.query(indexQuery);
      }

      this.logger.info(`Migration mappings table and indexes ensured`);

    } catch (error) {
      this.logger.error('Failed to ensure migration mappings table exists', error);
      throw new DatabaseError(
        `Failed to create migration mappings table: ${(error as Error).message}`,
        'TABLE_CREATION_ERROR'
      );
    }
  }

  /**
   * Validate create data
   */
  private async validateCreateData(data: CreateMigrationMappingData): Promise<void> {
    if (!data.migration_id || !MigrationModelValidation.validateUUID(data.migration_id)) {
      throw new ValidationError('Valid migration ID is required', 'MISSING_MIGRATION_ID');
    }

    if (!data.source_table || !MigrationModelValidation.validateEntityName(data.source_table)) {
      throw new ValidationError('Valid source table name is required', 'INVALID_SOURCE_TABLE');
    }

    if (!data.source_id || data.source_id.trim() === '') {
      throw new ValidationError('Source ID is required', 'MISSING_SOURCE_ID');
    }

    if (!data.destination_table || !MigrationModelValidation.validateEntityName(data.destination_table)) {
      throw new ValidationError('Valid destination table name is required', 'INVALID_DESTINATION_TABLE');
    }

    if (!data.destination_id || !MigrationModelValidation.validateUUID(data.destination_id)) {
      throw new ValidationError('Valid destination UUID is required', 'INVALID_DESTINATION_UUID');
    }

    if (!data.entity_type || !MigrationModelValidation.validateEntityName(data.entity_type)) {
      throw new ValidationError('Valid entity type is required', 'INVALID_ENTITY_TYPE');
    }

    if (data.mapping_metadata && !MigrationModelValidation.validateJSON(data.mapping_metadata)) {
      throw new ValidationError('Mapping metadata must be valid JSON', 'INVALID_METADATA_JSON');
    }
  }

  /**
   * Map database row to domain object
   */
  private mapDatabaseRow(row: any): MigrationMapping {
    return {
      id: row.id,
      migration_id: row.migration_id,
      source_table: row.source_table,
      source_id: row.source_id,
      destination_table: row.destination_table,
      destination_id: row.destination_id,
      entity_type: row.entity_type,
      mapping_metadata: typeof row.mapping_metadata === 'string' ? JSON.parse(row.mapping_metadata) : row.mapping_metadata,
      created_at: new Date(row.created_at),
      is_active: row.is_active
    };
  }
}