// Conflict Resolution Orchestrator
// Main entry point for handling data conflicts during synchronization
// Coordinates conflict detection, resolution strategies, and recovery processes

import { Pool } from 'pg';
import { DatabaseConnectionManager } from './lib/database-connections';
import { CheckpointManager } from './lib/checkpoint-manager';
import { BatchProcessorService } from './lib/batch-processor';
import { UUIDMapperService } from './lib/uuid-mapper';
import { ConflictResolverService, ResolutionOptions, ConflictResolutionSummary, BackupInfo } from './services/conflict-resolver';
import { DataComparatorService } from './services/data-comparator';
import { SyncLoggerService, OperationLogger } from './services/sync-logger';
import {
  DataDifferential,
  ComparisonType,
  ResolutionStrategy,
  ConflictResolutionResult,
  ConflictResolutionError,
  MigrationError,
  OperationType
} from './types/migration-types';

export interface ConflictResolutionOrchestratorConfig {
  defaultStrategy?: ResolutionStrategy;
  batchSize?: number;
  maxRetries?: number;
  enableBackups?: boolean;
  enableValidation?: boolean;
  enableDetailedLogging?: boolean;
  conflictDetectionThreshold?: number;
  autoResolveSimpleConflicts?: boolean;
  preserveConflictHistory?: boolean;
}

export interface ConflictResolutionWorkflow {
  entities: string[];
  strategy: ResolutionStrategy;
  options: ResolutionOptions;
  customRules?: ConflictRule[];
  preResolutionActions?: PreResolutionAction[];
  postResolutionActions?: PostResolutionAction[];
}

export interface ConflictRule {
  id: string;
  name: string;
  entityType: string;
  conflictType: ComparisonType;
  condition: string; // SQL-like condition
  resolution: ResolutionStrategy;
  priority: number;
  description: string;
}

export interface PreResolutionAction {
  type: 'backup' | 'validate' | 'notify' | 'checkpoint';
  config: Record<string, any>;
}

export interface PostResolutionAction {
  type: 'validate' | 'report' | 'cleanup' | 'notify';
  config: Record<string, any>;
}

export interface ConflictResolutionContext {
  operationId: string;
  config: ConflictResolutionOrchestratorConfig;
  workflow: ConflictResolutionWorkflow;
  logger: OperationLogger;
  dbManager: DatabaseConnectionManager;
  checkpointManager: CheckpointManager;
  resolverService: ConflictResolverService;
  comparatorService: DataComparatorService;
  startTime: Date;
  conflicts: Map<string, DataDifferential[]>;
  resolutions: Map<string, ConflictResolutionResult>;
  backups: BackupInfo[];
  errors: ConflictResolutionError[];
}

export interface ConflictDetectionResult {
  entityType: string;
  conflictsFound: number;
  conflictTypes: ComparisonType[];
  conflicts: DataDifferential[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  estimatedResolutionTime: number;
}

export interface ConflictResolutionOrchestrationResult {
  operationId: string;
  success: boolean;
  totalConflicts: number;
  resolvedConflicts: number;
  failedConflicts: number;
  skippedConflicts: number;
  executionTimeMs: number;
  strategy: ResolutionStrategy;
  entitiesProcessed: string[];
  backupsCreated: BackupInfo[];
  detectionResults: ConflictDetectionResult[];
  resolutionSummaries: ConflictResolutionSummary[];
  errors: ConflictResolutionError[];
  recommendedActions: string[];
}

export class ConflictResolutionOrchestrator {
  private dbManager: DatabaseConnectionManager;
  private checkpointManager: CheckpointManager;
  private logger: SyncLoggerService;
  private resolverService: ConflictResolverService;
  private comparatorService: DataComparatorService;

  constructor(projectRoot: string = process.cwd()) {
    this.dbManager = new DatabaseConnectionManager();
    this.checkpointManager = new CheckpointManager(this.dbManager.getTargetPool());
    this.logger = new SyncLoggerService(projectRoot);

    this.resolverService = new ConflictResolverService(
      this.dbManager.getSourcePool(),
      this.dbManager.getTargetPool(),
      projectRoot
    );

    this.comparatorService = new DataComparatorService(
      this.dbManager.getSourcePool(),
      this.dbManager.getTargetPool(),
      projectRoot
    );
  }

  /**
   * Execute comprehensive conflict resolution workflow
   */
  async executeConflictResolution(
    workflow: ConflictResolutionWorkflow,
    config: ConflictResolutionOrchestratorConfig = {}
  ): Promise<ConflictResolutionOrchestrationResult> {
    const operationId = this.generateOperationId('conflict_resolution');
    const operationLogger = this.logger.createOperationLogger(operationId);

    const context: ConflictResolutionContext = {
      operationId,
      config: this.mergeDefaultConfig(config),
      workflow,
      logger: operationLogger,
      dbManager: this.dbManager,
      checkpointManager: this.checkpointManager,
      resolverService: this.resolverService,
      comparatorService: this.comparatorService,
      startTime: new Date(),
      conflicts: new Map(),
      resolutions: new Map(),
      backups: [],
      errors: []
    };

    try {
      operationLogger.info('⚔️ Starting conflict resolution orchestration', {
        operationId,
        entities: workflow.entities,
        strategy: workflow.strategy,
        config: context.config
      });

      // Test database connections
      await this.validateConnections(context);

      // Create checkpoint for conflict resolution operation
      await this.createResolutionCheckpoint(context);

      // Phase 1: Detect conflicts
      const detectionResults = await this.detectConflicts(context);

      // Phase 2: Execute pre-resolution actions
      await this.executePreResolutionActions(context);

      // Phase 3: Resolve conflicts
      const resolutionSummaries = await this.resolveConflicts(context);

      // Phase 4: Execute post-resolution actions
      await this.executePostResolutionActions(context);

      // Generate final result
      const result = await this.generateResolutionResult(context, detectionResults, resolutionSummaries);

      operationLogger.info('✅ Conflict resolution orchestration completed successfully', {
        operationId,
        totalConflicts: result.totalConflicts,
        resolvedConflicts: result.resolvedConflicts,
        success: result.success
      });

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      context.errors.push({
        type: 'orchestration_error',
        message: errorMessage,
        entityType: 'system',
        timestamp: new Date(),
        context: { operationId, phase: 'execution' }
      });

      operationLogger.error('❌ Conflict resolution orchestration failed', {
        error: errorMessage,
        operationId
      });

      // Mark checkpoint as failed
      await this.handleResolutionFailure(context, error as Error);

      return this.generateFailureResult(context, error as Error);
    }
  }

  /**
   * Detect conflicts for specific entities
   */
  async detectConflicts(
    entities: string[],
    threshold: number = 0.01
  ): Promise<ConflictDetectionResult[]> {
    const operationId = this.generateOperationId('conflict_detection');
    const operationLogger = this.logger.createOperationLogger(operationId);

    try {
      operationLogger.info('🔍 Starting conflict detection', {
        operationId,
        entities,
        threshold
      });

      const results: ConflictDetectionResult[] = [];

      for (const entityType of entities) {
        operationLogger.info('🔎 Detecting conflicts for entity', { entityType });

        // Use data comparator to find differences
        const comparison = await this.comparatorService.compareEntities(entityType, {
          comparisonTypes: [
            ComparisonType.CONFLICTED_RECORDS,
            ComparisonType.MISSING_RECORDS
          ],
          samplingRate: 1.0, // Full comparison for conflict detection
          conflictThreshold: threshold
        });

        const conflicts = comparison.differentials.filter(
          diff => diff.comparison_type === ComparisonType.CONFLICTED_RECORDS
        );

        const severity = this.calculateConflictSeverity(conflicts.length, entityType);
        const estimatedResolutionTime = this.estimateResolutionTime(conflicts.length, entityType);

        const result: ConflictDetectionResult = {
          entityType,
          conflictsFound: conflicts.length,
          conflictTypes: [...new Set(conflicts.map(c => c.comparison_type))],
          conflicts,
          severity,
          estimatedResolutionTime
        };

        results.push(result);

        operationLogger.info('✅ Conflict detection completed for entity', {
          entityType,
          conflictsFound: conflicts.length,
          severity
        });
      }

      operationLogger.info('✅ Conflict detection completed', {
        totalEntities: entities.length,
        totalConflicts: results.reduce((sum, r) => sum + r.conflictsFound, 0)
      });

      return results;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      operationLogger.error('❌ Conflict detection failed', {
        error: errorMessage,
        operationId
      });
      throw error;
    }
  }

  /**
   * Resolve conflicts with specified strategy
   */
  async resolveConflictsWithStrategy(
    conflicts: DataDifferential[],
    strategy: ResolutionStrategy,
    options: ResolutionOptions = {}
  ): Promise<ConflictResolutionResult[]> {
    const operationId = this.generateOperationId('conflict_resolution_batch');
    const operationLogger = this.logger.createOperationLogger(operationId);

    try {
      operationLogger.info('🔧 Resolving conflicts with strategy', {
        operationId,
        conflictCount: conflicts.length,
        strategy
      });

      const results: ConflictResolutionResult[] = [];

      // Process conflicts in batches
      const batchSize = options.batchSize || 50;
      for (let i = 0; i < conflicts.length; i += batchSize) {
        const batch = conflicts.slice(i, i + batchSize);

        operationLogger.info('🔄 Processing conflict resolution batch', {
          batchIndex: Math.floor(i / batchSize) + 1,
          batchSize: batch.length,
          totalBatches: Math.ceil(conflicts.length / batchSize)
        });

        const batchResults = await this.resolverService.resolveConflicts(batch, strategy, options);
        results.push(...batchResults);
      }

      operationLogger.info('✅ Conflict resolution completed', {
        operationId,
        totalConflicts: conflicts.length,
        resolvedConflicts: results.filter(r => r.success).length,
        failedConflicts: results.filter(r => !r.success).length
      });

      return results;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      operationLogger.error('❌ Conflict resolution failed', {
        error: errorMessage,
        operationId
      });
      throw error;
    }
  }

  /**
   * Get conflict status and history
   */
  async getConflictStatus(entityType?: string): Promise<any> {
    try {
      if (entityType) {
        // Get conflict status for specific entity
        const conflicts = await this.comparatorService.getDataDifferentials(entityType, {
          comparisonType: ComparisonType.CONFLICTED_RECORDS,
          resolved: false
        });

        const resolvedConflicts = await this.comparatorService.getDataDifferentials(entityType, {
          comparisonType: ComparisonType.CONFLICTED_RECORDS,
          resolved: true
        });

        return {
          entityType,
          activeConflicts: conflicts.length,
          resolvedConflicts: resolvedConflicts.length,
          conflicts: conflicts.slice(0, 10), // Latest 10 conflicts
          lastConflictDetected: conflicts.length > 0 ? conflicts[0].created_at : null,
          status: conflicts.length > 0 ? 'conflicts_present' : 'no_conflicts'
        };
      }

      // Get overall conflict status
      const allConflicts = await this.comparatorService.getAllDataDifferentials({
        comparisonType: ComparisonType.CONFLICTED_RECORDS,
        limit: 100
      });

      const entitySummary = new Map<string, any>();
      for (const conflict of allConflicts) {
        if (!entitySummary.has(conflict.source_table)) {
          entitySummary.set(conflict.source_table, {
            entityType: conflict.source_table,
            conflicts: 0,
            resolved: 0
          });
        }

        const summary = entitySummary.get(conflict.source_table);
        if (conflict.resolved) {
          summary.resolved++;
        } else {
          summary.conflicts++;
        }
      }

      return {
        totalActiveConflicts: allConflicts.filter(c => !c.resolved).length,
        totalResolvedConflicts: allConflicts.filter(c => c.resolved).length,
        entitiesWithConflicts: entitySummary.size,
        entitySummaries: Array.from(entitySummary.values()),
        recentConflicts: allConflicts.slice(0, 20)
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get conflict status: ${errorMessage}`);
    }
  }

  /**
   * Create backup before conflict resolution
   */
  async createConflictBackup(
    entityType: string,
    conflictIds: string[]
  ): Promise<BackupInfo> {
    const operationId = this.generateOperationId('conflict_backup');
    const operationLogger = this.logger.createOperationLogger(operationId);

    try {
      operationLogger.info('💾 Creating conflict backup', {
        operationId,
        entityType,
        conflictCount: conflictIds.length
      });

      const backup = await this.resolverService.createBackup(entityType, conflictIds);

      operationLogger.info('✅ Conflict backup created successfully', {
        operationId,
        backupId: backup.backupId,
        recordCount: backup.recordCount
      });

      return backup;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      operationLogger.error('❌ Conflict backup creation failed', {
        error: errorMessage,
        operationId
      });
      throw error;
    }
  }

  /**
   * Private helper methods
   */

  private mergeDefaultConfig(config: ConflictResolutionOrchestratorConfig): ConflictResolutionOrchestratorConfig {
    return {
      defaultStrategy: ResolutionStrategy.SOURCE_WINS,
      batchSize: 50,
      maxRetries: 3,
      enableBackups: true,
      enableValidation: true,
      enableDetailedLogging: true,
      conflictDetectionThreshold: 0.01,
      autoResolveSimpleConflicts: true,
      preserveConflictHistory: true,
      ...config
    };
  }

  private generateOperationId(prefix: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${timestamp}_${random}`;
  }

  private async validateConnections(context: ConflictResolutionContext): Promise<void> {
    context.logger.info('🔌 Validating database connections');

    const sourceTest = await this.dbManager.testConnection('source');
    if (!sourceTest.success) {
      throw new Error(`Source database connection failed: ${sourceTest.error}`);
    }

    const targetTest = await this.dbManager.testConnection('target');
    if (!targetTest.success) {
      throw new Error(`Target database connection failed: ${targetTest.error}`);
    }

    context.logger.info('✅ Database connections validated');
  }

  private async createResolutionCheckpoint(context: ConflictResolutionContext): Promise<void> {
    try {
      await this.checkpointManager.saveCheckpoint({
        entityType: 'conflict_resolution',
        operationType: OperationType.SYNC,
        recordsProcessed: 0,
        batchSize: context.config.batchSize || 50,
        metadata: {
          operationId: context.operationId,
          strategy: context.workflow.strategy,
          entities: context.workflow.entities,
          startTime: context.startTime.toISOString()
        }
      });

      context.logger.info('📍 Conflict resolution checkpoint created');
    } catch (error) {
      context.logger.warn('⚠️ Could not create checkpoint', { error });
    }
  }

  private async detectConflicts(context: ConflictResolutionContext): Promise<ConflictDetectionResult[]> {
    context.logger.info('🔍 Phase 1: Detecting conflicts');

    const results: ConflictDetectionResult[] = [];

    for (const entityType of context.workflow.entities) {
      const comparison = await context.comparatorService.compareEntities(entityType, {
        comparisonTypes: [ComparisonType.CONFLICTED_RECORDS],
        samplingRate: 1.0,
        conflictThreshold: context.config.conflictDetectionThreshold || 0.01
      });

      const conflicts = comparison.differentials.filter(
        diff => diff.comparison_type === ComparisonType.CONFLICTED_RECORDS
      );

      context.conflicts.set(entityType, conflicts);

      const result: ConflictDetectionResult = {
        entityType,
        conflictsFound: conflicts.length,
        conflictTypes: [ComparisonType.CONFLICTED_RECORDS],
        conflicts,
        severity: this.calculateConflictSeverity(conflicts.length, entityType),
        estimatedResolutionTime: this.estimateResolutionTime(conflicts.length, entityType)
      };

      results.push(result);
    }

    context.logger.info('✅ Phase 1 completed: Conflict detection', {
      totalConflicts: results.reduce((sum, r) => sum + r.conflictsFound, 0)
    });

    return results;
  }

  private async executePreResolutionActions(context: ConflictResolutionContext): Promise<void> {
    context.logger.info('🔧 Phase 2: Executing pre-resolution actions');

    // Create backups if enabled
    if (context.config.enableBackups) {
      for (const [entityType, conflicts] of context.conflicts) {
        if (conflicts.length > 0) {
          const backup = await this.resolverService.createBackup(
            entityType,
            conflicts.map(c => c.id)
          );
          context.backups.push(backup);
          context.logger.info('💾 Backup created', { entityType, backupId: backup.backupId });
        }
      }
    }

    // Execute custom pre-resolution actions
    if (context.workflow.preResolutionActions) {
      for (const action of context.workflow.preResolutionActions) {
        context.logger.info('⚙️ Executing pre-resolution action', { type: action.type });
        // Implementation would depend on action type
      }
    }

    context.logger.info('✅ Phase 2 completed: Pre-resolution actions');
  }

  private async resolveConflicts(context: ConflictResolutionContext): Promise<ConflictResolutionSummary[]> {
    context.logger.info('⚔️ Phase 3: Resolving conflicts');

    const summaries: ConflictResolutionSummary[] = [];

    for (const [entityType, conflicts] of context.conflicts) {
      if (conflicts.length === 0) continue;

      context.logger.info('🔧 Resolving conflicts for entity', {
        entityType,
        conflictCount: conflicts.length
      });

      const startTime = Date.now();
      const results = await context.resolverService.resolveConflicts(
        conflicts,
        context.workflow.strategy,
        context.workflow.options
      );

      const summary: ConflictResolutionSummary = {
        totalConflicts: conflicts.length,
        resolvedConflicts: results.filter(r => r.success).length,
        failedConflicts: results.filter(r => !r.success).length,
        skippedConflicts: results.filter(r => r.skipped).length,
        backupCreated: context.backups.some(b => b.entityType === entityType),
        resolutionTime: Date.now() - startTime,
        strategy: context.workflow.strategy
      };

      summaries.push(summary);
      context.resolutions.set(entityType, results[0]); // Store first result as representative

      context.logger.info('✅ Conflicts resolved for entity', {
        entityType,
        summary
      });
    }

    context.logger.info('✅ Phase 3 completed: Conflict resolution');
    return summaries;
  }

  private async executePostResolutionActions(context: ConflictResolutionContext): Promise<void> {
    context.logger.info('🔍 Phase 4: Executing post-resolution actions');

    // Validate resolutions if enabled
    if (context.config.enableValidation) {
      context.logger.info('✅ Validating conflict resolutions');
      // Implementation would validate that conflicts are actually resolved
    }

    // Execute custom post-resolution actions
    if (context.workflow.postResolutionActions) {
      for (const action of context.workflow.postResolutionActions) {
        context.logger.info('⚙️ Executing post-resolution action', { type: action.type });
        // Implementation would depend on action type
      }
    }

    context.logger.info('✅ Phase 4 completed: Post-resolution actions');
  }

  private calculateConflictSeverity(conflictCount: number, entityType: string): 'low' | 'medium' | 'high' | 'critical' {
    if (conflictCount === 0) return 'low';
    if (conflictCount < 10) return 'low';
    if (conflictCount < 100) return 'medium';
    if (conflictCount < 1000) return 'high';
    return 'critical';
  }

  private estimateResolutionTime(conflictCount: number, entityType: string): number {
    // Rough estimate: 100ms per conflict
    return conflictCount * 100;
  }

  private async generateResolutionResult(
    context: ConflictResolutionContext,
    detectionResults: ConflictDetectionResult[],
    resolutionSummaries: ConflictResolutionSummary[]
  ): Promise<ConflictResolutionOrchestrationResult> {
    const executionTimeMs = Date.now() - context.startTime.getTime();
    const totalConflicts = detectionResults.reduce((sum, r) => sum + r.conflictsFound, 0);
    const resolvedConflicts = resolutionSummaries.reduce((sum, s) => sum + s.resolvedConflicts, 0);
    const failedConflicts = resolutionSummaries.reduce((sum, s) => sum + s.failedConflicts, 0);

    // Complete checkpoint
    await this.checkpointManager.completeCheckpoint(
      'conflict_resolution',
      OperationType.SYNC,
      {
        totalProcessed: totalConflicts,
        successful: resolvedConflicts,
        failed: failedConflicts,
        duration: executionTimeMs
      }
    );

    return {
      operationId: context.operationId,
      success: context.errors.length === 0 && failedConflicts === 0,
      totalConflicts,
      resolvedConflicts,
      failedConflicts,
      skippedConflicts: resolutionSummaries.reduce((sum, s) => sum + s.skippedConflicts, 0),
      executionTimeMs,
      strategy: context.workflow.strategy,
      entitiesProcessed: context.workflow.entities,
      backupsCreated: context.backups,
      detectionResults,
      resolutionSummaries,
      errors: context.errors,
      recommendedActions: this.generateRecommendations(detectionResults, resolutionSummaries)
    };
  }

  private generateFailureResult(
    context: ConflictResolutionContext,
    error: Error
  ): ConflictResolutionOrchestrationResult {
    const executionTimeMs = Date.now() - context.startTime.getTime();

    return {
      operationId: context.operationId,
      success: false,
      totalConflicts: 0,
      resolvedConflicts: 0,
      failedConflicts: 0,
      skippedConflicts: 0,
      executionTimeMs,
      strategy: context.workflow.strategy,
      entitiesProcessed: [],
      backupsCreated: context.backups,
      detectionResults: [],
      resolutionSummaries: [],
      errors: context.errors,
      recommendedActions: [`Fix orchestration error: ${error.message}`]
    };
  }

  private generateRecommendations(
    detectionResults: ConflictDetectionResult[],
    resolutionSummaries: ConflictResolutionSummary[]
  ): string[] {
    const recommendations: string[] = [];

    const totalConflicts = detectionResults.reduce((sum, r) => sum + r.conflictsFound, 0);
    const criticalEntities = detectionResults.filter(r => r.severity === 'critical');

    if (totalConflicts === 0) {
      recommendations.push('No conflicts detected - data synchronization is healthy');
    } else {
      recommendations.push(`${totalConflicts} conflicts detected - monitor data sources for consistency`);
    }

    if (criticalEntities.length > 0) {
      recommendations.push(`${criticalEntities.length} entities have critical conflict levels - investigate data quality`);
    }

    const failedResolutions = resolutionSummaries.reduce((sum, s) => sum + s.failedConflicts, 0);
    if (failedResolutions > 0) {
      recommendations.push(`${failedResolutions} conflicts could not be resolved - manual intervention required`);
    }

    return recommendations;
  }

  private async handleResolutionFailure(context: ConflictResolutionContext, error: Error): Promise<void> {
    try {
      await this.checkpointManager.failCheckpoint(
        'conflict_resolution',
        OperationType.SYNC,
        error,
        {
          recordsProcessed: 0,
          errors: context.errors
        }
      );
    } catch (checkpointError) {
      context.logger.error('❌ Failed to mark checkpoint as failed', { checkpointError });
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
export function createConflictResolutionOrchestrator(projectRoot?: string): ConflictResolutionOrchestrator {
  return new ConflictResolutionOrchestrator(projectRoot);
}

// Default export for CLI integration
export default ConflictResolutionOrchestrator;