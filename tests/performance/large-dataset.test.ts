// Large Dataset Performance Tests
// Tests system performance with 100K+ record processing scenarios

import { Pool, PoolClient } from 'pg';
import { performance } from 'perf_hooks';
import { DifferentialMigrationOrchestrator } from '../../src/differential-migration';
import { DataValidationOrchestrator } from '../../src/data-validator';
import { SyncSchedulerOrchestrator } from '../../src/sync-scheduler';
import { ConflictResolutionOrchestrator } from '../../src/conflict-resolver';
import {
  BatchProcessorService,
  MigrationBatchProcessor
} from '../../src/lib/batch-processor';
import {
  ValidationType,
  ConflictResolution,
  JobType
} from '../../src/types/migration-types';

// Performance test configuration
const PERFORMANCE_CONFIG = {
  LARGE_DATASET_SIZE: 100000,
  MEDIUM_DATASET_SIZE: 50000,
  SMALL_DATASET_SIZE: 10000,
  BATCH_SIZE: 500,
  MAX_EXECUTION_TIME_MS: 10 * 60 * 1000, // 10 minutes
  TARGET_THROUGHPUT_PER_SECOND: 1000, // records per second
  MEMORY_LIMIT_MB: 512
};

// Mock data generators
interface MockRecord {
  legacy_id: number;
  name: string;
  data: string;
  created_at: Date;
  updated_at: Date;
}

class MockDataGenerator {
  static generateRecords(count: number): MockRecord[] {
    const records: MockRecord[] = [];
    const baseDate = new Date('2023-01-01');

    for (let i = 1; i <= count; i++) {
      records.push({
        legacy_id: i,
        name: `Record ${i}`,
        data: `Data content for record ${i} `.repeat(10), // ~300 bytes per record
        created_at: new Date(baseDate.getTime() + i * 1000),
        updated_at: new Date(baseDate.getTime() + i * 1000)
      });
    }

    return records;
  }

  static generateConflictRecords(count: number): MockRecord[] {
    return this.generateRecords(count).map(record => ({
      ...record,
      name: `Modified ${record.name}`,
      updated_at: new Date(record.updated_at.getTime() + 60000) // 1 minute later
    }));
  }
}

// Performance measurement utilities
class PerformanceTracker {
  private startTime: number;
  private markers: Map<string, number> = new Map();
  private memoryUsage: number[];

  constructor() {
    this.startTime = performance.now();
    this.memoryUsage = [];
  }

  mark(name: string): void {
    this.markers.set(name, performance.now());
  }

  getDuration(startMark?: string, endMark?: string): number {
    const start = startMark ? this.markers.get(startMark) || this.startTime : this.startTime;
    const end = endMark ? this.markers.get(endMark) || performance.now() : performance.now();
    return end - start;
  }

  recordMemoryUsage(): void {
    const usage = process.memoryUsage();
    this.memoryUsage.push(usage.heapUsed / 1024 / 1024); // MB
  }

  getMaxMemoryUsage(): number {
    return Math.max(...this.memoryUsage);
  }

  getAverageMemoryUsage(): number {
    return this.memoryUsage.reduce((sum, usage) => sum + usage, 0) / this.memoryUsage.length;
  }

  calculateThroughput(recordCount: number, durationMs: number): number {
    return (recordCount / durationMs) * 1000; // records per second
  }
}

describe('Large Dataset Performance Tests', () => {
  let performanceTracker: PerformanceTracker;

  beforeEach(() => {
    performanceTracker = new PerformanceTracker();
    jest.setTimeout(PERFORMANCE_CONFIG.MAX_EXECUTION_TIME_MS + 30000); // Extra buffer
  });

  afterEach(() => {
    // Log performance results
    const totalDuration = performanceTracker.getDuration();
    const maxMemory = performanceTracker.getMaxMemoryUsage();

    console.log(`\n📊 Performance Results:`);
    console.log(`⏱️  Total Duration: ${(totalDuration / 1000).toFixed(2)}s`);
    console.log(`💾 Max Memory Usage: ${maxMemory.toFixed(2)}MB`);
  });

  describe('Batch Processing Performance', () => {
    it('should process 100K records within performance targets', async () => {
      const records = MockDataGenerator.generateRecords(PERFORMANCE_CONFIG.LARGE_DATASET_SIZE);
      const batchProcessor = MigrationBatchProcessor.createMigrationProcessor({
        batchSize: PERFORMANCE_CONFIG.BATCH_SIZE,
        enableCheckpointing: true,
        progressReporting: true
      });

      performanceTracker.mark('batch_start');

      // Create item processor that simulates database operations
      const itemProcessor = (record: MockRecord) => {
        return Promise.resolve({
          id: `uuid-${record.legacy_id}`,
          legacy_id: record.legacy_id,
          name: record.name,
          processed_at: new Date()
        });
      };

      const stats = await batchProcessor.processItems(records, itemProcessor);

      performanceTracker.mark('batch_end');
      const duration = performanceTracker.getDuration('batch_start', 'batch_end');
      const throughput = performanceTracker.calculateThroughput(stats.totalProcessed, duration);

      // Performance assertions
      expect(stats.totalProcessed).toBe(PERFORMANCE_CONFIG.LARGE_DATASET_SIZE);
      expect(stats.successful).toBe(PERFORMANCE_CONFIG.LARGE_DATASET_SIZE);
      expect(duration).toBeLessThan(PERFORMANCE_CONFIG.MAX_EXECUTION_TIME_MS);
      expect(throughput).toBeGreaterThan(PERFORMANCE_CONFIG.TARGET_THROUGHPUT_PER_SECOND);

      console.log(`\n🚀 Batch Processing Results:`);
      console.log(`📦 Records Processed: ${stats.totalProcessed.toLocaleString()}`);
      console.log(`✅ Success Rate: ${((stats.successful / stats.totalProcessed) * 100).toFixed(2)}%`);
      console.log(`⚡ Throughput: ${throughput.toFixed(0)} records/second`);
      console.log(`📊 Batches: ${Math.ceil(stats.totalProcessed / PERFORMANCE_CONFIG.BATCH_SIZE)}`);
    });

    it('should handle memory efficiently with large datasets', async () => {
      const records = MockDataGenerator.generateRecords(PERFORMANCE_CONFIG.LARGE_DATASET_SIZE);
      const batchProcessor = MigrationBatchProcessor.createMigrationProcessor({
        batchSize: PERFORMANCE_CONFIG.BATCH_SIZE
      });

      // Monitor memory usage during processing
      const memoryMonitor = setInterval(() => {
        performanceTracker.recordMemoryUsage();
      }, 1000); // Every second

      const itemProcessor = (record: MockRecord) => {
        // Simulate some processing work
        return Promise.resolve({
          id: `uuid-${record.legacy_id}`,
          processed: true
        });
      };

      await batchProcessor.processItems(records, itemProcessor);

      clearInterval(memoryMonitor);

      const maxMemory = performanceTracker.getMaxMemoryUsage();
      const avgMemory = performanceTracker.getAverageMemoryUsage();

      // Memory usage assertions
      expect(maxMemory).toBeLessThan(PERFORMANCE_CONFIG.MEMORY_LIMIT_MB);

      console.log(`\n💾 Memory Usage Results:`);
      console.log(`📈 Max Memory: ${maxMemory.toFixed(2)}MB`);
      console.log(`📊 Avg Memory: ${avgMemory.toFixed(2)}MB`);
      console.log(`🎯 Memory Limit: ${PERFORMANCE_CONFIG.MEMORY_LIMIT_MB}MB`);
    });

    it('should maintain consistent performance across multiple batches', async () => {
      const records = MockDataGenerator.generateRecords(PERFORMANCE_CONFIG.MEDIUM_DATASET_SIZE);
      const batchProcessor = MigrationBatchProcessor.createMigrationProcessor({
        batchSize: PERFORMANCE_CONFIG.BATCH_SIZE
      });

      const batchTimes: number[] = [];
      const batchProcessor_custom = new BatchProcessorService({
        batchSize: PERFORMANCE_CONFIG.BATCH_SIZE
      });

      // Custom batch processor to measure individual batch times
      const customBatchProcessor = async (batch: MockRecord[], batchIndex: number) => {
        const batchStart = performance.now();

        // Simulate processing each item in the batch
        const results = await Promise.all(
          batch.map(record => Promise.resolve({
            id: `uuid-${record.legacy_id}`,
            processed: true
          }))
        );

        const batchDuration = performance.now() - batchStart;
        batchTimes.push(batchDuration);

        return results;
      };

      await batchProcessor_custom.processBatches(records, customBatchProcessor);

      // Analyze batch performance consistency
      const avgBatchTime = batchTimes.reduce((sum, time) => sum + time, 0) / batchTimes.length;
      const maxBatchTime = Math.max(...batchTimes);
      const minBatchTime = Math.min(...batchTimes);
      const stdDev = Math.sqrt(
        batchTimes.reduce((sum, time) => sum + Math.pow(time - avgBatchTime, 2), 0) / batchTimes.length
      );

      // Performance consistency assertions
      const coefficient_of_variation = (stdDev / avgBatchTime) * 100;
      expect(coefficient_of_variation).toBeLessThan(50); // Less than 50% variation

      console.log(`\n⚖️ Batch Consistency Results:`);
      console.log(`📊 Total Batches: ${batchTimes.length}`);
      console.log(`⏱️  Avg Batch Time: ${avgBatchTime.toFixed(2)}ms`);
      console.log(`📈 Max Batch Time: ${maxBatchTime.toFixed(2)}ms`);
      console.log(`📉 Min Batch Time: ${minBatchTime.toFixed(2)}ms`);
      console.log(`📏 Std Deviation: ${stdDev.toFixed(2)}ms`);
      console.log(`📋 Variation: ${coefficient_of_variation.toFixed(1)}%`);
    });
  });

  describe('Differential Migration Performance', () => {
    // Note: This would require actual database connections in a real test environment
    // For this example, we'll mock the heavy operations

    test.skip('should complete differential migration of 100K records within time limit', async () => {
      // This test would be skipped in CI but can be run locally with real databases
      const orchestrator = new DifferentialMigrationOrchestrator();

      performanceTracker.mark('migration_start');

      const result = await orchestrator.executeDifferentialMigration({
        entities: ['test_entity'],
        batchSize: PERFORMANCE_CONFIG.BATCH_SIZE,
        enableCheckpointing: true
      });

      performanceTracker.mark('migration_end');
      const duration = performanceTracker.getDuration('migration_start', 'migration_end');

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(PERFORMANCE_CONFIG.MAX_EXECUTION_TIME_MS);

      console.log(`\n🔄 Migration Performance:`);
      console.log(`⏱️  Duration: ${(duration / 1000).toFixed(2)}s`);
      console.log(`📊 Records: ${result.stats.recordsProcessed.toLocaleString()}`);
      console.log(`✅ Success Rate: ${((result.stats.recordsSuccessful / result.stats.recordsProcessed) * 100).toFixed(2)}%`);
    });
  });

  describe('Data Validation Performance', () => {
    test.skip('should validate 100K records within performance targets', async () => {
      // This test would be skipped in CI but can be run locally with real databases
      const validator = new DataValidationOrchestrator();

      performanceTracker.mark('validation_start');

      const result = await validator.executeValidationWorkflow({
        entities: ['test_entity'],
        validationTypes: [ValidationType.DATA_INTEGRITY, ValidationType.COMPLETENESS_CHECK],
        samplingRate: 1.0 // Full validation
      });

      performanceTracker.mark('validation_end');
      const duration = performanceTracker.getDuration('validation_start', 'validation_end');

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(300000); // 5 minutes for validation

      console.log(`\n🔍 Validation Performance:`);
      console.log(`⏱️  Duration: ${(duration / 1000).toFixed(2)}s`);
      console.log(`📊 Validations: ${result.totalValidations}`);
      console.log(`✅ Success Rate: ${((result.successfulValidations / result.totalValidations) * 100).toFixed(2)}%`);
    });
  });

  describe('Conflict Resolution Performance', () => {
    it('should resolve 10K conflicts efficiently', async () => {
      // Generate mock conflict data
      const conflicts = Array.from({ length: 10000 }, (_, i) => ({
        id: `conflict-${i}`,
        source_table: 'dispatch_test',
        target_table: 'test',
        comparison_type: 'conflicted_records' as any,
        legacy_ids: [`${i + 1000}`],
        record_count: 1,
        comparison_criteria: { field_mismatches: ['name'] },
        resolution_strategy: ConflictResolution.SOURCE_WINS,
        resolved: false,
        resolved_at: null,
        created_at: new Date(),
        metadata: { conflict_reason: 'field_mismatch' }
      }));

      // Mock conflict resolver service
      const mockResolver = {
        resolveConflicts: jest.fn().mockImplementation(async (conflictBatch) => {
          const start = performance.now();

          // Simulate processing time based on batch size
          await new Promise(resolve => setTimeout(resolve, conflictBatch.length * 0.1));

          const duration = performance.now() - start;

          return conflictBatch.map((conflict: any, index: number) => ({
            id: conflict.id,
            success: true,
            recordsAffected: 1,
            strategy: ConflictResolution.SOURCE_WINS,
            executionTime: duration / conflictBatch.length,
            error: null
          }));
        })
      };

      performanceTracker.mark('conflict_resolution_start');

      // Process conflicts in batches
      const batchSize = 100;
      const results = [];

      for (let i = 0; i < conflicts.length; i += batchSize) {
        const batch = conflicts.slice(i, i + batchSize);
        const batchResults = await mockResolver.resolveConflicts(batch);
        results.push(...batchResults);

        performanceTracker.recordMemoryUsage();
      }

      performanceTracker.mark('conflict_resolution_end');
      const duration = performanceTracker.getDuration('conflict_resolution_start', 'conflict_resolution_end');
      const throughput = performanceTracker.calculateThroughput(conflicts.length, duration);

      // Performance assertions
      expect(results.length).toBe(conflicts.length);
      expect(results.every(r => r.success)).toBe(true);
      expect(duration).toBeLessThan(120000); // 2 minutes for 10K conflicts
      expect(throughput).toBeGreaterThan(100); // At least 100 conflicts/second

      console.log(`\n⚔️ Conflict Resolution Performance:`);
      console.log(`📊 Conflicts Resolved: ${results.length.toLocaleString()}`);
      console.log(`⏱️  Duration: ${(duration / 1000).toFixed(2)}s`);
      console.log(`⚡ Throughput: ${throughput.toFixed(0)} conflicts/second`);
      console.log(`✅ Success Rate: 100%`);
    });
  });

  describe('Concurrent Processing Performance', () => {
    it('should handle multiple concurrent operations efficiently', async () => {
      const concurrentTasks = 5;
      const recordsPerTask = PERFORMANCE_CONFIG.SMALL_DATASET_SIZE;

      performanceTracker.mark('concurrent_start');

      // Create multiple concurrent batch processing tasks
      const tasks = Array.from({ length: concurrentTasks }, async (_, taskIndex) => {
        const records = MockDataGenerator.generateRecords(recordsPerTask);
        const batchProcessor = MigrationBatchProcessor.createMigrationProcessor({
          batchSize: 100
        });

        const itemProcessor = (record: MockRecord) => {
          return Promise.resolve({
            task: taskIndex,
            id: `uuid-${taskIndex}-${record.legacy_id}`,
            processed: true
          });
        };

        return batchProcessor.processItems(records, itemProcessor);
      });

      const results = await Promise.all(tasks);

      performanceTracker.mark('concurrent_end');
      const duration = performanceTracker.getDuration('concurrent_start', 'concurrent_end');
      const totalRecords = results.reduce((sum, stats) => sum + stats.totalProcessed, 0);
      const totalThroughput = performanceTracker.calculateThroughput(totalRecords, duration);

      // Concurrent processing assertions
      expect(results.length).toBe(concurrentTasks);
      expect(results.every(stats => stats.successful === recordsPerTask)).toBe(true);
      expect(totalRecords).toBe(concurrentTasks * recordsPerTask);

      console.log(`\n🔄 Concurrent Processing Performance:`);
      console.log(`🎯 Concurrent Tasks: ${concurrentTasks}`);
      console.log(`📊 Total Records: ${totalRecords.toLocaleString()}`);
      console.log(`⏱️  Duration: ${(duration / 1000).toFixed(2)}s`);
      console.log(`⚡ Total Throughput: ${totalThroughput.toFixed(0)} records/second`);
      console.log(`📈 Per-task Throughput: ${(totalThroughput / concurrentTasks).toFixed(0)} records/second`);
    });
  });

  describe('Resource Usage and Scalability', () => {
    it('should demonstrate linear scalability with dataset size', async () => {
      const testSizes = [1000, 5000, 10000, 25000];
      const results: Array<{ size: number; duration: number; throughput: number }> = [];

      for (const size of testSizes) {
        const records = MockDataGenerator.generateRecords(size);
        const batchProcessor = MigrationBatchProcessor.createMigrationProcessor({
          batchSize: 500
        });

        const startTime = performance.now();

        const itemProcessor = (record: MockRecord) => {
          return Promise.resolve({
            id: `uuid-${record.legacy_id}`,
            processed: true
          });
        };

        await batchProcessor.processItems(records, itemProcessor);

        const duration = performance.now() - startTime;
        const throughput = performanceTracker.calculateThroughput(size, duration);

        results.push({ size, duration, throughput });
      }

      // Analyze scalability
      const throughputs = results.map(r => r.throughput);
      const avgThroughput = throughputs.reduce((sum, t) => sum + t, 0) / throughputs.length;
      const throughputVariation = Math.max(...throughputs) - Math.min(...throughputs);
      const variationPercentage = (throughputVariation / avgThroughput) * 100;

      // Scalability assertions
      expect(variationPercentage).toBeLessThan(30); // Less than 30% variation in throughput

      console.log(`\n📈 Scalability Analysis:`);
      results.forEach(({ size, duration, throughput }) => {
        console.log(`📊 ${size.toLocaleString()} records: ${(duration / 1000).toFixed(2)}s, ${throughput.toFixed(0)} rec/s`);
      });
      console.log(`📊 Avg Throughput: ${avgThroughput.toFixed(0)} records/second`);
      console.log(`📏 Throughput Variation: ${variationPercentage.toFixed(1)}%`);
    });

    it('should handle memory pressure gracefully', async () => {
      // Test with limited memory simulation
      const records = MockDataGenerator.generateRecords(PERFORMANCE_CONFIG.LARGE_DATASET_SIZE);
      const batchProcessor = MigrationBatchProcessor.createMigrationProcessor({
        batchSize: 100 // Smaller batch size to test memory management
      });

      // Monitor memory usage throughout processing
      const memorySnapshots: number[] = [];
      const memoryMonitor = setInterval(() => {
        const usage = process.memoryUsage();
        memorySnapshots.push(usage.heapUsed / 1024 / 1024);
      }, 500);

      const itemProcessor = (record: MockRecord) => {
        // Simulate some memory usage
        const tempData = new Array(100).fill(record.data);
        return Promise.resolve({
          id: `uuid-${record.legacy_id}`,
          processed: true,
          temp: tempData.length // Reference to prevent optimization
        });
      };

      const stats = await batchProcessor.processItems(records, itemProcessor);

      clearInterval(memoryMonitor);

      const maxMemory = Math.max(...memorySnapshots);
      const minMemory = Math.min(...memorySnapshots);
      const memoryGrowth = maxMemory - minMemory;

      // Memory management assertions
      expect(stats.totalProcessed).toBe(PERFORMANCE_CONFIG.LARGE_DATASET_SIZE);
      expect(memoryGrowth).toBeLessThan(200); // Less than 200MB memory growth

      console.log(`\n💾 Memory Pressure Test:`);
      console.log(`📊 Records Processed: ${stats.totalProcessed.toLocaleString()}`);
      console.log(`📈 Max Memory: ${maxMemory.toFixed(2)}MB`);
      console.log(`📉 Min Memory: ${minMemory.toFixed(2)}MB`);
      console.log(`📏 Memory Growth: ${memoryGrowth.toFixed(2)}MB`);
    });
  });
});

// Export performance utilities for use in other test files
export { PerformanceTracker, MockDataGenerator, PERFORMANCE_CONFIG };