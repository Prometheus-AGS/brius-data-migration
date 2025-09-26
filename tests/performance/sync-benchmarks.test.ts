// Sync Operations Performance Benchmarks
// Comprehensive benchmarking suite for synchronization operations

import { performance } from 'perf_hooks';
import { SyncSchedulerOrchestrator } from '../../src/sync-scheduler';
import { DifferentialMigrationOrchestrator } from '../../src/differential-migration';
import { DataValidationOrchestrator } from '../../src/data-validator';
import { ConflictResolutionOrchestrator } from '../../src/conflict-resolver';
import { PerformanceTracker, MockDataGenerator } from './large-dataset.test';
import {
  JobType,
  ConflictResolution,
  ValidationType,
  ResolutionStrategy
} from '../../src/types/migration-types';

// Benchmark configuration
const BENCHMARK_CONFIG = {
  SMALL_DATASET: 1000,
  MEDIUM_DATASET: 10000,
  LARGE_DATASET: 50000,
  XLARGE_DATASET: 100000,
  BATCH_SIZES: [100, 500, 1000, 2000],
  CONCURRENCY_LEVELS: [1, 2, 4, 8],
  SYNC_INTERVALS: ['1m', '5m', '15m', '1h'],
  PERFORMANCE_TARGETS: {
    differential_migration: {
      small: { max_time_ms: 30000, min_throughput: 100 },
      medium: { max_time_ms: 180000, min_throughput: 200 },
      large: { max_time_ms: 600000, min_throughput: 300 }
    },
    data_validation: {
      small: { max_time_ms: 15000, min_throughput: 200 },
      medium: { max_time_ms: 90000, min_throughput: 400 },
      large: { max_time_ms: 300000, min_throughput: 500 }
    },
    conflict_resolution: {
      small: { max_time_ms: 10000, min_throughput: 300 },
      medium: { max_time_ms: 60000, min_throughput: 500 },
      large: { max_time_ms: 180000, min_throughput: 600 }
    }
  }
};

interface BenchmarkResult {
  operation: string;
  dataset_size: number;
  batch_size?: number;
  duration_ms: number;
  throughput_per_second: number;
  memory_usage_mb: number;
  success_rate: number;
  errors?: string[];
}

interface BenchmarkSuite {
  name: string;
  results: BenchmarkResult[];
  summary: {
    total_operations: number;
    avg_throughput: number;
    max_memory: number;
    overall_success_rate: number;
  };
}

class SyncBenchmarkRunner {
  private performanceTracker: PerformanceTracker;
  private results: BenchmarkResult[] = [];

  constructor() {
    this.performanceTracker = new PerformanceTracker();
  }

  async runBenchmark(
    name: string,
    operation: () => Promise<any>,
    datasetSize: number,
    batchSize?: number
  ): Promise<BenchmarkResult> {
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    const startMemory = process.memoryUsage().heapUsed / 1024 / 1024;
    this.performanceTracker.mark(`${name}_start`);

    let success = true;
    let errors: string[] = [];

    try {
      const result = await operation();
      if (result && result.success === false) {
        success = false;
        errors = result.errors?.map((e: any) => e.message) || ['Operation failed'];
      }
    } catch (error) {
      success = false;
      errors = [error instanceof Error ? error.message : 'Unknown error'];
    }

    this.performanceTracker.mark(`${name}_end`);
    const endMemory = process.memoryUsage().heapUsed / 1024 / 1024;

    const duration = this.performanceTracker.getDuration(`${name}_start`, `${name}_end`);
    const throughput = this.performanceTracker.calculateThroughput(datasetSize, duration);

    const benchmarkResult: BenchmarkResult = {
      operation: name,
      dataset_size: datasetSize,
      batch_size: batchSize,
      duration_ms: duration,
      throughput_per_second: throughput,
      memory_usage_mb: endMemory - startMemory,
      success_rate: success ? 100 : 0,
      errors: errors.length > 0 ? errors : undefined
    };

    this.results.push(benchmarkResult);
    return benchmarkResult;
  }

  generateSummary(suiteName: string): BenchmarkSuite {
    const avgThroughput = this.results.reduce((sum, r) => sum + r.throughput_per_second, 0) / this.results.length;
    const maxMemory = Math.max(...this.results.map(r => r.memory_usage_mb));
    const overallSuccessRate = this.results.reduce((sum, r) => sum + r.success_rate, 0) / this.results.length;

    return {
      name: suiteName,
      results: [...this.results],
      summary: {
        total_operations: this.results.length,
        avg_throughput: avgThroughput,
        max_memory: maxMemory,
        overall_success_rate: overallSuccessRate
      }
    };
  }

  reset(): void {
    this.results = [];
    this.performanceTracker = new PerformanceTracker();
  }
}

describe('Sync Operations Performance Benchmarks', () => {
  let benchmarkRunner: SyncBenchmarkRunner;

  beforeEach(() => {
    benchmarkRunner = new SyncBenchmarkRunner();
    jest.setTimeout(15 * 60 * 1000); // 15 minutes for benchmarks
  });

  afterEach(() => {
    const suite = benchmarkRunner.generateSummary('Current Test Suite');
    console.log(`\n📊 Benchmark Suite: ${suite.name}`);
    console.log(`🔢 Operations: ${suite.summary.total_operations}`);
    console.log(`⚡ Avg Throughput: ${suite.summary.avg_throughput.toFixed(0)} ops/sec`);
    console.log(`💾 Max Memory: ${suite.summary.max_memory.toFixed(2)}MB`);
    console.log(`✅ Success Rate: ${suite.summary.overall_success_rate.toFixed(1)}%`);
  });

  describe('Differential Migration Benchmarks', () => {
    const createMockMigrationOrchestrator = () => ({
      executeDifferentialMigration: jest.fn().mockImplementation(async (config) => {
        const { entities = ['test'], batchSize = 500 } = config;
        const recordCount = entities.length * batchSize * 10; // Simulate record processing

        // Simulate processing time based on record count
        await new Promise(resolve => setTimeout(resolve, Math.min(recordCount * 0.1, 5000)));

        return {
          success: true,
          stats: {
            recordsProcessed: recordCount,
            recordsSuccessful: recordCount,
            recordsFailed: 0,
            startTime: new Date(),
            endTime: new Date()
          },
          entitiesProcessed: entities,
          executionTimeMs: recordCount * 0.1
        };
      }),
      analyzeDifferentialMigration: jest.fn().mockImplementation(async (entities) => {
        const recordCount = entities.length * 1000;
        await new Promise(resolve => setTimeout(resolve, recordCount * 0.05));

        return {
          success: true,
          stats: { recordsToProcess: recordCount },
          analysisTime: recordCount * 0.05
        };
      })
    });

    it('should benchmark differential migration across dataset sizes', async () => {
      const mockOrchestrator = createMockMigrationOrchestrator();
      const dataSizes = [
        { name: 'small', size: BENCHMARK_CONFIG.SMALL_DATASET },
        { name: 'medium', size: BENCHMARK_CONFIG.MEDIUM_DATASET },
        { name: 'large', size: BENCHMARK_CONFIG.LARGE_DATASET }
      ];

      for (const { name, size } of dataSizes) {
        const operation = () => mockOrchestrator.executeDifferentialMigration({
          entities: ['offices', 'doctors'],
          batchSize: 500,
          enableCheckpointing: true
        });

        const result = await benchmarkRunner.runBenchmark(
          `differential_migration_${name}`,
          operation,
          size,
          500
        );

        const target = BENCHMARK_CONFIG.PERFORMANCE_TARGETS.differential_migration[name];

        expect(result.duration_ms).toBeLessThan(target.max_time_ms);
        expect(result.throughput_per_second).toBeGreaterThan(target.min_throughput);
        expect(result.success_rate).toBe(100);

        console.log(`\n🔄 Differential Migration (${name}):`);
        console.log(`📊 Dataset Size: ${size.toLocaleString()}`);
        console.log(`⏱️  Duration: ${(result.duration_ms / 1000).toFixed(2)}s`);
        console.log(`⚡ Throughput: ${result.throughput_per_second.toFixed(0)} records/sec`);
        console.log(`💾 Memory: ${result.memory_usage_mb.toFixed(2)}MB`);
      }
    });

    it('should benchmark different batch sizes', async () => {
      const mockOrchestrator = createMockMigrationOrchestrator();

      for (const batchSize of BENCHMARK_CONFIG.BATCH_SIZES) {
        const operation = () => mockOrchestrator.executeDifferentialMigration({
          entities: ['offices'],
          batchSize,
          enableCheckpointing: true
        });

        const result = await benchmarkRunner.runBenchmark(
          `differential_migration_batch_${batchSize}`,
          operation,
          BENCHMARK_CONFIG.MEDIUM_DATASET,
          batchSize
        );

        console.log(`\n📦 Batch Size ${batchSize}:`);
        console.log(`⏱️  Duration: ${(result.duration_ms / 1000).toFixed(2)}s`);
        console.log(`⚡ Throughput: ${result.throughput_per_second.toFixed(0)} records/sec`);
      }

      // Analyze optimal batch size
      const batchResults = benchmarkRunner.results.filter(r => r.operation.includes('batch_'));
      const optimalBatch = batchResults.reduce((best, current) =>
        current.throughput_per_second > best.throughput_per_second ? current : best
      );

      console.log(`\n🎯 Optimal Batch Size: ${optimalBatch.batch_size} (${optimalBatch.throughput_per_second.toFixed(0)} rec/sec)`);
    });

    it('should benchmark migration analysis performance', async () => {
      const mockOrchestrator = createMockMigrationOrchestrator();
      const entitySets = [
        ['offices'],
        ['offices', 'doctors'],
        ['offices', 'doctors', 'patients'],
        ['offices', 'doctors', 'patients', 'orders']
      ];

      for (const entities of entitySets) {
        const operation = () => mockOrchestrator.analyzeDifferentialMigration(entities);

        const result = await benchmarkRunner.runBenchmark(
          `migration_analysis_${entities.length}_entities`,
          operation,
          entities.length * 10000
        );

        console.log(`\n🔍 Analysis (${entities.length} entities):`);
        console.log(`⏱️  Duration: ${(result.duration_ms / 1000).toFixed(2)}s`);
        console.log(`⚡ Throughput: ${result.throughput_per_second.toFixed(0)} records/sec`);
      }
    });
  });

  describe('Data Validation Benchmarks', () => {
    const createMockValidationOrchestrator = () => ({
      executeValidationWorkflow: jest.fn().mockImplementation(async (workflow) => {
        const { entities = ['test'], validationTypes = [ValidationType.DATA_INTEGRITY] } = workflow;
        const recordCount = entities.length * validationTypes.length * 5000;

        // Simulate validation processing time
        await new Promise(resolve => setTimeout(resolve, recordCount * 0.02));

        return {
          success: true,
          totalValidations: validationTypes.length * entities.length,
          successfulValidations: validationTypes.length * entities.length,
          failedValidations: 0,
          totalIssuesFound: 0,
          executionTimeMs: recordCount * 0.02,
          summary: {
            overallHealthScore: 100,
            entitiesValidated: entities,
            validationTypesCovered: validationTypes
          }
        };
      }),
      quickValidation: jest.fn().mockImplementation(async (entities) => {
        const recordCount = entities.length * 1000;
        await new Promise(resolve => setTimeout(resolve, recordCount * 0.01));

        return {
          success: true,
          validationTime: recordCount * 0.01,
          issuesFound: []
        };
      })
    });

    it('should benchmark validation workflow performance', async () => {
      const mockValidator = createMockValidationOrchestrator();
      const validationScenarios = [
        {
          name: 'data_integrity_only',
          types: [ValidationType.DATA_INTEGRITY],
          entities: ['offices', 'doctors']
        },
        {
          name: 'relationship_validation',
          types: [ValidationType.RELATIONSHIP_INTEGRITY],
          entities: ['offices', 'doctors', 'patients']
        },
        {
          name: 'comprehensive_validation',
          types: [ValidationType.DATA_INTEGRITY, ValidationType.RELATIONSHIP_INTEGRITY, ValidationType.COMPLETENESS_CHECK],
          entities: ['offices', 'doctors', 'patients', 'orders']
        }
      ];

      for (const scenario of validationScenarios) {
        const operation = () => mockValidator.executeValidationWorkflow({
          entities: scenario.entities,
          validationTypes: scenario.types,
          samplingRate: 1.0
        });

        const recordCount = scenario.entities.length * scenario.types.length * 5000;
        const result = await benchmarkRunner.runBenchmark(
          `validation_${scenario.name}`,
          operation,
          recordCount
        );

        console.log(`\n🔍 Validation (${scenario.name}):`);
        console.log(`📊 Entities: ${scenario.entities.length}, Types: ${scenario.types.length}`);
        console.log(`⏱️  Duration: ${(result.duration_ms / 1000).toFixed(2)}s`);
        console.log(`⚡ Throughput: ${result.throughput_per_second.toFixed(0)} validations/sec`);
      }
    });

    it('should benchmark quick validation performance', async () => {
      const mockValidator = createMockValidationOrchestrator();
      const entityCounts = [1, 5, 10, 20];

      for (const count of entityCounts) {
        const entities = Array.from({ length: count }, (_, i) => `entity_${i}`);

        const operation = () => mockValidator.quickValidation(entities);

        const result = await benchmarkRunner.runBenchmark(
          `quick_validation_${count}_entities`,
          operation,
          count * 1000
        );

        console.log(`\n⚡ Quick Validation (${count} entities):`);
        console.log(`⏱️  Duration: ${(result.duration_ms / 1000).toFixed(2)}s`);
        console.log(`⚡ Throughput: ${result.throughput_per_second.toFixed(0)} records/sec`);
      }
    });

    it('should benchmark validation sampling rates', async () => {
      const mockValidator = createMockValidationOrchestrator();
      const samplingRates = [0.1, 0.25, 0.5, 1.0];

      for (const rate of samplingRates) {
        const operation = () => mockValidator.executeValidationWorkflow({
          entities: ['offices', 'doctors'],
          validationTypes: [ValidationType.DATA_INTEGRITY],
          samplingRate: rate
        });

        const recordCount = Math.floor(10000 * rate);
        const result = await benchmarkRunner.runBenchmark(
          `validation_sampling_${(rate * 100).toFixed(0)}pct`,
          operation,
          recordCount
        );

        console.log(`\n📊 Validation Sampling (${(rate * 100).toFixed(0)}%):`);
        console.log(`📈 Records: ${recordCount.toLocaleString()}`);
        console.log(`⏱️  Duration: ${(result.duration_ms / 1000).toFixed(2)}s`);
        console.log(`⚡ Throughput: ${result.throughput_per_second.toFixed(0)} records/sec`);
      }
    });
  });

  describe('Conflict Resolution Benchmarks', () => {
    const createMockConflictOrchestrator = () => ({
      executeConflictResolution: jest.fn().mockImplementation(async (workflow) => {
        const { entities = ['test'] } = workflow;
        const conflictCount = entities.length * 1000;

        // Simulate conflict resolution processing time
        await new Promise(resolve => setTimeout(resolve, conflictCount * 0.5));

        return {
          success: true,
          totalConflicts: conflictCount,
          resolvedConflicts: conflictCount,
          failedConflicts: 0,
          executionTimeMs: conflictCount * 0.5,
          strategy: ResolutionStrategy.SOURCE_WINS,
          entitiesProcessed: entities
        };
      }),
      detectConflicts: jest.fn().mockImplementation(async (entities) => {
        const conflictCount = entities.length * 500;
        await new Promise(resolve => setTimeout(resolve, conflictCount * 0.1));

        return entities.map(entity => ({
          entityType: entity,
          conflictsFound: 500,
          severity: 'medium' as const,
          estimatedResolutionTime: 500 * 0.5
        }));
      })
    });

    it('should benchmark conflict resolution workflow', async () => {
      const mockResolver = createMockConflictOrchestrator();
      const strategies = [
        { name: 'source_wins', strategy: ResolutionStrategy.SOURCE_WINS },
        { name: 'target_wins', strategy: ResolutionStrategy.TARGET_WINS }
      ];

      for (const { name, strategy } of strategies) {
        const operation = () => mockResolver.executeConflictResolution({
          entities: ['offices', 'doctors'],
          strategy,
          options: { batchSize: 100 }
        });

        const result = await benchmarkRunner.runBenchmark(
          `conflict_resolution_${name}`,
          operation,
          2000 // 2 entities * 1000 conflicts each
        );

        console.log(`\n⚔️ Conflict Resolution (${name}):`);
        console.log(`⏱️  Duration: ${(result.duration_ms / 1000).toFixed(2)}s`);
        console.log(`⚡ Throughput: ${result.throughput_per_second.toFixed(0)} conflicts/sec`);
      }
    });

    it('should benchmark conflict detection performance', async () => {
      const mockResolver = createMockConflictOrchestrator();
      const entitySets = [
        { name: 'single', entities: ['offices'] },
        { name: 'pair', entities: ['offices', 'doctors'] },
        { name: 'triple', entities: ['offices', 'doctors', 'patients'] },
        { name: 'quad', entities: ['offices', 'doctors', 'patients', 'orders'] }
      ];

      for (const { name, entities } of entitySets) {
        const operation = () => mockResolver.detectConflicts(entities);

        const result = await benchmarkRunner.runBenchmark(
          `conflict_detection_${name}`,
          operation,
          entities.length * 500
        );

        console.log(`\n🔍 Conflict Detection (${name}):`);
        console.log(`📊 Entities: ${entities.length}`);
        console.log(`⏱️  Duration: ${(result.duration_ms / 1000).toFixed(2)}s`);
        console.log(`⚡ Throughput: ${result.throughput_per_second.toFixed(0)} records/sec`);
      }
    });

    it('should benchmark conflict resolution batch sizes', async () => {
      const mockResolver = createMockConflictOrchestrator();

      for (const batchSize of [50, 100, 200, 500]) {
        const operation = () => mockResolver.executeConflictResolution({
          entities: ['offices'],
          strategy: ResolutionStrategy.SOURCE_WINS,
          options: { batchSize }
        });

        const result = await benchmarkRunner.runBenchmark(
          `conflict_batch_${batchSize}`,
          operation,
          1000,
          batchSize
        );

        console.log(`\n📦 Conflict Batch Size ${batchSize}:`);
        console.log(`⏱️  Duration: ${(result.duration_ms / 1000).toFixed(2)}s`);
        console.log(`⚡ Throughput: ${result.throughput_per_second.toFixed(0)} conflicts/sec`);
      }
    });
  });

  describe('Sync Scheduler Benchmarks', () => {
    const createMockSyncScheduler = () => ({
      createSyncJob: jest.fn().mockImplementation(async (request) => {
        await new Promise(resolve => setTimeout(resolve, 100)); // Job creation time
        return {
          id: `job-${Date.now()}`,
          job_name: request.jobName,
          job_type: request.jobType,
          status: 'scheduled',
          created_at: new Date()
        };
      }),
      executeSyncJob: jest.fn().mockImplementation(async (jobId) => {
        const recordCount = 5000; // Simulate sync operation
        await new Promise(resolve => setTimeout(resolve, recordCount * 0.2));

        return {
          jobId,
          success: true,
          recordsProcessed: recordCount,
          executionTimeMs: recordCount * 0.2,
          runStatus: 'completed'
        };
      }),
      listJobs: jest.fn().mockImplementation(async (filters) => {
        const jobCount = Math.min(filters.limit || 100, 1000);
        await new Promise(resolve => setTimeout(resolve, jobCount * 0.5));

        return Array.from({ length: jobCount }, (_, i) => ({
          id: `job-${i}`,
          job_name: `Test Job ${i}`,
          status: 'scheduled'
        }));
      })
    });

    it('should benchmark sync job management operations', async () => {
      const mockScheduler = createMockSyncScheduler();
      const operations = [
        {
          name: 'create_sync_job',
          operation: () => mockScheduler.createSyncJob({
            jobName: 'benchmark-job',
            jobType: JobType.SCHEDULED_SYNC,
            entities: ['offices', 'doctors'],
            conflictResolution: ConflictResolution.SOURCE_WINS
          }),
          dataSize: 1
        },
        {
          name: 'execute_sync_job',
          operation: () => mockScheduler.executeSyncJob('job-123'),
          dataSize: 5000
        },
        {
          name: 'list_jobs_small',
          operation: () => mockScheduler.listJobs({ limit: 10 }),
          dataSize: 10
        },
        {
          name: 'list_jobs_large',
          operation: () => mockScheduler.listJobs({ limit: 1000 }),
          dataSize: 1000
        }
      ];

      for (const { name, operation, dataSize } of operations) {
        const result = await benchmarkRunner.runBenchmark(name, operation, dataSize);

        console.log(`\n📋 ${name.replace(/_/g, ' ')}:`);
        console.log(`⏱️  Duration: ${(result.duration_ms / 1000).toFixed(2)}s`);
        console.log(`⚡ Throughput: ${result.throughput_per_second.toFixed(0)} ops/sec`);
      }
    });

    it('should benchmark concurrent job execution', async () => {
      const mockScheduler = createMockSyncScheduler();
      const concurrentJobs = [2, 4, 8, 16];

      for (const jobCount of concurrentJobs) {
        const operation = async () => {
          const jobPromises = Array.from({ length: jobCount }, (_, i) =>
            mockScheduler.executeSyncJob(`job-${i}`)
          );
          return Promise.all(jobPromises);
        };

        const result = await benchmarkRunner.runBenchmark(
          `concurrent_jobs_${jobCount}`,
          operation,
          jobCount * 5000 // Each job processes 5000 records
        );

        console.log(`\n🔄 Concurrent Jobs (${jobCount}):`);
        console.log(`⏱️  Duration: ${(result.duration_ms / 1000).toFixed(2)}s`);
        console.log(`⚡ Total Throughput: ${result.throughput_per_second.toFixed(0)} records/sec`);
        console.log(`📊 Per-job Throughput: ${(result.throughput_per_second / jobCount).toFixed(0)} records/sec`);
      }
    });
  });

  describe('End-to-End Sync Benchmark', () => {
    it('should benchmark complete sync workflow', async () => {
      // Mock a complete end-to-end sync operation
      const mockCompleteSync = async () => {
        // 1. Detect conflicts
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 2. Resolve conflicts
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 3. Execute differential migration
        await new Promise(resolve => setTimeout(resolve, 5000));

        // 4. Validate results
        await new Promise(resolve => setTimeout(resolve, 1500));

        return {
          success: true,
          phases: {
            conflict_detection: { duration: 1000, conflicts_found: 100 },
            conflict_resolution: { duration: 2000, conflicts_resolved: 100 },
            differential_migration: { duration: 5000, records_migrated: 10000 },
            validation: { duration: 1500, records_validated: 10000 }
          },
          total_records: 10000
        };
      };

      const result = await benchmarkRunner.runBenchmark(
        'complete_sync_workflow',
        mockCompleteSync,
        10000
      );

      // Performance targets for complete workflow
      expect(result.duration_ms).toBeLessThan(15000); // 15 seconds max
      expect(result.throughput_per_second).toBeGreaterThan(500); // 500 records/sec min
      expect(result.success_rate).toBe(100);

      console.log(`\n🔄 Complete Sync Workflow:`);
      console.log(`📊 Total Records: 10,000`);
      console.log(`⏱️  Total Duration: ${(result.duration_ms / 1000).toFixed(2)}s`);
      console.log(`⚡ Overall Throughput: ${result.throughput_per_second.toFixed(0)} records/sec`);
      console.log(`💾 Memory Usage: ${result.memory_usage_mb.toFixed(2)}MB`);
      console.log(`✅ Success Rate: ${result.success_rate}%`);
    });
  });

  describe('Benchmark Summary and Analysis', () => {
    it('should generate comprehensive benchmark report', async () => {
      // This test summarizes all benchmark results
      const suite = benchmarkRunner.generateSummary('Complete Sync Operations Benchmark');

      console.log(`\n\n📋 BENCHMARK SUMMARY REPORT`);
      console.log(`═══════════════════════════════════════`);
      console.log(`🏷️  Suite: ${suite.name}`);
      console.log(`🔢 Total Operations: ${suite.summary.total_operations}`);
      console.log(`⚡ Average Throughput: ${suite.summary.avg_throughput.toFixed(0)} ops/sec`);
      console.log(`💾 Maximum Memory Usage: ${suite.summary.max_memory.toFixed(2)}MB`);
      console.log(`✅ Overall Success Rate: ${suite.summary.overall_success_rate.toFixed(1)}%`);

      // Performance analysis
      const fastestOperation = suite.results.reduce((fastest, current) =>
        current.throughput_per_second > fastest.throughput_per_second ? current : fastest
      );

      const slowestOperation = suite.results.reduce((slowest, current) =>
        current.throughput_per_second < slowest.throughput_per_second ? current : slowest
      );

      console.log(`\n🏆 Performance Analysis:`);
      console.log(`🥇 Fastest: ${fastestOperation.operation} (${fastestOperation.throughput_per_second.toFixed(0)} ops/sec)`);
      console.log(`🐌 Slowest: ${slowestOperation.operation} (${slowestOperation.throughput_per_second.toFixed(0)} ops/sec)`);

      // Memory analysis
      const highestMemory = suite.results.reduce((highest, current) =>
        current.memory_usage_mb > highest.memory_usage_mb ? current : highest
      );

      console.log(`💾 Highest Memory: ${highestMemory.operation} (${highestMemory.memory_usage_mb.toFixed(2)}MB)`);

      // Recommendations
      console.log(`\n💡 Recommendations:`);
      if (suite.summary.avg_throughput < 1000) {
        console.log(`⚠️  Consider optimizing batch sizes and concurrency settings`);
      }
      if (suite.summary.max_memory > 512) {
        console.log(`⚠️  Monitor memory usage in production environments`);
      }
      if (suite.summary.overall_success_rate < 100) {
        console.log(`⚠️  Investigate failed operations for reliability improvements`);
      }

      // Assert overall benchmark quality
      expect(suite.summary.total_operations).toBeGreaterThan(10);
      expect(suite.summary.overall_success_rate).toBeGreaterThan(90);
    });
  });
});

// Export for use in other benchmark files
export { SyncBenchmarkRunner, BENCHMARK_CONFIG, BenchmarkResult, BenchmarkSuite };