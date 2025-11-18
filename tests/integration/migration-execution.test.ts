/**
 * Complete Migration Execution Workflow Integration Tests
 * Tests end-to-end migration with checkpointing and recovery
 */

import { Pool } from 'pg';
import { MigrationExecutor, type ExecutionConfig, type MigrationTask, type MigrationExecutionResult } from '../../src/differential-migration/services/migration-executor';
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
    maxConnections: 10,
    connectionTimeoutMs: 5000
  },
  destinationDb: {
    host: process.env.TARGET_DB_HOST || 'localhost',
    port: parseInt(process.env.TARGET_DB_PORT || '54322'),
    database: process.env.TARGET_DB_NAME || 'test_target_db',
    user: process.env.TARGET_DB_USER || 'postgres',
    password: process.env.TARGET_DB_PASSWORD || 'postgres',
    maxConnections: 10,
    connectionTimeoutMs: 5000
  }
};

describe('Complete Migration Execution Workflow Integration Tests', () => {
  let sourcePool: Pool;
  let destinationPool: Pool;
  let migrationExecutor: MigrationExecutor;
  let progressTracker: ProgressTracker;
  let checkpointManager: CheckpointManager;
  let sessionId: string;

  beforeAll(async () => {
    // Initialize database connections
    sourcePool = new Pool(TEST_CONFIG.sourceDb);
    destinationPool = new Pool(TEST_CONFIG.destinationDb);

    // Verify database connections
    await verifyDatabaseConnections();

    // Setup test infrastructure
    await setupTestInfrastructure();
  });

  afterAll(async () => {
    // Cleanup test data and close connections
    await cleanupTestData();
    await sourcePool.end();
    await destinationPool.end();
  });

  beforeEach(async () => {
    // Create fresh session for each test
    sessionId = uuidv4();

    // Initialize services
    const executionConfig: ExecutionConfig = {
      batchSize: 100,
      maxRetryAttempts: 3,
      checkpointInterval: 5,
      parallelEntityLimit: 2,
      timeoutMs: 30000,
      enableValidation: true,
      validationSampleSize: 10,
      enablePerformanceMonitoring: true
    };

    migrationExecutor = new MigrationExecutor(
      sourcePool,
      destinationPool,
      sessionId,
      executionConfig
    );

    progressTracker = new ProgressTracker(
      sourcePool,
      destinationPool,
      sessionId
    );

    checkpointManager = new CheckpointManager(destinationPool, sessionId);

    // Reset test data for each test
    await resetTestData();
  });

  afterEach(async () => {
    // Clean up services
    if (progressTracker) {
      await progressTracker.stop();
    }
    if (checkpointManager) {
      await checkpointManager.cleanup();
    }
  });

  describe('End-to-End Migration Execution Workflow', () => {
    test('should execute complete migration workflow successfully', async () => {
      const migrationTasks = await createTestMigrationTasks();

      const result = await migrationExecutor.executeMigrationTasks(migrationTasks);

      // Validate execution result
      expect(result.overallStatus).toBe('completed');
      expect(result.sessionId).toBe(sessionId);
      expect(result.totalRecordsProcessed).toBeGreaterThan(0);
      expect(result.totalRecordsFailed).toBe(0);
      expect(result.entitiesProcessed).toContain('offices');
      expect(result.entitiesProcessed).toContain('doctors');
      expect(result.entitiesFailed).toHaveLength(0);

      // Validate performance metrics
      expect(result.executionSummary.totalDurationMs).toBeGreaterThan(0);
      expect(result.executionSummary.averageThroughput).toBeGreaterThan(0);
      expect(result.executionSummary.peakMemoryUsageMb).toBeGreaterThan(0);

      // Validate checkpoints were created
      expect(result.checkpoints.length).toBeGreaterThan(0);

      // Verify data was actually migrated
      const verificationResult = await verifyMigratedData();
      expect(verificationResult.success).toBe(true);
      expect(verificationResult.migratedRecords).toBeGreaterThan(0);
    }, 60000);

    test('should handle dependency-aware execution order', async () => {
      const migrationTasks = await createDependentMigrationTasks();

      const result = await migrationExecutor.executeMigrationTasks(migrationTasks);

      // Should complete successfully despite dependencies
      expect(result.overallStatus).toBe('completed');

      // Validate dependency resolution
      expect(result.dependencyResolution.reordered).toBe(true);
      expect(result.dependencyResolution.executionOrder).toBeDefined();

      // Verify execution order respected dependencies
      const executionOrder = result.dependencyResolution.executionOrder.flat();
      const officesIndex = executionOrder.indexOf('offices');
      const doctorsIndex = executionOrder.indexOf('doctors');
      const patientsIndex = executionOrder.indexOf('patients');

      expect(officesIndex).toBeLessThan(doctorsIndex); // offices before doctors
      expect(doctorsIndex).toBeLessThan(patientsIndex); // doctors before patients
    });

    test('should create and use checkpoints for resumability', async () => {
      const migrationTasks = await createLargeDatasetMigrationTasks();

      // Start migration execution
      const executionPromise = migrationExecutor.executeMigrationTasks(migrationTasks);

      // Let it run for a bit to create checkpoints
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Pause execution to test checkpoint creation
      const pauseResult = await migrationExecutor.pauseExecution();
      expect(pauseResult.success).toBe(true);
      expect(pauseResult.checkpointId).toBeDefined();

      // Wait for execution to pause
      const result = await executionPromise;
      expect(result.overallStatus).toBe('paused');

      // Verify checkpoint was created
      const checkpoints = await checkpointManager.listCheckpoints();
      expect(checkpoints.length).toBeGreaterThan(0);

      const latestCheckpoint = checkpoints[checkpoints.length - 1];
      expect(latestCheckpoint.status).toBe('active');
      expect(latestCheckpoint.recordsProcessed).toBeGreaterThan(0);

      // Resume from checkpoint
      const resumeResult = await migrationExecutor.resumeExecution(latestCheckpoint.checkpointId);
      expect(resumeResult.success).toBe(true);
      expect(resumeResult.resumedFromBatch).toBeGreaterThan(0);
    }, 90000);

    test('should handle batch processing with error recovery', async () => {
      // Create migration task with some problematic records
      const migrationTasks = await createProblematicMigrationTasks();

      const result = await migrationExecutor.executeMigrationTasks(migrationTasks);

      // Should complete with partial success
      expect(result.overallStatus).toMatch(/^(completed|partial)$/);
      expect(result.totalRecordsProcessed).toBeGreaterThan(0);
      expect(result.totalRecordsFailed).toBeGreaterThan(0);

      // Validate batch results contain error information
      expect(result.batchResults).toBeDefined();
      expect(result.batchResults!.length).toBeGreaterThan(0);

      const failedBatches = result.batchResults!.filter(b => b.failedRecords > 0);
      expect(failedBatches.length).toBeGreaterThan(0);

      for (const batch of failedBatches) {
        expect(batch.errors).toBeDefined();
        expect(batch.errors!.length).toBeGreaterThan(0);

        for (const error of batch.errors!) {
          expect(error.recordId).toBeDefined();
          expect(error.errorType).toBeDefined();
          expect(error.message).toBeDefined();
          expect(typeof error.retryable).toBe('boolean');
        }
      }
    });

    test('should track progress accurately during execution', async () => {
      const migrationTasks = await createTestMigrationTasks();

      // Start progress tracking
      const progressUpdates: any[] = [];
      const unsubscribe = progressTracker.subscribeToUpdates((update) => {
        progressUpdates.push(update);
      });

      try {
        const result = await migrationExecutor.executeMigrationTasks(migrationTasks);

        // Should have received progress updates
        expect(progressUpdates.length).toBeGreaterThan(0);

        // Validate progress update structure
        for (const update of progressUpdates) {
          expect(update.sessionId).toBe(sessionId);
          expect(update.updateType).toMatch(/^(progress|batch_complete|entity_complete|error)$/);
          expect(update.timestamp).toBeInstanceOf(Date);
        }

        // Should have final completion status
        expect(result.overallStatus).toBe('completed');

        // Get final progress snapshot
        const finalProgress = await progressTracker.getLatestProgress();
        expect(finalProgress.length).toBeGreaterThan(0);

        for (const progress of finalProgress) {
          expect(progress.sessionId).toBe(sessionId);
          expect(progress.status).toMatch(/^(completed|running|failed)$/);
        }
      } finally {
        unsubscribe();
      }
    }, 45000);

    test('should handle concurrent migration tasks properly', async () => {
      // Create independent migration tasks that can run in parallel
      const parallelTasks = await createParallelMigrationTasks();

      const result = await migrationExecutor.executeMigrationTasks(parallelTasks);

      expect(result.overallStatus).toBe('completed');
      expect(result.entitiesProcessed.length).toBe(parallelTasks.length);

      // Validate parallel execution metrics
      expect(result.executionSummary.parallelExecutions).toBeGreaterThan(1);
      expect(result.executionSummary.totalDurationMs).toBeLessThan(
        // Should be faster than sequential execution
        parallelTasks.reduce((sum, task) => sum + task.estimatedDurationMs, 0)
      );

      // Verify all entities were processed
      for (const task of parallelTasks) {
        expect(result.entitiesProcessed).toContain(task.entityType);
      }
    });

    test('should validate data integrity during migration', async () => {
      const migrationTasks = await createTestMigrationTasks();

      const result = await migrationExecutor.executeMigrationTasks(migrationTasks);

      expect(result.overallStatus).toBe('completed');

      // Validate data integrity results
      expect(result.validation).toBeDefined();
      expect(result.validation!.totalValidated).toBeGreaterThan(0);
      expect(result.validation!.successfulMatches).toBeGreaterThan(0);
      expect(result.validation!.failedMatches).toBe(0);
      expect(result.validation!.matchPercentage).toBe(100);

      // Verify actual data integrity
      const integrityCheck = await performDataIntegrityCheck();
      expect(integrityCheck.success).toBe(true);
      expect(integrityCheck.errors).toHaveLength(0);
    });

    test('should handle migration cancellation gracefully', async () => {
      const migrationTasks = await createLargeDatasetMigrationTasks();

      // Start migration
      const executionPromise = migrationExecutor.executeMigrationTasks(migrationTasks);

      // Let it run briefly
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Cancel execution
      const cancelResult = await migrationExecutor.cancelExecution();
      expect(cancelResult.success).toBe(true);

      // Wait for execution to complete
      const result = await executionPromise;
      expect(result.overallStatus).toBe('cancelled');

      // Verify cleanup was performed
      const progress = await progressTracker.getLatestProgress();
      for (const p of progress) {
        expect(p.status).toMatch(/^(cancelled|completed)$/);
      }
    });
  });

  describe('Error Handling and Recovery', () => {
    test('should recover from database connection failures', async () => {
      const migrationTasks = await createTestMigrationTasks();

      // Simulate connection failure by closing pool temporarily
      await destinationPool.end();

      // Restart pool to simulate recovery
      destinationPool = new Pool(TEST_CONFIG.destinationDb);

      // Migration should eventually succeed with retry logic
      const result = await migrationExecutor.executeMigrationTasks(migrationTasks);

      expect(result.overallStatus).toMatch(/^(completed|partial)$/);
      expect(result.totalRecordsProcessed).toBeGreaterThan(0);
    }, 60000);

    test('should handle transaction rollback on critical errors', async () => {
      // Create task that will cause constraint violations
      const problematicTasks = await createConstraintViolationTasks();

      try {
        await migrationExecutor.executeMigrationTasks(problematicTasks);
      } catch (error) {
        expect(error).toBeDefined();
      }

      // Verify no partial data was left behind
      const dataCheck = await checkForPartialData();
      expect(dataCheck.hasPartialData).toBe(false);
    });

    test('should preserve recovery information for failed migrations', async () => {
      const problematicTasks = await createUnrecoverableFailureTasks();

      const result = await migrationExecutor.executeMigrationTasks(problematicTasks);

      expect(result.overallStatus).toBe('failed');
      expect(result.recovery.isRecoverable).toBe(true);
      expect(result.recovery.lastCheckpointId).toBeDefined();
      expect(result.recovery.recommendedActions).toBeDefined();
      expect(result.recovery.recommendedActions.length).toBeGreaterThan(0);

      // Verify recovery metadata is comprehensive
      expect(result.recovery.resumeFromBatch).toBeGreaterThanOrEqual(0);
      expect(result.recovery.failureAnalysis).toBeDefined();
    });
  });

  describe('Performance and Scalability', () => {
    test('should maintain performance targets for large datasets', async () => {
      const largeTasks = await createLargeDatasetMigrationTasks();

      const startTime = Date.now();
      const result = await migrationExecutor.executeMigrationTasks(largeTasks);
      const endTime = Date.now();

      const actualDuration = endTime - startTime;

      // Should maintain target throughput
      const actualThroughput = result.totalRecordsProcessed / (actualDuration / 1000);
      expect(actualThroughput).toBeGreaterThan(100); // Records per second

      // Memory usage should be reasonable
      expect(result.executionSummary.peakMemoryUsageMb).toBeLessThan(512);

      // Performance metrics should be accurate
      expect(result.executionSummary.averageThroughput).toBeCloseTo(actualThroughput, -1);
    }, 120000);

    test('should optimize batch sizes automatically', async () => {
      const migrationTasks = await createVariableSizeTasks();

      const result = await migrationExecutor.executeMigrationTasks(migrationTasks);

      expect(result.overallStatus).toBe('completed');

      // Should have batch size optimization metrics
      expect(result.batchOptimization).toBeDefined();
      expect(result.batchOptimization!.originalBatchSize).toBeDefined();
      expect(result.batchOptimization!.optimizedBatchSize).toBeDefined();
      expect(result.batchOptimization!.performanceImprovement).toBeGreaterThanOrEqual(0);
    });
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

  async function setupTestInfrastructure(): Promise<void> {
    // Create necessary tables for migration control
    await destinationPool.query(`
      CREATE TABLE IF NOT EXISTS migration_control (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL,
        entity_type VARCHAR(100) NOT NULL,
        batch_number INTEGER NOT NULL,
        status VARCHAR(50) NOT NULL,
        records_processed INTEGER DEFAULT 0,
        records_failed INTEGER DEFAULT 0,
        started_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP,
        error_message TEXT,
        error_details JSONB,
        checkpoint_data JSONB
      )
    `);

    await destinationPool.query(`
      CREATE TABLE IF NOT EXISTS migration_checkpoints (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        checkpoint_id VARCHAR(255) UNIQUE NOT NULL,
        session_id UUID NOT NULL,
        entity_type VARCHAR(100) NOT NULL,
        batch_number INTEGER NOT NULL,
        records_processed INTEGER NOT NULL,
        checkpoint_data JSONB NOT NULL,
        status VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create test source tables
    await sourcePool.query(`
      CREATE TABLE IF NOT EXISTS dispatch_offices (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        address VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await sourcePool.query(`
      CREATE TABLE IF NOT EXISTS dispatch_doctors (
        id SERIAL PRIMARY KEY,
        office_id INTEGER REFERENCES dispatch_offices(id),
        name VARCHAR(255) NOT NULL,
        specialty VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await sourcePool.query(`
      CREATE TABLE IF NOT EXISTS dispatch_patients (
        id SERIAL PRIMARY KEY,
        doctor_id INTEGER REFERENCES dispatch_doctors(id),
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create test destination tables
    await destinationPool.query(`
      CREATE TABLE IF NOT EXISTS offices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        legacy_id INTEGER,
        name VARCHAR(255) NOT NULL,
        address VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await destinationPool.query(`
      CREATE TABLE IF NOT EXISTS doctors (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        legacy_id INTEGER,
        office_id UUID REFERENCES offices(id),
        name VARCHAR(255) NOT NULL,
        specialty VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await destinationPool.query(`
      CREATE TABLE IF NOT EXISTS patients (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        legacy_id INTEGER,
        doctor_id UUID REFERENCES doctors(id),
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
  }

  async function cleanupTestData(): Promise<void> {
    const cleanupQueries = [
      'DROP TABLE IF EXISTS patients CASCADE',
      'DROP TABLE IF EXISTS doctors CASCADE',
      'DROP TABLE IF EXISTS offices CASCADE',
      'DROP TABLE IF EXISTS dispatch_patients CASCADE',
      'DROP TABLE IF EXISTS dispatch_doctors CASCADE',
      'DROP TABLE IF EXISTS dispatch_offices CASCADE',
      'DROP TABLE IF EXISTS migration_control CASCADE',
      'DROP TABLE IF EXISTS migration_checkpoints CASCADE'
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

  async function resetTestData(): Promise<void> {
    // Clear existing data
    await sourcePool.query('DELETE FROM dispatch_patients');
    await sourcePool.query('DELETE FROM dispatch_doctors');
    await sourcePool.query('DELETE FROM dispatch_offices');
    await destinationPool.query('DELETE FROM patients');
    await destinationPool.query('DELETE FROM doctors');
    await destinationPool.query('DELETE FROM offices');
    await destinationPool.query('DELETE FROM migration_control');
    await destinationPool.query('DELETE FROM migration_checkpoints');

    // Insert fresh test data
    await sourcePool.query(`
      INSERT INTO dispatch_offices (name, address)
      VALUES ('Test Office 1', '123 Main St'),
             ('Test Office 2', '456 Oak Ave'),
             ('Test Office 3', '789 Pine Rd')
    `);

    await sourcePool.query(`
      INSERT INTO dispatch_doctors (office_id, name, specialty)
      VALUES (1, 'Dr. Smith', 'Cardiology'),
             (1, 'Dr. Jones', 'Neurology'),
             (2, 'Dr. Brown', 'Pediatrics'),
             (3, 'Dr. Davis', 'Orthopedics')
    `);

    await sourcePool.query(`
      INSERT INTO dispatch_patients (doctor_id, name, email)
      VALUES (1, 'Patient A', 'patient.a@test.com'),
             (1, 'Patient B', 'patient.b@test.com'),
             (2, 'Patient C', 'patient.c@test.com'),
             (3, 'Patient D', 'patient.d@test.com'),
             (4, 'Patient E', 'patient.e@test.com')
    `);
  }

  async function createTestMigrationTasks(): Promise<MigrationTask[]> {
    const officeIds = await sourcePool.query('SELECT id FROM dispatch_offices ORDER BY id');
    const doctorIds = await sourcePool.query('SELECT id FROM dispatch_doctors ORDER BY id');

    return [
      {
        entityType: 'offices',
        recordIds: officeIds.rows.map(row => row.id.toString()),
        priority: 'high',
        dependencies: [],
        estimatedDurationMs: 5000,
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
        estimatedDurationMs: 8000,
        metadata: {
          sourceTable: 'dispatch_doctors',
          destinationTable: 'doctors',
          totalRecords: doctorIds.rows.length,
          migrationMethod: 'differential'
        }
      }
    ];
  }

  async function createDependentMigrationTasks(): Promise<MigrationTask[]> {
    const officeIds = await sourcePool.query('SELECT id FROM dispatch_offices ORDER BY id');
    const doctorIds = await sourcePool.query('SELECT id FROM dispatch_doctors ORDER BY id');
    const patientIds = await sourcePool.query('SELECT id FROM dispatch_patients ORDER BY id');

    return [
      {
        entityType: 'patients', // Intentionally out of order
        recordIds: patientIds.rows.map(row => row.id.toString()),
        priority: 'low',
        dependencies: ['doctors'],
        estimatedDurationMs: 6000,
        metadata: {
          sourceTable: 'dispatch_patients',
          destinationTable: 'patients',
          totalRecords: patientIds.rows.length,
          migrationMethod: 'differential'
        }
      },
      {
        entityType: 'doctors',
        recordIds: doctorIds.rows.map(row => row.id.toString()),
        priority: 'medium',
        dependencies: ['offices'],
        estimatedDurationMs: 8000,
        metadata: {
          sourceTable: 'dispatch_doctors',
          destinationTable: 'doctors',
          totalRecords: doctorIds.rows.length,
          migrationMethod: 'differential'
        }
      },
      {
        entityType: 'offices',
        recordIds: officeIds.rows.map(row => row.id.toString()),
        priority: 'high',
        dependencies: [],
        estimatedDurationMs: 5000,
        metadata: {
          sourceTable: 'dispatch_offices',
          destinationTable: 'offices',
          totalRecords: officeIds.rows.length,
          migrationMethod: 'differential'
        }
      }
    ];
  }

  async function createLargeDatasetMigrationTasks(): Promise<MigrationTask[]> {
    // Create larger dataset for checkpoint testing
    const batchInserts = [];
    for (let i = 1; i <= 50; i++) {
      batchInserts.push(`('Large Office ${i}', '${i} Large St')`);
    }

    await sourcePool.query(`
      INSERT INTO dispatch_offices (name, address)
      VALUES ${batchInserts.join(', ')}
    `);

    const officeIds = await sourcePool.query('SELECT id FROM dispatch_offices ORDER BY id');

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
      }
    ];
  }

  async function createProblematicMigrationTasks(): Promise<MigrationTask[]> {
    // Add some records with potential issues
    await sourcePool.query(`
      INSERT INTO dispatch_offices (name, address)
      VALUES ('Valid Office', '123 Valid St'),
             ('', 'Invalid Name Office'),  -- Empty name might cause issues
             ('Duplicate Office', '456 Test St'),
             ('Duplicate Office', '789 Test St')  -- Duplicate name
    `);

    const officeIds = await sourcePool.query('SELECT id FROM dispatch_offices ORDER BY id');

    return [
      {
        entityType: 'offices',
        recordIds: officeIds.rows.map(row => row.id.toString()),
        priority: 'high',
        dependencies: [],
        estimatedDurationMs: 10000,
        metadata: {
          sourceTable: 'dispatch_offices',
          destinationTable: 'offices',
          totalRecords: officeIds.rows.length,
          migrationMethod: 'differential'
        }
      }
    ];
  }

  async function createParallelMigrationTasks(): Promise<MigrationTask[]> {
    // Create independent tasks that can run in parallel
    const officeIds = await sourcePool.query('SELECT id FROM dispatch_offices ORDER BY id');

    return [
      {
        entityType: 'offices',
        recordIds: officeIds.rows.slice(0, 2).map(row => row.id.toString()),
        priority: 'high',
        dependencies: [],
        estimatedDurationMs: 5000,
        metadata: {
          sourceTable: 'dispatch_offices',
          destinationTable: 'offices',
          totalRecords: 2,
          migrationMethod: 'differential'
        }
      },
      {
        entityType: 'offices_batch_2',
        recordIds: officeIds.rows.slice(2).map(row => row.id.toString()),
        priority: 'high',
        dependencies: [],
        estimatedDurationMs: 5000,
        metadata: {
          sourceTable: 'dispatch_offices',
          destinationTable: 'offices',
          totalRecords: officeIds.rows.length - 2,
          migrationMethod: 'differential'
        }
      }
    ];
  }

  async function createConstraintViolationTasks(): Promise<MigrationTask[]> {
    // This would create tasks that violate foreign key constraints
    await sourcePool.query(`
      INSERT INTO dispatch_doctors (office_id, name, specialty)
      VALUES (999, 'Dr. Invalid', 'Invalid Specialty')  -- Invalid office_id
    `);

    const doctorIds = await sourcePool.query('SELECT id FROM dispatch_doctors WHERE office_id = 999');

    return [
      {
        entityType: 'doctors',
        recordIds: doctorIds.rows.map(row => row.id.toString()),
        priority: 'medium',
        dependencies: [],
        estimatedDurationMs: 5000,
        metadata: {
          sourceTable: 'dispatch_doctors',
          destinationTable: 'doctors',
          totalRecords: doctorIds.rows.length,
          migrationMethod: 'differential'
        }
      }
    ];
  }

  async function createUnrecoverableFailureTasks(): Promise<MigrationTask[]> {
    // Create tasks that will fail but are recoverable
    const officeIds = await sourcePool.query('SELECT id FROM dispatch_offices ORDER BY id');

    return [
      {
        entityType: 'offices',
        recordIds: officeIds.rows.map(row => row.id.toString()),
        priority: 'high',
        dependencies: [],
        estimatedDurationMs: 10000,
        metadata: {
          sourceTable: 'dispatch_offices',
          destinationTable: 'nonexistent_table', // Will cause failure
          totalRecords: officeIds.rows.length,
          migrationMethod: 'differential'
        }
      }
    ];
  }

  async function createVariableSizeTasks(): Promise<MigrationTask[]> {
    const officeIds = await sourcePool.query('SELECT id FROM dispatch_offices ORDER BY id');

    return [
      {
        entityType: 'offices',
        recordIds: officeIds.rows.map(row => row.id.toString()),
        priority: 'high',
        dependencies: [],
        estimatedDurationMs: 8000,
        metadata: {
          sourceTable: 'dispatch_offices',
          destinationTable: 'offices',
          totalRecords: officeIds.rows.length,
          migrationMethod: 'differential',
          variableRecordSizes: true
        }
      }
    ];
  }

  async function verifyMigratedData(): Promise<{ success: boolean; migratedRecords: number }> {
    try {
      const sourceCount = await sourcePool.query('SELECT COUNT(*) FROM dispatch_offices');
      const destCount = await destinationPool.query('SELECT COUNT(*) FROM offices');

      return {
        success: parseInt(destCount.rows[0].count) > 0,
        migratedRecords: parseInt(destCount.rows[0].count)
      };
    } catch (error) {
      return { success: false, migratedRecords: 0 };
    }
  }

  async function performDataIntegrityCheck(): Promise<{ success: boolean; errors: string[] }> {
    try {
      // Check for data consistency between source and destination
      const sourceOffices = await sourcePool.query('SELECT COUNT(*) FROM dispatch_offices');
      const destOffices = await destinationPool.query('SELECT COUNT(*) FROM offices');

      const errors: string[] = [];

      if (parseInt(sourceOffices.rows[0].count) !== parseInt(destOffices.rows[0].count)) {
        errors.push('Office count mismatch between source and destination');
      }

      // Check for orphaned records
      const orphanedDoctors = await destinationPool.query(`
        SELECT COUNT(*) FROM doctors d
        LEFT JOIN offices o ON d.office_id = o.id
        WHERE o.id IS NULL
      `);

      if (parseInt(orphanedDoctors.rows[0].count) > 0) {
        errors.push('Found orphaned doctor records');
      }

      return { success: errors.length === 0, errors };
    } catch (error) {
      return { success: false, errors: [error.message] };
    }
  }

  async function checkForPartialData(): Promise<{ hasPartialData: boolean }> {
    try {
      // Check if there's any partial data left after failed migration
      const partialData = await destinationPool.query(`
        SELECT COUNT(*) FROM offices WHERE name = '' OR name IS NULL
      `);

      return { hasPartialData: parseInt(partialData.rows[0].count) > 0 };
    } catch (error) {
      return { hasPartialData: false };
    }
  }
});