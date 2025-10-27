/**
 * Real-time Monitoring Workflow Integration Tests
 * Tests progress tracking, status updates, and log streaming
 */

import { Pool } from 'pg';
import { ProgressTracker, type ProgressSnapshot, type ProgressAlert, type PerformanceMetrics } from '../../src/differential-migration/services/progress-tracker';
import { MigrationExecutor, type ExecutionConfig } from '../../src/differential-migration/services/migration-executor';
import { v4 as uuidv4 } from 'uuid';
import EventEmitter from 'events';

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

describe('Real-time Monitoring Workflow Integration Tests', () => {
  let sourcePool: Pool;
  let destinationPool: Pool;
  let progressTracker: ProgressTracker;
  let migrationExecutor: MigrationExecutor;
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
    // Cleanup and close connections
    await cleanupTestData();
    await sourcePool.end();
    await destinationPool.end();
  });

  beforeEach(async () => {
    // Create fresh session for each test
    sessionId = uuidv4();

    // Initialize services
    progressTracker = new ProgressTracker(
      sourcePool,
      destinationPool,
      sessionId
    );

    const executionConfig: ExecutionConfig = {
      batchSize: 50,
      maxRetryAttempts: 3,
      checkpointInterval: 3,
      parallelEntityLimit: 2,
      timeoutMs: 30000,
      enableValidation: true,
      validationSampleSize: 5,
      enablePerformanceMonitoring: true
    };

    migrationExecutor = new MigrationExecutor(
      sourcePool,
      destinationPool,
      sessionId,
      executionConfig
    );

    // Reset test data
    await resetTestData();
  });

  afterEach(async () => {
    // Cleanup services
    if (progressTracker) {
      await progressTracker.stop();
    }
  });

  describe('Real-time Progress Tracking Workflow', () => {
    test('should provide real-time progress updates during migration', async () => {
      const progressUpdates: any[] = [];
      let updateCount = 0;

      // Subscribe to progress updates
      const unsubscribe = progressTracker.subscribeToUpdates((update) => {
        progressUpdates.push({
          ...update,
          sequenceNumber: ++updateCount,
          receivedAt: new Date()
        });
      });

      try {
        // Start migration with progress tracking
        const migrationTasks = await createTestMigrationTasks();
        await migrationExecutor.executeMigrationTasks(migrationTasks);

        // Should have received multiple progress updates
        expect(progressUpdates.length).toBeGreaterThan(5);

        // Validate update sequence and timing
        for (let i = 1; i < progressUpdates.length; i++) {
          expect(progressUpdates[i].sequenceNumber).toBeGreaterThan(
            progressUpdates[i - 1].sequenceNumber
          );
          expect(progressUpdates[i].receivedAt.getTime()).toBeGreaterThanOrEqual(
            progressUpdates[i - 1].receivedAt.getTime()
          );
        }

        // Should include different types of updates
        const updateTypes = new Set(progressUpdates.map(u => u.updateType));
        expect(updateTypes.has('batch_started')).toBe(true);
        expect(updateTypes.has('batch_completed')).toBe(true);
        expect(updateTypes.has('progress')).toBe(true);

        // Should have entity completion updates
        const entityCompletions = progressUpdates.filter(u => u.updateType === 'entity_completed');
        expect(entityCompletions.length).toBeGreaterThan(0);

        for (const completion of entityCompletions) {
          expect(completion.entityType).toBeDefined();
          expect(completion.data.recordsProcessed).toBeGreaterThan(0);
          expect(completion.data.status).toBe('completed');
        }

      } finally {
        unsubscribe();
      }
    }, 45000);

    test('should track progress snapshots accurately', async () => {
      // Start migration
      const migrationTasks = await createTestMigrationTasks();
      const migrationPromise = migrationExecutor.executeMigrationTasks(migrationTasks);

      // Collect progress snapshots during execution
      const snapshots: ProgressSnapshot[] = [];
      const snapshotInterval = setInterval(async () => {
        try {
          const currentProgress = await progressTracker.getLatestProgress();
          if (currentProgress.length > 0) {
            snapshots.push(...currentProgress);
          }
        } catch (error) {
          // Ignore snapshot errors during execution
        }
      }, 500);

      try {
        // Wait for migration to complete
        await migrationPromise;

        // Get final snapshot
        const finalProgress = await progressTracker.getLatestProgress();
        snapshots.push(...finalProgress);

        // Validate progress accuracy
        expect(snapshots.length).toBeGreaterThan(0);

        // Find completed snapshots
        const completedSnapshots = snapshots.filter(s => s.status === 'completed');
        expect(completedSnapshots.length).toBeGreaterThan(0);

        for (const snapshot of completedSnapshots) {
          expect(snapshot.sessionId).toBe(sessionId);
          expect(snapshot.progress.percentageComplete).toBe(100);
          expect(snapshot.progress.recordsProcessed).toBeGreaterThan(0);
          expect(snapshot.progress.recordsRemaining).toBe(0);
          expect(snapshot.timing.elapsedTimeMs).toBeGreaterThan(0);
        }

        // Validate progress progression
        const officeSnapshots = snapshots
          .filter(s => s.entityType === 'offices')
          .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        if (officeSnapshots.length > 1) {
          for (let i = 1; i < officeSnapshots.length; i++) {
            expect(officeSnapshots[i].progress.recordsProcessed).toBeGreaterThanOrEqual(
              officeSnapshots[i - 1].progress.recordsProcessed
            );
          }
        }

      } finally {
        clearInterval(snapshotInterval);
      }
    }, 60000);

    test('should generate and track performance metrics', async () => {
      const migrationTasks = await createLargeMigrationTasks();

      // Start migration and track performance
      const startTime = Date.now();
      await migrationExecutor.executeMigrationTasks(migrationTasks);
      const endTime = Date.now();

      // Get performance metrics
      const performanceMetrics = await progressTracker.calculatePerformanceMetrics('offices');

      // Validate metrics structure
      expect(performanceMetrics.entityType).toBe('offices');
      expect(performanceMetrics.timeWindow.startTime).toBeInstanceOf(Date);
      expect(performanceMetrics.timeWindow.endTime).toBeInstanceOf(Date);
      expect(performanceMetrics.timeWindow.durationMs).toBeGreaterThan(0);

      // Validate throughput metrics
      expect(performanceMetrics.throughput.current).toBeGreaterThan(0);
      expect(performanceMetrics.throughput.average).toBeGreaterThan(0);
      expect(performanceMetrics.throughput.peak).toBeGreaterThanOrEqual(performanceMetrics.throughput.average);
      expect(performanceMetrics.throughput.minimum).toBeGreaterThan(0);
      expect(performanceMetrics.throughput.minimum).toBeLessThanOrEqual(performanceMetrics.throughput.average);

      // Validate memory metrics
      expect(performanceMetrics.memory.current).toBeGreaterThan(0);
      expect(performanceMetrics.memory.average).toBeGreaterThan(0);
      expect(performanceMetrics.memory.peak).toBeGreaterThanOrEqual(performanceMetrics.memory.average);

      // Validate timing metrics
      expect(performanceMetrics.timing.averageBatchTimeMs).toBeGreaterThan(0);
      expect(performanceMetrics.timing.fastestBatchMs).toBeGreaterThan(0);
      expect(performanceMetrics.timing.slowestBatchMs).toBeGreaterThanOrEqual(performanceMetrics.timing.fastestBatchMs);
      expect(performanceMetrics.timing.varianceMs).toBeGreaterThanOrEqual(0);

      // Validate efficiency metrics
      expect(performanceMetrics.efficiency.cpuEfficiency).toBeGreaterThan(0);
      expect(performanceMetrics.efficiency.cpuEfficiency).toBeLessThanOrEqual(1);
      expect(performanceMetrics.efficiency.memoryEfficiency).toBeGreaterThan(0);
      expect(performanceMetrics.efficiency.memoryEfficiency).toBeLessThanOrEqual(1);
      expect(performanceMetrics.efficiency.overallScore).toBeGreaterThan(0);
      expect(performanceMetrics.efficiency.overallScore).toBeLessThanOrEqual(100);
    });

    test('should track multiple concurrent sessions independently', async () => {
      // Create multiple sessions
      const sessions = [uuidv4(), uuidv4(), uuidv4()];
      const progressTrackers: ProgressTracker[] = [];
      const migrationExecutors: MigrationExecutor[] = [];

      try {
        // Initialize trackers and executors for each session
        for (const sessionId of sessions) {
          const tracker = new ProgressTracker(sourcePool, destinationPool, sessionId);
          const executor = new MigrationExecutor(
            sourcePool,
            destinationPool,
            sessionId,
            {
              batchSize: 25,
              maxRetryAttempts: 3,
              checkpointInterval: 2,
              parallelEntityLimit: 1,
              timeoutMs: 20000,
              enableValidation: true,
              validationSampleSize: 3,
              enablePerformanceMonitoring: true
            }
          );

          progressTrackers.push(tracker);
          migrationExecutors.push(executor);
        }

        // Start migrations concurrently
        const migrationPromises = migrationExecutors.map((executor, index) =>
          executor.executeMigrationTasks(createTestMigrationTasksForSession(sessions[index]))
        );

        // Wait for all migrations to complete
        await Promise.all(migrationPromises);

        // Verify independent tracking
        for (let i = 0; i < sessions.length; i++) {
          const sessionId = sessions[i];
          const tracker = progressTrackers[i];

          const sessionProgress = await tracker.getAllProgress();
          expect(sessionProgress.length).toBeGreaterThan(0);

          // All progress should belong to the correct session
          for (const progress of sessionProgress) {
            expect(progress.sessionId).toBe(sessionId);
          }

          // Should not contain progress from other sessions
          const otherSessionProgress = sessionProgress.filter(p => p.sessionId !== sessionId);
          expect(otherSessionProgress.length).toBe(0);
        }

      } finally {
        // Cleanup all trackers
        for (const tracker of progressTrackers) {
          await tracker.stop();
        }
      }
    }, 90000);

    test('should detect and alert on performance issues', async () => {
      // Create scenario that will trigger performance alerts
      const migrationTasks = await createSlowMigrationTasks();

      const alertsReceived: ProgressAlert[] = [];
      const unsubscribe = progressTracker.subscribeToUpdates((update) => {
        if (update.updateType === 'alert') {
          alertsReceived.push(update.data as ProgressAlert);
        }
      });

      try {
        await migrationExecutor.executeMigrationTasks(migrationTasks);

        // Should have received performance-related alerts
        expect(alertsReceived.length).toBeGreaterThan(0);

        // Validate alert structure
        for (const alert of alertsReceived) {
          expect(alert.alertId).toBeDefined();
          expect(alert.severity).toMatch(/^(debug|info|warning|error)$/);
          expect(alert.type).toBeDefined();
          expect(alert.message).toBeDefined();
          expect(alert.timestamp).toBeInstanceOf(Date);
          expect(alert.details).toBeDefined();
        }

        // Should include specific alert types
        const alertTypes = alertsReceived.map(a => a.type);
        expect(alertTypes.some(type => type.includes('throughput') || type.includes('performance'))).toBe(true);

      } finally {
        unsubscribe();
      }
    }, 60000);

    test('should provide accurate ETA calculations', async () => {
      const migrationTasks = await createPredictableMigrationTasks();

      const progressUpdates: any[] = [];
      const unsubscribe = progressTracker.subscribeToUpdates((update) => {
        if (update.updateType === 'progress' && update.data.eta) {
          progressUpdates.push({
            timestamp: new Date(),
            progress: update.data.progress,
            eta: update.data.eta,
            remainingRecords: update.data.remainingRecords
          });
        }
      });

      try {
        const startTime = Date.now();
        await migrationExecutor.executeMigrationTasks(migrationTasks);
        const actualDuration = Date.now() - startTime;

        // Should have ETA updates
        expect(progressUpdates.length).toBeGreaterThan(0);

        // Validate ETA accuracy (should be reasonably close to actual)
        const etaUpdates = progressUpdates.filter(u => u.eta && u.progress < 90); // Early estimates

        if (etaUpdates.length > 0) {
          for (const update of etaUpdates) {
            expect(update.eta).toBeGreaterThan(0);
            expect(update.remainingRecords).toBeGreaterThanOrEqual(0);

            // ETA should be reasonable (not wildly off)
            const reasonableRange = actualDuration * 3; // Allow 3x variance
            expect(update.eta).toBeLessThan(reasonableRange);
          }
        }

      } finally {
        unsubscribe();
      }
    }, 45000);
  });

  describe('Alert System and Notifications', () => {
    test('should generate alerts for different severity levels', async () => {
      const alertsReceived: ProgressAlert[] = [];

      // Subscribe to alerts
      const unsubscribe = progressTracker.subscribeToUpdates((update) => {
        if (update.updateType === 'alert') {
          alertsReceived.push(update.data as ProgressAlert);
        }
      });

      try {
        // Trigger various alert conditions
        await simulateAlertConditions();

        // Should have received alerts
        expect(alertsReceived.length).toBeGreaterThan(0);

        // Should have different severity levels
        const severityLevels = new Set(alertsReceived.map(a => a.severity));
        expect(severityLevels.size).toBeGreaterThan(1);
        expect(severityLevels.has('info')).toBe(true);

        // Validate alert timing and context
        for (const alert of alertsReceived) {
          expect(alert.timestamp.getTime()).toBeLessThanOrEqual(Date.now());
          expect(alert.timestamp.getTime()).toBeGreaterThan(Date.now() - 60000); // Within last minute
        }

      } finally {
        unsubscribe();
      }
    });

    test('should track active alerts and provide alert history', async () => {
      // Generate some alerts
      await progressTracker.recordAlert({
        alertId: uuidv4(),
        severity: 'warning',
        type: 'low_throughput',
        entityType: 'offices',
        message: 'Low throughput detected',
        details: { threshold: 100, actual: 75 },
        timestamp: new Date()
      });

      await progressTracker.recordAlert({
        alertId: uuidv4(),
        severity: 'info',
        type: 'checkpoint_created',
        entityType: 'offices',
        message: 'Checkpoint created successfully',
        details: { checkpointId: 'cp_123', batchNumber: 5 },
        timestamp: new Date()
      });

      // Get active alerts
      const activeAlerts = await progressTracker.getActiveAlerts();
      expect(activeAlerts.length).toBe(2);

      // Validate alert structure
      for (const alert of activeAlerts) {
        expect(alert.alertId).toBeDefined();
        expect(alert.severity).toMatch(/^(debug|info|warning|error)$/);
        expect(alert.type).toBeDefined();
        expect(alert.message).toBeDefined();
        expect(alert.timestamp).toBeInstanceOf(Date);
      }

      // Should be sorted by timestamp (most recent first)
      if (activeAlerts.length > 1) {
        for (let i = 1; i < activeAlerts.length; i++) {
          expect(activeAlerts[i - 1].timestamp.getTime()).toBeGreaterThanOrEqual(
            activeAlerts[i].timestamp.getTime()
          );
        }
      }
    });

    test('should handle alert cleanup and expiration', async () => {
      // Create old alert
      const oldAlert = {
        alertId: uuidv4(),
        severity: 'info' as const,
        type: 'test_alert',
        entityType: 'offices',
        message: 'Old test alert',
        details: {},
        timestamp: new Date(Date.now() - 86400000) // 24 hours ago
      };

      await progressTracker.recordAlert(oldAlert);

      // Create recent alert
      const recentAlert = {
        alertId: uuidv4(),
        severity: 'warning' as const,
        type: 'test_alert',
        entityType: 'offices',
        message: 'Recent test alert',
        details: {},
        timestamp: new Date()
      };

      await progressTracker.recordAlert(recentAlert);

      // Get active alerts (should exclude expired ones)
      const activeAlerts = await progressTracker.getActiveAlerts();

      // Should only include recent alerts
      const recentAlerts = activeAlerts.filter(a =>
        a.timestamp.getTime() > Date.now() - 3600000 // Within last hour
      );

      expect(recentAlerts.length).toBeGreaterThan(0);
      expect(recentAlerts.some(a => a.alertId === recentAlert.alertId)).toBe(true);
    });
  });

  describe('Status Reporting and Dashboards', () => {
    test('should generate comprehensive progress reports', async () => {
      const migrationTasks = await createTestMigrationTasks();
      await migrationExecutor.executeMigrationTasks(migrationTasks);

      const report = await progressTracker.generateProgressReport();

      // Validate report structure
      expect(report.sessionId).toBe(sessionId);
      expect(report.generatedAt).toBeInstanceOf(Date);
      expect(report.overallStatus).toMatch(/^(running|completed|paused|failed)$/);

      // Validate entity summaries
      expect(report.entitySummaries.length).toBeGreaterThan(0);
      for (const summary of report.entitySummaries) {
        expect(summary.entityType).toBeDefined();
        expect(summary.status).toMatch(/^(pending|running|completed|failed|paused)$/);
        expect(summary.recordsProcessed).toBeGreaterThanOrEqual(0);
        expect(summary.totalRecords).toBeGreaterThan(0);
        expect(summary.progressPercentage).toBeGreaterThanOrEqual(0);
        expect(summary.progressPercentage).toBeLessThanOrEqual(100);
      }

      // Validate performance summary
      expect(report.performanceSummary.averageThroughput).toBeGreaterThan(0);
      expect(report.performanceSummary.totalRecordsProcessed).toBeGreaterThan(0);
      expect(report.performanceSummary.totalElapsedTimeMs).toBeGreaterThan(0);

      // Validate timing information
      expect(report.timing.startTime).toBeInstanceOf(Date);
      expect(report.timing.lastUpdateTime).toBeInstanceOf(Date);
      expect(report.timing.totalElapsedMs).toBeGreaterThan(0);
    });

    test('should provide session-specific monitoring data', async () => {
      // Create specific session data
      const migrationTasks = await createTestMigrationTasks();
      await migrationExecutor.executeMigrationTasks(migrationTasks);

      // Get session-specific progress
      const sessionProgress = await progressTracker.getAllProgress();
      expect(sessionProgress.length).toBeGreaterThan(0);

      // All progress should belong to current session
      for (const progress of sessionProgress) {
        expect(progress.sessionId).toBe(sessionId);
      }

      // Should include different entity types
      const entityTypes = new Set(sessionProgress.map(p => p.entityType));
      expect(entityTypes.size).toBeGreaterThan(0);

      // Should have completed status for successful migration
      const completedEntities = sessionProgress.filter(p => p.status === 'completed');
      expect(completedEntities.length).toBeGreaterThan(0);
    });

    test('should support real-time dashboard updates', async () => {
      const dashboardUpdates: any[] = [];
      let updateInterval: NodeJS.Timeout;

      // Simulate dashboard polling
      updateInterval = setInterval(async () => {
        try {
          const currentProgress = await progressTracker.getLatestProgress();
          if (currentProgress.length > 0) {
            dashboardUpdates.push({
              timestamp: new Date(),
              progress: currentProgress.map(p => ({
                entityType: p.entityType,
                progress: p.progress.percentageComplete,
                status: p.status,
                throughput: p.performance.recordsPerSecond
              }))
            });
          }
        } catch (error) {
          // Ignore polling errors
        }
      }, 1000);

      try {
        // Start migration
        const migrationTasks = await createTestMigrationTasks();
        await migrationExecutor.executeMigrationTasks(migrationTasks);

        // Should have collected dashboard updates
        expect(dashboardUpdates.length).toBeGreaterThan(2);

        // Validate update structure
        for (const update of dashboardUpdates) {
          expect(update.timestamp).toBeInstanceOf(Date);
          expect(Array.isArray(update.progress)).toBe(true);

          for (const progressItem of update.progress) {
            expect(progressItem.entityType).toBeDefined();
            expect(progressItem.progress).toBeGreaterThanOrEqual(0);
            expect(progressItem.progress).toBeLessThanOrEqual(100);
            expect(progressItem.status).toBeDefined();
            expect(progressItem.throughput).toBeGreaterThanOrEqual(0);
          }
        }

        // Should show progress over time
        const firstUpdate = dashboardUpdates[0];
        const lastUpdate = dashboardUpdates[dashboardUpdates.length - 1];

        expect(lastUpdate.timestamp.getTime()).toBeGreaterThan(firstUpdate.timestamp.getTime());

      } finally {
        clearInterval(updateInterval);
      }
    }, 45000);
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
    // Create monitoring tables
    await destinationPool.query(`
      CREATE TABLE IF NOT EXISTS migration_progress (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL,
        entity_type VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL,
        records_processed INTEGER DEFAULT 0,
        total_records INTEGER DEFAULT 0,
        percentage_complete DECIMAL(5,2) DEFAULT 0,
        throughput DECIMAL(10,2) DEFAULT 0,
        memory_usage_mb INTEGER DEFAULT 0,
        start_time TIMESTAMP DEFAULT NOW(),
        last_update TIMESTAMP DEFAULT NOW(),
        INDEX(session_id, entity_type)
      )
    `);

    await destinationPool.query(`
      CREATE TABLE IF NOT EXISTS migration_alerts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL,
        alert_id VARCHAR(255) UNIQUE NOT NULL,
        severity VARCHAR(20) NOT NULL,
        alert_type VARCHAR(100) NOT NULL,
        entity_type VARCHAR(100),
        message TEXT NOT NULL,
        details JSONB,
        timestamp TIMESTAMP DEFAULT NOW(),
        acknowledged BOOLEAN DEFAULT FALSE,
        INDEX(session_id, timestamp DESC)
      )
    `);

    // Create test data tables
    await setupTestTables();
  }

  async function setupTestTables(): Promise<void> {
    // Source tables
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

    // Destination tables
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
  }

  async function cleanupTestData(): Promise<void> {
    const cleanupQueries = [
      'DROP TABLE IF EXISTS doctors CASCADE',
      'DROP TABLE IF EXISTS offices CASCADE',
      'DROP TABLE IF EXISTS dispatch_doctors CASCADE',
      'DROP TABLE IF EXISTS dispatch_offices CASCADE',
      'DROP TABLE IF EXISTS migration_progress CASCADE',
      'DROP TABLE IF EXISTS migration_alerts CASCADE'
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
    await sourcePool.query('DELETE FROM dispatch_doctors');
    await sourcePool.query('DELETE FROM dispatch_offices');
    await destinationPool.query('DELETE FROM doctors');
    await destinationPool.query('DELETE FROM offices');
    await destinationPool.query('DELETE FROM migration_progress');
    await destinationPool.query('DELETE FROM migration_alerts');

    // Insert fresh test data
    await sourcePool.query(`
      INSERT INTO dispatch_offices (name, address)
      VALUES ('Monitor Office 1', '123 Monitor St'),
             ('Monitor Office 2', '456 Track Ave'),
             ('Monitor Office 3', '789 Progress Rd')
    `);

    await sourcePool.query(`
      INSERT INTO dispatch_doctors (office_id, name, specialty)
      VALUES (1, 'Dr. Monitor', 'Monitoring'),
             (2, 'Dr. Track', 'Tracking'),
             (3, 'Dr. Progress', 'Progress')
    `);
  }

  async function createTestMigrationTasks(): Promise<any[]> {
    const officeIds = await sourcePool.query('SELECT id FROM dispatch_offices ORDER BY id');
    const doctorIds = await sourcePool.query('SELECT id FROM dispatch_doctors ORDER BY id');

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
          totalRecords: officeIds.rows.length
        }
      },
      {
        entityType: 'doctors',
        recordIds: doctorIds.rows.map(row => row.id.toString()),
        priority: 'medium',
        dependencies: ['offices'],
        estimatedDurationMs: 10000,
        metadata: {
          sourceTable: 'dispatch_doctors',
          destinationTable: 'doctors',
          totalRecords: doctorIds.rows.length
        }
      }
    ];
  }

  function createTestMigrationTasksForSession(sessionId: string): Promise<any[]> {
    return createTestMigrationTasks();
  }

  async function createLargeMigrationTasks(): Promise<any[]> {
    // Create larger dataset for performance testing
    const batchInserts = [];
    for (let i = 1; i <= 20; i++) {
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
        estimatedDurationMs: 15000,
        metadata: {
          sourceTable: 'dispatch_offices',
          destinationTable: 'offices',
          totalRecords: officeIds.rows.length
        }
      }
    ];
  }

  async function createSlowMigrationTasks(): Promise<any[]> {
    // Create tasks that will be processed slowly to trigger alerts
    const officeIds = await sourcePool.query('SELECT id FROM dispatch_offices ORDER BY id');

    return [
      {
        entityType: 'offices',
        recordIds: officeIds.rows.map(row => row.id.toString()),
        priority: 'low', // Lower priority to simulate slower processing
        dependencies: [],
        estimatedDurationMs: 20000,
        metadata: {
          sourceTable: 'dispatch_offices',
          destinationTable: 'offices',
          totalRecords: officeIds.rows.length,
          slowProcessing: true // Flag to simulate slow processing
        }
      }
    ];
  }

  async function createPredictableMigrationTasks(): Promise<any[]> {
    // Create tasks with predictable processing patterns
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
          predictableProcessing: true
        }
      }
    ];
  }

  async function simulateAlertConditions(): Promise<void> {
    // Simulate various conditions that would trigger alerts
    await progressTracker.recordAlert({
      alertId: uuidv4(),
      severity: 'info',
      type: 'migration_started',
      entityType: 'offices',
      message: 'Migration started for offices',
      details: { batchSize: 50, totalRecords: 100 },
      timestamp: new Date()
    });

    await progressTracker.recordAlert({
      alertId: uuidv4(),
      severity: 'warning',
      type: 'low_throughput',
      entityType: 'offices',
      message: 'Processing throughput below expected rate',
      details: { expected: 100, actual: 65, threshold: 80 },
      timestamp: new Date()
    });

    await progressTracker.recordAlert({
      alertId: uuidv4(),
      severity: 'info',
      type: 'checkpoint_created',
      entityType: 'offices',
      message: 'Migration checkpoint created successfully',
      details: { checkpointId: 'cp_001', recordsProcessed: 250 },
      timestamp: new Date()
    });
  }
});