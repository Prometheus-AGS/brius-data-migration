/**
 * Unit Tests: MigrationExecutor Service
 * Tests batch processing, dependency ordering, checkpoint creation, error handling
 */

import { diffMigrationTestUtils } from '../../setup';

// Import the service interfaces (will be implemented after tests)
interface ExecutionConfig {
  batchSize: number;
  maxRetryAttempts: number;
  checkpointInterval: number; // Number of batches between checkpoints
  parallelEntityLimit: number;
  timeoutMs: number;
  enableValidation: boolean;
}

interface MigrationTask {
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
  };
}

interface BatchExecutionResult {
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

interface MigrationExecutionResult {
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

interface DependencyGraph {
  entities: string[];
  dependencies: Record<string, string[]>;
  executionOrder: string[][]; // Arrays of entities that can run in parallel
}

// Mock implementation for testing (will be replaced with actual implementation)
class MockMigrationExecutor {
  private config: ExecutionConfig;
  private sessionId: string;

  constructor(sessionId: string, config: ExecutionConfig) {
    this.sessionId = sessionId;
    this.config = config;
  }

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

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  async executeBatch(
    entityType: string,
    recordIds: string[],
    batchNumber?: number
  ): Promise<BatchExecutionResult> {
    const startTime = new Date();
    const batchId = `batch_${entityType}_${batchNumber || 1}_${Date.now()}`;

    // Simulate processing time based on batch size
    const processingTimeMs = Math.min(recordIds.length * 10, this.config.timeoutMs);
    await new Promise(resolve => setTimeout(resolve, 1)); // Mock async processing

    // Mock some failures for testing
    const failureRate = entityType === 'problematic_entity' ? 0.1 : 0.02;
    const failedCount = Math.floor(recordIds.length * failureRate);
    const processedCount = recordIds.length - failedCount;

    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();

    const errors = [];
    for (let i = 0; i < failedCount; i++) {
      errors.push({
        recordId: recordIds[recordIds.length - 1 - i],
        errorType: 'validation_error',
        message: 'Mock validation error for testing',
        retryable: true
      });
    }

    const status = failedCount === 0 ? 'success' :
                  processedCount > 0 ? 'partial_success' : 'failed';

    // Create checkpoint if interval reached
    let checkpointCreated: string | undefined;
    if (batchNumber && batchNumber % this.config.checkpointInterval === 0) {
      checkpointCreated = `checkpoint_${entityType}_${batchNumber}_${Date.now()}`;
    }

    return {
      batchId,
      entityType,
      recordIds: [...recordIds],
      status,
      processedRecords: processedCount,
      failedRecords: failedCount,
      errors,
      performance: {
        startTime,
        endTime,
        durationMs,
        recordsPerSecond: durationMs > 0 ? Math.round((processedCount / durationMs) * 1000) : 0,
        memoryUsageMb: Math.random() * 100 + 50 // Mock memory usage
      },
      checkpointCreated
    };
  }

  async executeMigrationTasks(tasks: MigrationTask[]): Promise<MigrationExecutionResult> {
    const executionId = diffMigrationTestUtils.generateTestUUID();
    const startTime = new Date();

    // Build and validate dependency graph
    const dependencyGraph = this.buildDependencyGraph(tasks);

    const batchResults: BatchExecutionResult[] = [];
    const checkpoints: string[] = [];
    const entitiesProcessed: string[] = [];
    const entitiesFailed: string[] = [];

    let totalRecordsProcessed = 0;
    let totalRecordsFailed = 0;
    let peakMemoryUsageMb = 0;

    // Execute entities according to dependency order
    for (const parallelGroup of dependencyGraph.executionOrder) {
      const groupResults = await this.executeParallelGroup(parallelGroup, tasks);

      for (const result of groupResults) {
        batchResults.push(...result.batches);

        if (result.checkpoints) {
          checkpoints.push(...result.checkpoints);
        }

        if (result.success) {
          entitiesProcessed.push(result.entityType);
          totalRecordsProcessed += result.recordsProcessed;
        } else {
          entitiesFailed.push(result.entityType);
          totalRecordsFailed += result.recordsFailed;
        }

        peakMemoryUsageMb = Math.max(peakMemoryUsageMb, result.peakMemoryMb);
      }
    }

    const endTime = new Date();
    const totalDurationMs = endTime.getTime() - startTime.getTime();

    // Determine overall status
    let overallStatus: 'completed' | 'partial' | 'failed' | 'paused' = 'completed';
    if (entitiesFailed.length > 0) {
      overallStatus = entitiesProcessed.length > 0 ? 'partial' : 'failed';
    }

    // Recovery information
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
      recommendedActions.push('High failure rate detected - investigate data quality issues');
    }

    return {
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
  }

  private async executeParallelGroup(entityTypes: string[], allTasks: MigrationTask[]): Promise<Array<{
    entityType: string;
    success: boolean;
    recordsProcessed: number;
    recordsFailed: number;
    batches: BatchExecutionResult[];
    checkpoints: string[];
    peakMemoryMb: number;
  }>> {
    const results = [];

    for (const entityType of entityTypes) {
      const task = allTasks.find(t => t.entityType === entityType);
      if (!task) continue;

      const entityResult = {
        entityType,
        success: true,
        recordsProcessed: 0,
        recordsFailed: 0,
        batches: [] as BatchExecutionResult[],
        checkpoints: [] as string[],
        peakMemoryMb: 0
      };

      // Process task in batches
      const batches = this.createBatches(task.recordIds, this.config.batchSize);

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchResult = await this.executeBatch(entityType, batch, i + 1);

        entityResult.batches.push(batchResult);
        entityResult.recordsProcessed += batchResult.processedRecords;
        entityResult.recordsFailed += batchResult.failedRecords;
        entityResult.peakMemoryMb = Math.max(entityResult.peakMemoryMb, batchResult.performance.memoryUsageMb);

        if (batchResult.checkpointCreated) {
          entityResult.checkpoints.push(batchResult.checkpointCreated);
        }

        if (batchResult.status === 'failed') {
          entityResult.success = false;
          break; // Stop processing this entity on failure
        }
      }

      results.push(entityResult);
    }

    return results;
  }

  buildDependencyGraph(tasks: MigrationTask[]): DependencyGraph {
    const entities = tasks.map(t => t.entityType);
    const dependencies: Record<string, string[]> = {};

    // Build dependency map
    for (const task of tasks) {
      dependencies[task.entityType] = task.dependencies.filter(dep => entities.includes(dep));
    }

    // Calculate execution order using topological sort
    const executionOrder: string[][] = [];
    const remaining = new Set(entities);

    while (remaining.size > 0) {
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
        // Circular dependency detected - add all remaining as separate levels
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
    }

    return {
      entities,
      dependencies,
      executionOrder
    };
  }

  private createBatches(recordIds: string[], batchSize: number): string[][] {
    const batches: string[][] = [];

    for (let i = 0; i < recordIds.length; i += batchSize) {
      batches.push(recordIds.slice(i, i + batchSize));
    }

    return batches;
  }

  async pauseExecution(): Promise<{ success: boolean; checkpointId?: string }> {
    // Mock pause implementation
    return {
      success: true,
      checkpointId: `pause_checkpoint_${Date.now()}`
    };
  }

  async resumeExecution(checkpointId: string): Promise<{ success: boolean; resumedFromBatch: number }> {
    // Mock resume implementation
    return {
      success: true,
      resumedFromBatch: 10 // Mock batch number
    };
  }

  async validateMigrationIntegrity(entityType: string, sampleSize?: number): Promise<{
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
    const actualSampleSize = sampleSize || 100;
    const validationResults = [];

    // Mock validation for sample records
    for (let i = 0; i < actualSampleSize; i++) {
      const recordId = `${entityType}_${i + 1}`;
      const isMatch = Math.random() > 0.05; // 95% success rate

      validationResults.push({
        recordId,
        sourceData: { id: i + 1, name: `Record ${i + 1}` },
        destinationData: { id: i + 1, name: `Record ${i + 1}`, legacy_id: i + 1 },
        isMatch,
        differences: isMatch ? [] : ['name format mismatch']
      });
    }

    const successfulMatches = validationResults.filter(r => r.isMatch).length;
    const failedMatches = actualSampleSize - successfulMatches;
    const matchPercentage = Math.round((successfulMatches / actualSampleSize) * 100 * 100) / 100;

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
        totalValidated: actualSampleSize,
        successfulMatches,
        failedMatches,
        matchPercentage
      },
      recommendations
    };
  }
}

describe('MigrationExecutor Service', () => {
  let executor: MockMigrationExecutor;
  const sessionId = diffMigrationTestUtils.generateTestUUID();

  const mockConfig: ExecutionConfig = {
    batchSize: 1000,
    maxRetryAttempts: 3,
    checkpointInterval: 5,
    parallelEntityLimit: 3,
    timeoutMs: 30000,
    enableValidation: true
  };

  beforeEach(() => {
    executor = new MockMigrationExecutor(sessionId, mockConfig);
  });

  describe('Configuration Validation', () => {
    test('should validate correct execution configuration', () => {
      const validation = MockMigrationExecutor.validateExecutionConfig(mockConfig);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should fail validation for invalid batch size', () => {
      const invalidConfig = {
        ...mockConfig,
        batchSize: 10000
      };

      const validation = MockMigrationExecutor.validateExecutionConfig(invalidConfig);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('batchSize must be between 1 and 5000');
    });

    test('should fail validation for invalid retry attempts', () => {
      const invalidConfig = {
        ...mockConfig,
        maxRetryAttempts: 15
      };

      const validation = MockMigrationExecutor.validateExecutionConfig(invalidConfig);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('maxRetryAttempts must be between 0 and 10');
    });

    test('should fail validation for invalid timeout', () => {
      const invalidConfig = {
        ...mockConfig,
        timeoutMs: 500
      };

      const validation = MockMigrationExecutor.validateExecutionConfig(invalidConfig);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('timeoutMs must be at least 1000ms');
    });
  });

  describe('Batch Execution', () => {
    test('should execute batch successfully', async () => {
      const recordIds = Array.from({ length: 100 }, (_, i) => `record-${i + 1}`);

      const result = await executor.executeBatch('doctors', recordIds, 1);

      expect(result).toBeDefined();
      expect(result.batchId).toMatch(/^batch_doctors_1_/);
      expect(result.entityType).toBe('doctors');
      expect(result.recordIds).toEqual(recordIds);
      expect(result.status).toMatch(/^(success|partial_success)$/);
      expect(result.processedRecords).toBeGreaterThan(0);
      expect(result.performance).toBeDefined();
      expect(result.performance.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('should handle batch failures gracefully', async () => {
      const recordIds = Array.from({ length: 50 }, (_, i) => `record-${i + 1}`);

      const result = await executor.executeBatch('problematic_entity', recordIds, 1);

      expect(result.status).toMatch(/^(partial_success|failed)$/);
      expect(result.failedRecords).toBeGreaterThan(0);
      expect(result.errors.length).toBe(result.failedRecords);
      expect(result.errors.every(err => err.retryable)).toBe(true);
    });

    test('should create checkpoints at configured intervals', async () => {
      const recordIds = Array.from({ length: 100 }, (_, i) => `record-${i + 1}`);
      const checkpointBatch = mockConfig.checkpointInterval; // Batch 5

      const result = await executor.executeBatch('offices', recordIds, checkpointBatch);

      expect(result.checkpointCreated).toBeDefined();
      expect(result.checkpointCreated).toMatch(/^checkpoint_offices_5_/);
    });

    test('should not create checkpoints for non-interval batches', async () => {
      const recordIds = Array.from({ length: 100 }, (_, i) => `record-${i + 1}`);

      const result = await executor.executeBatch('offices', recordIds, 3);

      expect(result.checkpointCreated).toBeUndefined();
    });
  });

  describe('Dependency Graph', () => {
    test('should build correct dependency graph', () => {
      const tasks: MigrationTask[] = [
        {
          entityType: 'offices',
          recordIds: ['1', '2'],
          priority: 'high',
          dependencies: [],
          estimatedDurationMs: 5000,
          metadata: { sourceTable: 'dispatch_office', destinationTable: 'offices', totalRecords: 2, migrationMethod: 'differential' }
        },
        {
          entityType: 'doctors',
          recordIds: ['1', '2', '3'],
          priority: 'high',
          dependencies: ['offices'],
          estimatedDurationMs: 10000,
          metadata: { sourceTable: 'dispatch_doctor', destinationTable: 'doctors', totalRecords: 3, migrationMethod: 'differential' }
        },
        {
          entityType: 'patients',
          recordIds: ['1', '2', '3', '4'],
          priority: 'medium',
          dependencies: ['doctors'],
          estimatedDurationMs: 15000,
          metadata: { sourceTable: 'dispatch_patient', destinationTable: 'patients', totalRecords: 4, migrationMethod: 'differential' }
        }
      ];

      const graph = executor.buildDependencyGraph(tasks);

      expect(graph.entities).toEqual(['offices', 'doctors', 'patients']);
      expect(graph.dependencies['offices']).toEqual([]);
      expect(graph.dependencies['doctors']).toEqual(['offices']);
      expect(graph.dependencies['patients']).toEqual(['doctors']);
      expect(graph.executionOrder).toEqual([['offices'], ['doctors'], ['patients']]);
    });

    test('should handle parallel execution groups', () => {
      const tasks: MigrationTask[] = [
        {
          entityType: 'offices',
          recordIds: ['1'],
          priority: 'high',
          dependencies: [],
          estimatedDurationMs: 5000,
          metadata: { sourceTable: 'dispatch_office', destinationTable: 'offices', totalRecords: 1, migrationMethod: 'differential' }
        },
        {
          entityType: 'products',
          recordIds: ['1'],
          priority: 'medium',
          dependencies: [],
          estimatedDurationMs: 8000,
          metadata: { sourceTable: 'dispatch_product', destinationTable: 'products', totalRecords: 1, migrationMethod: 'differential' }
        },
        {
          entityType: 'doctors',
          recordIds: ['1'],
          priority: 'high',
          dependencies: ['offices'],
          estimatedDurationMs: 10000,
          metadata: { sourceTable: 'dispatch_doctor', destinationTable: 'doctors', totalRecords: 1, migrationMethod: 'differential' }
        }
      ];

      const graph = executor.buildDependencyGraph(tasks);

      expect(graph.executionOrder[0]).toEqual(expect.arrayContaining(['offices', 'products']));
      expect(graph.executionOrder[1]).toEqual(['doctors']);
    });
  });

  describe('Migration Execution', () => {
    test('should execute migration tasks successfully', async () => {
      const tasks: MigrationTask[] = [
        {
          entityType: 'offices',
          recordIds: Array.from({ length: 500 }, (_, i) => `office-${i + 1}`),
          priority: 'high',
          dependencies: [],
          estimatedDurationMs: 5000,
          metadata: { sourceTable: 'dispatch_office', destinationTable: 'offices', totalRecords: 500, migrationMethod: 'differential' }
        },
        {
          entityType: 'doctors',
          recordIds: Array.from({ length: 1200 }, (_, i) => `doctor-${i + 1}`),
          priority: 'high',
          dependencies: ['offices'],
          estimatedDurationMs: 10000,
          metadata: { sourceTable: 'dispatch_doctor', destinationTable: 'doctors', totalRecords: 1200, migrationMethod: 'differential' }
        }
      ];

      const result = await executor.executeMigrationTasks(tasks);

      expect(result).toBeDefined();
      expect(result.executionId).toBeDefined();
      expect(result.sessionId).toBe(sessionId);
      expect(result.entitiesProcessed).toContain('offices');
      expect(result.entitiesProcessed).toContain('doctors');
      expect(result.totalRecordsProcessed).toBeGreaterThan(0);
      expect(result.batchResults.length).toBeGreaterThan(0);
      expect(result.executionSummary).toBeDefined();
      expect(result.executionSummary.averageThroughput).toBeGreaterThan(0);
    });

    test('should handle partial failures correctly', async () => {
      const tasks: MigrationTask[] = [
        {
          entityType: 'offices',
          recordIds: Array.from({ length: 100 }, (_, i) => `office-${i + 1}`),
          priority: 'high',
          dependencies: [],
          estimatedDurationMs: 5000,
          metadata: { sourceTable: 'dispatch_office', destinationTable: 'offices', totalRecords: 100, migrationMethod: 'differential' }
        },
        {
          entityType: 'problematic_entity',
          recordIds: Array.from({ length: 100 }, (_, i) => `prob-${i + 1}`),
          priority: 'medium',
          dependencies: [],
          estimatedDurationMs: 8000,
          metadata: { sourceTable: 'dispatch_problematic', destinationTable: 'problematic_entity', totalRecords: 100, migrationMethod: 'differential' }
        }
      ];

      const result = await executor.executeMigrationTasks(tasks);

      expect(result.overallStatus).toMatch(/^(partial|failed)$/);
      expect(result.entitiesFailed.length).toBeGreaterThan(0);
      expect(result.recovery.isRecoverable).toBeDefined();
      expect(result.recovery.recommendedActions.length).toBeGreaterThan(0);
    });

    test('should create checkpoints during execution', async () => {
      const tasks: MigrationTask[] = [
        {
          entityType: 'orders',
          recordIds: Array.from({ length: 6000 }, (_, i) => `order-${i + 1}`), // Should create multiple checkpoints
          priority: 'medium',
          dependencies: [],
          estimatedDurationMs: 30000,
          metadata: { sourceTable: 'dispatch_order', destinationTable: 'orders', totalRecords: 6000, migrationMethod: 'differential' }
        }
      ];

      const result = await executor.executeMigrationTasks(tasks);

      expect(result.checkpoints.length).toBeGreaterThan(0);
      expect(result.recovery.lastCheckpointId).toBeDefined();
    });
  });

  describe('Execution Control', () => {
    test('should pause execution successfully', async () => {
      const result = await executor.pauseExecution();

      expect(result.success).toBe(true);
      expect(result.checkpointId).toBeDefined();
      expect(result.checkpointId).toMatch(/^pause_checkpoint_/);
    });

    test('should resume execution from checkpoint', async () => {
      const checkpointId = 'test_checkpoint_123';

      const result = await executor.resumeExecution(checkpointId);

      expect(result.success).toBe(true);
      expect(result.resumedFromBatch).toBeGreaterThan(0);
    });
  });

  describe('Migration Validation', () => {
    test('should validate migration integrity', async () => {
      const result = await executor.validateMigrationIntegrity('doctors', 50);

      expect(result).toBeDefined();
      expect(result.isValid).toBeDefined();
      expect(result.validationResults).toHaveLength(50);
      expect(result.summary.totalValidated).toBe(50);
      expect(result.summary.matchPercentage).toBeGreaterThanOrEqual(0);
      expect(result.summary.matchPercentage).toBeLessThanOrEqual(100);
      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    test('should use default sample size when not specified', async () => {
      const result = await executor.validateMigrationIntegrity('patients');

      expect(result.summary.totalValidated).toBe(100); // Default sample size
      expect(result.validationResults).toHaveLength(100);
    });

    test('should provide appropriate recommendations', async () => {
      const result = await executor.validateMigrationIntegrity('offices');

      expect(result.recommendations).toBeDefined();
      expect(result.recommendations.length).toBeGreaterThan(0);

      if (result.summary.matchPercentage >= 95) {
        expect(result.recommendations).toContain('Validation successful - migration integrity confirmed');
      }
    });
  });

  describe('Integration with Test Utilities', () => {
    test('should work with test utility helper', () => {
      const testData = diffMigrationTestUtils.createTestMigrationTask({
        entityType: 'test_entity',
        recordCount: 100,
        dependencies: ['offices']
      });

      expect(testData.entityType).toBe('test_entity');
      expect(testData.recordIds).toHaveLength(100);
      expect(testData.dependencies).toContain('offices');
      expect(testData.metadata.totalRecords).toBe(100);
    });
  });
});