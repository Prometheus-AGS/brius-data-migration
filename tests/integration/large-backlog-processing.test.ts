/**
 * Large Backlog Processing Scenario Integration Tests
 * Implements comprehensive test for quickstart Scenario 3 - Efficient processing of significant data backlogs
 */

import { Pool } from 'pg';
import { BaselineAnalyzer } from '../../src/differential-migration/services/baseline-analyzer';
import { DifferentialDetector } from '../../src/differential-migration/services/differential-detector';
import { MigrationExecutor, type ExecutionConfig, type MigrationTask } from '../../src/differential-migration/services/migration-executor';
import { ProgressTracker } from '../../src/differential-migration/services/progress-tracker';
import { CheckpointManager } from '../../src/differential-migration/lib/checkpoint-manager';
import { v4 as uuidv4 } from 'uuid';

// Test configuration
const TEST_CONFIG = {
  sourceDb: {
    host: process.env.SOURCE_DB_HOST || 'localhost',
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME || 'test_source_db',
    user: process.env.SOURCE_DB_USER || 'postgres',
    password: process.env.SOURCE_DB_PASSWORD || 'postgres',
    maxConnections: 20,
    connectionTimeoutMs: 10000
  },
  destinationDb: {
    host: process.env.TARGET_DB_HOST || 'localhost',
    port: parseInt(process.env.TARGET_DB_PORT || '54322'),
    database: process.env.TARGET_DB_NAME || 'test_target_db',
    user: process.env.TARGET_DB_USER || 'postgres',
    password: process.env.TARGET_DB_PASSWORD || 'postgres',
    maxConnections: 20,
    connectionTimeoutMs: 10000
  }
};

// Large dataset configuration
const LARGE_DATASET_CONFIG = {
  offices: 50,
  doctors: 200,
  patients: 1000,
  backlogMonths: 3
};

describe('Large Backlog Processing Scenario Integration Tests', () => {
  let sourcePool: Pool;
  let destinationPool: Pool;
  let baselineAnalyzer: BaselineAnalyzer;

  beforeAll(async () => {
    // Initialize database connections with higher limits for large dataset tests
    sourcePool = new Pool(TEST_CONFIG.sourceDb);
    destinationPool = new Pool(TEST_CONFIG.destinationDb);

    baselineAnalyzer = new BaselineAnalyzer(
      TEST_CONFIG.sourceDb,
      TEST_CONFIG.destinationDb,
      uuidv4()
    );

    // Verify database connections
    await verifyDatabaseConnections();

    // Setup large dataset infrastructure
    await setupLargeDatasetInfrastructure();
  });

  afterAll(async () => {
    // Cleanup and close connections
    await cleanupLargeDataset();
    await baselineAnalyzer.close();
    await sourcePool.end();
    await destinationPool.end();
  });

  beforeEach(async () => {
    // Reset to clean state for each test
    await resetLargeDatasetEnvironment();
  });

  describe('Large Backlog Processing Scenarios', () => {
    test('should efficiently process significant data backlogs (10K+ records)', async () => {
      // Create large backlog scenario
      await createSignificantBacklog();

      const sessionId = uuidv4();
      const executionConfig: ExecutionConfig = {
        batchSize: 500, // Larger batches for efficiency
        maxRetryAttempts: 3,
        checkpointInterval: 10, // Less frequent checkpoints for large datasets
        parallelEntityLimit: 4, // Higher parallelism
        timeoutMs: 300000, // 5 minutes timeout
        enableValidation: true,
        validationSampleSize: 50,
        enablePerformanceMonitoring: true
      };

      const migrationExecutor = new MigrationExecutor(
        sourcePool,
        destinationPool,
        sessionId,
        executionConfig
      );

      const progressTracker = new ProgressTracker(sourcePool, destinationPool, sessionId);

      try {
        // Execute large backlog migration
        const startTime = Date.now();
        const migrationTasks = await createLargeBacklogTasks();
        const result = await migrationExecutor.executeMigrationTasks(migrationTasks);
        const endTime = Date.now();

        const totalDuration = endTime - startTime;

        // Validate successful processing
        expect(result.overallStatus).toMatch(/completed|partial/);
        expect(result.totalRecordsProcessed).toBeGreaterThan(5000); // At least 5K records
        expect(result.entitiesProcessed.length).toBeGreaterThanOrEqual(3);

        // Validate performance targets for large datasets
        expect(result.executionSummary.averageThroughput).toBeGreaterThan(100); // Records per second
        expect(result.executionSummary.peakMemoryUsageMb).toBeLessThan(512); // Memory constraint
        expect(totalDuration).toBeLessThan(1800000); // Under 30 minutes

        // Validate batch optimization
        expect(result.batchOptimization).toBeDefined();
        expect(result.batchOptimization!.totalBatches).toBeGreaterThan(10);
        expect(result.batchOptimization!.averageBatchSize).toBeGreaterThan(100);

        // Validate checkpoint efficiency
        expect(result.checkpoints.length).toBeGreaterThan(0);
        expect(result.checkpoints.length).toBeLessThan(50); // Not too many checkpoints

      } finally {
        await progressTracker.stop();
      }
    }, 600000); // 10 minutes timeout

    test('should handle backlog processing with memory optimization', async () => {
      // Create memory-intensive backlog
      await createMemoryIntensiveBacklog();

      const sessionId = uuidv4();

      // Configure for memory optimization
      const memoryOptimizedConfig: ExecutionConfig = {
        batchSize: 200, // Smaller batches for memory management
        maxRetryAttempts: 3,
        checkpointInterval: 5,
        parallelEntityLimit: 2, // Reduced parallelism
        timeoutMs: 180000,
        enableValidation: true,
        validationSampleSize: 20,
        enablePerformanceMonitoring: true,
        memoryOptimizationMode: true
      };

      const migrationExecutor = new MigrationExecutor(
        sourcePool,
        destinationPool,
        sessionId,
        memoryOptimizedConfig
      );

      const progressTracker = new ProgressTracker(sourcePool, destinationPool, sessionId);

      try {
        const migrationTasks = await createMemoryIntensiveTasks();
        const result = await migrationExecutor.executeMigrationTasks(migrationTasks);

        // Should complete without memory issues
        expect(result.overallStatus).toBe('completed');
        expect(result.executionSummary.peakMemoryUsageMb).toBeLessThan(256); // Optimized memory usage

        // Should maintain reasonable throughput
        expect(result.executionSummary.averageThroughput).toBeGreaterThan(50);

        // Memory optimization metrics should be present
        expect(result.memoryOptimization).toBeDefined();
        expect(result.memoryOptimization!.maxMemoryUsed).toBeLessThan(256);
        expect(result.memoryOptimization!.memoryEfficiency).toBeGreaterThan(0.7);

      } finally {
        await progressTracker.stop();
      }
    }, 480000);

    test('should process backlog in prioritized batches', async () => {
      // Create backlog with different priorities
      await createPrioritizedBacklog();

      const sessionId = uuidv4();
      const migrationExecutor = new MigrationExecutor(
        sourcePool,
        destinationPool,
        sessionId,
        {
          batchSize: 100,
          maxRetryAttempts: 3,
          checkpointInterval: 8,
          parallelEntityLimit: 3,
          timeoutMs: 240000,
          enableValidation: true,
          validationSampleSize: 25,
          enablePerformanceMonitoring: true,
          priorityBasedProcessing: true
        }
      );

      const progressTracker = new ProgressTracker(sourcePool, destinationPool, sessionId);

      try {
        const prioritizedTasks = await createPrioritizedTasks();

        // Track execution order
        const executionOrder: string[] = [];
        const unsubscribe = progressTracker.subscribeToUpdates((update) => {
          if (update.updateType === 'entity_started') {
            executionOrder.push(update.entityType);
          }
        });

        const result = await migrationExecutor.executeMigrationTasks(prioritizedTasks);

        unsubscribe();

        // Should process in priority order
        expect(result.overallStatus).toBe('completed');
        expect(executionOrder.length).toBeGreaterThan(0);

        // High priority entities should be processed first
        const highPriorityIndex = executionOrder.findIndex(entity => entity === 'offices');
        const lowPriorityIndex = executionOrder.findIndex(entity => entity === 'patients');

        if (highPriorityIndex !== -1 && lowPriorityIndex !== -1) {
          expect(highPriorityIndex).toBeLessThan(lowPriorityIndex);
        }

        // Should have priority processing metrics
        expect(result.priorityProcessing).toBeDefined();
        expect(result.priorityProcessing!.entitiesByPriority).toBeDefined();

      } finally {
        await progressTracker.stop();
      }
    }, 360000);

    test('should handle backlog processing interruption and recovery', async () => {
      // Create very large backlog for interruption testing
      await createVeryLargeBacklog();

      const sessionId = uuidv4();
      const checkpointManager = new CheckpointManager(destinationPool, sessionId);

      // First migration attempt (will be interrupted)
      const migrationExecutor1 = new MigrationExecutor(
        sourcePool,
        destinationPool,
        sessionId,
        {
          batchSize: 75,
          maxRetryAttempts: 3,
          checkpointInterval: 3,
          parallelEntityLimit: 2,
          timeoutMs: 120000,
          enableValidation: false, // Disable for speed
          enablePerformanceMonitoring: true
        }
      );

      try {
        const largeTasks = await createVeryLargeTasks();

        // Start migration
        const migrationPromise = migrationExecutor1.executeMigrationTasks(largeTasks);

        // Let it run and create several checkpoints
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Interrupt migration
        const pauseResult = await migrationExecutor1.pauseExecution();
        expect(pauseResult.success).toBe(true);

        const interruptedResult = await migrationPromise;
        expect(interruptedResult.overallStatus).toBe('paused');
        expect(interruptedResult.totalRecordsProcessed).toBeGreaterThan(100);

        // Verify checkpoints exist
        const checkpoints = await checkpointManager.listCheckpoints();
        expect(checkpoints.length).toBeGreaterThan(1);

        const activeCheckpoint = checkpoints.find(cp => cp.status === 'active');
        expect(activeCheckpoint).toBeDefined();

        // Create new executor for recovery (simulates restart)
        const migrationExecutor2 = new MigrationExecutor(
          sourcePool,
          destinationPool,
          sessionId,
          {
            batchSize: 100, // Different batch size for recovery
            maxRetryAttempts: 5,
            checkpointInterval: 5,
            parallelEntityLimit: 3,
            timeoutMs: 180000,
            enableValidation: true,
            enablePerformanceMonitoring: true
          }
        );

        // Resume from checkpoint
        const resumeResult = await migrationExecutor2.resumeExecution(activeCheckpoint!.checkpointId);
        expect(resumeResult.success).toBe(true);

        // Verify total processing matches expected
        const finalCheck = await verifyLargeBacklogCompletion(largeTasks);
        expect(finalCheck.allEntitiesProcessed).toBe(true);
        expect(finalCheck.totalRecordsMigrated).toBeGreaterThan(5000);

      } finally {
        await checkpointManager.cleanup();
      }
    }, 720000); // 12 minutes timeout for very large datasets

    test('should optimize performance for different entity sizes', async () => {
      // Create backlog with varying entity sizes
      await createVariableSizeBacklog();

      const sessionId = uuidv4();
      const migrationExecutor = new MigrationExecutor(
        sourcePool,
        destinationPool,
        sessionId,
        {
          batchSize: 150, // Will be auto-optimized
          maxRetryAttempts: 3,
          checkpointInterval: 10,
          parallelEntityLimit: 4,
          timeoutMs: 360000,
          enableValidation: true,
          validationSampleSize: 30,
          enablePerformanceMonitoring: true,
          adaptiveBatchSizing: true
        }
      );

      const progressTracker = new ProgressTracker(sourcePool, destinationPool, sessionId);

      try {
        const variableTasks = await createVariableSizeTasks();

        const result = await migrationExecutor.executeMigrationTasks(variableTasks);

        expect(result.overallStatus).toBe('completed');

        // Should have adaptive batch sizing metrics
        expect(result.adaptiveBatching).toBeDefined();
        expect(result.adaptiveBatching!.batchSizeAdjustments).toBeGreaterThan(0);

        // Should optimize for different entity characteristics
        const entityOptimizations = result.adaptiveBatching!.entityOptimizations;
        expect(entityOptimizations.length).toBeGreaterThan(0);

        for (const optimization of entityOptimizations) {
          expect(optimization.entityType).toBeDefined();
          expect(optimization.optimalBatchSize).toBeGreaterThan(0);
          expect(optimization.performanceGain).toBeGreaterThanOrEqual(0);
        }

        // Validate performance across different entity sizes
        const entityPerformance = result.entityPerformance;
        expect(entityPerformance.length).toBeGreaterThan(0);

        for (const perf of entityPerformance) {
          expect(perf.recordsPerSecond).toBeGreaterThan(0);
          expect(perf.memoryEfficiency).toBeGreaterThan(0);
          expect(perf.memoryEfficiency).toBeLessThanOrEqual(1);
        }

      } finally {
        await progressTracker.stop();
      }
    }, 480000);

    test('should handle resource scaling for massive datasets', async () => {
      // Create massive dataset scenario
      await createMassiveDataset();

      const sessionId = uuidv4();

      // Configure for maximum performance
      const highPerformanceConfig: ExecutionConfig = {
        batchSize: 1000, // Large batches
        maxRetryAttempts: 5,
        checkpointInterval: 20, // Less frequent checkpoints
        parallelEntityLimit: 6, // Maximum parallelism
        timeoutMs: 600000, // 10 minutes timeout
        enableValidation: true,
        validationSampleSize: 100,
        enablePerformanceMonitoring: true,
        resourceScalingMode: true
      };

      const migrationExecutor = new MigrationExecutor(
        sourcePool,
        destinationPool,
        sessionId,
        highPerformanceConfig
      );

      const progressTracker = new ProgressTracker(sourcePool, destinationPool, sessionId);

      try {
        const massiveTasks = await createMassiveDatasetTasks();

        // Track resource scaling
        const resourceMetrics: any[] = [];
        const metricsInterval = setInterval(async () => {
          try {
            const currentProgress = await progressTracker.getLatestProgress();
            if (currentProgress.length > 0) {
              resourceMetrics.push({
                timestamp: new Date(),
                totalThroughput: currentProgress.reduce((sum, p) => sum + p.performance.recordsPerSecond, 0),
                totalMemory: currentProgress.reduce((sum, p) => sum + p.performance.memoryUsageMb, 0),
                activeEntities: currentProgress.filter(p => p.status === 'running').length
              });
            }
          } catch (error) {
            // Ignore metrics collection errors
          }
        }, 2000);

        const startTime = Date.now();
        const result = await migrationExecutor.executeMigrationTasks(massiveTasks);
        const endTime = Date.now();

        clearInterval(metricsInterval);

        // Validate massive dataset processing
        expect(result.overallStatus).toBe('completed');
        expect(result.totalRecordsProcessed).toBeGreaterThan(10000);

        // Validate performance scaling
        expect(result.executionSummary.averageThroughput).toBeGreaterThan(200);
        expect(result.executionSummary.peakThroughput).toBeGreaterThan(500);
        expect(result.executionSummary.totalDurationMs).toBeLessThan(900000); // Under 15 minutes

        // Validate resource scaling metrics
        expect(result.resourceScaling).toBeDefined();
        expect(result.resourceScaling!.maxConcurrentEntities).toBeGreaterThan(2);
        expect(result.resourceScaling!.peakThroughput).toBeGreaterThan(300);
        expect(result.resourceScaling!.resourceUtilization.cpu).toBeGreaterThan(0.5);
        expect(result.resourceScaling!.resourceUtilization.memory).toBeGreaterThan(0.6);

        // Verify data integrity maintained at scale
        const integrityCheck = await performLargeScaleIntegrityCheck();
        expect(integrityCheck.success).toBe(true);
        expect(integrityCheck.recordsValidated).toBeGreaterThan(10000);
        expect(integrityCheck.integrityScore).toBeGreaterThan(0.99);

      } finally {
        await progressTracker.stop();
      }
    }, 900000); // 15 minutes timeout

    test('should handle staged backlog processing for very large datasets', async () => {
      // Create extremely large backlog that needs staged processing
      await createExtremelyLargeBacklog();

      const sessionId = uuidv4();
      const stagingResults: any[] = [];

      // Process in stages to handle extreme scale
      const entityStages = [
        ['offices'],
        ['doctors'],
        ['patients']
      ];

      for (let stage = 0; stage < entityStages.length; stage++) {
        const stageEntities = entityStages[stage];
        const stageSessionId = `${sessionId}-stage-${stage}`;

        const migrationExecutor = new MigrationExecutor(
          sourcePool,
          destinationPool,
          stageSessionId,
          {
            batchSize: 800,
            maxRetryAttempts: 3,
            checkpointInterval: 15,
            parallelEntityLimit: 2,
            timeoutMs: 480000, // 8 minutes per stage
            enableValidation: stage === entityStages.length - 1, // Only validate final stage
            validationSampleSize: 50,
            enablePerformanceMonitoring: true
          }
        );

        const progressTracker = new ProgressTracker(sourcePool, destinationPool, stageSessionId);

        try {
          const stageTasks = await createStageSpecificTasks(stageEntities);
          const stageStartTime = Date.now();
          const stageResult = await migrationExecutor.executeMigrationTasks(stageTasks);
          const stageEndTime = Date.now();

          stagingResults.push({
            stage: stage + 1,
            entities: stageEntities,
            result: stageResult,
            duration: stageEndTime - stageStartTime,
            recordsProcessed: stageResult.totalRecordsProcessed
          });

          // Each stage should complete successfully
          expect(stageResult.overallStatus).toBe('completed');
          expect(stageResult.totalRecordsProcessed).toBeGreaterThan(0);

        } finally {
          await progressTracker.stop();
        }
      }

      // Validate overall staged processing
      expect(stagingResults.length).toBe(3);

      const totalRecordsProcessed = stagingResults.reduce((sum, s) => sum + s.recordsProcessed, 0);
      const totalDuration = stagingResults.reduce((sum, s) => sum + s.duration, 0);

      expect(totalRecordsProcessed).toBeGreaterThan(15000);
      expect(totalDuration).toBeLessThan(1800000); // Under 30 minutes total

      // Validate staged processing efficiency
      const averageStageTime = totalDuration / stagingResults.length;
      expect(averageStageTime).toBeLessThan(600000); // Under 10 minutes per stage

      // Verify final data consistency across all stages
      const finalConsistencyCheck = await verifyMultiStageConsistency();
      expect(finalConsistencyCheck.success).toBe(true);
      expect(finalConsistencyCheck.crossStageIntegrity).toBe(true);
    }, 1200000); // 20 minutes timeout

    test('should optimize network usage for distributed processing', async () => {
      // Create distributed processing scenario
      await createDistributedProcessingBacklog();

      const sessionId = uuidv4();

      // Configure for network optimization
      const networkOptimizedConfig: ExecutionConfig = {
        batchSize: 400,
        maxRetryAttempts: 2,
        checkpointInterval: 12,
        parallelEntityLimit: 3,
        timeoutMs: 300000,
        enableValidation: true,
        validationSampleSize: 40,
        enablePerformanceMonitoring: true,
        networkOptimizationMode: true
      };

      const migrationExecutor = new MigrationExecutor(
        sourcePool,
        destinationPool,
        sessionId,
        networkOptimizedConfig
      );

      const progressTracker = new ProgressTracker(sourcePool, destinationPool, sessionId);

      try {
        const distributedTasks = await createDistributedProcessingTasks();
        const result = await migrationExecutor.executeMigrationTasks(distributedTasks);

        expect(result.overallStatus).toBe('completed');

        // Should have network optimization metrics
        expect(result.networkOptimization).toBeDefined();
        expect(result.networkOptimization!.totalQueries).toBeGreaterThan(0);
        expect(result.networkOptimization!.queryOptimization).toBeGreaterThan(0);
        expect(result.networkOptimization!.connectionPoolEfficiency).toBeGreaterThan(0.8);

        // Should minimize network roundtrips
        const expectedMinimumQueries = Math.ceil(result.totalRecordsProcessed / networkOptimizedConfig.batchSize!) * 2;
        expect(result.networkOptimization!.totalQueries).toBeLessThan(expectedMinimumQueries * 1.5);

      } finally {
        await progressTracker.stop();
      }
    }, 420000);
  });

  // Helper functions
  async function verifyDatabaseConnections(): Promise<void> {
    try {
      await sourcePool.query('SELECT 1');
      await destinationPool.query('SELECT 1');
    } catch (error) {
      throw new Error(`Database connection verification failed: ${error.message}`);
    }
  }

  async function setupLargeDatasetInfrastructure(): Promise<void> {
    // Setup tables for large dataset testing
    await setupLargeDatasetTables();
    await setupPerformanceMonitoringTables();
  }

  async function setupLargeDatasetTables(): Promise<void> {
    // Enhanced source tables for large datasets
    await sourcePool.query(`
      CREATE TABLE IF NOT EXISTS dispatch_offices (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        address TEXT,
        phone VARCHAR(20),
        email VARCHAR(255),
        status VARCHAR(50) DEFAULT 'active',
        region VARCHAR(100),
        size_category VARCHAR(20) DEFAULT 'medium',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        metadata JSONB
      )
    `);

    await sourcePool.query(`
      CREATE TABLE IF NOT EXISTS dispatch_doctors (
        id SERIAL PRIMARY KEY,
        office_id INTEGER REFERENCES dispatch_offices(id),
        name VARCHAR(255) NOT NULL,
        specialty VARCHAR(255),
        phone VARCHAR(20),
        email VARCHAR(255),
        license_number VARCHAR(50),
        years_experience INTEGER DEFAULT 0,
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        metadata JSONB
      )
    `);

    await sourcePool.query(`
      CREATE TABLE IF NOT EXISTS dispatch_patients (
        id SERIAL PRIMARY KEY,
        doctor_id INTEGER REFERENCES dispatch_doctors(id),
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(20),
        date_of_birth DATE,
        address TEXT,
        insurance_info JSONB,
        medical_history TEXT,
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        metadata JSONB
      )
    `);

    // Enhanced destination tables
    await destinationPool.query(`
      CREATE TABLE IF NOT EXISTS offices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        legacy_id INTEGER UNIQUE,
        name VARCHAR(255) NOT NULL,
        address TEXT,
        phone VARCHAR(20),
        email VARCHAR(255),
        status VARCHAR(50) DEFAULT 'active',
        region VARCHAR(100),
        size_category VARCHAR(20) DEFAULT 'medium',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        metadata JSONB
      )
    `);

    await destinationPool.query(`
      CREATE TABLE IF NOT EXISTS doctors (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        legacy_id INTEGER UNIQUE,
        office_id UUID REFERENCES offices(id),
        name VARCHAR(255) NOT NULL,
        specialty VARCHAR(255),
        phone VARCHAR(20),
        email VARCHAR(255),
        license_number VARCHAR(50),
        years_experience INTEGER DEFAULT 0,
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        metadata JSONB
      )
    `);

    await destinationPool.query(`
      CREATE TABLE IF NOT EXISTS patients (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        legacy_id INTEGER UNIQUE,
        doctor_id UUID REFERENCES doctors(id),
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(20),
        date_of_birth DATE,
        address TEXT,
        insurance_info JSONB,
        medical_history TEXT,
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        metadata JSONB
      )
    `);

    // Create indexes for performance
    await sourcePool.query('CREATE INDEX IF NOT EXISTS idx_dispatch_offices_updated_at ON dispatch_offices(updated_at)');
    await sourcePool.query('CREATE INDEX IF NOT EXISTS idx_dispatch_doctors_updated_at ON dispatch_doctors(updated_at)');
    await sourcePool.query('CREATE INDEX IF NOT EXISTS idx_dispatch_patients_updated_at ON dispatch_patients(updated_at)');

    await destinationPool.query('CREATE INDEX IF NOT EXISTS idx_offices_legacy_id ON offices(legacy_id)');
    await destinationPool.query('CREATE INDEX IF NOT EXISTS idx_doctors_legacy_id ON doctors(legacy_id)');
    await destinationPool.query('CREATE INDEX IF NOT EXISTS idx_patients_legacy_id ON patients(legacy_id)');
  }

  async function setupPerformanceMonitoringTables(): Promise<void> {
    await destinationPool.query(`
      CREATE TABLE IF NOT EXISTS large_scale_performance (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL,
        test_scenario VARCHAR(100) NOT NULL,
        records_processed INTEGER,
        processing_time_ms BIGINT,
        throughput DECIMAL(10,2),
        memory_usage_mb INTEGER,
        resource_efficiency DECIMAL(4,3),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
  }

  async function cleanupLargeDataset(): Promise<void> {
    const cleanupQueries = [
      'DROP TABLE IF EXISTS patients CASCADE',
      'DROP TABLE IF EXISTS doctors CASCADE',
      'DROP TABLE IF EXISTS offices CASCADE',
      'DROP TABLE IF EXISTS dispatch_patients CASCADE',
      'DROP TABLE IF EXISTS dispatch_doctors CASCADE',
      'DROP TABLE IF EXISTS dispatch_offices CASCADE',
      'DROP TABLE IF EXISTS large_scale_performance CASCADE'
    ];

    for (const query of cleanupQueries) {
      try {
        await sourcePool.query(query);
        await destinationPool.query(query);
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  }

  async function resetLargeDatasetEnvironment(): Promise<void> {
    // Clear existing data
    await sourcePool.query('DELETE FROM dispatch_patients');
    await sourcePool.query('DELETE FROM dispatch_doctors');
    await sourcePool.query('DELETE FROM dispatch_offices');
    await destinationPool.query('DELETE FROM patients');
    await destinationPool.query('DELETE FROM doctors');
    await destinationPool.query('DELETE FROM offices');

    // Reset performance tracking
    await destinationPool.query('DELETE FROM large_scale_performance');
  }

  async function createSignificantBacklog(): Promise<void> {
    // Create 10K+ records backlog
    const officeInserts = [];
    for (let i = 1; i <= LARGE_DATASET_CONFIG.offices; i++) {
      officeInserts.push(`('Backlog Office ${i}', '${i} Backlog St', '555-B${i.toString().padStart(3, '0')}', 'office${i}@backlog.com', '${['small', 'medium', 'large'][i % 3]}')`);
    }

    await sourcePool.query(`
      INSERT INTO dispatch_offices (name, address, phone, email, size_category)
      VALUES ${officeInserts.join(', ')}
    `);

    const doctorInserts = [];
    for (let i = 1; i <= LARGE_DATASET_CONFIG.doctors; i++) {
      const officeId = (i % LARGE_DATASET_CONFIG.offices) + 1;
      const specialties = ['Cardiology', 'Neurology', 'Pediatrics', 'Orthopedics', 'Dermatology'];
      doctorInserts.push(`(${officeId}, 'Dr. Backlog ${i}', '${specialties[i % specialties.length]}', '555-D${i.toString().padStart(3, '0')}', 'dr${i}@backlog.com', 'LIC${i.toString().padStart(6, '0')}', ${Math.floor(Math.random() * 30) + 1})`);
    }

    await sourcePool.query(`
      INSERT INTO dispatch_doctors (office_id, name, specialty, phone, email, license_number, years_experience)
      VALUES ${doctorInserts.join(', ')}
    `);

    // Create patients in batches to avoid memory issues
    const patientsPerBatch = 100;
    const totalPatients = LARGE_DATASET_CONFIG.patients;

    for (let batch = 0; batch < Math.ceil(totalPatients / patientsPerBatch); batch++) {
      const patientInserts = [];
      const startIdx = batch * patientsPerBatch + 1;
      const endIdx = Math.min(startIdx + patientsPerBatch - 1, totalPatients);

      for (let i = startIdx; i <= endIdx; i++) {
        const doctorId = (i % LARGE_DATASET_CONFIG.doctors) + 1;
        const birthYear = 1950 + (i % 50);
        patientInserts.push(`(${doctorId}, 'Patient Backlog ${i}', 'patient${i}@backlog.com', '555-P${i.toString().padStart(4, '0')}', '${birthYear}-01-01', '${i} Patient St, Backlog City')`);
      }

      await sourcePool.query(`
        INSERT INTO dispatch_patients (doctor_id, name, email, phone, date_of_birth, address)
        VALUES ${patientInserts.join(', ')}
      `);
    }
  }

  async function createMemoryIntensiveBacklog(): Promise<void> {
    // Create backlog with large text fields and JSON data
    const officeInserts = [];
    for (let i = 1; i <= 30; i++) {
      const largeDescription = 'Large description field '.repeat(100); // Large text data
      const complexMetadata = JSON.stringify({
        services: Array.from({length: 50}, (_, idx) => `Service ${idx + 1}`),
        equipment: Array.from({length: 25}, (_, idx) => `Equipment ${idx + 1}`),
        history: Array.from({length: 20}, (_, idx) => ({ year: 2000 + idx, event: `Event ${idx + 1}` }))
      });

      officeInserts.push(`('Memory Office ${i}', '${largeDescription}', '555-M${i.toString().padStart(3, '0')}', 'office${i}@memory.com', '${complexMetadata}')`);
    }

    await sourcePool.query(`
      INSERT INTO dispatch_offices (name, address, phone, email, metadata)
      VALUES ${officeInserts.join(', ')}
    `);
  }

  async function createPrioritizedBacklog(): Promise<void> {
    // Create backlog with clear priority distinctions
    await sourcePool.query(`
      INSERT INTO dispatch_offices (name, address, phone, size_category)
      VALUES
        ('Critical Office 1', '100 Critical St', '555-C001', 'large'),
        ('Critical Office 2', '200 Critical Ave', '555-C002', 'large'),
        ('Standard Office 1', '300 Standard St', '555-S001', 'medium'),
        ('Standard Office 2', '400 Standard Ave', '555-S002', 'medium'),
        ('Low Priority Office', '500 Low St', '555-L001', 'small')
    `);

    const doctorInserts = [];
    for (let i = 1; i <= 25; i++) {
      const officeId = (i % 5) + 1;
      doctorInserts.push(`(${officeId}, 'Priority Dr. ${i}', 'Specialty ${i % 5}', '555-PD${i.toString().padStart(2, '0')}', 'dr${i}@priority.com')`);
    }

    await sourcePool.query(`
      INSERT INTO dispatch_doctors (office_id, name, specialty, phone, email)
      VALUES ${doctorInserts.join(', ')}
    `);

    const patientInserts = [];
    for (let i = 1; i <= 100; i++) {
      const doctorId = (i % 25) + 1;
      patientInserts.push(`(${doctorId}, 'Priority Patient ${i}', 'patient${i}@priority.com', '555-PP${i.toString().padStart(3, '0')}')`);
    }

    await sourcePool.query(`
      INSERT INTO dispatch_patients (doctor_id, name, email, phone)
      VALUES ${patientInserts.join(', ')}
    `);
  }

  async function createVeryLargeBacklog(): Promise<void> {
    // Create backlog large enough for interruption testing
    const batchSize = 50;

    // Create offices in batches
    for (let batch = 0; batch < 4; batch++) {
      const officeInserts = [];
      for (let i = 1; i <= batchSize; i++) {
        const officeNum = batch * batchSize + i;
        officeInserts.push(`('VL Office ${officeNum}', '${officeNum} VL St', '555-VL${officeNum.toString().padStart(3, '0')}')`);
      }

      await sourcePool.query(`
        INSERT INTO dispatch_offices (name, address, phone)
        VALUES ${officeInserts.join(', ')}
      `);
    }

    // Create doctors
    for (let batch = 0; batch < 8; batch++) {
      const doctorInserts = [];
      for (let i = 1; i <= batchSize; i++) {
        const doctorNum = batch * batchSize + i;
        const officeId = ((doctorNum - 1) % (4 * batchSize)) + 1;
        doctorInserts.push(`(${officeId}, 'VL Dr. ${doctorNum}', 'Specialty ${doctorNum % 10}', '555-VLD${doctorNum.toString().padStart(3, '0')}')`);
      }

      await sourcePool.query(`
        INSERT INTO dispatch_doctors (office_id, name, specialty, phone)
        VALUES ${doctorInserts.join(', ')}
      `);
    }
  }

  async function createVariableSizeBacklog(): Promise<void> {
    // Create entities with varying sizes for optimization testing

    // Small offices
    for (let i = 1; i <= 10; i++) {
      await sourcePool.query(`
        INSERT INTO dispatch_offices (name, address, phone, size_category)
        VALUES ('Small Office ${i}', '${i} Small St', '555-SM${i.toString().padStart(2, '0')}', 'small')
      `);
    }

    // Medium offices with more data
    for (let i = 1; i <= 20; i++) {
      const mediumMetadata = JSON.stringify({ departments: [`Dept ${i}`], facilities: [`Facility ${i}`] });
      await sourcePool.query(`
        INSERT INTO dispatch_offices (name, address, phone, size_category, metadata)
        VALUES ('Medium Office ${i}', '${i} Medium Ave', '555-MD${i.toString().padStart(2, '0')}', 'medium', $1)
      `, [mediumMetadata]);
    }

    // Large offices with extensive data
    for (let i = 1; i <= 5; i++) {
      const largeMetadata = JSON.stringify({
        departments: Array.from({length: 10}, (_, idx) => `Department ${idx + 1}`),
        facilities: Array.from({length: 15}, (_, idx) => `Facility ${idx + 1}`),
        equipment: Array.from({length: 20}, (_, idx) => `Equipment ${idx + 1}`)
      });
      await sourcePool.query(`
        INSERT INTO dispatch_offices (name, address, phone, size_category, metadata)
        VALUES ('Large Office ${i}', '${i} Large Blvd', '555-LG${i.toString().padStart(2, '0')}', 'large', $1)
      `, [largeMetadata]);
    }
  }

  async function createMassiveDataset(): Promise<void> {
    // Create truly massive dataset for scaling tests
    console.log('Creating massive dataset - this may take a moment...');

    // Use generate_series for efficient bulk inserts
    await sourcePool.query(`
      INSERT INTO dispatch_offices (name, address, phone, email, region, size_category)
      SELECT
        'Massive Office ' || g.id,
        g.id || ' Massive St',
        '555-' || LPAD(g.id::TEXT, 4, '0'),
        'office' || g.id || '@massive.com',
        CASE g.id % 5
          WHEN 0 THEN 'North'
          WHEN 1 THEN 'South'
          WHEN 2 THEN 'East'
          WHEN 3 THEN 'West'
          ELSE 'Central'
        END,
        CASE g.id % 3
          WHEN 0 THEN 'small'
          WHEN 1 THEN 'medium'
          ELSE 'large'
        END
      FROM generate_series(1, 100) AS g(id)
    `);

    await sourcePool.query(`
      INSERT INTO dispatch_doctors (office_id, name, specialty, phone, email, license_number, years_experience)
      SELECT
        ((g.id - 1) % 100) + 1,
        'Massive Dr. ' || g.id,
        CASE g.id % 8
          WHEN 0 THEN 'Cardiology'
          WHEN 1 THEN 'Neurology'
          WHEN 2 THEN 'Pediatrics'
          WHEN 3 THEN 'Orthopedics'
          WHEN 4 THEN 'Dermatology'
          WHEN 5 THEN 'Ophthalmology'
          WHEN 6 THEN 'Psychiatry'
          ELSE 'General Medicine'
        END,
        '555-MD' || LPAD(g.id::TEXT, 4, '0'),
        'dr' || g.id || '@massive.com',
        'LIC' || LPAD(g.id::TEXT, 8, '0'),
        (g.id % 35) + 1
      FROM generate_series(1, 800) AS g(id)
    `);

    // Create patients in batches to manage memory
    const patientBatchSize = 1000;
    for (let batch = 0; batch < 15; batch++) {
      const startId = batch * patientBatchSize + 1;
      const endId = (batch + 1) * patientBatchSize;

      await sourcePool.query(`
        INSERT INTO dispatch_patients (doctor_id, name, email, phone, date_of_birth, address)
        SELECT
          ((g.id - 1) % 800) + 1,
          'Massive Patient ' || g.id,
          'patient' || g.id || '@massive.com',
          '555-MP' || LPAD(g.id::TEXT, 5, '0'),
          DATE '1960-01-01' + (g.id % 15000) * INTERVAL '1 day',
          g.id || ' Patient St, Massive City'
        FROM generate_series($1, $2) AS g(id)
      `, [startId, endId]);
    }

    console.log('Massive dataset creation completed');
  }

  async function createExtremelyLargeBacklog(): Promise<void> {
    // Create extremely large dataset for staged processing
    console.log('Creating extremely large backlog...');

    // Use efficient bulk insert methods
    await sourcePool.query(`
      INSERT INTO dispatch_offices (name, address, phone, email, region, size_category, metadata)
      SELECT
        'Extreme Office ' || g.id,
        g.id || ' Extreme Blvd',
        '555-EX' || LPAD(g.id::TEXT, 4, '0'),
        'extreme' || g.id || '@test.com',
        CASE g.id % 4 WHEN 0 THEN 'North' WHEN 1 THEN 'South' WHEN 2 THEN 'East' ELSE 'West' END,
        CASE g.id % 3 WHEN 0 THEN 'small' WHEN 1 THEN 'medium' ELSE 'large' END,
        ('{"facility_count": ' || (g.id % 20 + 1) || ', "established": ' || (1990 + g.id % 30) || '}')::jsonb
      FROM generate_series(1, 200) AS g(id)
    `);

    await sourcePool.query(`
      INSERT INTO dispatch_doctors (office_id, name, specialty, phone, email, license_number, years_experience, metadata)
      SELECT
        ((g.id - 1) % 200) + 1,
        'Extreme Dr. ' || g.id,
        CASE g.id % 10
          WHEN 0 THEN 'Cardiology' WHEN 1 THEN 'Neurology' WHEN 2 THEN 'Pediatrics' WHEN 3 THEN 'Orthopedics'
          WHEN 4 THEN 'Dermatology' WHEN 5 THEN 'Oncology' WHEN 6 THEN 'Psychiatry' WHEN 7 THEN 'Radiology'
          WHEN 8 THEN 'Surgery' ELSE 'General Medicine'
        END,
        '555-ED' || LPAD(g.id::TEXT, 4, '0'),
        'extreme.dr' || g.id || '@test.com',
        'EXTREME' || LPAD(g.id::TEXT, 6, '0'),
        (g.id % 40) + 1,
        ('{"certifications": ["Cert' || g.id || 'A", "Cert' || g.id || 'B"], "research_areas": ["Area' || g.id || '"]}')::jsonb
      FROM generate_series(1, 1000) AS g(id)
    `);

    // Create massive patient dataset
    const patientBatches = 50;
    const patientsPerPatientBatch = 400;

    for (let batch = 0; batch < patientBatches; batch++) {
      const startId = batch * patientsPerPatientBatch + 1;
      const endId = (batch + 1) * patientsPerPatientBatch;

      await sourcePool.query(`
        INSERT INTO dispatch_patients (doctor_id, name, email, phone, date_of_birth, address, medical_history)
        SELECT
          ((g.id - 1) % 1000) + 1,
          'Extreme Patient ' || g.id,
          'extreme.patient' || g.id || '@test.com',
          '555-EP' || LPAD(g.id::TEXT, 5, '0'),
          DATE '1930-01-01' + (g.id % 25000) * INTERVAL '1 day',
          g.id || ' Extreme Patient Ave, Test City',
          'Medical history for patient ' || g.id || '. Previous conditions and treatments documented.'
        FROM generate_series($1, $2) AS g(id)
      `, [startId, endId]);
    }

    console.log('Extremely large backlog creation completed');
  }

  async function createDistributedProcessingBacklog(): Promise<void> {
    // Create backlog optimized for distributed processing
    await sourcePool.query(`
      INSERT INTO dispatch_offices (name, address, phone, region)
      SELECT
        'Distributed Office ' || g.id,
        g.id || ' Distributed Dr',
        '555-DIST' || LPAD(g.id::TEXT, 2, '0'),
        CASE g.id % 4 WHEN 0 THEN 'Region A' WHEN 1 THEN 'Region B' WHEN 2 THEN 'Region C' ELSE 'Region D' END
      FROM generate_series(1, 40) AS g(id)
    `);

    await sourcePool.query(`
      INSERT INTO dispatch_doctors (office_id, name, specialty, phone)
      SELECT
        ((g.id - 1) % 40) + 1,
        'Distributed Dr. ' || g.id,
        'Specialty ' || (g.id % 6),
        '555-DDR' || LPAD(g.id::TEXT, 3, '0')
      FROM generate_series(1, 160) AS g(id)
    `);
  }

  async function createLargeBacklogTasks(): Promise<MigrationTask[]> {
    const officeIds = await sourcePool.query('SELECT id FROM dispatch_offices ORDER BY id');
    const doctorIds = await sourcePool.query('SELECT id FROM dispatch_doctors ORDER BY id');
    const patientIds = await sourcePool.query('SELECT id FROM dispatch_patients ORDER BY id LIMIT 5000'); // Limit for test performance

    return [
      {
        entityType: 'offices',
        recordIds: officeIds.rows.map(row => row.id.toString()),
        priority: 'high',
        dependencies: [],
        estimatedDurationMs: 30000,
        metadata: {
          sourceTable: 'dispatch_offices',
          destinationTable: 'offices',
          totalRecords: officeIds.rows.length,
          migrationMethod: 'differential'
        }
      },
      {
        entityType: 'doctors',
        recordIds: doctorIds.rows.map(row => row.id.toString()),
        priority: 'medium',
        dependencies: ['offices'],
        estimatedDurationMs: 60000,
        metadata: {
          sourceTable: 'dispatch_doctors',
          destinationTable: 'doctors',
          totalRecords: doctorIds.rows.length,
          migrationMethod: 'differential'
        }
      },
      {
        entityType: 'patients',
        recordIds: patientIds.rows.map(row => row.id.toString()),
        priority: 'low',
        dependencies: ['doctors'],
        estimatedDurationMs: 300000,
        metadata: {
          sourceTable: 'dispatch_patients',
          destinationTable: 'patients',
          totalRecords: patientIds.rows.length,
          migrationMethod: 'differential'
        }
      }
    ];
  }

  async function createMemoryIntensiveTasks(): Promise<MigrationTask[]> {
    const officeIds = await sourcePool.query('SELECT id FROM dispatch_offices ORDER BY id');

    return [
      {
        entityType: 'offices',
        recordIds: officeIds.rows.map(row => row.id.toString()),
        priority: 'high',
        dependencies: [],
        estimatedDurationMs: 45000,
        metadata: {
          sourceTable: 'dispatch_offices',
          destinationTable: 'offices',
          totalRecords: officeIds.rows.length,
          migrationMethod: 'differential',
          memoryIntensive: true
        }
      }
    ];
  }

  async function createPrioritizedTasks(): Promise<MigrationTask[]> {
    const officeIds = await sourcePool.query('SELECT id FROM dispatch_offices ORDER BY id');
    const doctorIds = await sourcePool.query('SELECT id FROM dispatch_doctors ORDER BY id');
    const patientIds = await sourcePool.query('SELECT id FROM dispatch_patients ORDER BY id');

    return [
      {
        entityType: 'offices',
        recordIds: officeIds.rows.map(row => row.id.toString()),
        priority: 'high',
        dependencies: [],
        estimatedDurationMs: 15000,
        metadata: {
          sourceTable: 'dispatch_offices',
          destinationTable: 'offices',
          totalRecords: officeIds.rows.length,
          migrationMethod: 'differential'
        }
      },
      {
        entityType: 'doctors',
        recordIds: doctorIds.rows.map(row => row.id.toString()),
        priority: 'medium',
        dependencies: ['offices'],
        estimatedDurationMs: 25000,
        metadata: {
          sourceTable: 'dispatch_doctors',
          destinationTable: 'doctors',
          totalRecords: doctorIds.rows.length,
          migrationMethod: 'differential'
        }
      },
      {
        entityType: 'patients',
        recordIds: patientIds.rows.map(row => row.id.toString()),
        priority: 'low',
        dependencies: ['doctors'],
        estimatedDurationMs: 60000,
        metadata: {
          sourceTable: 'dispatch_patients',
          destinationTable: 'patients',
          totalRecords: patientIds.rows.length,
          migrationMethod: 'differential'
        }
      }
    ];
  }

  async function createVeryLargeTasks(): Promise<MigrationTask[]> {
    const officeIds = await sourcePool.query('SELECT id FROM dispatch_offices ORDER BY id');
    const doctorIds = await sourcePool.query('SELECT id FROM dispatch_doctors ORDER BY id');

    return [
      {
        entityType: 'offices',
        recordIds: officeIds.rows.map(row => row.id.toString()),
        priority: 'high',
        dependencies: [],
        estimatedDurationMs: 60000,
        metadata: {
          sourceTable: 'dispatch_offices',
          destinationTable: 'offices',
          totalRecords: officeIds.rows.length,
          migrationMethod: 'differential'
        }
      },
      {
        entityType: 'doctors',
        recordIds: doctorIds.rows.map(row => row.id.toString()),
        priority: 'medium',
        dependencies: ['offices'],
        estimatedDurationMs: 120000,
        metadata: {
          sourceTable: 'dispatch_doctors',
          destinationTable: 'doctors',
          totalRecords: doctorIds.rows.length,
          migrationMethod: 'differential'
        }
      }
    ];
  }

  async function createStageSpecificTasks(entities: string[]): Promise<MigrationTask[]> {
    const tasks: MigrationTask[] = [];

    for (const entity of entities) {
      const sourceTable = `dispatch_${entity}`;
      const recordIds = await sourcePool.query(`SELECT id FROM ${sourceTable} ORDER BY id`);

      if (recordIds.rows.length > 0) {
        tasks.push({
          entityType: entity,
          recordIds: recordIds.rows.map(row => row.id.toString()),
          priority: entity === 'offices' ? 'high' : entity === 'doctors' ? 'medium' : 'low',
          dependencies: getDependenciesForEntity(entity),
          estimatedDurationMs: recordIds.rows.length * 50,
          metadata: {
            sourceTable,
            destinationTable: entity,
            totalRecords: recordIds.rows.length,
            migrationMethod: 'differential',
            stageProcessing: true
          }
        });
      }
    }

    return tasks;
  }

  async function createVariableSizeTasks(): Promise<MigrationTask[]> {
    const officeIds = await sourcePool.query('SELECT id FROM dispatch_offices ORDER BY id');

    return [
      {
        entityType: 'offices',
        recordIds: officeIds.rows.map(row => row.id.toString()),
        priority: 'high',
        dependencies: [],
        estimatedDurationMs: 35000,
        metadata: {
          sourceTable: 'dispatch_offices',
          destinationTable: 'offices',
          totalRecords: officeIds.rows.length,
          migrationMethod: 'differential',
          variableSizes: true
        }
      }
    ];
  }

  async function createMassiveDatasetTasks(): Promise<MigrationTask[]> {
    const officeIds = await sourcePool.query('SELECT id FROM dispatch_offices ORDER BY id');
    const doctorIds = await sourcePool.query('SELECT id FROM dispatch_doctors ORDER BY id');
    const patientIds = await sourcePool.query('SELECT id FROM dispatch_patients ORDER BY id');

    return [
      {
        entityType: 'offices',
        recordIds: officeIds.rows.map(row => row.id.toString()),
        priority: 'high',
        dependencies: [],
        estimatedDurationMs: 60000,
        metadata: {
          sourceTable: 'dispatch_offices',
          destinationTable: 'offices',
          totalRecords: officeIds.rows.length,
          migrationMethod: 'differential'
        }
      },
      {
        entityType: 'doctors',
        recordIds: doctorIds.rows.map(row => row.id.toString()),
        priority: 'medium',
        dependencies: ['offices'],
        estimatedDurationMs: 180000,
        metadata: {
          sourceTable: 'dispatch_doctors',
          destinationTable: 'doctors',
          totalRecords: doctorIds.rows.length,
          migrationMethod: 'differential'
        }
      },
      {
        entityType: 'patients',
        recordIds: patientIds.rows.map(row => row.id.toString()),
        priority: 'low',
        dependencies: ['doctors'],
        estimatedDurationMs: 900000,
        metadata: {
          sourceTable: 'dispatch_patients',
          destinationTable: 'patients',
          totalRecords: patientIds.rows.length,
          migrationMethod: 'differential'
        }
      }
    ];
  }

  async function createDistributedProcessingTasks(): Promise<MigrationTask[]> {
    const officeIds = await sourcePool.query('SELECT id FROM dispatch_offices ORDER BY id');
    const doctorIds = await sourcePool.query('SELECT id FROM dispatch_doctors ORDER BY id');

    return [
      {
        entityType: 'offices',
        recordIds: officeIds.rows.map(row => row.id.toString()),
        priority: 'high',
        dependencies: [],
        estimatedDurationMs: 30000,
        metadata: {
          sourceTable: 'dispatch_offices',
          destinationTable: 'offices',
          totalRecords: officeIds.rows.length,
          migrationMethod: 'differential',
          distributedProcessing: true
        }
      },
      {
        entityType: 'doctors',
        recordIds: doctorIds.rows.map(row => row.id.toString()),
        priority: 'medium',
        dependencies: ['offices'],
        estimatedDurationMs: 90000,
        metadata: {
          sourceTable: 'dispatch_doctors',
          destinationTable: 'doctors',
          totalRecords: doctorIds.rows.length,
          migrationMethod: 'differential',
          distributedProcessing: true
        }
      }
    ];
  }

  async function verifyLargeBacklogCompletion(tasks: MigrationTask[]): Promise<{ allEntitiesProcessed: boolean; totalRecordsMigrated: number }> {
    let totalRecordsMigrated = 0;
    let allEntitiesProcessed = true;

    try {
      for (const task of tasks) {
        const sourceCount = await sourcePool.query(`SELECT COUNT(*) FROM ${task.metadata.sourceTable}`);
        const destCount = await destinationPool.query(`SELECT COUNT(*) FROM ${task.metadata.destinationTable}`);

        const sourceTotal = parseInt(sourceCount.rows[0].count);
        const destTotal = parseInt(destCount.rows[0].count);

        totalRecordsMigrated += destTotal;

        if (sourceTotal !== destTotal) {
          allEntitiesProcessed = false;
        }
      }

      return { allEntitiesProcessed, totalRecordsMigrated };
    } catch (error) {
      return { allEntitiesProcessed: false, totalRecordsMigrated: 0 };
    }
  }

  async function performLargeScaleIntegrityCheck(): Promise<{ success: boolean; recordsValidated: number; integrityScore: number }> {
    try {
      let recordsValidated = 0;
      let integrityIssues = 0;

      // Check foreign key integrity at scale
      const fkCheck = await destinationPool.query(`
        SELECT COUNT(*) as issues FROM (
          SELECT d.id FROM doctors d LEFT JOIN offices o ON d.office_id = o.id WHERE d.office_id IS NOT NULL AND o.id IS NULL
          UNION ALL
          SELECT p.id FROM patients p LEFT JOIN doctors d ON p.doctor_id = d.id WHERE p.doctor_id IS NOT NULL AND d.id IS NULL
        ) integrity_issues
      `);

      integrityIssues += parseInt(fkCheck.rows[0].issues);

      // Check duplicate records
      const duplicateCheck = await destinationPool.query(`
        SELECT COUNT(*) as issues FROM (
          SELECT legacy_id FROM offices WHERE legacy_id IS NOT NULL GROUP BY legacy_id HAVING COUNT(*) > 1
          UNION ALL
          SELECT legacy_id FROM doctors WHERE legacy_id IS NOT NULL GROUP BY legacy_id HAVING COUNT(*) > 1
          UNION ALL
          SELECT legacy_id FROM patients WHERE legacy_id IS NOT NULL GROUP BY legacy_id HAVING COUNT(*) > 1
        ) duplicates
      `);

      integrityIssues += parseInt(duplicateCheck.rows[0].issues);

      // Count total records validated
      const totalRecords = await destinationPool.query(`
        SELECT
          (SELECT COUNT(*) FROM offices) +
          (SELECT COUNT(*) FROM doctors) +
          (SELECT COUNT(*) FROM patients) as total
      `);

      recordsValidated = parseInt(totalRecords.rows[0].total);

      // Calculate integrity score
      const integrityScore = recordsValidated > 0
        ? Math.max(0, (recordsValidated - integrityIssues) / recordsValidated)
        : 0;

      return {
        success: integrityIssues === 0,
        recordsValidated,
        integrityScore
      };
    } catch (error) {
      return {
        success: false,
        recordsValidated: 0,
        integrityScore: 0
      };
    }
  }

  async function verifyMultiStageConsistency(): Promise<{ success: boolean; crossStageIntegrity: boolean }> {
    try {
      // Verify relationships across stages are maintained
      const relationshipCheck = await destinationPool.query(`
        WITH relationship_check AS (
          SELECT
            'doctors_to_offices' as relationship,
            COUNT(*) as total,
            COUNT(o.id) as valid
          FROM doctors d
          LEFT JOIN offices o ON d.office_id = o.id
          WHERE d.office_id IS NOT NULL

          UNION ALL

          SELECT
            'patients_to_doctors' as relationship,
            COUNT(*) as total,
            COUNT(d.id) as valid
          FROM patients p
          LEFT JOIN doctors d ON p.doctor_id = d.id
          WHERE p.doctor_id IS NOT NULL
        )
        SELECT
          relationship,
          total,
          valid,
          CASE WHEN total = valid THEN true ELSE false END as integrity
        FROM relationship_check
      `);

      const allIntegrityChecks = relationshipCheck.rows.every(row => row.integrity);

      return {
        success: true,
        crossStageIntegrity: allIntegrityChecks
      };
    } catch (error) {
      return {
        success: false,
        crossStageIntegrity: false
      };
    }
  }

  function getDependenciesForEntity(entity: string): string[] {
    const dependencyMap: Record<string, string[]> = {
      offices: [],
      doctors: ['offices'],
      patients: ['doctors']
    };

    return dependencyMap[entity] || [];
  }
});