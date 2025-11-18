/**
 * EntityMigrationStatus Model
 *
 * Tracks migration progress for individual entities (tables/collections).
 * Manages dependency ordering, progress tracking, and performance metrics
 * for each entity within a migration orchestration.
 */

import { Pool, PoolClient } from 'pg';
import {
  EntityMigrationStatus,
  CreateEntityMigrationStatusData,
  UpdateEntityMigrationStatusData,
  EntityMigrationStatusFilters,
  EntityStatus,
  MigrationModelValidation
} from './migration-models';
import { getLogger, Logger, DatabaseError, ValidationError, generateCorrelationId } from '../lib/error-handler';

export class EntityMigrationStatusModel {
  private db: Pool;
  private logger: Logger;
  private readonly tableName = 'entity_migration_statuses';

  constructor(db: Pool) {
    this.db = db;
    this.logger = getLogger();
  }

  /**
   * Create new entity migration status
   */
  async create(data: CreateEntityMigrationStatusData): Promise<EntityMigrationStatus> {
    const correlationId = generateCorrelationId();
    this.logger.setCorrelationId(correlationId);

    try {
      this.logger.info('Creating entity migration status', {
        migration_id: data.migration_id,
        entity_name: data.entity_name,
        target_entity: data.target_entity,
        dependency_order: data.dependency_order
      });

      // Validate input data
      await this.validateCreateData(data);

      const query = `
        INSERT INTO ${this.tableName} (
          id, migration_id, entity_name, target_entity, dependency_order,
          status, records_total, records_processed, records_failed,
          started_at, batch_size, throughput_per_second, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10, NOW(), NOW()
        )
        RETURNING *
      `;

      const values = [
        data.migration_id,
        data.entity_name,
        data.target_entity,
        data.dependency_order,
        data.status || EntityStatus.PENDING,
        data.records_total,
        data.records_processed || 0,
        data.records_failed || 0,
        data.batch_size,
        data.throughput_per_second || 0
      ];

      const result = await this.db.query(query, values);
      const entityStatus = this.mapDatabaseRow(result.rows[0]);

      this.logger.info('Entity migration status created successfully', {
        entity_status_id: entityStatus.id,
        entity_name: entityStatus.entity_name,
        migration_id: entityStatus.migration_id,
        correlation_id: correlationId
      });

      return entityStatus;

    } catch (error) {
      this.logger.error('Failed to create entity migration status', error);
      throw new DatabaseError(
        `Failed to create entity migration status: ${(error as Error).message}`,
        'ENTITY_MIGRATION_STATUS_CREATE_ERROR',
        { data, correlation_id: correlationId }
      );
    } finally {
      this.logger.clearContext();
    }
  }

  /**
   * Update existing entity migration status
   */
  async update(id: string, data: UpdateEntityMigrationStatusData): Promise<EntityMigrationStatus> {
    const correlationId = generateCorrelationId();
    this.logger.setCorrelationId(correlationId);

    try {
      this.logger.info('Updating entity migration status', {
        entity_status_id: id,
        update_fields: Object.keys(data)
      });

      // Validate input data
      this.validateUpdateData(data);

      // Get current state for validation
      const current = await this.findById(id);
      if (!current) {
        throw new ValidationError(
          `Entity migration status with ID ${id} not found`,
          'ENTITY_STATUS_NOT_FOUND',
          { entity_status_id: id }
        );
      }

      // Validate record counts
      if (data.records_processed !== undefined || data.records_failed !== undefined) {
        const newProcessed = data.records_processed ?? current.records_processed;
        const newFailed = data.records_failed ?? current.records_failed;

        if (!MigrationModelValidation.validateEntityRecords(newProcessed, newFailed, current.records_total)) {
          throw new ValidationError(
            'Processed + failed records cannot exceed total records',
            'INVALID_RECORD_COUNTS',
            {
              records_processed: newProcessed,
              records_failed: newFailed,
              records_total: current.records_total
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

      if (data.records_processed !== undefined) {
        updateFields.push(`records_processed = $${paramIndex++}`);
        values.push(data.records_processed);
      }

      if (data.records_failed !== undefined) {
        updateFields.push(`records_failed = $${paramIndex++}`);
        values.push(data.records_failed);
      }

      if (data.completed_at !== undefined) {
        if (data.completed_at && !MigrationModelValidation.validateTimestamps(current.started_at, data.completed_at)) {
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

      if (data.last_processed_id !== undefined) {
        updateFields.push(`last_processed_id = $${paramIndex++}`);
        values.push(data.last_processed_id);
      }

      if (data.throughput_per_second !== undefined) {
        updateFields.push(`throughput_per_second = $${paramIndex++}`);
        values.push(data.throughput_per_second);
      }

      if (updateFields.length === 0) {
        this.logger.warn('No fields to update', { entity_status_id: id });
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
          `Entity migration status with ID ${id} not found`,
          'ENTITY_STATUS_NOT_FOUND',
          { entity_status_id: id }
        );
      }

      const entityStatus = this.mapDatabaseRow(result.rows[0]);

      this.logger.info('Entity migration status updated successfully', {
        entity_status_id: entityStatus.id,
        entity_name: entityStatus.entity_name,
        updated_fields: Object.keys(data),
        correlation_id: correlationId
      });

      return entityStatus;

    } catch (error) {
      this.logger.error('Failed to update entity migration status', error);
      throw new DatabaseError(
        `Failed to update entity migration status: ${(error as Error).message}`,
        'ENTITY_MIGRATION_STATUS_UPDATE_ERROR',
        { entity_status_id: id, data, correlation_id: correlationId }
      );
    } finally {
      this.logger.clearContext();
    }
  }

  /**
   * Find entity migration status by ID
   */
  async findById(id: string): Promise<EntityMigrationStatus | null> {
    try {
      const query = `SELECT * FROM ${this.tableName} WHERE id = $1`;
      const result = await this.db.query(query, [id]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapDatabaseRow(result.rows[0]);

    } catch (error) {
      this.logger.error('Failed to find entity migration status by ID', error);
      throw new DatabaseError(
        `Failed to find entity migration status: ${(error as Error).message}`,
        'ENTITY_MIGRATION_STATUS_FIND_ERROR',
        { entity_status_id: id }
      );
    }
  }

  /**
   * Find entity migration status by migration ID and entity name
   */
  async findByMigrationAndEntity(migrationId: string, entityName: string): Promise<EntityMigrationStatus | null> {
    try {
      const query = `SELECT * FROM ${this.tableName} WHERE migration_id = $1 AND entity_name = $2`;
      const result = await this.db.query(query, [migrationId, entityName]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapDatabaseRow(result.rows[0]);

    } catch (error) {
      this.logger.error('Failed to find entity migration status by migration and entity', error);
      throw new DatabaseError(
        `Failed to find entity migration status: ${(error as Error).message}`,
        'ENTITY_MIGRATION_STATUS_FIND_ERROR',
        { migration_id: migrationId, entity_name: entityName }
      );
    }
  }

  /**
   * List entity migration statuses with filters
   */
  async list(filters: EntityMigrationStatusFilters = {}): Promise<EntityMigrationStatus[]> {
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

      if (filters.status) {
        whereClauses.push(`status = $${paramIndex++}`);
        values.push(filters.status);
      }

      if (filters.dependency_order !== undefined) {
        whereClauses.push(`dependency_order = $${paramIndex++}`);
        values.push(filters.dependency_order);
      }

      // Build complete query
      let query = `SELECT * FROM ${this.tableName}`;

      if (whereClauses.length > 0) {
        query += ` WHERE ${whereClauses.join(' AND ')}`;
      }

      query += ` ORDER BY dependency_order ASC, entity_name ASC`;

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
      this.logger.error('Failed to list entity migration statuses', error);
      throw new DatabaseError(
        `Failed to list entity migration statuses: ${(error as Error).message}`,
        'ENTITY_MIGRATION_STATUS_LIST_ERROR',
        { filters }
      );
    }
  }

  /**
   * Get entities by dependency order for a migration
   */
  async getByDependencyOrder(migrationId: string, dependencyOrder: number): Promise<EntityMigrationStatus[]> {
    return this.list({ migration_id: migrationId, dependency_order: dependencyOrder });
  }

  /**
   * Get next entities to process based on dependency order
   */
  async getNextEntities(migrationId: string): Promise<EntityMigrationStatus[]> {
    try {
      const query = `
        SELECT * FROM ${this.tableName}
        WHERE migration_id = $1
          AND status = 'pending'
          AND dependency_order = (
            SELECT MIN(dependency_order)
            FROM ${this.tableName}
            WHERE migration_id = $1 AND status = 'pending'
          )
        ORDER BY entity_name ASC
      `;

      const result = await this.db.query(query, [migrationId]);
      return result.rows.map(row => this.mapDatabaseRow(row));

    } catch (error) {
      this.logger.error('Failed to get next entities to process', error);
      throw new DatabaseError(
        `Failed to get next entities: ${(error as Error).message}`,
        'ENTITY_MIGRATION_STATUS_NEXT_ERROR',
        { migration_id: migrationId }
      );
    }
  }

  /**
   * Get entities currently being processed
   */
  async getRunningEntities(migrationId: string): Promise<EntityMigrationStatus[]> {
    return this.list({ migration_id: migrationId, status: EntityStatus.RUNNING });
  }

  /**
   * Get completed entities for a migration
   */
  async getCompletedEntities(migrationId: string): Promise<EntityMigrationStatus[]> {
    return this.list({ migration_id: migrationId, status: EntityStatus.COMPLETED });
  }

  /**
   * Get failed entities for a migration
   */
  async getFailedEntities(migrationId: string): Promise<EntityMigrationStatus[]> {
    return this.list({ migration_id: migrationId, status: EntityStatus.FAILED });
  }

  /**
   * Delete entity migration status
   */
  async delete(id: string): Promise<boolean> {
    try {
      this.logger.info('Deleting entity migration status', { entity_status_id: id });

      const query = `DELETE FROM ${this.tableName} WHERE id = $1`;
      const result = await this.db.query(query, [id]);

      const deleted = result.rowCount > 0;

      if (deleted) {
        this.logger.info('Entity migration status deleted successfully', { entity_status_id: id });
      } else {
        this.logger.warn('Entity migration status not found for deletion', { entity_status_id: id });
      }

      return deleted;

    } catch (error) {
      this.logger.error('Failed to delete entity migration status', error);
      throw new DatabaseError(
        `Failed to delete entity migration status: ${(error as Error).message}`,
        'ENTITY_MIGRATION_STATUS_DELETE_ERROR',
        { entity_status_id: id }
      );
    }
  }

  /**
   * Get migration progress summary
   */
  async getMigrationProgressSummary(migrationId: string): Promise<{
    total_entities: number;
    pending_entities: number;
    running_entities: number;
    completed_entities: number;
    failed_entities: number;
    skipped_entities: number;
    total_records: number;
    processed_records: number;
    failed_records: number;
    overall_progress_percentage: number;
    average_throughput: number;
    estimated_completion_time?: Date;
  }> {
    try {
      const query = `
        SELECT
          COUNT(*) as total_entities,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_entities,
          COUNT(CASE WHEN status = 'running' THEN 1 END) as running_entities,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_entities,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_entities,
          COUNT(CASE WHEN status = 'skipped' THEN 1 END) as skipped_entities,
          SUM(records_total) as total_records,
          SUM(records_processed) as processed_records,
          SUM(records_failed) as failed_records,
          AVG(throughput_per_second) as average_throughput
        FROM ${this.tableName}
        WHERE migration_id = $1
      `;

      const result = await this.db.query(query, [migrationId]);
      const row = result.rows[0];

      const totalRecords = parseInt(row.total_records) || 0;
      const processedRecords = parseInt(row.processed_records) || 0;
      const overallProgressPercentage = totalRecords > 0 ? Math.round((processedRecords / totalRecords) * 100) : 0;

      // Calculate estimated completion time
      let estimatedCompletionTime: Date | undefined;
      const averageThroughput = parseFloat(row.average_throughput) || 0;
      const remainingRecords = totalRecords - processedRecords;

      if (averageThroughput > 0 && remainingRecords > 0) {
        const secondsRemaining = remainingRecords / averageThroughput;
        estimatedCompletionTime = new Date(Date.now() + secondsRemaining * 1000);
      }

      return {
        total_entities: parseInt(row.total_entities) || 0,
        pending_entities: parseInt(row.pending_entities) || 0,
        running_entities: parseInt(row.running_entities) || 0,
        completed_entities: parseInt(row.completed_entities) || 0,
        failed_entities: parseInt(row.failed_entities) || 0,
        skipped_entities: parseInt(row.skipped_entities) || 0,
        total_records: totalRecords,
        processed_records: processedRecords,
        failed_records: parseInt(row.failed_records) || 0,
        overall_progress_percentage: overallProgressPercentage,
        average_throughput: averageThroughput,
        estimated_completion_time: estimatedCompletionTime
      };

    } catch (error) {
      this.logger.error('Failed to get migration progress summary', error);
      throw new DatabaseError(
        `Failed to get migration progress summary: ${(error as Error).message}`,
        'MIGRATION_PROGRESS_SUMMARY_ERROR',
        { migration_id: migrationId }
      );
    }
  }

  /**
   * Check dependency readiness for entities
   */
  async checkDependencyReadiness(migrationId: string): Promise<{
    ready_entities: EntityMigrationStatus[];
    blocked_entities: Array<{
      entity: EntityMigrationStatus;
      blocking_dependencies: string[];
    }>;
  }> {
    try {
      const allEntities = await this.list({ migration_id: migrationId });
      const readyEntities: EntityMigrationStatus[] = [];
      const blockedEntities: Array<{
        entity: EntityMigrationStatus;
        blocking_dependencies: string[];
      }> = [];

      // Group entities by dependency order
      const entitiesByOrder = new Map<number, EntityMigrationStatus[]>();
      allEntities.forEach(entity => {
        if (!entitiesByOrder.has(entity.dependency_order)) {
          entitiesByOrder.set(entity.dependency_order, []);
        }
        entitiesByOrder.get(entity.dependency_order)!.push(entity);
      });

      // Find the lowest dependency order with pending entities
      const sortedOrders = Array.from(entitiesByOrder.keys()).sort((a, b) => a - b);

      for (const order of sortedOrders) {
        const entitiesAtOrder = entitiesByOrder.get(order)!;
        const pendingEntities = entitiesAtOrder.filter(e => e.status === EntityStatus.PENDING);

        if (pendingEntities.length > 0) {
          // Check if all previous orders are completed
          const previousOrdersCompleted = sortedOrders
            .filter(o => o < order)
            .every(prevOrder => {
              const prevEntities = entitiesByOrder.get(prevOrder)!;
              return prevEntities.every(e => e.status === EntityStatus.COMPLETED || e.status === EntityStatus.SKIPPED);
            });

          if (previousOrdersCompleted) {
            readyEntities.push(...pendingEntities);
          } else {
            // Find which dependencies are blocking
            const blockingDependencies = sortedOrders
              .filter(o => o < order)
              .flatMap(prevOrder => {
                const prevEntities = entitiesByOrder.get(prevOrder)!;
                return prevEntities
                  .filter(e => e.status !== EntityStatus.COMPLETED && e.status !== EntityStatus.SKIPPED)
                  .map(e => e.entity_name);
              });

            pendingEntities.forEach(entity => {
              blockedEntities.push({
                entity,
                blocking_dependencies: blockingDependencies
              });
            });
          }
          break; // Only process the first order with pending entities
        }
      }

      return {
        ready_entities: readyEntities,
        blocked_entities: blockedEntities
      };

    } catch (error) {
      this.logger.error('Failed to check dependency readiness', error);
      throw new DatabaseError(
        `Failed to check dependency readiness: ${(error as Error).message}`,
        'DEPENDENCY_READINESS_CHECK_ERROR',
        { migration_id: migrationId }
      );
    }
  }

  /**
   * Ensure entity migration statuses table exists
   */
  async ensureTableExists(): Promise<void> {
    try {
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          migration_id UUID NOT NULL,
          entity_name VARCHAR(255) NOT NULL,
          target_entity VARCHAR(255) NOT NULL,
          dependency_order INTEGER NOT NULL CHECK (dependency_order >= 0),
          status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
          records_total INTEGER NOT NULL CHECK (records_total >= 0),
          records_processed INTEGER NOT NULL DEFAULT 0 CHECK (records_processed >= 0),
          records_failed INTEGER NOT NULL DEFAULT 0 CHECK (records_failed >= 0),
          started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMP WITH TIME ZONE,
          last_processed_id VARCHAR(255),
          batch_size INTEGER NOT NULL CHECK (batch_size > 0),
          throughput_per_second NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (throughput_per_second >= 0),
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

          CONSTRAINT valid_record_counts CHECK (records_processed + records_failed <= records_total),
          CONSTRAINT valid_timestamps CHECK (completed_at IS NULL OR completed_at >= started_at),
          CONSTRAINT unique_entity_per_migration UNIQUE (migration_id, entity_name)
        )
      `;

      await this.db.query(createTableQuery);

      // Create indexes for performance
      const indexes = [
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_migration_id ON ${this.tableName} (migration_id)`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_status ON ${this.tableName} (status)`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_dependency_order ON ${this.tableName} (migration_id, dependency_order)`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_entity_name ON ${this.tableName} (entity_name)`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_pending ON ${this.tableName} (migration_id, dependency_order) WHERE status = 'pending'`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_running ON ${this.tableName} (migration_id) WHERE status = 'running'`
      ];

      for (const indexQuery of indexes) {
        await this.db.query(indexQuery);
      }

      this.logger.info(`Entity migration statuses table and indexes ensured`);

    } catch (error) {
      this.logger.error('Failed to ensure entity migration statuses table exists', error);
      throw new DatabaseError(
        `Failed to create entity migration statuses table: ${(error as Error).message}`,
        'TABLE_CREATION_ERROR'
      );
    }
  }

  /**
   * Validate create data
   */
  private async validateCreateData(data: CreateEntityMigrationStatusData): Promise<void> {
    if (!data.migration_id || !MigrationModelValidation.validateUUID(data.migration_id)) {
      throw new ValidationError('Valid migration ID is required', 'MISSING_MIGRATION_ID');
    }

    if (!data.entity_name || !MigrationModelValidation.validateEntityName(data.entity_name)) {
      throw new ValidationError('Valid entity name is required', 'INVALID_ENTITY_NAME');
    }

    if (!data.target_entity || !MigrationModelValidation.validateEntityName(data.target_entity)) {
      throw new ValidationError('Valid target entity name is required', 'INVALID_TARGET_ENTITY');
    }

    if (data.dependency_order < 0) {
      throw new ValidationError('Dependency order must be non-negative', 'INVALID_DEPENDENCY_ORDER');
    }

    if (data.records_total < 0) {
      throw new ValidationError('Records total must be non-negative', 'INVALID_RECORDS_TOTAL');
    }

    if (data.batch_size <= 0) {
      throw new ValidationError('Batch size must be positive', 'INVALID_BATCH_SIZE');
    }

    // Check for unique dependency order within migration
    const existingEntities = await this.list({ migration_id: data.migration_id });
    const isUniqueOrder = MigrationModelValidation.validateDependencyOrder(
      existingEntities,
      data.migration_id,
      data.dependency_order
    );

    if (!isUniqueOrder) {
      throw new ValidationError(
        `Dependency order ${data.dependency_order} already exists for migration ${data.migration_id}`,
        'DUPLICATE_DEPENDENCY_ORDER',
        {
          migration_id: data.migration_id,
          dependency_order: data.dependency_order
        }
      );
    }

    // Validate record counts
    const recordsProcessed = data.records_processed || 0;
    const recordsFailed = data.records_failed || 0;

    if (!MigrationModelValidation.validateEntityRecords(recordsProcessed, recordsFailed, data.records_total)) {
      throw new ValidationError(
        'Processed + failed records cannot exceed total records',
        'INVALID_RECORD_COUNTS',
        {
          records_processed: recordsProcessed,
          records_failed: recordsFailed,
          records_total: data.records_total
        }
      );
    }
  }

  /**
   * Validate update data
   */
  private validateUpdateData(data: UpdateEntityMigrationStatusData): void {
    if (data.status && !Object.values(EntityStatus).includes(data.status)) {
      throw new ValidationError(
        `Invalid entity status: ${data.status}`,
        'INVALID_ENTITY_STATUS',
        { status: data.status }
      );
    }

    if (data.records_processed !== undefined && data.records_processed < 0) {
      throw new ValidationError('Records processed must be non-negative', 'INVALID_RECORDS_PROCESSED');
    }

    if (data.records_failed !== undefined && data.records_failed < 0) {
      throw new ValidationError('Records failed must be non-negative', 'INVALID_RECORDS_FAILED');
    }

    if (data.throughput_per_second !== undefined && data.throughput_per_second < 0) {
      throw new ValidationError('Throughput per second must be non-negative', 'INVALID_THROUGHPUT');
    }
  }

  /**
   * Map database row to domain object
   */
  private mapDatabaseRow(row: any): EntityMigrationStatus {
    return {
      id: row.id,
      migration_id: row.migration_id,
      entity_name: row.entity_name,
      target_entity: row.target_entity,
      dependency_order: row.dependency_order,
      status: row.status,
      records_total: row.records_total,
      records_processed: row.records_processed,
      records_failed: row.records_failed,
      started_at: new Date(row.started_at),
      completed_at: row.completed_at ? new Date(row.completed_at) : undefined,
      last_processed_id: row.last_processed_id,
      batch_size: row.batch_size,
      throughput_per_second: parseFloat(row.throughput_per_second),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at)
    };
  }
}