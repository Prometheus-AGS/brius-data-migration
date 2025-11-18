/**
 * MigrationOrchestration Model
 *
 * Central control entity managing full migration execution lifecycle.
 * Handles state transitions, progress tracking, and overall orchestration
 * of database migration operations.
 */

import { Pool, PoolClient } from 'pg';
import {
  MigrationOrchestration,
  CreateMigrationOrchestrationData,
  UpdateMigrationOrchestrationData,
  MigrationOrchestrationFilters,
  MigrationType,
  MigrationStatus,
  MigrationModelValidation
} from './migration-models';
import { getLogger, Logger, DatabaseError, ValidationError, generateCorrelationId } from '../lib/error-handler';

export class MigrationOrchestrationModel {
  private db: Pool;
  private logger: Logger;
  private readonly tableName = 'migration_orchestrations';

  constructor(db: Pool) {
    this.db = db;
    this.logger = getLogger();
  }

  /**
   * Create new migration orchestration
   */
  async create(data: CreateMigrationOrchestrationData): Promise<MigrationOrchestration> {
    const correlationId = generateCorrelationId();
    this.logger.setCorrelationId(correlationId);

    try {
      this.logger.info('Creating migration orchestration', {
        migration_type: data.migration_type,
        total_entities: data.total_entities,
        created_by: data.created_by
      });

      // Validate input data
      this.validateCreateData(data);

      const query = `
        INSERT INTO ${this.tableName} (
          id, migration_type, status, started_at, progress_percentage,
          total_entities, completed_entities, error_count, configuration,
          created_by, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), $1, $2, NOW(), $3, $4, $5, $6, $7, $8, NOW(), NOW()
        )
        RETURNING *
      `;

      const values = [
        data.migration_type,
        data.status || MigrationStatus.PENDING,
        data.progress_percentage || 0,
        data.total_entities,
        data.completed_entities || 0,
        data.error_count || 0,
        JSON.stringify(data.configuration),
        data.created_by
      ];

      const result = await this.db.query(query, values);
      const migration = this.mapDatabaseRow(result.rows[0]);

      this.logger.info('Migration orchestration created successfully', {
        migration_id: migration.id,
        migration_type: migration.migration_type,
        correlation_id: correlationId
      });

      return migration;

    } catch (error) {
      this.logger.error('Failed to create migration orchestration', error);
      throw new DatabaseError(
        `Failed to create migration orchestration: ${(error as Error).message}`,
        'MIGRATION_ORCHESTRATION_CREATE_ERROR',
        { data, correlation_id: correlationId }
      );
    } finally {
      this.logger.clearContext();
    }
  }

  /**
   * Update existing migration orchestration
   */
  async update(id: string, data: UpdateMigrationOrchestrationData): Promise<MigrationOrchestration> {
    const correlationId = generateCorrelationId();
    this.logger.setCorrelationId(correlationId);

    try {
      this.logger.info('Updating migration orchestration', {
        migration_id: id,
        update_fields: Object.keys(data)
      });

      // Validate input data
      this.validateUpdateData(data);

      // Get current state for validation
      const current = await this.findById(id);
      if (!current) {
        throw new ValidationError(
          `Migration orchestration with ID ${id} not found`,
          'MIGRATION_NOT_FOUND',
          { migration_id: id }
        );
      }

      // Validate state transitions if status is being updated
      if (data.status && data.status !== current.status) {
        const isValidTransition = MigrationModelValidation.validateMigrationStatusTransition(
          current.status,
          data.status
        );

        if (!isValidTransition) {
          throw new ValidationError(
            `Invalid status transition from ${current.status} to ${data.status}`,
            'INVALID_STATUS_TRANSITION',
            {
              migration_id: id,
              current_status: current.status,
              new_status: data.status
            }
          );
        }
      }

      // Build dynamic update query
      const updateFields: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (data.status !== undefined) {
        updateFields.push(`status = $${paramIndex++}`);
        values.push(data.status);
      }

      if (data.progress_percentage !== undefined) {
        if (!MigrationModelValidation.validateProgressPercentage(data.progress_percentage)) {
          throw new ValidationError(
            'Progress percentage must be between 0 and 100',
            'INVALID_PROGRESS_PERCENTAGE',
            { progress_percentage: data.progress_percentage }
          );
        }
        updateFields.push(`progress_percentage = $${paramIndex++}`);
        values.push(data.progress_percentage);
      }

      if (data.completed_entities !== undefined) {
        if (!MigrationModelValidation.validateEntityCounts(data.completed_entities, current.total_entities)) {
          throw new ValidationError(
            'Completed entities cannot exceed total entities',
            'INVALID_ENTITY_COUNT',
            {
              completed_entities: data.completed_entities,
              total_entities: current.total_entities
            }
          );
        }
        updateFields.push(`completed_entities = $${paramIndex++}`);
        values.push(data.completed_entities);
      }

      if (data.error_count !== undefined) {
        updateFields.push(`error_count = $${paramIndex++}`);
        values.push(data.error_count);
      }

      if (data.completed_at !== undefined) {
        if (!MigrationModelValidation.validateTimestamps(current.started_at, data.completed_at)) {
          throw new ValidationError(
            'Completion time must be after start time',
            'INVALID_TIMESTAMP_SEQUENCE',
            {
              started_at: current.started_at,
              completed_at: data.completed_at
            }
          );
        }
        updateFields.push(`completed_at = $${paramIndex++}`);
        values.push(data.completed_at);
      }

      if (data.configuration !== undefined) {
        if (!MigrationModelValidation.validateJSON(data.configuration)) {
          throw new ValidationError(
            'Configuration must be valid JSON',
            'INVALID_CONFIGURATION_JSON'
          );
        }
        updateFields.push(`configuration = $${paramIndex++}`);
        values.push(JSON.stringify(data.configuration));
      }

      if (updateFields.length === 0) {
        this.logger.warn('No fields to update', { migration_id: id });
        return current;
      }

      // Always update the updated_at timestamp
      updateFields.push(`updated_at = NOW()`);
      values.push(id);

      const query = `
        UPDATE ${this.tableName}
        SET ${updateFields.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *
      `;

      const result = await this.db.query(query, values);

      if (result.rows.length === 0) {
        throw new ValidationError(
          `Migration orchestration with ID ${id} not found`,
          'MIGRATION_NOT_FOUND',
          { migration_id: id }
        );
      }

      const migration = this.mapDatabaseRow(result.rows[0]);

      this.logger.info('Migration orchestration updated successfully', {
        migration_id: migration.id,
        updated_fields: Object.keys(data),
        correlation_id: correlationId
      });

      return migration;

    } catch (error) {
      this.logger.error('Failed to update migration orchestration', error);
      throw new DatabaseError(
        `Failed to update migration orchestration: ${(error as Error).message}`,
        'MIGRATION_ORCHESTRATION_UPDATE_ERROR',
        { migration_id: id, data, correlation_id: correlationId }
      );
    } finally {
      this.logger.clearContext();
    }
  }

  /**
   * Find migration orchestration by ID
   */
  async findById(id: string): Promise<MigrationOrchestration | null> {
    try {
      const query = `SELECT * FROM ${this.tableName} WHERE id = $1`;
      const result = await this.db.query(query, [id]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapDatabaseRow(result.rows[0]);

    } catch (error) {
      this.logger.error('Failed to find migration orchestration by ID', error);
      throw new DatabaseError(
        `Failed to find migration orchestration: ${(error as Error).message}`,
        'MIGRATION_ORCHESTRATION_FIND_ERROR',
        { migration_id: id }
      );
    }
  }

  /**
   * List migration orchestrations with filters
   */
  async list(filters: MigrationOrchestrationFilters = {}): Promise<MigrationOrchestration[]> {
    try {
      const whereClauses: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      // Build WHERE clauses based on filters
      if (filters.migration_type) {
        whereClauses.push(`migration_type = $${paramIndex++}`);
        values.push(filters.migration_type);
      }

      if (filters.status) {
        whereClauses.push(`status = $${paramIndex++}`);
        values.push(filters.status);
      }

      if (filters.created_by) {
        whereClauses.push(`created_by = $${paramIndex++}`);
        values.push(filters.created_by);
      }

      if (filters.created_after) {
        whereClauses.push(`created_at >= $${paramIndex++}`);
        values.push(filters.created_after);
      }

      if (filters.created_before) {
        whereClauses.push(`created_at <= $${paramIndex++}`);
        values.push(filters.created_before);
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
      this.logger.error('Failed to list migration orchestrations', error);
      throw new DatabaseError(
        `Failed to list migration orchestrations: ${(error as Error).message}`,
        'MIGRATION_ORCHESTRATION_LIST_ERROR',
        { filters }
      );
    }
  }

  /**
   * Delete migration orchestration
   */
  async delete(id: string): Promise<boolean> {
    try {
      this.logger.info('Deleting migration orchestration', { migration_id: id });

      const query = `DELETE FROM ${this.tableName} WHERE id = $1`;
      const result = await this.db.query(query, [id]);

      const deleted = result.rowCount > 0;

      if (deleted) {
        this.logger.info('Migration orchestration deleted successfully', { migration_id: id });
      } else {
        this.logger.warn('Migration orchestration not found for deletion', { migration_id: id });
      }

      return deleted;

    } catch (error) {
      this.logger.error('Failed to delete migration orchestration', error);
      throw new DatabaseError(
        `Failed to delete migration orchestration: ${(error as Error).message}`,
        'MIGRATION_ORCHESTRATION_DELETE_ERROR',
        { migration_id: id }
      );
    }
  }

  /**
   * Get migration orchestration statistics
   */
  async getStatistics(): Promise<{
    total_migrations: number;
    by_type: Record<string, number>;
    by_status: Record<string, number>;
    recent_completions: number;
    average_duration_hours: number;
  }> {
    try {
      const query = `
        SELECT
          COUNT(*) as total_migrations,
          COUNT(CASE WHEN migration_type = 'full_migration' THEN 1 END) as full_migrations,
          COUNT(CASE WHEN migration_type = 'incremental' THEN 1 END) as incremental_migrations,
          COUNT(CASE WHEN migration_type = 'schema_cleanup' THEN 1 END) as schema_cleanup_migrations,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
          COUNT(CASE WHEN status = 'running' THEN 1 END) as running_count,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
          COUNT(CASE WHEN status = 'rolling_back' THEN 1 END) as rolling_back_count,
          COUNT(CASE WHEN completed_at > NOW() - INTERVAL '24 hours' THEN 1 END) as recent_completions,
          AVG(EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - started_at)) / 3600) as avg_duration_hours
        FROM ${this.tableName}
      `;

      const result = await this.db.query(query);
      const row = result.rows[0];

      return {
        total_migrations: parseInt(row.total_migrations) || 0,
        by_type: {
          full_migration: parseInt(row.full_migrations) || 0,
          incremental: parseInt(row.incremental_migrations) || 0,
          schema_cleanup: parseInt(row.schema_cleanup_migrations) || 0
        },
        by_status: {
          pending: parseInt(row.pending_count) || 0,
          running: parseInt(row.running_count) || 0,
          completed: parseInt(row.completed_count) || 0,
          failed: parseInt(row.failed_count) || 0,
          rolling_back: parseInt(row.rolling_back_count) || 0
        },
        recent_completions: parseInt(row.recent_completions) || 0,
        average_duration_hours: parseFloat(row.avg_duration_hours) || 0
      };

    } catch (error) {
      this.logger.error('Failed to get migration orchestration statistics', error);
      throw new DatabaseError(
        `Failed to get statistics: ${(error as Error).message}`,
        'MIGRATION_ORCHESTRATION_STATS_ERROR'
      );
    }
  }

  /**
   * Get currently running migrations
   */
  async getRunningMigrations(): Promise<MigrationOrchestration[]> {
    return this.list({ status: MigrationStatus.RUNNING });
  }

  /**
   * Get recent migrations (last 24 hours)
   */
  async getRecentMigrations(hours: number = 24): Promise<MigrationOrchestration[]> {
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.list({ created_after: cutoffTime });
  }

  /**
   * Check if migration can be started
   */
  async canStartMigration(migrationType: MigrationType): Promise<{
    canStart: boolean;
    reason?: string;
    conflictingMigration?: MigrationOrchestration;
  }> {
    try {
      // Check for running migrations of the same type
      const runningMigrations = await this.list({
        migration_type: migrationType,
        status: MigrationStatus.RUNNING
      });

      if (runningMigrations.length > 0) {
        return {
          canStart: false,
          reason: `Another ${migrationType} migration is already running`,
          conflictingMigration: runningMigrations[0]
        };
      }

      // Check for recent failures that might need manual intervention
      const recentFailures = await this.list({
        migration_type: migrationType,
        status: MigrationStatus.FAILED,
        created_after: new Date(Date.now() - 60 * 60 * 1000) // Last hour
      });

      if (recentFailures.length > 0) {
        return {
          canStart: false,
          reason: `Recent ${migrationType} migration failure requires investigation`,
          conflictingMigration: recentFailures[0]
        };
      }

      return { canStart: true };

    } catch (error) {
      this.logger.error('Failed to check if migration can be started', error);
      throw new DatabaseError(
        `Failed to check migration eligibility: ${(error as Error).message}`,
        'MIGRATION_ELIGIBILITY_CHECK_ERROR',
        { migration_type: migrationType }
      );
    }
  }

  /**
   * Ensure migration orchestrations table exists
   */
  async ensureTableExists(): Promise<void> {
    try {
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          migration_type VARCHAR(50) NOT NULL CHECK (migration_type IN ('full_migration', 'incremental', 'schema_cleanup')),
          status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'rolling_back')),
          started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMP WITH TIME ZONE,
          progress_percentage INTEGER NOT NULL DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
          total_entities INTEGER NOT NULL CHECK (total_entities >= 0),
          completed_entities INTEGER NOT NULL DEFAULT 0 CHECK (completed_entities >= 0),
          error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
          configuration JSONB NOT NULL DEFAULT '{}',
          created_by VARCHAR(255) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

          CONSTRAINT valid_entity_counts CHECK (completed_entities <= total_entities),
          CONSTRAINT valid_timestamps CHECK (completed_at IS NULL OR completed_at >= started_at)
        )
      `;

      await this.db.query(createTableQuery);

      // Create indexes for performance
      const indexes = [
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_status ON ${this.tableName} (status)`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_type ON ${this.tableName} (migration_type)`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_created_at ON ${this.tableName} (created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_created_by ON ${this.tableName} (created_by)`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_running ON ${this.tableName} (migration_type, status) WHERE status = 'running'`
      ];

      for (const indexQuery of indexes) {
        await this.db.query(indexQuery);
      }

      this.logger.info(`Migration orchestrations table and indexes ensured`);

    } catch (error) {
      this.logger.error('Failed to ensure migration orchestrations table exists', error);
      throw new DatabaseError(
        `Failed to create migration orchestrations table: ${(error as Error).message}`,
        'TABLE_CREATION_ERROR'
      );
    }
  }

  /**
   * Validate create data
   */
  private validateCreateData(data: CreateMigrationOrchestrationData): void {
    if (!data.migration_type) {
      throw new ValidationError('Migration type is required', 'MISSING_MIGRATION_TYPE');
    }

    if (!Object.values(MigrationType).includes(data.migration_type)) {
      throw new ValidationError(
        `Invalid migration type: ${data.migration_type}`,
        'INVALID_MIGRATION_TYPE',
        { migration_type: data.migration_type }
      );
    }

    if (data.total_entities < 0) {
      throw new ValidationError('Total entities must be non-negative', 'INVALID_TOTAL_ENTITIES');
    }

    if (!data.created_by || data.created_by.trim() === '') {
      throw new ValidationError('Created by is required', 'MISSING_CREATED_BY');
    }

    if (!MigrationModelValidation.validateJSON(data.configuration)) {
      throw new ValidationError('Configuration must be valid JSON', 'INVALID_CONFIGURATION_JSON');
    }

    if (data.progress_percentage !== undefined && !MigrationModelValidation.validateProgressPercentage(data.progress_percentage)) {
      throw new ValidationError('Progress percentage must be between 0 and 100', 'INVALID_PROGRESS_PERCENTAGE');
    }

    if (data.completed_entities !== undefined && !MigrationModelValidation.validateEntityCounts(data.completed_entities, data.total_entities)) {
      throw new ValidationError('Completed entities cannot exceed total entities', 'INVALID_ENTITY_COUNT');
    }
  }

  /**
   * Validate update data
   */
  private validateUpdateData(data: UpdateMigrationOrchestrationData): void {
    if (data.status && !Object.values(MigrationStatus).includes(data.status)) {
      throw new ValidationError(
        `Invalid migration status: ${data.status}`,
        'INVALID_MIGRATION_STATUS',
        { status: data.status }
      );
    }

    if (data.progress_percentage !== undefined && !MigrationModelValidation.validateProgressPercentage(data.progress_percentage)) {
      throw new ValidationError('Progress percentage must be between 0 and 100', 'INVALID_PROGRESS_PERCENTAGE');
    }

    if (data.configuration !== undefined && !MigrationModelValidation.validateJSON(data.configuration)) {
      throw new ValidationError('Configuration must be valid JSON', 'INVALID_CONFIGURATION_JSON');
    }
  }

  /**
   * Map database row to domain object
   */
  private mapDatabaseRow(row: any): MigrationOrchestration {
    return {
      id: row.id,
      migration_type: row.migration_type,
      status: row.status,
      started_at: new Date(row.started_at),
      completed_at: row.completed_at ? new Date(row.completed_at) : undefined,
      progress_percentage: row.progress_percentage,
      total_entities: row.total_entities,
      completed_entities: row.completed_entities,
      error_count: row.error_count,
      configuration: typeof row.configuration === 'string' ? JSON.parse(row.configuration) : row.configuration,
      created_by: row.created_by,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at)
    };
  }
}