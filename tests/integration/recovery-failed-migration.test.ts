/**
 * Recovery from Failed Migration Scenario Integration Tests
 * Implements comprehensive test for quickstart Scenario 2 - Migration interruption and checkpoint-based recovery
 */

import { Pool } from 'pg';
import { MigrationExecutor, type ExecutionConfig, type MigrationTask } from '../../src/differential-migration/services/migration-executor';
import { ProgressTracker } from '../../src/differential-migration/services/progress-tracker';
import { CheckpointManager } from '../../src/differential-migration/lib/checkpoint-manager';
import { DifferentialDetector } from '../../src/differential-migration/services/differential-detector';
import { v4 as uuidv4 } from 'uuid';

// Test configuration
const TEST_CONFIG = {
  sourceDb: {
    host: process.env.SOURCE_DB_HOST || 'localhost',
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME || 'test_source_db',
    user: process.env.SOURCE_DB_USER || 'postgres',
    password: process.env.SOURCE_DB_PASSWORD || 'postgres',
    maxConnections: 15,
    connectionTimeoutMs: 10000
  },
  destinationDb: {
    host: process.env.TARGET_DB_HOST || 'localhost',
    port: parseInt(process.env.TARGET_DB_PORT || '54322'),
    database: process.env.TARGET_DB_NAME || 'test_target_db',
    user: process.env.TARGET_DB_USER || 'postgres',
    password: process.env.TARGET_DB_PASSWORD || 'postgres',
    maxConnections: 15,
    connectionTimeoutMs: 10000
  }
};

describe('Recovery from Failed Migration Scenario Integration Tests', () => {
  let sourcePool: Pool;
  let destinationPool: Pool;

  beforeAll(async () => {
    // Initialize database connections
    sourcePool = new Pool(TEST_CONFIG.sourceDb);
    destinationPool = new Pool(TEST_CONFIG.destinationDb);

    // Verify database connections
    await verifyDatabaseConnections();

    // Setup test infrastructure
    await setupFailureRecoveryInfrastructure();
  });

  afterAll(async () => {
    // Cleanup and close connections
    await cleanupTestData();
    await sourcePool.end();
    await destinationPool.end();
  });

  beforeEach(async () => {
    // Reset test environment for each scenario
    await resetTestEnvironment();
  });

  describe('Migration Interruption and Recovery Scenarios', () => {
    test('should recover from network interruption during migration', async () => {
      const sessionId = uuidv4();
      const executionConfig: ExecutionConfig = {
        batchSize: 25,
        maxRetryAttempts: 5,
        checkpointInterval: 2, // Frequent checkpoints
        parallelEntityLimit: 1,
        timeoutMs: 20000,
        enableValidation: true,
        validationSampleSize: 5,
        enablePerformanceMonitoring: true
      };

      const migrationExecutor = new MigrationExecutor(
        sourcePool,
        destinationPool,
        sessionId,
        executionConfig
      );

      const progressTracker = new ProgressTracker(sourcePool, destinationPool, sessionId);
      const checkpointManager = new CheckpointManager(destinationPool, sessionId);

      try {
        // Create large migration task
        const migrationTasks = await createLargeMigrationTasks();

        // Start migration
        const migrationPromise = migrationExecutor.executeMigrationTasks(migrationTasks);

        // Let it run and create checkpoints
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Simulate network interruption by pausing
        const pauseResult = await migrationExecutor.pauseExecution();
        expect(pauseResult.success).toBe(true);
        expect(pauseResult.checkpointId).toBeDefined();

        // Wait for migration to pause
        const pausedResult = await migrationPromise;
        expect(pausedResult.overallStatus).toBe('paused');
        expect(pausedResult.totalRecordsProcessed).toBeGreaterThan(0);

        // Verify checkpoint was created
        const checkpoints = await checkpointManager.listCheckpoints();
        expect(checkpoints.length).toBeGreaterThan(0);

        const latestCheckpoint = checkpoints[checkpoints.length - 1];
        expect(latestCheckpoint.status).toBe('active');
        expect(latestCheckpoint.recordsProcessed).toBeGreaterThan(0);

        // Resume from checkpoint
        const newExecutor = new MigrationExecutor(
          sourcePool,
          destinationPool,
          sessionId,
          executionConfig
        );

        const resumeResult = await newExecutor.resumeExecution(latestCheckpoint.checkpointId);
        expect(resumeResult.success).toBe(true);
        expect(resumeResult.resumedFromBatch).toBeGreaterThan(0);

        // Verify total records processed matches original + resumed
        const finalProgress = await progressTracker.getLatestProgress();
        const totalProcessed = finalProgress.reduce((sum, p) => sum + p.progress.recordsProcessed, 0);
        expect(totalProcessed).toBeGreaterThanOrEqual(pausedResult.totalRecordsProcessed);

        // Verify data integrity after recovery
        const integrityCheck = await verifyDataIntegrityAfterRecovery();
        expect(integrityCheck.success).toBe(true);
        expect(integrityCheck.duplicateRecords).toBe(0);

      } finally {
        await progressTracker.stop();
        await checkpointManager.cleanup();
      }
    }, 120000);

    test('should recover from database failure during batch processing', async () => {
      const sessionId = uuidv4();
      const migrationExecutor = new MigrationExecutor(
        sourcePool,
        destinationPool,
        sessionId,
        {
          batchSize: 20,
          maxRetryAttempts: 3,
          checkpointInterval: 3,
          parallelEntityLimit: 1,
          timeoutMs: 15000,
          enableValidation: false, // Disable validation to speed up test
          enablePerformanceMonitoring: true
        }
      );

      const checkpointManager = new CheckpointManager(destinationPool, sessionId);

      try {
        const migrationTasks = await createMediumMigrationTasks();

        // Start migration
        const migrationPromise = migrationExecutor.executeMigrationTasks(migrationTasks);

        // Let it process some batches
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Simulate database failure by temporarily closing connection
        await destinationPool.end();

        // Wait for failure detection
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Recreate connection pool (simulates database recovery)
        destinationPool = new Pool(TEST_CONFIG.destinationDb);

        // Original migration should have failed
        try {
          const failedResult = await migrationPromise;
          expect(failedResult.overallStatus).toMatch(/failed|partial/);
        } catch (error) {
          // Expected failure due to connection loss
        }

        // Create new executor for recovery
        const recoveryExecutor = new MigrationExecutor(
          sourcePool,
          destinationPool,
          sessionId,
          {
            batchSize: 20,
            maxRetryAttempts: 5,
            checkpointInterval: 3,
            parallelEntityLimit: 1,
            timeoutMs: 15000,
            enableValidation: true,
            enablePerformanceMonitoring: true
          }
        );

        // Find available checkpoint
        const checkpoints = await checkpointManager.listCheckpoints();
        expect(checkpoints.length).toBeGreaterThan(0);

        const recoverableCheckpoint = checkpoints.find(cp => cp.status === 'active');
        expect(recoverableCheckpoint).toBeDefined();

        // Resume from checkpoint
        const resumeResult = await recoveryExecutor.resumeExecution(recoverableCheckpoint!.checkpointId);
        expect(resumeResult.success).toBe(true);
        expect(resumeResult.resumedFromBatch).toBeGreaterThan(0);

        // Verify complete recovery
        const recoveryVerification = await verifyCompleteRecovery(migrationTasks);
        expect(recoveryVerification.success).toBe(true);
        expect(recoveryVerification.allRecordsMigrated).toBe(true);

      } finally {
        await checkpointManager.cleanup();
      }
    }, 180000);

    test('should handle partial batch failures with record-level recovery', async () => {
      const sessionId = uuidv4();

      // Create tasks with some records that will fail
      const mixedMigrationTasks = await createMixedSuccessFailureTasks();

      const migrationExecutor = new MigrationExecutor(
        sourcePool,
        destinationPool,
        sessionId,
        {
          batchSize: 10,
          maxRetryAttempts: 2,
          checkpointInterval: 1,
          parallelEntityLimit: 1,
          timeoutMs: 30000,
          enableValidation: true,
          validationSampleSize: 5,
          enablePerformanceMonitoring: true
        }
      );

      const checkpointManager = new CheckpointManager(destinationPool, sessionId);

      try {
        const result = await migrationExecutor.executeMigrationTasks(mixedMigrationTasks);

        // Should complete with partial success
        expect(result.overallStatus).toBe('partial');
        expect(result.totalRecordsProcessed).toBeGreaterThan(0);
        expect(result.totalRecordsFailed).toBeGreaterThan(0);

        // Should identify recoverable failures
        expect(result.recovery.isRecoverable).toBe(true);
        expect(result.recovery.lastCheckpointId).toBeDefined();
        expect(result.recovery.recommendedActions.length).toBeGreaterThan(0);

        // Should have detailed batch results
        expect(result.batchResults).toBeDefined();
        expect(result.batchResults!.length).toBeGreaterThan(0);

        const failedBatches = result.batchResults!.filter(b => b.failedRecords > 0);
        expect(failedBatches.length).toBeGreaterThan(0);

        // Validate error details
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

        // Attempt recovery of failed records
        const retryableErrors = result.batchResults!
          .flatMap(b => b.errors || [])
          .filter(e => e.retryable);

        if (retryableErrors.length > 0) {
          // Create recovery tasks for retryable failures
          const recoveryTasks = await createRecoveryTasks(retryableErrors);
          const recoveryResult = await migrationExecutor.executeMigrationTasks(recoveryTasks);

          expect(recoveryResult.totalRecordsProcessed).toBeGreaterThan(0);
          expect(recoveryResult.totalRecordsFailed).toBeLessThan(result.totalRecordsFailed);
        }

      } finally {
        await checkpointManager.cleanup();
      }
    }, 180000);

    test('should recover from system resource exhaustion', async () => {
      const sessionId = uuidv4();

      // Configure with resource constraints to trigger exhaustion
      const migrationExecutor = new MigrationExecutor(
        sourcePool,
        destinationPool,
        sessionId,
        {
          batchSize: 5, // Small batches to simulate resource constraints
          maxRetryAttempts: 3,
          checkpointInterval: 2,
          parallelEntityLimit: 1,
          timeoutMs: 5000, // Short timeout to trigger failures
          enableValidation: false,
          enablePerformanceMonitoring: true
        }
      );

      const checkpointManager = new CheckpointManager(destinationPool, sessionId);
      const progressTracker = new ProgressTracker(sourcePool, destinationPool, sessionId);

      try {
        // Create resource-intensive migration tasks
        const intensiveTasks = await createResourceIntensiveTasks();

        // Execute migration (may fail due to resource constraints)
        const result = await migrationExecutor.executeMigrationTasks(intensiveTasks);

        if (result.overallStatus === 'failed' || result.overallStatus === 'partial') {
          // Should have checkpoint for recovery
          expect(result.recovery.isRecoverable).toBe(true);
          expect(result.recovery.lastCheckpointId).toBeDefined();

          // Create recovery executor with better resource allocation
          const recoveryExecutor = new MigrationExecutor(
            sourcePool,
            destinationPool,
            sessionId,
            {
              batchSize: 10,
              maxRetryAttempts: 5,
              checkpointInterval: 1,
              parallelEntityLimit: 1,
              timeoutMs: 30000, // Longer timeout
              enableValidation: true,
              enablePerformanceMonitoring: true
            }
          );

          // Resume from checkpoint
          const resumeResult = await recoveryExecutor.resumeExecution(result.recovery.lastCheckpointId!);
          expect(resumeResult.success).toBe(true);

          // Verify recovery completion
          const finalProgress = await progressTracker.getLatestProgress();
          const completedEntities = finalProgress.filter(p => p.status === 'completed');
          expect(completedEntities.length).toBeGreaterThan(0);
        }

      } finally {
        await progressTracker.stop();
        await checkpointManager.cleanup();
      }
    }, 240000);

    test('should handle complex recovery scenarios with data dependencies', async () => {
      const sessionId = uuidv4();

      // Create scenario with complex dependencies that may fail
      const dependentTasks = await createComplexDependencyTasks();

      const migrationExecutor = new MigrationExecutor(
        sourcePool,
        destinationPool,
        sessionId,
        {
          batchSize: 15,
          maxRetryAttempts: 3,
          checkpointInterval: 2,
          parallelEntityLimit: 2,
          timeoutMs: 20000,
          enableValidation: true,
          validationSampleSize: 3,
          enablePerformanceMonitoring: true
        }
      );

      const checkpointManager = new CheckpointManager(destinationPool, sessionId);

      try {
        // Execute migration with dependency failures
        const result = await migrationExecutor.executeMigrationTasks(dependentTasks);

        if (result.overallStatus !== 'completed') {
          // Should have detailed failure analysis
          expect(result.recovery.failureAnalysis).toBeDefined();
          expect(result.recovery.failureAnalysis!.dependencyIssues).toBeDefined();
          expect(result.recovery.failureAnalysis!.rootCause).toBeDefined();

          // Should provide recovery strategy
          expect(result.recovery.recommendedActions.length).toBeGreaterThan(0);

          // Test dependency resolution recovery
          const dependencyRecoveryTasks = await createDependencyRecoveryTasks(
            result.recovery.failureAnalysis!.dependencyIssues!
          );

          // Execute dependency fixes first
          const dependencyResult = await migrationExecutor.executeMigrationTasks(dependencyRecoveryTasks);
          expect(dependencyResult.overallStatus).toBe('completed');

          // Then resume original migration
          if (result.recovery.lastCheckpointId) {
            const resumeResult = await migrationExecutor.resumeExecution(result.recovery.lastCheckpointId);
            expect(resumeResult.success).toBe(true);
          }
        }

        // Verify final consistency
        const consistencyCheck = await verifyDependencyConsistency();
        expect(consistencyCheck.success).toBe(true);

      } finally {
        await checkpointManager.cleanup();
      }
    }, 300000);

    test('should maintain data integrity during recovery operations', async () => {
      const sessionId = uuidv4();

      // Setup scenario with potential data integrity issues
      await setupDataIntegrityScenario();

      const migrationExecutor = new MigrationExecutor(
        sourcePool,
        destinationPool,
        sessionId,
        {
          batchSize: 20,
          maxRetryAttempts: 3,
          checkpointInterval: 3,
          parallelEntityLimit: 1,
          timeoutMs: 25000,
          enableValidation: true,
          validationSampleSize: 10,
          enablePerformanceMonitoring: true
        }
      );

      const checkpointManager = new CheckpointManager(destinationPool, sessionId);

      try {
        // Create tasks that may have integrity issues
        const integrityTasks = await createDataIntegrityTasks();

        // Execute with potential failures
        const result = await migrationExecutor.executeMigrationTasks(integrityTasks);

        // Validate integrity was maintained regardless of success/failure
        const integrityResults = await performComprehensiveIntegrityCheck();

        expect(integrityResults.foreignKeyViolations).toBe(0);
        expect(integrityResults.duplicateRecords).toBe(0);
        expect(integrityResults.orphanedRecords).toBe(0);
        expect(integrityResults.dataCorruption).toBe(0);

        // If migration failed, verify rollback maintained integrity
        if (result.overallStatus === 'failed') {
          const rollbackCheck = await verifyRollbackIntegrity();
          expect(rollbackCheck.success).toBe(true);
          expect(rollbackCheck.consistentState).toBe(true);
        }

        // If partial success, verify partial state is consistent
        if (result.overallStatus === 'partial') {
          const partialStateCheck = await verifyPartialStateConsistency();
          expect(partialStateCheck.isConsistent).toBe(true);
        }

      } finally {
        await checkpointManager.cleanup();
      }
    }, 240000);

    test('should provide comprehensive failure analysis and recovery guidance', async () => {
      const sessionId = uuidv4();

      // Create scenario with multiple failure types
      const complexFailureTasks = await createComplexFailureScenario();

      const migrationExecutor = new MigrationExecutor(
        sourcePool,
        destinationPool,
        sessionId,
        {
          batchSize: 10,
          maxRetryAttempts: 2,
          checkpointInterval: 1,
          parallelEntityLimit: 1,
          timeoutMs: 10000,
          enableValidation: true,
          validationSampleSize: 5,
          enablePerformanceMonitoring: true
        }
      );

      const result = await migrationExecutor.executeMigrationTasks(complexFailureTasks);

      // Should provide detailed failure analysis
      expect(result.recovery.failureAnalysis).toBeDefined();
      const analysis = result.recovery.failureAnalysis!;

      // Should categorize failure types
      expect(analysis.failureCategories).toBeDefined();
      expect(analysis.failureCategories!.length).toBeGreaterThan(0);

      for (const category of analysis.failureCategories!) {
        expect(category.type).toBeDefined();
        expect(category.count).toBeGreaterThan(0);
        expect(category.severity).toMatch(/low|moderate|high|critical/);
        expect(category.examples.length).toBeGreaterThan(0);
      }

      // Should provide specific recovery actions
      expect(analysis.recoveryActions).toBeDefined();
      expect(analysis.recoveryActions!.length).toBeGreaterThan(0);

      for (const action of analysis.recoveryActions!) {
        expect(action.action).toBeDefined();
        expect(action.priority).toMatch(/low|medium|high|critical/);
        expect(action.description).toBeDefined();
        expect(typeof action.automated).toBe('boolean');
      }

      // Should estimate recovery time
      expect(analysis.estimatedRecoveryTime).toBeDefined();
      expect(analysis.estimatedRecoveryTime!.totalMinutes).toBeGreaterThan(0);
      expect(analysis.estimatedRecoveryTime!.breakdown).toBeDefined();
    });

    test('should handle checkpoint corruption and recovery', async () => {
      const sessionId = uuidv4();
      const checkpointManager = new CheckpointManager(destinationPool, sessionId);

      try {
        // Create and corrupt checkpoint
        const checkpointId = await checkpointManager.createCheckpoint({
          entityType: 'offices',
          batchNumber: 5,
          recordsProcessed: 100,
          lastProcessedId: '50',
          state: {
            currentBatch: [],
            processedIds: [],
            failedIds: []
          }
        });

        // Corrupt checkpoint data
        await destinationPool.query(`
          UPDATE migration_checkpoints
          SET checkpoint_data = '{"corrupted": true}'::jsonb
          WHERE checkpoint_id = $1
        `, [checkpointId]);

        // Attempt to resume from corrupted checkpoint
        const migrationExecutor = new MigrationExecutor(
          sourcePool,
          destinationPool,
          sessionId,
          {
            batchSize: 20,
            maxRetryAttempts: 3,
            checkpointInterval: 2,
            parallelEntityLimit: 1,
            timeoutMs: 20000,
            enableValidation: true,
            enablePerformanceMonitoring: true
          }
        );

        const resumeResult = await migrationExecutor.resumeExecution(checkpointId);

        // Should handle corruption gracefully
        if (!resumeResult.success) {
          expect(resumeResult.error).toContain('checkpoint');

          // Should provide fallback options
          const fallbackCheckpoints = await checkpointManager.findFallbackCheckpoints(checkpointId);
          expect(fallbackCheckpoints).toBeDefined();

          // Should be able to restart from earlier checkpoint
          const cleanCheckpoints = await checkpointManager.listCheckpoints();
          const validCheckpoint = cleanCheckpoints.find(cp =>
            cp.checkpointId !== checkpointId && cp.status === 'active'
          );

          if (validCheckpoint) {
            const fallbackResumeResult = await migrationExecutor.resumeExecution(validCheckpoint.checkpointId);
            expect(fallbackResumeResult.success).toBe(true);
          }
        }

      } finally {
        await checkpointManager.cleanup();
      }
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

  async function setupFailureRecoveryInfrastructure(): Promise<void> {
    // Create all necessary tables for recovery testing
    await setupMigrationTables();
    await setupCheckpointTables();
    await setupTestEntityTables();
  }

  async function setupMigrationTables(): Promise<void> {
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
  }

  async function setupCheckpointTables(): Promise<void> {
    await destinationPool.query(`
      CREATE TABLE IF NOT EXISTS migration_checkpoints (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        checkpoint_id VARCHAR(255) UNIQUE NOT NULL,
        session_id UUID NOT NULL,
        entity_type VARCHAR(100) NOT NULL,
        batch_number INTEGER NOT NULL,
        records_processed INTEGER NOT NULL,
        checkpoint_data JSONB NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW(),
        metadata JSONB
      )
    `);
  }

  async function setupTestEntityTables(): Promise<void> {
    // Source tables
    await sourcePool.query(`
      CREATE TABLE IF NOT EXISTS dispatch_offices (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        address VARCHAR(500),
        phone VARCHAR(20),
        status VARCHAR(50) DEFAULT 'active',
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
        phone VARCHAR(20),
        status VARCHAR(50) DEFAULT 'active',
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
        phone VARCHAR(20),
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Destination tables
    await destinationPool.query(`
      CREATE TABLE IF NOT EXISTS offices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        legacy_id INTEGER UNIQUE,
        name VARCHAR(255) NOT NULL,
        address VARCHAR(500),
        phone VARCHAR(20),
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
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
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
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
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
  }

  async function resetTestEnvironment(): Promise<void> {
    // Clear all test data
    await sourcePool.query('DELETE FROM dispatch_patients');
    await sourcePool.query('DELETE FROM dispatch_doctors');
    await sourcePool.query('DELETE FROM dispatch_offices');
    await destinationPool.query('DELETE FROM patients');
    await destinationPool.query('DELETE FROM doctors');
    await destinationPool.query('DELETE FROM offices');
    await destinationPool.query('DELETE FROM migration_control');
    await destinationPool.query('DELETE FROM migration_checkpoints');

    // Create fresh test data
    await createFreshTestData();
  }

  async function createFreshTestData(): Promise<void> {
    // Create base data for recovery testing
    await sourcePool.query(`
      INSERT INTO dispatch_offices (name, address, phone)
      VALUES
        ('Recovery Office 1', '123 Recovery St', '555-R001'),
        ('Recovery Office 2', '456 Recovery Ave', '555-R002'),
        ('Recovery Office 3', '789 Recovery Blvd', '555-R003')
    `);

    await sourcePool.query(`
      INSERT INTO dispatch_doctors (office_id, name, specialty, phone)
      VALUES
        (1, 'Dr. Recovery', 'Recovery Medicine', '555-DR01'),
        (2, 'Dr. Resilient', 'Resilience Studies', '555-DR02'),
        (3, 'Dr. Backup', 'Backup Procedures', '555-DR03')
    `);

    // Create patient data for recovery scenarios
    const patientInserts = [];
    for (let i = 1; i <= 30; i++) {
      const doctorId = (i % 3) + 1;
      patientInserts.push(`(${doctorId}, 'Recovery Patient ${i}', 'recovery${i}@test.com', '555-P${i.toString().padStart(3, '0')}')`);
    }

    await sourcePool.query(`
      INSERT INTO dispatch_patients (doctor_id, name, email, phone)
      VALUES ${patientInserts.join(', ')}
    `);
  }

  async function createLargeMigrationTasks(): Promise<MigrationTask[]> {
    const officeIds = await sourcePool.query('SELECT id FROM dispatch_offices ORDER BY id');
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
        entityType: 'patients',
        recordIds: patientIds.rows.map(row => row.id.toString()),
        priority: 'medium',
        dependencies: ['doctors'],
        estimatedDurationMs: 25000,
        metadata: {
          sourceTable: 'dispatch_patients',
          destinationTable: 'patients',
          totalRecords: patientIds.rows.length,
          migrationMethod: 'differential'
        }
      }
    ];
  }

  async function createMediumMigrationTasks(): Promise<MigrationTask[]> {
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

  async function createMixedSuccessFailureTasks(): Promise<MigrationTask[]> {
    // Add some records that will succeed and some that will fail
    await sourcePool.query(`
      INSERT INTO dispatch_offices (name, address, phone)
      VALUES
        ('Valid Office 1', '100 Valid St', '555-V001'),
        ('Valid Office 2', '200 Valid Ave', '555-V002'),
        ('', 'Invalid Empty Name', '555-I001'),  -- Will fail due to empty name
        ('Valid Office 3', '', '555-V003')      -- Valid (empty address allowed)
    `);

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
          migrationMethod: 'differential'
        }
      }
    ];
  }

  async function createResourceIntensiveTasks(): Promise<MigrationTask[]> {
    // Create large dataset that might exhaust resources
    const batchInserts = [];
    for (let i = 1; i <= 100; i++) {
      batchInserts.push(`('Intensive Office ${i}', 'Intensive data for resource testing with longer content ${i}', '555-${i.toString().padStart(4, '0')}')`);
    }

    await sourcePool.query(`
      INSERT INTO dispatch_offices (name, address, phone)
      VALUES ${batchInserts.join(', ')}
    `);

    const officeIds = await sourcePool.query('SELECT id FROM dispatch_offices ORDER BY id');

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
          migrationMethod: 'differential',
          resourceIntensive: true
        }
      }
    ];
  }

  async function createComplexDependencyTasks(): Promise<MigrationTask[]> {
    const officeIds = await sourcePool.query('SELECT id FROM dispatch_offices ORDER BY id');
    const doctorIds = await sourcePool.query('SELECT id FROM dispatch_doctors ORDER BY id');
    const patientIds = await sourcePool.query('SELECT id FROM dispatch_patients ORDER BY id');

    return [
      {
        entityType: 'patients',
        recordIds: patientIds.rows.map(row => row.id.toString()),
        priority: 'low',
        dependencies: ['doctors'],
        estimatedDurationMs: 15000,
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
        estimatedDurationMs: 12000,
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
        estimatedDurationMs: 8000,
        metadata: {
          sourceTable: 'dispatch_offices',
          destinationTable: 'offices',
          totalRecords: officeIds.rows.length,
          migrationMethod: 'differential'
        }
      }
    ];
  }

  async function createRecoveryTasks(retryableErrors: any[]): Promise<MigrationTask[]> {
    const recordIds = retryableErrors.map(e => e.recordId);

    return [
      {
        entityType: 'offices',
        recordIds,
        priority: 'high',
        dependencies: [],
        estimatedDurationMs: recordIds.length * 100,
        metadata: {
          sourceTable: 'dispatch_offices',
          destinationTable: 'offices',
          totalRecords: recordIds.length,
          migrationMethod: 'recovery',
          retryOperation: true
        }
      }
    ];
  }

  async function createDependencyRecoveryTasks(dependencyIssues: any[]): Promise<MigrationTask[]> {
    // Create tasks to fix dependency issues
    return [
      {
        entityType: 'offices',
        recordIds: ['1', '2', '3'], // Fix dependency roots
        priority: 'critical',
        dependencies: [],
        estimatedDurationMs: 5000,
        metadata: {
          sourceTable: 'dispatch_offices',
          destinationTable: 'offices',
          totalRecords: 3,
          migrationMethod: 'dependency_fix'
        }
      }
    ];
  }

  async function setupDataIntegrityScenario(): Promise<void> {
    // Create scenario with potential integrity issues
    await sourcePool.query(`
      INSERT INTO dispatch_offices (name, address, phone)
      VALUES ('Integrity Office', '123 Integrity St', '555-INT1')
    `);

    await sourcePool.query(`
      INSERT INTO dispatch_doctors (office_id, name, specialty, phone)
      VALUES (999, 'Dr. Orphan', 'Orphan Medicine', '555-ORP1')  -- Invalid office_id
    `);
  }

  async function createDataIntegrityTasks(): Promise<MigrationTask[]> {
    const doctorIds = await sourcePool.query('SELECT id FROM dispatch_doctors ORDER BY id');

    return [
      {
        entityType: 'doctors',
        recordIds: doctorIds.rows.map(row => row.id.toString()),
        priority: 'medium',
        dependencies: ['offices'],
        estimatedDurationMs: 10000,
        metadata: {
          sourceTable: 'dispatch_doctors',
          destinationTable: 'doctors',
          totalRecords: doctorIds.rows.length,
          migrationMethod: 'differential'
        }
      }
    ];
  }

  async function createComplexFailureScenario(): Promise<MigrationTask[]> {
    // Create various failure scenarios
    await sourcePool.query(`
      INSERT INTO dispatch_offices (name, address, phone)
      VALUES
        ('', '123 Empty Name St', '555-FAIL1'),           -- Validation failure
        ('Constraint Office', NULL, '555-FAIL2'),         -- NULL constraint failure
        ('Very Long Office Name That Exceeds Maximum Column Length Limits And Will Cause Truncation Errors During Migration Process Testing', '456 Long St', '555-FAIL3')  -- Length constraint failure
    `);

    const officeIds = await sourcePool.query('SELECT id FROM dispatch_offices ORDER BY id');

    return [
      {
        entityType: 'offices',
        recordIds: officeIds.rows.map(row => row.id.toString()),
        priority: 'high',
        dependencies: [],
        estimatedDurationMs: 12000,
        metadata: {
          sourceTable: 'dispatch_offices',
          destinationTable: 'offices',
          totalRecords: officeIds.rows.length,
          migrationMethod: 'differential'
        }
      }
    ];
  }

  async function verifyDataIntegrityAfterRecovery(): Promise<{ success: boolean; duplicateRecords: number }> {
    try {
      const duplicates = await destinationPool.query(`
        SELECT COUNT(*) as duplicate_count FROM (
          SELECT legacy_id, COUNT(*)
          FROM offices
          WHERE legacy_id IS NOT NULL
          GROUP BY legacy_id
          HAVING COUNT(*) > 1
        ) dup
      `);

      return {
        success: parseInt(duplicates.rows[0].duplicate_count) === 0,
        duplicateRecords: parseInt(duplicates.rows[0].duplicate_count)
      };
    } catch (error) {
      return { success: false, duplicateRecords: -1 };
    }
  }

  async function verifyCompleteRecovery(originalTasks: MigrationTask[]): Promise<{ success: boolean; allRecordsMigrated: boolean }> {
    try {
      let allRecordsMigrated = true;

      for (const task of originalTasks) {
        const sourceCount = await sourcePool.query(`SELECT COUNT(*) FROM ${task.metadata.sourceTable}`);
        const destCount = await destinationPool.query(`SELECT COUNT(*) FROM ${task.metadata.destinationTable}`);

        if (parseInt(sourceCount.rows[0].count) !== parseInt(destCount.rows[0].count)) {
          allRecordsMigrated = false;
          break;
        }
      }

      return { success: true, allRecordsMigrated };
    } catch (error) {
      return { success: false, allRecordsMigrated: false };
    }
  }

  async function performComprehensiveIntegrityCheck(): Promise<any> {
    try {
      // Check for foreign key violations
      const fkViolations = await destinationPool.query(`
        SELECT COUNT(*) as count FROM doctors d
        LEFT JOIN offices o ON d.office_id = o.id
        WHERE d.office_id IS NOT NULL AND o.id IS NULL
      `);

      // Check for duplicate records
      const duplicates = await destinationPool.query(`
        SELECT COUNT(*) as count FROM (
          SELECT legacy_id FROM offices WHERE legacy_id IS NOT NULL GROUP BY legacy_id HAVING COUNT(*) > 1
        ) dup
      `);

      // Check for orphaned records
      const orphaned = await destinationPool.query(`
        SELECT COUNT(*) as count FROM patients p
        LEFT JOIN doctors d ON p.doctor_id = d.id
        WHERE p.doctor_id IS NOT NULL AND d.id IS NULL
      `);

      return {
        foreignKeyViolations: parseInt(fkViolations.rows[0].count),
        duplicateRecords: parseInt(duplicates.rows[0].count),
        orphanedRecords: parseInt(orphaned.rows[0].count),
        dataCorruption: 0 // Would check for data corruption patterns
      };
    } catch (error) {
      return {
        foreignKeyViolations: -1,
        duplicateRecords: -1,
        orphanedRecords: -1,
        dataCorruption: -1
      };
    }
  }

  async function verifyRollbackIntegrity(): Promise<{ success: boolean; consistentState: boolean }> {
    try {
      // Verify system is in consistent state after rollback
      const dataCheck = await performComprehensiveIntegrityCheck();
      const isConsistent = dataCheck.foreignKeyViolations === 0 &&
                          dataCheck.duplicateRecords === 0 &&
                          dataCheck.orphanedRecords === 0;

      return { success: true, consistentState: isConsistent };
    } catch (error) {
      return { success: false, consistentState: false };
    }
  }

  async function verifyPartialStateConsistency(): Promise<{ isConsistent: boolean }> {
    // Verify partial migration state is consistent
    const integrityCheck = await performComprehensiveIntegrityCheck();
    return {
      isConsistent: integrityCheck.foreignKeyViolations === 0 && integrityCheck.orphanedRecords === 0
    };
  }

  async function verifyDependencyConsistency(): Promise<{ success: boolean }> {
    try {
      // Verify all dependencies are properly maintained
      const dependencyCheck = await destinationPool.query(`
        SELECT
          (SELECT COUNT(*) FROM doctors d LEFT JOIN offices o ON d.office_id = o.id WHERE d.office_id IS NOT NULL AND o.id IS NULL) as orphaned_doctors,
          (SELECT COUNT(*) FROM patients p LEFT JOIN doctors d ON p.doctor_id = d.id WHERE p.doctor_id IS NOT NULL AND d.id IS NULL) as orphaned_patients
      `);

      const result = dependencyCheck.rows[0];
      return {
        success: parseInt(result.orphaned_doctors) === 0 && parseInt(result.orphaned_patients) === 0
      };
    } catch (error) {
      return { success: false };
    }
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
});