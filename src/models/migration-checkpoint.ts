// Migration Checkpoint Model
// Handles tracking and managing migration progress and checkpoints

import { Pool, PoolClient } from 'pg';
import {
  MigrationCheckpoint,
  OperationType,
  CheckpointStatus,
  CheckpointInfo,
  CheckpointError
} from '../types/migration-types';

export class MigrationCheckpointModel {
  constructor(private db: Pool) {}

  /**
   * Create a new migration checkpoint
   */
  async create(checkpoint: Omit<MigrationCheckpoint, 'id' | 'created_at' | 'updated_at'>): Promise<MigrationCheckpoint> {
    const query = `
      INSERT INTO migration_checkpoints (
        operation_type, entity_type, last_processed_id, records_processed,
        records_total, batch_size, status, started_at, completed_at,
        error_message, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;

    const values = [
      checkpoint.operation_type,
      checkpoint.entity_type,
      checkpoint.last_processed_id,
      checkpoint.records_processed,
      checkpoint.records_total,
      checkpoint.batch_size,
      checkpoint.status,
      checkpoint.started_at,
      checkpoint.completed_at,
      checkpoint.error_message,
      JSON.stringify(checkpoint.metadata)
    ];

    try {
      const result = await this.db.query(query, values);
      return this.mapRowToCheckpoint(result.rows[0]);
    } catch (error) {
      throw new CheckpointError(`Failed to create checkpoint: ${error.message}`, undefined, 'create');
    }
  }

  /**
   * Update an existing checkpoint
   */
  async update(id: string, updates: Partial<MigrationCheckpoint>): Promise<MigrationCheckpoint> {
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    // Build dynamic update query based on provided fields
    Object.entries(updates).forEach(([key, value]) => {
      if (key !== 'id' && key !== 'created_at' && value !== undefined) {
        if (key === 'metadata') {
          updateFields.push(`${key} = $${paramCount}`);
          values.push(JSON.stringify(value));
        } else {
          updateFields.push(`${key} = $${paramCount}`);
          values.push(value);
        }
        paramCount++;
      }
    });

    if (updateFields.length === 0) {
      throw new CheckpointError('No valid fields provided for update', id, 'update');
    }

    // Always update the updated_at timestamp
    updateFields.push(`updated_at = NOW()`);

    const query = `
      UPDATE migration_checkpoints
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    values.push(id);

    try {
      const result = await this.db.query(query, values);
      if (result.rows.length === 0) {
        throw new CheckpointError(`Checkpoint not found: ${id}`, id, 'update');
      }
      return this.mapRowToCheckpoint(result.rows[0]);
    } catch (error) {
      if (error instanceof CheckpointError) throw error;
      throw new CheckpointError(`Failed to update checkpoint: ${error.message}`, id, 'update');
    }
  }

  /**
   * Find checkpoint by ID
   */
  async findById(id: string): Promise<MigrationCheckpoint | null> {
    const query = 'SELECT * FROM migration_checkpoints WHERE id = $1';

    try {
      const result = await this.db.query(query, [id]);
      return result.rows.length > 0 ? this.mapRowToCheckpoint(result.rows[0]) : null;
    } catch (error) {
      throw new CheckpointError(`Failed to find checkpoint: ${error.message}`, id, 'findById');
    }
  }

  /**
   * Find active checkpoint for an entity and operation type
   */
  async findActiveCheckpoint(entityType: string, operationType: OperationType): Promise<MigrationCheckpoint | null> {
    const query = `
      SELECT * FROM migration_checkpoints
      WHERE entity_type = $1 AND operation_type = $2
        AND status IN ('pending', 'in_progress', 'paused')
      ORDER BY created_at DESC
      LIMIT 1
    `;

    try {
      const result = await this.db.query(query, [entityType, operationType]);
      return result.rows.length > 0 ? this.mapRowToCheckpoint(result.rows[0]) : null;
    } catch (error) {
      throw new CheckpointError(
        `Failed to find active checkpoint: ${error.message}`,
        undefined,
        'findActiveCheckpoint'
      );
    }
  }

  /**
   * Find the most recent checkpoint for an entity
   */
  async findLatestCheckpoint(entityType: string, operationType?: OperationType): Promise<MigrationCheckpoint | null> {
    let query = `
      SELECT * FROM migration_checkpoints
      WHERE entity_type = $1
    `;
    const values = [entityType];

    if (operationType) {
      query += ' AND operation_type = $2';
      values.push(operationType);
    }

    query += ' ORDER BY created_at DESC LIMIT 1';

    try {
      const result = await this.db.query(query, values);
      return result.rows.length > 0 ? this.mapRowToCheckpoint(result.rows[0]) : null;
    } catch (error) {
      throw new CheckpointError(
        `Failed to find latest checkpoint: ${error.message}`,
        undefined,
        'findLatestCheckpoint'
      );
    }
  }

  /**
   * List checkpoints with optional filtering
   */
  async list(
    filters: {
      entityType?: string;
      operationType?: OperationType;
      status?: CheckpointStatus;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<MigrationCheckpoint[]> {
    let query = 'SELECT * FROM migration_checkpoints WHERE 1=1';
    const values: any[] = [];
    let paramCount = 1;

    if (filters.entityType) {
      query += ` AND entity_type = $${paramCount}`;
      values.push(filters.entityType);
      paramCount++;
    }

    if (filters.operationType) {
      query += ` AND operation_type = $${paramCount}`;
      values.push(filters.operationType);
      paramCount++;
    }

    if (filters.status) {
      query += ` AND status = $${paramCount}`;
      values.push(filters.status);
      paramCount++;
    }

    query += ' ORDER BY created_at DESC';

    if (filters.limit) {
      query += ` LIMIT $${paramCount}`;
      values.push(filters.limit);
      paramCount++;
    }

    if (filters.offset) {
      query += ` OFFSET $${paramCount}`;
      values.push(filters.offset);
    }

    try {
      const result = await this.db.query(query, values);
      return result.rows.map(row => this.mapRowToCheckpoint(row));
    } catch (error) {
      throw new CheckpointError(`Failed to list checkpoints: ${error.message}`, undefined, 'list');
    }
  }

  /**
   * Delete a checkpoint
   */
  async delete(id: string): Promise<boolean> {
    const query = 'DELETE FROM migration_checkpoints WHERE id = $1';

    try {
      const result = await this.db.query(query, [id]);
      return result.rowCount > 0;
    } catch (error) {
      throw new CheckpointError(`Failed to delete checkpoint: ${error.message}`, id, 'delete');
    }
  }

  /**
   * Mark checkpoint as completed
   */
  async markCompleted(id: string, recordsProcessed?: number): Promise<MigrationCheckpoint> {
    const updates: Partial<MigrationCheckpoint> = {
      status: CheckpointStatus.COMPLETED,
      completed_at: new Date()
    };

    if (recordsProcessed !== undefined) {
      updates.records_processed = recordsProcessed;
    }

    return this.update(id, updates);
  }

  /**
   * Mark checkpoint as failed
   */
  async markFailed(id: string, errorMessage: string): Promise<MigrationCheckpoint> {
    return this.update(id, {
      status: CheckpointStatus.FAILED,
      error_message: errorMessage,
      completed_at: new Date()
    });
  }

  /**
   * Update progress for a checkpoint
   */
  async updateProgress(
    id: string,
    recordsProcessed: number,
    lastProcessedId?: string
  ): Promise<MigrationCheckpoint> {
    const updates: Partial<MigrationCheckpoint> = {
      records_processed: recordsProcessed,
      status: CheckpointStatus.IN_PROGRESS
    };

    if (lastProcessedId) {
      updates.last_processed_id = lastProcessedId;
    }

    return this.update(id, updates);
  }

  /**
   * Get checkpoint info for CLI display
   */
  async getCheckpointInfo(entityType: string, operationType?: OperationType): Promise<CheckpointInfo | null> {
    const checkpoint = await this.findLatestCheckpoint(entityType, operationType);

    if (!checkpoint) {
      return null;
    }

    const progressPercentage = checkpoint.records_total
      ? Math.round((checkpoint.records_processed / checkpoint.records_total) * 100)
      : 0;

    const canResume = checkpoint.status === CheckpointStatus.IN_PROGRESS ||
                      checkpoint.status === CheckpointStatus.PAUSED;

    const info: CheckpointInfo = {
      checkpoint_id: checkpoint.id,
      entity_type: checkpoint.entity_type,
      last_processed_id: checkpoint.last_processed_id,
      progress_percentage: progressPercentage,
      can_resume: canResume
    };

    // Calculate estimated time remaining if we have enough data
    if (checkpoint.records_total && checkpoint.records_processed > 0 && canResume) {
      const elapsedMs = Date.now() - checkpoint.started_at.getTime();
      const recordsPerMs = checkpoint.records_processed / elapsedMs;
      const remainingRecords = checkpoint.records_total - checkpoint.records_processed;
      info.estimated_time_remaining = Math.round(remainingRecords / recordsPerMs);
    }

    return info;
  }

  /**
   * Clean up old completed checkpoints
   */
  async cleanup(olderThanDays: number = 30): Promise<number> {
    const query = `
      DELETE FROM migration_checkpoints
      WHERE status IN ('completed', 'failed')
        AND completed_at < NOW() - INTERVAL '${olderThanDays} days'
    `;

    try {
      const result = await this.db.query(query);
      return result.rowCount;
    } catch (error) {
      throw new CheckpointError(`Failed to cleanup checkpoints: ${error.message}`, undefined, 'cleanup');
    }
  }

  /**
   * Execute checkpoint operations within a transaction
   */
  async withTransaction<T>(operation: (client: PoolClient, model: MigrationCheckpointModel) => Promise<T>): Promise<T> {
    const client = await this.db.connect();

    try {
      await client.query('BEGIN');
      const transactionModel = new MigrationCheckpointModel(client as any);
      const result = await operation(client, transactionModel);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Map database row to MigrationCheckpoint object
   */
  private mapRowToCheckpoint(row: any): MigrationCheckpoint {
    return {
      id: row.id,
      operation_type: row.operation_type as OperationType,
      entity_type: row.entity_type,
      last_processed_id: row.last_processed_id,
      records_processed: parseInt(row.records_processed),
      records_total: row.records_total ? parseInt(row.records_total) : undefined,
      batch_size: parseInt(row.batch_size),
      status: row.status as CheckpointStatus,
      started_at: new Date(row.started_at),
      completed_at: row.completed_at ? new Date(row.completed_at) : undefined,
      error_message: row.error_message,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at)
    };
  }
}