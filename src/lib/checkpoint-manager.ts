// Migration Checkpoint Manager
// Handles save/restore state functionality for resumable migrations

import { Pool, PoolClient } from 'pg';
import { MigrationCheckpointModel } from '../models/migration-checkpoint';
import { BatchProcessorStats, CheckpointData } from './batch-processor';
import {
  MigrationCheckpoint,
  OperationType,
  CheckpointStatus,
  CheckpointInfo,
  CheckpointError
} from '../types/migration-types';

export interface CheckpointManagerConfig {
  autoSaveInterval?: number; // milliseconds
  maxCheckpointsPerEntity?: number;
  retentionPeriodDays?: number;
  enableCompression?: boolean;
}

export interface SaveCheckpointOptions {
  entityType: string;
  operationType: OperationType;
  lastProcessedId?: string;
  recordsProcessed: number;
  recordsTotal?: number;
  batchSize: number;
  metadata?: Record<string, any>;
  force?: boolean; // Force save even if no progress
}

export interface RestoreCheckpointResult {
  checkpoint: MigrationCheckpoint | null;
  canResume: boolean;
  resumeFromIndex?: number;
  resumeFromId?: string;
  progressPercentage: number;
  lastSaveTime?: Date;
}

export interface CheckpointCleanupResult {
  deletedCheckpoints: number;
  freedSpace: number; // in bytes
  oldestRetained?: Date;
  newestRetained?: Date;
}

export class CheckpointManager {
  private checkpointModel: MigrationCheckpointModel;
  private config: Required<CheckpointManagerConfig>;
  private autoSaveTimer?: NodeJS.Timeout;
  private lastAutoSave = new Map<string, Date>();

  constructor(
    private db: Pool,
    config: CheckpointManagerConfig = {}
  ) {
    this.checkpointModel = new MigrationCheckpointModel(db);
    this.config = {
      autoSaveInterval: config.autoSaveInterval || 30000, // 30 seconds
      maxCheckpointsPerEntity: config.maxCheckpointsPerEntity || 10,
      retentionPeriodDays: config.retentionPeriodDays || 7,
      enableCompression: config.enableCompression ?? false
    };
  }

  /**
   * Save migration checkpoint
   */
  async saveCheckpoint(options: SaveCheckpointOptions): Promise<MigrationCheckpoint> {
    const checkpointKey = `${options.entityType}:${options.operationType}`;

    try {
      // Check if we need to force save or if enough time has passed
      const lastSave = this.lastAutoSave.get(checkpointKey);
      const timeSinceLastSave = lastSave ? Date.now() - lastSave.getTime() : Infinity;

      if (!options.force && timeSinceLastSave < this.config.autoSaveInterval) {
        // Skip save if not enough time has passed
        const existingCheckpoint = await this.getLatestCheckpoint(options.entityType, options.operationType);
        if (existingCheckpoint) {
          return existingCheckpoint;
        }
      }

      console.log(`💾 Saving checkpoint for ${options.entityType}[${options.operationType}]...`);

      // Prepare checkpoint data
      const checkpointData = {
        operation_type: options.operationType,
        entity_type: options.entityType,
        last_processed_id: options.lastProcessedId,
        records_processed: options.recordsProcessed,
        records_total: options.recordsTotal,
        batch_size: options.batchSize,
        status: CheckpointStatus.IN_PROGRESS,
        started_at: new Date(),
        metadata: {
          ...options.metadata,
          checkpoint_saved_at: new Date(),
          progress_percentage: options.recordsTotal
            ? Math.round((options.recordsProcessed / options.recordsTotal) * 100)
            : null
        }
      };

      // Find existing checkpoint to update or create new one
      const existingCheckpoint = await this.getLatestCheckpoint(options.entityType, options.operationType);

      let savedCheckpoint: MigrationCheckpoint;

      if (existingCheckpoint && existingCheckpoint.status === CheckpointStatus.IN_PROGRESS) {
        // Update existing checkpoint
        savedCheckpoint = await this.checkpointModel.update(existingCheckpoint.id, {
          last_processed_id: checkpointData.last_processed_id,
          records_processed: checkpointData.records_processed,
          records_total: checkpointData.records_total,
          metadata: checkpointData.metadata
        });
      } else {
        // Create new checkpoint
        savedCheckpoint = await this.checkpointModel.create(checkpointData);
      }

      // Update last save time
      this.lastAutoSave.set(checkpointKey, new Date());

      console.log(`✅ Checkpoint saved: ${savedCheckpoint.id} (${checkpointData.records_processed} records)`);
      return savedCheckpoint;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Failed to save checkpoint for ${options.entityType}:`, errorMessage);
      throw new CheckpointError(
        `Checkpoint save failed: ${errorMessage}`,
        undefined,
        'save'
      );
    }
  }

  /**
   * Restore checkpoint for resumable migration
   */
  async restoreCheckpoint(
    entityType: string,
    operationType: OperationType
  ): Promise<RestoreCheckpointResult> {
    try {
      console.log(`📥 Checking for resumable checkpoint: ${entityType}[${operationType}]`);

      const checkpoint = await this.getLatestCheckpoint(entityType, operationType);

      if (!checkpoint) {
        return {
          checkpoint: null,
          canResume: false,
          progressPercentage: 0
        };
      }

      // Determine if checkpoint can be resumed
      const canResume = this.canResumeFromCheckpoint(checkpoint);
      const progressPercentage = checkpoint.records_total
        ? Math.round((checkpoint.records_processed / checkpoint.records_total) * 100)
        : 0;

      const result: RestoreCheckpointResult = {
        checkpoint,
        canResume,
        progressPercentage,
        lastSaveTime: checkpoint.updated_at
      };

      if (canResume) {
        result.resumeFromId = checkpoint.last_processed_id;
        // Calculate approximate index from processed records
        if (checkpoint.batch_size > 0) {
          result.resumeFromIndex = Math.floor(checkpoint.records_processed / checkpoint.batch_size) * checkpoint.batch_size;
        }
      }

      if (canResume) {
        console.log(`✅ Resumable checkpoint found: ${checkpoint.id} (${progressPercentage}% complete)`);
      } else {
        console.log(`⚠️  Checkpoint found but cannot resume: ${checkpoint.status}`);
      }

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Failed to restore checkpoint for ${entityType}:`, errorMessage);
      throw new CheckpointError(
        `Checkpoint restore failed: ${errorMessage}`,
        undefined,
        'restore'
      );
    }
  }

  /**
   * Complete a checkpoint (mark as completed)
   */
  async completeCheckpoint(
    entityType: string,
    operationType: OperationType,
    finalStats?: {
      totalProcessed: number;
      successful: number;
      failed: number;
      duration?: number;
    }
  ): Promise<MigrationCheckpoint | null> {
    try {
      const checkpoint = await this.getLatestCheckpoint(entityType, operationType);

      if (!checkpoint) {
        console.warn(`⚠️  No checkpoint found to complete for ${entityType}[${operationType}]`);
        return null;
      }

      const completedCheckpoint = await this.checkpointModel.update(checkpoint.id, {
        status: CheckpointStatus.COMPLETED,
        completed_at: new Date(),
        records_processed: finalStats?.totalProcessed || checkpoint.records_processed,
        metadata: {
          ...checkpoint.metadata,
          completion_stats: finalStats,
          completed_at: new Date()
        }
      });

      console.log(`✅ Checkpoint completed: ${completedCheckpoint.id}`);
      return completedCheckpoint;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Failed to complete checkpoint for ${entityType}:`, errorMessage);
      throw new CheckpointError(
        `Checkpoint completion failed: ${errorMessage}`,
        undefined,
        'complete'
      );
    }
  }

  /**
   * Fail a checkpoint (mark as failed with error details)
   */
  async failCheckpoint(
    entityType: string,
    operationType: OperationType,
    error: Error | string,
    partialStats?: {
      recordsProcessed: number;
      errors?: any[];
    }
  ): Promise<MigrationCheckpoint | null> {
    try {
      const checkpoint = await this.getLatestCheckpoint(entityType, operationType);

      if (!checkpoint) {
        console.warn(`⚠️  No checkpoint found to fail for ${entityType}[${operationType}]`);
        return null;
      }

      const errorMessage = error instanceof Error ? error.message : error;

      const failedCheckpoint = await this.checkpointModel.update(checkpoint.id, {
        status: CheckpointStatus.FAILED,
        completed_at: new Date(),
        error_message: errorMessage,
        records_processed: partialStats?.recordsProcessed || checkpoint.records_processed,
        metadata: {
          ...checkpoint.metadata,
          failure_details: {
            error: errorMessage,
            failed_at: new Date(),
            partial_stats: partialStats
          }
        }
      });

      console.log(`❌ Checkpoint failed: ${failedCheckpoint.id} - ${errorMessage}`);
      return failedCheckpoint;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Failed to mark checkpoint as failed for ${entityType}:`, errorMessage);
      throw new CheckpointError(
        `Checkpoint failure marking failed: ${errorMessage}`,
        undefined,
        'fail'
      );
    }
  }

  /**
   * Pause a checkpoint for later resumption
   */
  async pauseCheckpoint(
    entityType: string,
    operationType: OperationType,
    reason?: string
  ): Promise<MigrationCheckpoint | null> {
    try {
      const checkpoint = await this.getLatestCheckpoint(entityType, operationType);

      if (!checkpoint) {
        console.warn(`⚠️  No checkpoint found to pause for ${entityType}[${operationType}]`);
        return null;
      }

      const pausedCheckpoint = await this.checkpointModel.update(checkpoint.id, {
        status: CheckpointStatus.PAUSED,
        metadata: {
          ...checkpoint.metadata,
          paused_at: new Date(),
          pause_reason: reason || 'Manual pause'
        }
      });

      console.log(`⏸️  Checkpoint paused: ${pausedCheckpoint.id} - ${reason || 'Manual pause'}`);
      return pausedCheckpoint;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Failed to pause checkpoint for ${entityType}:`, errorMessage);
      throw new CheckpointError(
        `Checkpoint pause failed: ${errorMessage}`,
        undefined,
        'pause'
      );
    }
  }

  /**
   * Get the latest checkpoint for an entity and operation
   */
  private async getLatestCheckpoint(
    entityType: string,
    operationType: OperationType
  ): Promise<MigrationCheckpoint | null> {
    const checkpoints = await this.checkpointModel.list({
      entityType,
      operationType,
      limit: 1
    });

    return checkpoints.length > 0 ? checkpoints[0] : null;
  }

  /**
   * Determine if a checkpoint can be resumed
   */
  private canResumeFromCheckpoint(checkpoint: MigrationCheckpoint): boolean {
    // Can resume if status is paused or failed (for retry)
    if (checkpoint.status === CheckpointStatus.PAUSED) {
      return true;
    }

    // Can resume failed checkpoints for retry
    if (checkpoint.status === CheckpointStatus.FAILED) {
      return true;
    }

    // Can resume in_progress checkpoints that appear stale (longer than 1 hour)
    if (checkpoint.status === CheckpointStatus.IN_PROGRESS) {
      const timeSinceUpdate = Date.now() - checkpoint.updated_at.getTime();
      return timeSinceUpdate > 60 * 60 * 1000; // 1 hour
    }

    return false;
  }

  /**
   * Create checkpoint saver function for batch processor integration
   */
  createCheckpointSaver(
    entityType: string,
    operationType: OperationType,
    totalRecords?: number
  ): (checkpointData: CheckpointData) => Promise<void> {
    return async (checkpointData: CheckpointData) => {
      await this.saveCheckpoint({
        entityType,
        operationType,
        recordsProcessed: checkpointData.stats.totalProcessed,
        recordsTotal: totalRecords,
        batchSize: 500, // Default batch size
        lastProcessedId: checkpointData.lastProcessedIndex.toString(),
        metadata: {
          ...checkpointData.metadata,
          stats: checkpointData.stats,
          checkpoint_timestamp: checkpointData.timestamp
        }
      });
    };
  }

  /**
   * Create checkpoint loader function for batch processor integration
   */
  createCheckpointLoader(
    entityType: string,
    operationType: OperationType
  ): () => Promise<CheckpointData | null> {
    return async () => {
      const restoreResult = await this.restoreCheckpoint(entityType, operationType);

      if (!restoreResult.canResume || !restoreResult.checkpoint) {
        return null;
      }

      const checkpointData: CheckpointData = {
        lastProcessedIndex: restoreResult.resumeFromIndex || 0,
        timestamp: restoreResult.checkpoint.updated_at,
        stats: restoreResult.checkpoint.metadata?.stats || {
          totalProcessed: restoreResult.checkpoint.records_processed,
          successful: restoreResult.checkpoint.records_processed, // Assume all were successful so far
          failed: 0,
          skipped: 0,
          errors: [],
          startTime: restoreResult.checkpoint.started_at
        },
        metadata: restoreResult.checkpoint.metadata
      };

      return checkpointData;
    };
  }

  /**
   * Start auto-save for an operation
   */
  startAutoSave(
    entityType: string,
    operationType: OperationType,
    getCurrentState: () => SaveCheckpointOptions
  ): void {
    const checkpointKey = `${entityType}:${operationType}`;

    // Clear existing timer if any
    this.stopAutoSave(entityType, operationType);

    this.autoSaveTimer = setInterval(async () => {
      try {
        const state = getCurrentState();
        await this.saveCheckpoint(state);
      } catch (error) {
        console.error(`❌ Auto-save failed for ${checkpointKey}:`, error);
      }
    }, this.config.autoSaveInterval);

    console.log(`⏰ Auto-save started for ${checkpointKey} (interval: ${this.config.autoSaveInterval}ms)`);
  }

  /**
   * Stop auto-save for an operation
   */
  stopAutoSave(entityType: string, operationType: OperationType): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = undefined;

      const checkpointKey = `${entityType}:${operationType}`;
      console.log(`⏹️  Auto-save stopped for ${checkpointKey}`);
    }
  }

  /**
   * Get all checkpoints for an entity
   */
  async getEntityCheckpoints(
    entityType: string,
    operationType?: OperationType,
    status?: CheckpointStatus
  ): Promise<MigrationCheckpoint[]> {
    try {
      const filters: any = { entityType };

      if (operationType) {
        filters.operationType = operationType;
      }

      if (status) {
        filters.status = status;
      }

      return await this.checkpointModel.list(filters);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Error getting checkpoints for ${entityType}:`, errorMessage);
      return [];
    }
  }

  /**
   * Get checkpoint status information
   */
  async getCheckpointInfo(
    entityType: string,
    operationType?: OperationType
  ): Promise<CheckpointInfo | null> {
    try {
      return await this.checkpointModel.getCheckpointInfo(entityType, operationType);

    } catch (error) {
      console.error(`❌ Error getting checkpoint info for ${entityType}:`, error);
      return null;
    }
  }

  /**
   * Clean up old checkpoints
   */
  async cleanupOldCheckpoints(
    entityType?: string,
    olderThanDays?: number
  ): Promise<CheckpointCleanupResult> {
    const retentionDays = olderThanDays || this.config.retentionPeriodDays;

    try {
      console.log(`🧹 Cleaning up checkpoints older than ${retentionDays} days...`);

      let deleteQuery = `
        DELETE FROM migration_checkpoints
        WHERE status IN ('completed', 'failed')
          AND updated_at < NOW() - INTERVAL '${retentionDays} days'
      `;

      const values: any[] = [];

      if (entityType) {
        deleteQuery += ` AND entity_type = $1`;
        values.push(entityType);
      }

      deleteQuery += ` RETURNING id, entity_type, updated_at`;

      const result = await this.db.query(deleteQuery, values);

      const deletedCount = result.rowCount || 0;
      let oldestRetained: Date | undefined;
      let newestRetained: Date | undefined;

      if (result.rows.length > 0) {
        const dates = result.rows.map(row => new Date(row.updated_at));
        oldestRetained = new Date(Math.min(...dates.map(d => d.getTime())));
        newestRetained = new Date(Math.max(...dates.map(d => d.getTime())));
      }

      console.log(`✅ Cleanup completed: ${deletedCount} checkpoints removed`);

      return {
        deletedCheckpoints: deletedCount,
        freedSpace: deletedCount * 1024, // Rough estimate
        oldestRetained,
        newestRetained
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Checkpoint cleanup failed:`, errorMessage);
      throw new CheckpointError(`Checkpoint cleanup failed: ${errorMessage}`, undefined, 'cleanup');
    }
  }

  /**
   * Force delete a checkpoint (use with caution)
   */
  async deleteCheckpoint(checkpointId: string): Promise<boolean> {
    try {
      const deleted = await this.checkpointModel.delete(checkpointId);

      if (deleted) {
        console.log(`🗑️  Checkpoint deleted: ${checkpointId}`);
      } else {
        console.warn(`⚠️  Checkpoint not found or already deleted: ${checkpointId}`);
      }

      return deleted;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Failed to delete checkpoint ${checkpointId}:`, errorMessage);
      throw new CheckpointError(`Checkpoint deletion failed: ${errorMessage}`, checkpointId, 'delete');
    }
  }

  /**
   * Get checkpoint statistics
   */
  async getCheckpointStatistics(): Promise<any> {
    try {
      const query = `
        SELECT
          entity_type,
          operation_type,
          status,
          COUNT(*) as checkpoint_count,
          AVG(records_processed) as avg_records_processed,
          MAX(updated_at) as last_update,
          AVG(EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - started_at)) * 1000) as avg_duration_ms
        FROM migration_checkpoints
        WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY entity_type, operation_type, status
        ORDER BY entity_type, operation_type, status
      `;

      const result = await this.db.query(query);

      return result.rows.map(row => ({
        entity_type: row.entity_type,
        operation_type: row.operation_type,
        status: row.status,
        checkpoint_count: parseInt(row.checkpoint_count),
        avg_records_processed: Math.round(parseFloat(row.avg_records_processed || '0')),
        last_update: row.last_update,
        avg_duration_ms: row.avg_duration_ms ? Math.round(parseFloat(row.avg_duration_ms)) : null
      }));

    } catch (error) {
      console.error('❌ Error getting checkpoint statistics:', error);
      return [];
    }
  }

  /**
   * Execute operation with automatic checkpointing
   */
  async withCheckpointing<T>(
    entityType: string,
    operationType: OperationType,
    operation: (checkpointManager: CheckpointManager) => Promise<T>,
    options?: {
      totalRecords?: number;
      batchSize?: number;
      autoSaveInterval?: number;
    }
  ): Promise<T> {
    const checkpointKey = `${entityType}:${operationType}`;

    try {
      console.log(`🚀 Starting operation with checkpointing: ${checkpointKey}`);

      // Start with initial checkpoint
      await this.saveCheckpoint({
        entityType,
        operationType,
        recordsProcessed: 0,
        recordsTotal: options?.totalRecords,
        batchSize: options?.batchSize || 500,
        metadata: {
          operation_started: new Date(),
          auto_save_interval: options?.autoSaveInterval || this.config.autoSaveInterval
        }
      });

      // Execute the operation
      const result = await operation(this);

      // Complete the checkpoint
      await this.completeCheckpoint(entityType, operationType);

      console.log(`✅ Operation completed with checkpointing: ${checkpointKey}`);
      return result;

    } catch (error) {
      // Mark checkpoint as failed
      await this.failCheckpoint(entityType, operationType, error as Error);

      console.error(`❌ Operation failed with checkpointing: ${checkpointKey}`, error);
      throw error;
    }
  }

  /**
   * Get active (resumable) checkpoints
   */
  async getActiveCheckpoints(): Promise<MigrationCheckpoint[]> {
    try {
      return await this.checkpointModel.list({
        status: CheckpointStatus.IN_PROGRESS,
        limit: 50
      });

    } catch (error) {
      console.error('❌ Error getting active checkpoints:', error);
      return [];
    }
  }

  /**
   * Validate checkpoint integrity
   */
  async validateCheckpointIntegrity(
    entityType?: string
  ): Promise<{ valid: boolean; issues: string[] }> {
    const issues: string[] = [];

    try {
      let query = `
        SELECT id, entity_type, records_processed, records_total,
               started_at, completed_at, status
        FROM migration_checkpoints
        WHERE created_at > NOW() - INTERVAL '30 days'
      `;

      const values: any[] = [];

      if (entityType) {
        query += ` AND entity_type = $1`;
        values.push(entityType);
      }

      const result = await this.db.query(query, values);

      for (const checkpoint of result.rows) {
        // Check for logical inconsistencies
        if (checkpoint.records_total && checkpoint.records_processed > checkpoint.records_total) {
          issues.push(`Checkpoint ${checkpoint.id}: processed count exceeds total count`);
        }

        // Check for stale in_progress checkpoints
        if (checkpoint.status === 'in_progress') {
          const timeSinceStart = Date.now() - new Date(checkpoint.started_at).getTime();
          if (timeSinceStart > 4 * 60 * 60 * 1000) { // 4 hours
            issues.push(`Checkpoint ${checkpoint.id}: stale in_progress status (${Math.round(timeSinceStart / (60 * 60 * 1000))} hours)`);
          }
        }

        // Check for completed checkpoints without completion timestamp
        if (checkpoint.status === 'completed' && !checkpoint.completed_at) {
          issues.push(`Checkpoint ${checkpoint.id}: marked completed but missing completion timestamp`);
        }
      }

      return {
        valid: issues.length === 0,
        issues
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      issues.push(`Validation query failed: ${errorMessage}`);

      return {
        valid: false,
        issues
      };
    }
  }

  /**
   * Cleanup resources and stop auto-save timers
   */
  async cleanup(): Promise<void> {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = undefined;
    }

    this.lastAutoSave.clear();
    console.log('🧹 Checkpoint manager cleanup completed');
  }
}

/**
 * Helper functions for checkpoint integration
 */

/**
 * Create checkpoint-enabled batch processor
 */
export function createCheckpointEnabledProcessor<TInput, TOutput>(
  checkpointManager: CheckpointManager,
  entityType: string,
  operationType: OperationType,
  totalRecords?: number
) {
  const checkpointSaver = checkpointManager.createCheckpointSaver(
    entityType,
    operationType,
    totalRecords
  );

  const checkpointLoader = checkpointManager.createCheckpointLoader(
    entityType,
    operationType
  );

  return { checkpointSaver, checkpointLoader };
}

/**
 * Execute operation with checkpoint safety
 */
export async function withCheckpointSafety<T>(
  db: Pool,
  entityType: string,
  operationType: OperationType,
  operation: (checkpointManager: CheckpointManager) => Promise<T>,
  options?: {
    totalRecords?: number;
    batchSize?: number;
    autoSaveInterval?: number;
  }
): Promise<T> {
  const checkpointManager = new CheckpointManager(db);

  try {
    return await checkpointManager.withCheckpointing(
      entityType,
      operationType,
      operation,
      options
    );
  } finally {
    await checkpointManager.cleanup();
  }
}