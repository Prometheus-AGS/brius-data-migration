// Differential Migration Orchestrator
// Main entry point for differential database migration operations
// Coordinates CLI integration, service orchestration, and workflow execution

import { Pool } from 'pg';
import { DatabaseConnectionManager } from './lib/database-connections';
import { CheckpointManager } from './lib/checkpoint-manager';
import { BatchProcessorService } from './lib/batch-processor';
import { UUIDMapperService } from './lib/uuid-mapper';
import { DifferentialMigrationService } from './services/differential-migration-service';
import { SyncLoggerService, OperationLogger } from './services/sync-logger';
import {
  DifferentialMigrationOptions,
  DifferentialMigrationResponse,
  OperationType,
  MigrationStats,
  MigrationError,
  ConflictResolution
} from './types/migration-types';

export interface DifferentialMigrationConfig {
  batchSize?: number;
  maxRetries?: number;
  enableCheckpointing?: boolean;
  conflictResolution?: ConflictResolution;
  dryRun?: boolean;
  entities?: string[];
  resumeFromCheckpoint?: boolean;
}

export interface MigrationExecutionContext {
  operationId: string;
  config: DifferentialMigrationConfig;
  logger: any; // Will use simple logger for now
  dbManager: DatabaseConnectionManager;
  checkpointManager: CheckpointManager;
  uuidMapper: UUIDMapperService;
  startTime: Date;
  stats: MigrationStats;
  errors: any[];
}

export interface MigrationOrchestrationResult {
  operationId: string;
  success: boolean;
  stats: MigrationStats;
  executionTimeMs: number;
  errors: MigrationError[];
  checkpointsCreated: number;
  entitiesProcessed: string[];
  resumedFromCheckpoint?: boolean;
}

export class DifferentialMigrationOrchestrator {
  private dbManager: DatabaseConnectionManager;
  private checkpointManager: CheckpointManager;
  private logger: SyncLoggerService;
  private migrationService: DifferentialMigrationService;

  constructor(projectRoot: string = process.cwd()) {
    this.dbManager = new DatabaseConnectionManager();
    this.checkpointManager = new CheckpointManager(this.dbManager.getTargetPool());
    this.logger = new SyncLoggerService({ logDir: `${projectRoot}/logs` });

    this.migrationService = new DifferentialMigrationService(
      this.dbManager.getSourcePool(),
      this.dbManager.getTargetPool(),
      projectRoot
    );
  }

  /**
   * Execute differential migration with full orchestration
   */
  async executeDifferentialMigration(
    config: DifferentialMigrationConfig = {}
  ): Promise<MigrationOrchestrationResult> {
    const operationId = this.generateOperationId('differential_migration');
    const operationLogger = this.logger.startOperation(
      OperationType.DIFFERENTIAL_MIGRATION,
      'orchestration',
      operationId
    );

    const context: MigrationExecutionContext = {
      operationId,
      config: this.mergeDefaultConfig(config),
      logger: operationLogger,
      dbManager: this.dbManager,
      checkpointManager: this.checkpointManager,
      uuidMapper: new UUIDMapperService(this.dbManager.getTargetPool()),
      startTime: new Date(),
      stats: this.initializeStats(),
      errors: []
    };

    try {
      operationLogger.info('🚀 Starting differential migration orchestration', {
        operationId,
        config: context.config,
        timestamp: context.startTime.toISOString()
      });

      // Test database connections
      await this.validateConnections(context);

      // Check for resumable checkpoints
      let resumedFromCheckpoint = false;
      if (context.config.resumeFromCheckpoint) {
        resumedFromCheckpoint = await this.attemptCheckpointResume(context);
      }

      // Execute the migration workflow
      await this.executeWorkflow(context);

      // Complete and validate results
      const result = await this.completeExecution(context, resumedFromCheckpoint);

      operationLogger.info('✅ Differential migration orchestration completed successfully', {
        operationId,
        result,
        duration: result.executionTimeMs
      });

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      context.errors.push({
        entityType: 'orchestration',
        legacyId: 'N/A',
        errorCode: 'ORCHESTRATION_ERROR',
        errorMessage: errorMessage,
        timestamp: new Date()
      });

      operationLogger.error('❌ Differential migration orchestration failed', error as Error, {
        operationId,
        stats: context.stats
      });

      // Mark any active checkpoints as failed
      await this.handleExecutionFailure(context, error as Error);

      return {
        operationId,
        success: false,
        stats: context.stats,
        executionTimeMs: Date.now() - context.startTime.getTime(),
        errors: context.errors,
        checkpointsCreated: 0,
        entitiesProcessed: [],
        resumedFromCheckpoint: false
      };
    }
  }

  /**
   * Analyze differential migration without execution (dry run)
   */
  async analyzeDifferentialMigration(
    entities: string[] = [],
    options: Partial<DifferentialMigrationOptions> = {}
  ): Promise<DifferentialMigrationResponse> {
    const operationId = this.generateOperationId('differential_analysis');
    const operationLogger = this.logger.startOperation(
      OperationType.DIFFERENTIAL_MIGRATION,
      'analysis',
      operationId
    );

    try {
      operationLogger.info('🔍 Starting differential migration analysis', {
        operationId,
        entities,
        options
      });

      const analysisOptions: DifferentialMigrationOptions = {
        entities,
        dryRun: true,
        batchSize: options.batchSize || 500,
        conflictResolution: options.conflictResolution || ConflictResolution.SOURCE_WINS,
        ...options
      };

      const result = await this.migrationService.executeDifferentialMigration(analysisOptions);

      operationLogger.info('✅ Differential migration analysis completed', {
        operationId,
        recordsProcessed: result.totalProcessed,
        successfulRecords: result.successful
      });

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      operationLogger.error('❌ Differential migration analysis failed', error as Error, {
        operationId
      });
      throw error;
    }
  }

  /**
   * Get status of differential migration operations
   */
  async getMigrationStatus(operationId?: string): Promise<any> {
    try {
      if (operationId) {
        // Get specific operation status
        const checkpoints = await this.checkpointManager.getEntityCheckpoints('differential_migration');
        const operationCheckpoints = checkpoints.filter(cp =>
          cp.metadata?.operationId === operationId
        );

        return {
          operationId,
          checkpoints: operationCheckpoints,
          totalCheckpoints: operationCheckpoints.length,
          activeCheckpoints: operationCheckpoints.filter(cp => cp.status === 'in_progress').length
        };
      }

      // Get overall migration status
      const activeCheckpoints = await this.checkpointManager.getActiveCheckpoints();
      const migrationCheckpoints = activeCheckpoints.filter(cp =>
        cp.operation_type === OperationType.DIFFERENTIAL_MIGRATION
      );

      const stats = await this.checkpointManager.getCheckpointStatistics();

      return {
        activeMigrations: migrationCheckpoints.length,
        checkpointStatistics: stats,
        activeCheckpoints: migrationCheckpoints
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get migration status: ${errorMessage}`);
    }
  }

  /**
   * Reset migration checkpoints for specific entities
   */
  async resetMigrationCheckpoints(entities: string[]): Promise<{ resetCount: number; errors: string[] }> {
    const operationLogger = this.logger.startOperation(
      OperationType.DIFFERENTIAL_MIGRATION,
      'checkpoint_reset',
      this.generateOperationId('checkpoint_reset')
    );

    const errors: string[] = [];
    let resetCount = 0;

    try {
      operationLogger.info('🔄 Resetting migration checkpoints', { entities });

      for (const entity of entities) {
        try {
          const checkpoints = await this.checkpointManager.getEntityCheckpoints(
            entity,
            OperationType.DIFFERENTIAL_MIGRATION
          );

          for (const checkpoint of checkpoints) {
            if (checkpoint.status === 'in_progress' || checkpoint.status === 'failed') {
              await this.checkpointManager.deleteCheckpoint(checkpoint.id);
              resetCount++;
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          errors.push(`Failed to reset checkpoints for ${entity}: ${errorMessage}`);
        }
      }

      operationLogger.info('✅ Migration checkpoint reset completed', {
        resetCount,
        errors: errors.length
      });

      return { resetCount, errors };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`Global checkpoint reset error: ${errorMessage}`);
      return { resetCount, errors };
    }
  }

  /**
   * Private helper methods
   */

  private mergeDefaultConfig(config: DifferentialMigrationConfig): DifferentialMigrationConfig {
    return {
      batchSize: 500,
      maxRetries: 3,
      enableCheckpointing: true,
      conflictResolution: ConflictResolution.SOURCE_WINS,
      dryRun: false,
      entities: [],
      resumeFromCheckpoint: true,
      ...config
    };
  }

  private generateOperationId(prefix: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${timestamp}_${random}`;
  }

  private initializeStats(): MigrationStats {
    return {
      totalProcessed: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      duration: 0
    };
  }

  private async validateConnections(context: MigrationExecutionContext): Promise<void> {
    context.logger.info('🔌 Validating database connections');

    const sourceTest = await this.dbManager.testConnection('source');
    if (!sourceTest.success) {
      throw new Error(`Source database connection failed: ${sourceTest.error}`);
    }

    const targetTest = await this.dbManager.testConnection('target');
    if (!targetTest.success) {
      throw new Error(`Target database connection failed: ${targetTest.error}`);
    }

    context.logger.info('✅ Database connections validated', {
      sourceLatency: sourceTest.latency,
      targetLatency: targetTest.latency
    });
  }

  private async attemptCheckpointResume(context: MigrationExecutionContext): Promise<boolean> {
    try {
      const activeCheckpoints = await this.checkpointManager.getActiveCheckpoints();
      const migrationCheckpoints = activeCheckpoints.filter(cp =>
        cp.operation_type === OperationType.DIFFERENTIAL_MIGRATION
      );

      if (migrationCheckpoints.length > 0) {
        context.logger.info('📍 Found resumable checkpoints', {
          count: migrationCheckpoints.length,
          entities: migrationCheckpoints.map(cp => cp.entity_type)
        });
        return true;
      }

      return false;
    } catch (error) {
      context.logger.warn('⚠️ Could not check for resumable checkpoints', { error });
      return false;
    }
  }

  private async executeWorkflow(context: MigrationExecutionContext): Promise<void> {
    const { config, logger } = context;

    logger.info('⚡ Executing differential migration workflow');

    // Build migration options from context
    const migrationOptions: DifferentialMigrationOptions = {
      entities: config.entities || [],
      batchSize: config.batchSize || 500,
      conflictResolution: config.conflictResolution || ConflictResolution.SOURCE_WINS,
      dryRun: config.dryRun || false
    };

    // Execute the migration service
    const result = await this.migrationService.executeDifferentialMigration(migrationOptions);

    // Update context with results
    context.stats.totalProcessed = result.totalProcessed;
    context.stats.successful = result.successful;
    context.stats.failed = result.failed;
    context.stats.skipped = result.skipped;
    context.stats.duration = result.duration;

    if (result.errors) {
      context.errors.push(...result.errors);
    }

    logger.info('✅ Differential migration workflow completed', {
      recordsProcessed: result.totalProcessed,
      successful: result.successful,
      failed: result.failed
    });
  }

  private async completeExecution(
    context: MigrationExecutionContext,
    resumedFromCheckpoint: boolean
  ): Promise<MigrationOrchestrationResult> {
    const endTime = new Date();
    const executionTimeMs = endTime.getTime() - context.startTime.getTime();

    // Complete any active checkpoints
    const checkpointsCreated = await this.finalizeCheckpoints(context);

    return {
      operationId: context.operationId,
      success: context.errors.length === 0,
      stats: context.stats,
      executionTimeMs,
      errors: context.errors,
      checkpointsCreated,
      entitiesProcessed: context.config.entities || [],
      resumedFromCheckpoint
    };
  }

  private async finalizeCheckpoints(context: MigrationExecutionContext): Promise<number> {
    try {
      const activeCheckpoints = await this.checkpointManager.getActiveCheckpoints();
      const operationCheckpoints = activeCheckpoints.filter(cp =>
        cp.metadata?.operationId === context.operationId
      );

      for (const checkpoint of operationCheckpoints) {
        if (checkpoint.status === 'in_progress') {
          await this.checkpointManager.completeCheckpoint(
            checkpoint.entity_type,
            checkpoint.operation_type,
            {
              totalProcessed: context.stats.totalProcessed,
              successful: context.stats.successful,
              failed: context.stats.failed,
              duration: context.stats.duration || 0
            }
          );
        }
      }

      return operationCheckpoints.length;
    } catch (error) {
      context.logger.warn('⚠️ Could not finalize checkpoints', { error });
      return 0;
    }
  }

  private async handleExecutionFailure(context: MigrationExecutionContext, error: Error): Promise<void> {
    try {
      const activeCheckpoints = await this.checkpointManager.getActiveCheckpoints();
      const operationCheckpoints = activeCheckpoints.filter(cp =>
        cp.metadata?.operationId === context.operationId
      );

      for (const checkpoint of operationCheckpoints) {
        if (checkpoint.status === 'in_progress') {
          await this.checkpointManager.failCheckpoint(
            checkpoint.entity_type,
            checkpoint.operation_type,
            error,
            {
              recordsProcessed: context.stats.totalProcessed,
              errors: context.errors
            }
          );
        }
      }
    } catch (failureError) {
      context.logger.error('❌ Failed to handle execution failure', failureError as Error, {
        originalError: error.message
      });
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.checkpointManager.cleanup();
    await this.dbManager.closeAll();
  }
}

// Factory function for easy instantiation
export function createDifferentialMigrationOrchestrator(projectRoot?: string): DifferentialMigrationOrchestrator {
  return new DifferentialMigrationOrchestrator(projectRoot);
}

// Default export for CLI integration
export default DifferentialMigrationOrchestrator;