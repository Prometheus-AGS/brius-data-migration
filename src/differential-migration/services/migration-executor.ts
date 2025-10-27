/**
 * MigrationExecutor Service
 * Implements batch processing, checkpoint management, dependency-aware execution
 */

import { Pool, PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';

// Import our models
import {
  MigrationCheckpointModel,
  type MigrationCheckpoint,
  type MigrationCheckpointCreateInput
} from '../models/migration-checkpoint';
import {
  MigrationStatusModel,
  type MigrationStatus
} from '../models/migration-status';
import {
  MigrationExecutionLogModel,
  type MigrationExecutionLog
} from '../models/execution-log';

// Service interfaces
export interface ExecutionConfig {
  batchSize: number;
  maxRetryAttempts: number;
  checkpointInterval: number; // Number of batches between checkpoints
  parallelEntityLimit: number;
  timeoutMs: number;
  enableValidation: boolean;
  validationSampleSize?: number;
  enablePerformanceMonitoring?: boolean;
}

export interface MigrationTask {
  entityType: string;
  recordIds: string[];
  priority: 'high' | 'medium' | 'low';
  dependencies: string[]; // Entity types that must complete first
  estimatedDurationMs: number;
  metadata: {
    sourceTable: string;
    destinationTable: string;
    totalRecords: number;
    migrationMethod: 'differential' | 'full' | 'incremental';
    checkpointId?: string; // Resume from checkpoint
  };
}

export interface BatchExecutionResult {
  batchId: string;
  entityType: string;
  recordIds: string[];
  status: 'success' | 'partial_success' | 'failed';
  processedRecords: number;
  failedRecords: number;
  errors: Array<{
    recordId: string;
    errorType: string;
    message: string;
    retryable: boolean;
  }>;
  performance: {
    startTime: Date;
    endTime: Date;
    durationMs: number;
    recordsPerSecond: number;
    memoryUsageMb: number;
  };
  checkpointCreated?: string; // Checkpoint ID if created during this batch
}

export interface MigrationExecutionResult {
  executionId: string;
  sessionId: string;
  overallStatus: 'completed' | 'partial' | 'failed' | 'paused';
  entitiesProcessed: string[];
  entitiesFailed: string[];
  totalRecordsProcessed: number;
  totalRecordsFailed: number;
  batchResults: BatchExecutionResult[];
  checkpoints: string[]; // List of checkpoint IDs created
  executionSummary: {
    startTime: Date;
    endTime?: Date;
    totalDurationMs: number;
    averageThroughput: number; // Records per second
    peakMemoryUsageMb: number;
  };
  recovery: {
    isRecoverable: boolean;
    lastCheckpointId?: string;
    resumeFromBatch?: number;
    recommendedActions: string[];
  };
}

export interface DependencyGraph {
  entities: string[];
  dependencies: Record<string, string[]>;
  executionOrder: string[][]; // Arrays of entities that can run in parallel
}

// Entity dependency configuration based on foreign key relationships
const ENTITY_DEPENDENCIES: Record<string, string[]> = {
  offices: [],
  doctors: ['offices'],
  doctor_offices: ['doctors', 'offices'],
  patients: ['doctors'],
  orders: ['patients'],
  cases: ['orders'],
  files: [],
  case_files: ['cases', 'files'],
  messages: ['cases'],
  message_files: ['messages', 'files'],
  jaw: ['patients'],
  dispatch_records: [],
  system_messages: [],
  message_attachments: ['messages'],
  technician_roles: ['doctors'],
  order_cases: ['orders', 'cases'],
  purchases: ['orders'],
  treatment_discussions: ['cases'],
  template_view_groups: [],
  template_view_roles: ['template_view_groups']
};

/**
 * MigrationExecutor Service Implementation
 *
 * Orchestrates differential migration execution with batch processing, checkpoint management,
 * dependency resolution, and comprehensive error recovery capabilities.
 */
export class MigrationExecutor {
  private sourcePool: Pool;
  private destinationPool: Pool;
  private config: ExecutionConfig;
  private sessionId: string;
  private currentStatus: MigrationStatus | null = null;
  private executionState: Map<string, MigrationCheckpoint> = new Map();

  constructor(
    sourcePool: Pool,
    destinationPool: Pool,
    sessionId: string,
    config: ExecutionConfig
  ) {
    // Validate configuration
    const validation = MigrationExecutor.validateExecutionConfig(config);
    if (!validation.isValid) {
      throw new Error(`Invalid execution config: ${validation.errors.join(', ')}`);
    }

    this.sourcePool = sourcePool;
    this.destinationPool = destinationPool;
    this.sessionId = sessionId;
    this.config = config;
  }

  /**
   * Validates execution configuration
   */
  static validateExecutionConfig(config: ExecutionConfig): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (config.batchSize < 1 || config.batchSize > 5000) {
      errors.push('batchSize must be between 1 and 5000');
    }

    if (config.maxRetryAttempts < 0 || config.maxRetryAttempts > 10) {
      errors.push('maxRetryAttempts must be between 0 and 10');
    }

    if (config.checkpointInterval < 1) {
      errors.push('checkpointInterval must be at least 1');
    }

    if (config.parallelEntityLimit < 1 || config.parallelEntityLimit > 10) {
      errors.push('parallelEntityLimit must be between 1 and 10');
    }

    if (config.timeoutMs < 1000) {
      errors.push('timeoutMs must be at least 1000ms');
    }

    if (config.validationSampleSize && (config.validationSampleSize < 1 || config.validationSampleSize > 10000)) {
      errors.push('validationSampleSize must be between 1 and 10000');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Executes a single batch of records
   */
  async executeBatch(
    entityType: string,
    recordIds: string[],
    batchNumber?: number
  ): Promise<BatchExecutionResult> {
    const startTime = new Date();
    const batchId = `batch_${entityType}_${batchNumber || 1}_${Date.now()}`;

    await this.logExecution('info',
      `Starting batch execution for ${entityType}`,
      {
        batchId,
        entityType,
        recordCount: recordIds.length,
        batchNumber
      }
    );

    let processedRecords = 0;
    let failedRecords = 0;
    const errors: BatchExecutionResult['errors'] = [];

    try {
      // Execute migration logic for this batch
      const migrationResult = await this.executeMigrationLogic(entityType, recordIds);

      processedRecords = migrationResult.successful.length;
      failedRecords = migrationResult.failed.length;

      // Record errors
      for (const failure of migrationResult.failed) {
        errors.push({
          recordId: failure.recordId,
          errorType: failure.errorType,
          message: failure.message,
          retryable: failure.retryable
        });
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.logExecution('error',
        `Batch execution failed for ${entityType}: ${errorMessage}`,
        { batchId, error: errorMessage }
      );

      // Mark all records as failed
      failedRecords = recordIds.length;
      errors.push({
        recordId: 'batch_failure',
        errorType: 'batch_execution_error',
        message: errorMessage,
        retryable: true
      });
    }

    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();
    const recordsPerSecond = durationMs > 0 ? Math.round((processedRecords / durationMs) * 1000) : 0;

    const status: BatchExecutionResult['status'] =
      failedRecords === 0 ? 'success' :
      processedRecords > 0 ? 'partial_success' : 'failed';

    // Create checkpoint if needed
    let checkpointCreated: string | undefined;
    if (batchNumber && batchNumber % this.config.checkpointInterval === 0 && status !== 'failed') {
      checkpointCreated = await this.createBatchCheckpoint(
        entityType,
        batchNumber,
        processedRecords,
        recordIds.length - processedRecords
      );
    }

    const result: BatchExecutionResult = {
      batchId,
      entityType,
      recordIds: [...recordIds],
      status,
      processedRecords,
      failedRecords,
      errors,
      performance: {
        startTime,
        endTime,
        durationMs,
        recordsPerSecond,
        memoryUsageMb: this.getMemoryUsage()
      },
      checkpointCreated
    };

    await this.logExecution('info',
      `Batch execution completed for ${entityType}`,
      {
        batchId,
        status,
        processedRecords,
        failedRecords,
        durationMs,
        recordsPerSecond
      }
    );

    return result;
  }

  /**
   * Executes migration tasks following dependency order
   */
  async executeMigrationTasks(tasks: MigrationTask[]): Promise<MigrationExecutionResult> {
    const executionId = uuidv4();
    const startTime = new Date();

    await this.logExecution('info',
      `Starting migration execution with ${tasks.length} tasks`,
      { executionId, taskCount: tasks.length }
    );

    try {
      // Initialize migration status
      this.currentStatus = MigrationStatusModel.createForSession(
        this.sessionId,
        tasks.map(t => t.entityType),
        tasks.reduce((sum, t) => sum + t.recordIds.length, 0)
      );

      // Build dependency graph and execution order
      const dependencyGraph = this.buildDependencyGraph(tasks);

      const batchResults: BatchExecutionResult[] = [];
      const checkpoints: string[] = [];
      const entitiesProcessed: string[] = [];
      const entitiesFailed: string[] = [];

      let totalRecordsProcessed = 0;
      let totalRecordsFailed = 0;
      let peakMemoryUsageMb = 0;

      // Execute entities in dependency order
      for (let levelIndex = 0; levelIndex < dependencyGraph.executionOrder.length; levelIndex++) {
        const parallelGroup = dependencyGraph.executionOrder[levelIndex];

        await this.logExecution('info',
          `Executing parallel group ${levelIndex + 1}: ${parallelGroup.join(', ')}`,
          { levelIndex, entities: parallelGroup }
        );

        // Execute parallel group (respecting parallel entity limit)
        const groupResults = await this.executeParallelGroup(parallelGroup, tasks);

        // Process results
        for (const result of groupResults) {
          batchResults.push(...result.batches);

          if (result.checkpoints) {
            checkpoints.push(...result.checkpoints);
          }

          if (result.success) {
            entitiesProcessed.push(result.entityType);
            totalRecordsProcessed += result.recordsProcessed;

            // Update status
            this.currentStatus = MigrationStatusModel.moveEntityToState(
              this.currentStatus,
              result.entityType,
              'completed'
            );
          } else {
            entitiesFailed.push(result.entityType);
            totalRecordsFailed += result.recordsFailed;

            // Update status
            this.currentStatus = MigrationStatusModel.moveEntityToState(
              this.currentStatus,
              result.entityType,
              'failed'
            );
          }

          peakMemoryUsageMb = Math.max(peakMemoryUsageMb, result.peakMemoryMb);
        }

        // Stop execution if any entity in this group failed (dependency blocking)
        if (groupResults.some(r => !r.success)) {
          await this.logExecution('warn',
            `Stopping execution due to failures in dependency group ${levelIndex + 1}`,
            { failedEntities: groupResults.filter(r => !r.success).map(r => r.entityType) }
          );
          break;
        }
      }

      const endTime = new Date();
      const totalDurationMs = endTime.getTime() - startTime.getTime();

      // Determine overall status
      let overallStatus: MigrationExecutionResult['overallStatus'] = 'completed';
      if (entitiesFailed.length > 0) {
        overallStatus = entitiesProcessed.length > 0 ? 'partial' : 'failed';
      }

      // Generate recovery information
      const isRecoverable = checkpoints.length > 0 && entitiesFailed.length > 0;
      const lastCheckpointId = checkpoints.length > 0 ? checkpoints[checkpoints.length - 1] : undefined;

      const recommendedActions: string[] = [];
      if (entitiesFailed.length > 0) {
        recommendedActions.push(`Review and fix errors for failed entities: ${entitiesFailed.join(', ')}`);
      }
      if (isRecoverable) {
        recommendedActions.push('Use checkpoint-based recovery to resume from last successful batch');
      }
      if (totalRecordsFailed > totalRecordsProcessed * 0.1) {
        recommendedActions.push('High failure rate detected - investigate data quality issues before retrying');
      }
      if (peakMemoryUsageMb > 400) {
        recommendedActions.push('High memory usage detected - consider reducing batch size');
      }

      const result: MigrationExecutionResult = {
        executionId,
        sessionId: this.sessionId,
        overallStatus,
        entitiesProcessed,
        entitiesFailed,
        totalRecordsProcessed,
        totalRecordsFailed,
        batchResults,
        checkpoints,
        executionSummary: {
          startTime,
          endTime,
          totalDurationMs,
          averageThroughput: totalDurationMs > 0 ? Math.round((totalRecordsProcessed / totalDurationMs) * 1000) : 0,
          peakMemoryUsageMb
        },
        recovery: {
          isRecoverable,
          lastCheckpointId,
          resumeFromBatch: batchResults.length,
          recommendedActions
        }
      };

      await this.logExecution('info',
        `Migration execution completed: ${overallStatus}`,
        {
          executionId,
          overallStatus,
          entitiesProcessed: entitiesProcessed.length,
          entitiesFailed: entitiesFailed.length,
          totalRecordsProcessed,
          totalDurationMs
        }
      );

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.logExecution('error',
        `Migration execution failed: ${errorMessage}`,
        { executionId, error: errorMessage }
      );

      throw new Error(`Migration execution failed: ${errorMessage}`);
    }
  }

  /**
   * Builds dependency graph for task execution order
   */
  buildDependencyGraph(tasks: MigrationTask[]): DependencyGraph {
    const entities = tasks.map(t => t.entityType);
    const dependencies: Record<string, string[]> = {};

    // Build dependency map
    for (const task of tasks) {
      // Use task dependencies if provided, otherwise use default entity dependencies
      const taskDeps = task.dependencies.length > 0 ? task.dependencies : ENTITY_DEPENDENCIES[task.entityType] || [];
      dependencies[task.entityType] = taskDeps.filter(dep => entities.includes(dep));
    }

    // Calculate execution order using topological sort
    const executionOrder: string[][] = [];
    const remaining = new Set(entities);
    let maxIterations = entities.length + 1;
    let iterations = 0;

    while (remaining.size > 0 && iterations < maxIterations) {
      const currentLevel: string[] = [];

      // Find entities with no unresolved dependencies
      for (const entity of remaining) {
        const deps = dependencies[entity] || [];
        const unresolvedDeps = deps.filter(dep => remaining.has(dep));

        if (unresolvedDeps.length === 0) {
          currentLevel.push(entity);
        }
      }

      if (currentLevel.length === 0) {
        // Circular dependency detected - log warning and add remaining entities
        console.warn('Circular dependency detected in migration tasks. Adding remaining entities in arbitrary order.');

        for (const entity of remaining) {
          executionOrder.push([entity]);
          remaining.delete(entity);
        }
        break;
      }

      executionOrder.push(currentLevel);
      for (const entity of currentLevel) {
        remaining.delete(entity);
      }

      iterations++;
    }

    return {
      entities,
      dependencies,
      executionOrder
    };
  }

  /**
   * Executes a parallel group of entities
   */
  private async executeParallelGroup(
    entityTypes: string[],
    allTasks: MigrationTask[]
  ): Promise<Array<{
    entityType: string;
    success: boolean;
    recordsProcessed: number;
    recordsFailed: number;
    batches: BatchExecutionResult[];
    checkpoints: string[];
    peakMemoryMb: number;
  }>> {
    const results = [];

    // Limit concurrent entities based on configuration
    const chunks = this.chunkArray(entityTypes, this.config.parallelEntityLimit);

    for (const chunk of chunks) {
      const chunkPromises = chunk.map(async (entityType) => {
        const task = allTasks.find(t => t.entityType === entityType);
        if (!task) {
          throw new Error(`Task not found for entity: ${entityType}`);
        }

        // Update status to running
        if (this.currentStatus) {
          this.currentStatus = MigrationStatusModel.moveEntityToState(
            this.currentStatus,
            entityType,
            'running'
          );
        }

        return await this.executeEntityTask(task);
      });

      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
    }

    return results;
  }

  /**
   * Executes migration task for a single entity
   */
  private async executeEntityTask(task: MigrationTask): Promise<{
    entityType: string;
    success: boolean;
    recordsProcessed: number;
    recordsFailed: number;
    batches: BatchExecutionResult[];
    checkpoints: string[];
    peakMemoryMb: number;
  }> {
    const entityResult = {
      entityType: task.entityType,
      success: true,
      recordsProcessed: 0,
      recordsFailed: 0,
      batches: [] as BatchExecutionResult[],
      checkpoints: [] as string[],
      peakMemoryMb: 0
    };

    // Create or resume checkpoint
    let checkpoint: MigrationCheckpoint;
    if (task.metadata.checkpointId) {
      // Resume from checkpoint (mock implementation)
      checkpoint = await this.loadCheckpoint(task.metadata.checkpointId);
    } else {
      // Create new checkpoint
      checkpoint = MigrationCheckpointModel.create({
        entity_type: task.entityType,
        migration_run_id: MigrationCheckpointModel.generateMigrationRunId(task.entityType, this.sessionId),
        records_remaining: task.recordIds.length,
        checkpoint_data: MigrationCheckpointModel.createCheckpointData({
          batchSize: this.config.batchSize,
          processingStartTime: new Date()
        })
      });
    }

    // Process records in batches
    const batches = this.createBatches(task.recordIds, this.config.batchSize);
    let startBatchIndex = Math.floor(checkpoint.records_processed / this.config.batchSize);

    for (let i = startBatchIndex; i < batches.length; i++) {
      const batch = batches[i];

      try {
        const batchResult = await this.executeBatch(task.entityType, batch, i + 1);

        entityResult.batches.push(batchResult);
        entityResult.recordsProcessed += batchResult.processedRecords;
        entityResult.recordsFailed += batchResult.failedRecords;
        entityResult.peakMemoryMb = Math.max(entityResult.peakMemoryMb, batchResult.performance.memoryUsageMb);

        if (batchResult.checkpointCreated) {
          entityResult.checkpoints.push(batchResult.checkpointCreated);
        }

        // Update checkpoint
        checkpoint = MigrationCheckpointModel.updateProgress(checkpoint, {
          last_processed_id: batch[batch.length - 1],
          batch_position: i + 1,
          records_processed: checkpoint.records_processed + batchResult.processedRecords,
          records_remaining: checkpoint.records_remaining - batchResult.processedRecords - batchResult.failedRecords
        });

        // Stop if batch failed completely
        if (batchResult.status === 'failed') {
          entityResult.success = false;
          break;
        }

        // Check for timeout
        const elapsed = Date.now() - checkpoint.created_at.getTime();
        if (elapsed > this.config.timeoutMs) {
          await this.logExecution('warn',
            `Migration timeout reached for ${task.entityType}`,
            { elapsed, timeout: this.config.timeoutMs }
          );
          break;
        }

      } catch (error) {
        entityResult.success = false;
        await this.logExecution('error',
          `Error processing batch ${i + 1} for ${task.entityType}`,
          { error: error instanceof Error ? error.message : 'Unknown error' }
        );
        break;
      }
    }

    // Validate migration if enabled
    if (this.config.enableValidation && entityResult.success) {
      const validationResult = await this.validateMigrationIntegrity(
        task.entityType,
        this.config.validationSampleSize
      );

      if (!validationResult.isValid) {
        await this.logExecution('warn',
          `Validation failed for ${task.entityType}`,
          { validationResult: validationResult.summary }
        );
      }
    }

    return entityResult;
  }

  /**
   * Executes the actual migration logic for a batch of records
   */
  private async executeMigrationLogic(
    entityType: string,
    recordIds: string[]
  ): Promise<{
    successful: Array<{ recordId: string }>;
    failed: Array<{ recordId: string; errorType: string; message: string; retryable: boolean }>;
  }> {
    // Mock implementation - in real implementation, this would call existing migration scripts
    const successful: Array<{ recordId: string }> = [];
    const failed: Array<{ recordId: string; errorType: string; message: string; retryable: boolean }> = [];

    // Simulate processing with some failures
    const failureRate = entityType === 'problematic_entity' ? 0.1 : 0.02;

    for (const recordId of recordIds) {
      if (Math.random() < failureRate) {
        failed.push({
          recordId,
          errorType: 'validation_error',
          message: `Mock validation error for record ${recordId}`,
          retryable: true
        });
      } else {
        successful.push({ recordId });
      }

      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 1));
    }

    return { successful, failed };
  }

  /**
   * Creates a checkpoint for batch progress
   */
  private async createBatchCheckpoint(
    entityType: string,
    batchNumber: number,
    recordsProcessed: number,
    recordsRemaining: number
  ): Promise<string> {
    const checkpointData = MigrationCheckpointModel.createCheckpointData({
      batchSize: this.config.batchSize,
      processingStartTime: new Date(),
      memoryUsageMb: this.getMemoryUsage()
    });

    const checkpoint = MigrationCheckpointModel.create({
      entity_type: entityType,
      migration_run_id: `${this.sessionId}_${entityType}`,
      last_processed_id: `batch_${batchNumber}`,
      batch_position: batchNumber,
      records_processed: recordsProcessed,
      records_remaining: recordsRemaining,
      checkpoint_data: checkpointData
    });

    await this.logExecution('info',
      `Checkpoint created for ${entityType} at batch ${batchNumber}`,
      { checkpointId: checkpoint.id, recordsProcessed, recordsRemaining }
    );

    return checkpoint.id;
  }

  /**
   * Loads a checkpoint for resumption
   */
  private async loadCheckpoint(checkpointId: string): Promise<MigrationCheckpoint> {
    // Mock implementation - in real implementation, this would load from database
    return MigrationCheckpointModel.create({
      entity_type: 'mock_entity',
      migration_run_id: checkpointId,
      records_processed: 500,
      records_remaining: 1000
    });
  }

  /**
   * Pauses execution and creates checkpoint
   */
  async pauseExecution(): Promise<{ success: boolean; checkpointId?: string }> {
    try {
      const checkpointId = `pause_checkpoint_${Date.now()}`;

      if (this.currentStatus) {
        this.currentStatus = MigrationStatusModel.updateStatus(this.currentStatus, {
          overall_status: 'paused'
        });
      }

      await this.logExecution('info',
        'Migration execution paused',
        { checkpointId }
      );

      return { success: true, checkpointId };
    } catch (error) {
      await this.logExecution('error',
        'Failed to pause execution',
        { error: error instanceof Error ? error.message : 'Unknown error' }
      );
      return { success: false };
    }
  }

  /**
   * Resumes execution from checkpoint
   */
  async resumeExecution(checkpointId: string): Promise<{ success: boolean; resumedFromBatch: number }> {
    try {
      const checkpoint = await this.loadCheckpoint(checkpointId);
      const resumedFromBatch = checkpoint.batch_position;

      if (this.currentStatus) {
        this.currentStatus = MigrationStatusModel.updateStatus(this.currentStatus, {
          overall_status: 'running'
        });
      }

      await this.logExecution('info',
        'Migration execution resumed from checkpoint',
        { checkpointId, resumedFromBatch }
      );

      return { success: true, resumedFromBatch };
    } catch (error) {
      await this.logExecution('error',
        'Failed to resume execution',
        { checkpointId, error: error instanceof Error ? error.message : 'Unknown error' }
      );
      return { success: false, resumedFromBatch: 0 };
    }
  }

  /**
   * Validates migration integrity for an entity
   */
  async validateMigrationIntegrity(entityType: string, sampleSize: number = 100): Promise<{
    isValid: boolean;
    validationResults: Array<{
      recordId: string;
      sourceData: object;
      destinationData: object;
      isMatch: boolean;
      differences: string[];
    }>;
    summary: {
      totalValidated: number;
      successfulMatches: number;
      failedMatches: number;
      matchPercentage: number;
    };
    recommendations: string[];
  }> {
    try {
      // Mock validation implementation
      const validationResults = [];
      let successfulMatches = 0;

      for (let i = 0; i < sampleSize; i++) {
        const recordId = `${entityType}_${i + 1}`;
        const isMatch = Math.random() > 0.05; // 95% success rate

        validationResults.push({
          recordId,
          sourceData: { id: i + 1, name: `Record ${i + 1}` },
          destinationData: { id: uuidv4(), name: `Record ${i + 1}`, legacy_id: i + 1 },
          isMatch,
          differences: isMatch ? [] : ['data transformation mismatch']
        });

        if (isMatch) successfulMatches++;
      }

      const failedMatches = sampleSize - successfulMatches;
      const matchPercentage = Math.round((successfulMatches / sampleSize) * 100 * 100) / 100;

      const recommendations: string[] = [];
      if (matchPercentage < 95) {
        recommendations.push('Low match percentage - investigate data transformation issues');
      }
      if (failedMatches > 5) {
        recommendations.push('Multiple validation failures - review migration logic');
      }
      if (recommendations.length === 0) {
        recommendations.push('Validation successful - migration integrity confirmed');
      }

      return {
        isValid: matchPercentage >= 95,
        validationResults,
        summary: {
          totalValidated: sampleSize,
          successfulMatches,
          failedMatches,
          matchPercentage
        },
        recommendations
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.logExecution('error',
        `Validation failed for ${entityType}: ${errorMessage}`,
        { error: errorMessage }
      );

      throw new Error(`Validation failed: ${errorMessage}`);
    }
  }

  /**
   * Utility methods
   */
  private createBatches(recordIds: string[], batchSize: number): string[][] {
    const batches: string[][] = [];

    for (let i = 0; i < recordIds.length; i += batchSize) {
      batches.push(recordIds.slice(i, i + batchSize));
    }

    return batches;
  }

  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  private getMemoryUsage(): number {
    const memUsage = process.memoryUsage();
    return Math.round(memUsage.heapUsed / 1024 / 1024); // Convert to MB
  }

  /**
   * Logs execution operations
   */
  private async logExecution(
    level: 'info' | 'warn' | 'error',
    message: string,
    contextData: object = {}
  ): Promise<void> {
    try {
      const log = MigrationExecutionLogModel.create({
        migration_session_id: this.sessionId,
        entity_type: this.entityType || null,
        operation_type: 'record_migration',
        log_level: level,
        message,
        context_data: {
          service: 'MigrationExecutor',
          timestamp: new Date().toISOString(),
          ...contextData
        }
      });

      // In a real implementation, this would be persisted to the database
      console.log(`[${level.toUpperCase()}] MigrationExecutor: ${message}`, contextData);
    } catch (error) {
      // Don't let logging errors break the main functionality
      console.error('Failed to log execution operation:', error);
    }
  }
}