/**
 * MigrationCheckpoint Model
 *
 * Enables resumable migration with granular recovery points.
 * Manages checkpoint creation, restoration, and validation for
 * fault-tolerant migration operations.
 */

import { Pool, PoolClient } from 'pg';
import {
  MigrationCheckpoint,
  CreateMigrationCheckpointData,
  MigrationCheckpointFilters,
  CheckpointType,
  MigrationModelValidation
} from './migration-models';
import { getLogger, Logger, DatabaseError, ValidationError, generateCorrelationId } from '../lib/error-handler';

export interface CheckpointStatistics {
  total_checkpoints: number;
  by_type: Record<string, number>;
  by_entity: Record<string, number>;
  recent_checkpoints: number;
  resumable_checkpoints: number;
  average_records_per_checkpoint: number;
  disk_usage_estimate_mb: number;
}

export class MigrationCheckpointModel {
  private db: Pool;
  private logger: Logger;
  private readonly tableName = 'migration_checkpoints';

  constructor(db: Pool) {
    this.db = db;
    this.logger = getLogger();
  }

  /**
   * Create new migration checkpoint
   */
  async create(data: CreateMigrationCheckpointData): Promise<MigrationCheckpoint> {
    const correlationId = generateCorrelationId();
    this.logger.setCorrelationId(correlationId);

    try {
      this.logger.info('Creating migration checkpoint', {
        migration_id: data.migration_id,
        entity_name: data.entity_name,
        checkpoint_type: data.checkpoint_type,
        batch_number: data.batch_number,
        records_processed: data.records_processed
      });

      // Validate input data
      await this.validateCreateData(data);

      const query = `
        INSERT INTO ${this.tableName} (
          id, migration_id, entity_name, checkpoint_type, batch_number,
          last_source_id, records_processed, system_state, created_at, is_resumable
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), $8
        )
        RETURNING *
      `;

      const values = [
        data.migration_id,
        data.entity_name,
        data.checkpoint_type,
        data.batch_number,
        data.last_source_id,
        data.records_processed,
        JSON.stringify(data.system_state),
        data.is_resumable !== false // Default to true
      ];

      const result = await this.db.query(query, values);
      const checkpoint = this.mapDatabaseRow(result.rows[0]);

      this.logger.info('Migration checkpoint created successfully', {
        checkpoint_id: checkpoint.id,
        entity_name: checkpoint.entity_name,
        migration_id: checkpoint.migration_id,
        batch_number: checkpoint.batch_number,
        correlation_id: correlationId
      });

      return checkpoint;

    } catch (error) {
      this.logger.error('Failed to create migration checkpoint', error);
      throw new DatabaseError(
        `Failed to create migration checkpoint: ${(error as Error).message}`,
        'MIGRATION_CHECKPOINT_CREATE_ERROR',
        { data, correlation_id: correlationId }
      );
    } finally {
      this.logger.clearContext();
    }
  }

  /**
   * Find migration checkpoint by ID
   */
  async findById(id: string): Promise<MigrationCheckpoint | null> {
    try {
      const query = `SELECT * FROM ${this.tableName} WHERE id = $1`;
      const result = await this.db.query(query, [id]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapDatabaseRow(result.rows[0]);

    } catch (error) {
      this.logger.error('Failed to find migration checkpoint by ID', error);
      throw new DatabaseError(
        `Failed to find migration checkpoint: ${(error as Error).message}`,
        'MIGRATION_CHECKPOINT_FIND_ERROR',
        { checkpoint_id: id }
      );
    }
  }

  /**
   * Find latest checkpoint for migration and entity
   */
  async findLatestCheckpoint(
    migrationId: string,
    entityName: string,
    checkpointType?: CheckpointType
  ): Promise<MigrationCheckpoint | null> {
    try {
      let query = `
        SELECT * FROM ${this.tableName}
        WHERE migration_id = $1 AND entity_name = $2
      `;
      const values: any[] = [migrationId, entityName];

      if (checkpointType) {
        query += ` AND checkpoint_type = $3`;
        values.push(checkpointType);
      }

      query += ` ORDER BY created_at DESC, batch_number DESC LIMIT 1`;

      const result = await this.db.query(query, values);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapDatabaseRow(result.rows[0]);

    } catch (error) {
      this.logger.error('Failed to find latest checkpoint', error);
      throw new DatabaseError(
        `Failed to find latest checkpoint: ${(error as Error).message}`,
        'MIGRATION_CHECKPOINT_FIND_LATEST_ERROR',
        { migration_id: migrationId, entity_name: entityName, checkpoint_type: checkpointType }
      );
    }
  }

  /**
   * Find latest resumable checkpoint for migration and entity
   */
  async findLatestResumableCheckpoint(
    migrationId: string,
    entityName: string
  ): Promise<MigrationCheckpoint | null> {
    try {
      const query = `
        SELECT * FROM ${this.tableName}
        WHERE migration_id = $1 AND entity_name = $2 AND is_resumable = true
        ORDER BY created_at DESC, batch_number DESC
        LIMIT 1
      `;

      const result = await this.db.query(query, [migrationId, entityName]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapDatabaseRow(result.rows[0]);

    } catch (error) {
      this.logger.error('Failed to find latest resumable checkpoint', error);
      throw new DatabaseError(
        `Failed to find latest resumable checkpoint: ${(error as Error).message}`,
        'MIGRATION_CHECKPOINT_FIND_RESUMABLE_ERROR',
        { migration_id: migrationId, entity_name: entityName }
      );
    }
  }

  /**
   * List migration checkpoints with filters
   */
  async list(filters: MigrationCheckpointFilters = {}): Promise<MigrationCheckpoint[]> {
    try {
      const whereClauses: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      // Build WHERE clauses based on filters
      if (filters.migration_id) {
        whereClauses.push(`migration_id = $${paramIndex++}`);
        values.push(filters.migration_id);
      }

      if (filters.entity_name) {
        whereClauses.push(`entity_name = $${paramIndex++}`);
        values.push(filters.entity_name);
      }

      if (filters.checkpoint_type) {
        whereClauses.push(`checkpoint_type = $${paramIndex++}`);
        values.push(filters.checkpoint_type);
      }

      if (filters.is_resumable !== undefined) {
        whereClauses.push(`is_resumable = $${paramIndex++}`);
        values.push(filters.is_resumable);
      }

      // Build complete query
      let query = `SELECT * FROM ${this.tableName}`;

      if (whereClauses.length > 0) {
        query += ` WHERE ${whereClauses.join(' AND ')}`;
      }

      query += ` ORDER BY created_at DESC, batch_number DESC`;

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
      this.logger.error('Failed to list migration checkpoints', error);
      throw new DatabaseError(
        `Failed to list migration checkpoints: ${(error as Error).message}`,
        'MIGRATION_CHECKPOINT_LIST_ERROR',
        { filters }
      );
    }
  }

  /**
   * Get all resumable checkpoints for a migration
   */
  async getResumableCheckpoints(migrationId: string): Promise<MigrationCheckpoint[]> {
    return this.list({ migration_id: migrationId, is_resumable: true });
  }

  /**
   * Get checkpoint statistics
   */
  async getStatistics(migrationId?: string): Promise<CheckpointStatistics> {
    try {
      let query = `
        SELECT
          COUNT(*) as total_checkpoints,
          COUNT(CASE WHEN checkpoint_type = 'batch_completion' THEN 1 END) as batch_completion_count,
          COUNT(CASE WHEN checkpoint_type = 'entity_completion' THEN 1 END) as entity_completion_count,
          COUNT(CASE WHEN checkpoint_type = 'error_recovery' THEN 1 END) as error_recovery_count,
          COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as recent_checkpoints,
          COUNT(CASE WHEN is_resumable = true THEN 1 END) as resumable_checkpoints,
          AVG(records_processed) as avg_records_per_checkpoint,
          SUM(LENGTH(system_state::text)) as total_state_size_bytes
        FROM ${this.tableName}
      `;

      const values: any[] = [];
      if (migrationId) {
        query += ` WHERE migration_id = $1`;
        values.push(migrationId);
      }

      const result = await this.db.query(query, values);
      const row = result.rows[0];

      // Get entity statistics
      let entityQuery = `
        SELECT
          entity_name,
          COUNT(*) as checkpoint_count
        FROM ${this.tableName}
      `;

      if (migrationId) {
        entityQuery += ` WHERE migration_id = $1`;
      }

      entityQuery += ` GROUP BY entity_name ORDER BY checkpoint_count DESC`;

      const entityResult = await this.db.query(entityQuery, values);

      const byEntity: Record<string, number> = {};
      entityResult.rows.forEach(entityRow => {
        byEntity[entityRow.entity_name] = parseInt(entityRow.checkpoint_count);
      });

      return {
        total_checkpoints: parseInt(row.total_checkpoints) || 0,
        by_type: {
          batch_completion: parseInt(row.batch_completion_count) || 0,
          entity_completion: parseInt(row.entity_completion_count) || 0,
          error_recovery: parseInt(row.error_recovery_count) || 0
        },
        by_entity: byEntity,
        recent_checkpoints: parseInt(row.recent_checkpoints) || 0,
        resumable_checkpoints: parseInt(row.resumable_checkpoints) || 0,
        average_records_per_checkpoint: Math.round(parseFloat(row.avg_records_per_checkpoint) || 0),
        disk_usage_estimate_mb: Math.round((parseInt(row.total_state_size_bytes) || 0) / (1024 * 1024))
      };

    } catch (error) {
      this.logger.error('Failed to get checkpoint statistics', error);
      throw new DatabaseError(
        `Failed to get checkpoint statistics: ${(error as Error).message}`,
        'MIGRATION_CHECKPOINT_STATS_ERROR',
        { migration_id: migrationId }
      );
    }
  }

  /**
   * Delete migration checkpoint
   */
  async delete(id: string): Promise<boolean> {
    try {
      this.logger.info('Deleting migration checkpoint', { checkpoint_id: id });

      const query = `DELETE FROM ${this.tableName} WHERE id = $1`;
      const result = await this.db.query(query, [id]);

      const deleted = result.rowCount > 0;

      if (deleted) {
        this.logger.info('Migration checkpoint deleted successfully', { checkpoint_id: id });
      } else {
        this.logger.warn('Migration checkpoint not found for deletion', { checkpoint_id: id });
      }

      return deleted;

    } catch (error) {
      this.logger.error('Failed to delete migration checkpoint', error);
      throw new DatabaseError(
        `Failed to delete migration checkpoint: ${(error as Error).message}`,
        'MIGRATION_CHECKPOINT_DELETE_ERROR',
        { checkpoint_id: id }
      );
    }
  }

  /**
   * Ensure migration checkpoints table exists
   */
  async ensureTableExists(): Promise<void> {
    try {
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          migration_id UUID NOT NULL,
          entity_name VARCHAR(255) NOT NULL,
          checkpoint_type VARCHAR(50) NOT NULL CHECK (checkpoint_type IN ('batch_completion', 'entity_completion', 'error_recovery')),
          batch_number INTEGER NOT NULL CHECK (batch_number >= 0),
          last_source_id VARCHAR(255),
          records_processed INTEGER NOT NULL CHECK (records_processed >= 0),
          system_state JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          is_resumable BOOLEAN NOT NULL DEFAULT true
        )
      `;

      await this.db.query(createTableQuery);

      // Create indexes for performance
      const indexes = [
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_migration_id ON ${this.tableName} (migration_id)`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_entity_name ON ${this.tableName} (entity_name)`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_created_at ON ${this.tableName} (created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_resumable ON ${this.tableName} (migration_id, entity_name, is_resumable) WHERE is_resumable = true`
      ];

      for (const indexQuery of indexes) {
        await this.db.query(indexQuery);
      }

      this.logger.info(`Migration checkpoints table and indexes ensured`);

    } catch (error) {
      this.logger.error('Failed to ensure migration checkpoints table exists', error);
      throw new DatabaseError(
        `Failed to create migration checkpoints table: ${(error as Error).message}`,
        'TABLE_CREATION_ERROR'
      );
    }
  }

  /**
   * Validate create data
   */
  private async validateCreateData(data: CreateMigrationCheckpointData): Promise<void> {
    if (!data.migration_id || !MigrationModelValidation.validateUUID(data.migration_id)) {
      throw new ValidationError('Valid migration ID is required', 'MISSING_MIGRATION_ID');
    }

    if (!data.entity_name || !MigrationModelValidation.validateEntityName(data.entity_name)) {
      throw new ValidationError('Valid entity name is required', 'INVALID_ENTITY_NAME');
    }

    if (!Object.values(CheckpointType).includes(data.checkpoint_type)) {
      throw new ValidationError(
        `Invalid checkpoint type: ${data.checkpoint_type}`,
        'INVALID_CHECKPOINT_TYPE',
        { checkpoint_type: data.checkpoint_type }
      );
    }

    if (data.batch_number < 0) {
      throw new ValidationError('Batch number must be non-negative', 'INVALID_BATCH_NUMBER');
    }

    if (data.records_processed < 0) {
      throw new ValidationError('Records processed must be non-negative', 'INVALID_RECORDS_PROCESSED');
    }

    if (!MigrationModelValidation.validateJSON(data.system_state)) {
      throw new ValidationError('System state must be valid JSON', 'INVALID_SYSTEM_STATE_JSON');
    }
  }

  /**
   * Map database row to domain object
   */
  private mapDatabaseRow(row: any): MigrationCheckpoint {
    return {
      id: row.id,
      migration_id: row.migration_id,
      entity_name: row.entity_name,
      checkpoint_type: row.checkpoint_type,
      batch_number: row.batch_number,
      last_source_id: row.last_source_id,
      records_processed: row.records_processed,
      system_state: typeof row.system_state === 'string' ? JSON.parse(row.system_state) : row.system_state,
      created_at: new Date(row.created_at),
      is_resumable: row.is_resumable
    };
  }
}