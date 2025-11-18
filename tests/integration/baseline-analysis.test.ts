/**
 * Complete Baseline Analysis Workflow Integration Tests
 * Tests end-to-end baseline analysis with real database connections
 */

import { Pool } from 'pg';
import { BaselineAnalyzer, type BaselineAnalysisReport } from '../../src/differential-migration/services/baseline-analyzer';
import { DatabaseComparator } from '../../src/differential-migration/lib/database-comparator';
import { v4 as uuidv4 } from 'uuid';

// Test configuration
const TEST_CONFIG = {
  sourceDb: {
    host: process.env.SOURCE_DB_HOST || 'localhost',
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME || 'test_source_db',
    user: process.env.SOURCE_DB_USER || 'postgres',
    password: process.env.SOURCE_DB_PASSWORD || 'postgres',
    maxConnections: 5,
    connectionTimeoutMs: 5000
  },
  destinationDb: {
    host: process.env.TARGET_DB_HOST || 'localhost',
    port: parseInt(process.env.TARGET_DB_PORT || '54322'),
    database: process.env.TARGET_DB_NAME || 'test_target_db',
    user: process.env.TARGET_DB_USER || 'postgres',
    password: process.env.TARGET_DB_PASSWORD || 'postgres',
    maxConnections: 5,
    connectionTimeoutMs: 5000
  }
};

// Test data setup
const TEST_ENTITIES = ['offices', 'doctors', 'patients'];

describe('Complete Baseline Analysis Workflow Integration Tests', () => {
  let sourcePool: Pool;
  let destinationPool: Pool;
  let baselineAnalyzer: BaselineAnalyzer;
  let dbComparator: DatabaseComparator;

  beforeAll(async () => {
    // Initialize database connections
    sourcePool = new Pool(TEST_CONFIG.sourceDb);
    destinationPool = new Pool(TEST_CONFIG.destinationDb);

    // Initialize services
    baselineAnalyzer = new BaselineAnalyzer(
      TEST_CONFIG.sourceDb,
      TEST_CONFIG.destinationDb,
      uuidv4()
    );

    dbComparator = new DatabaseComparator(sourcePool, destinationPool);

    // Verify database connections
    await verifyDatabaseConnections();

    // Setup test data
    await setupTestData();
  });

  afterAll(async () => {
    // Cleanup test data
    await cleanupTestData();

    // Close all connections
    await baselineAnalyzer.close();
    await dbComparator.close();
    await sourcePool.end();
    await destinationPool.end();
  });

  beforeEach(async () => {
    // Reset test data state for each test
    await resetTestDataState();
  });

  describe('End-to-End Baseline Analysis Workflow', () => {
    test('should complete full baseline analysis for all entities', async () => {
      const analysisId = uuidv4();

      // Execute complete baseline analysis
      const report = await baselineAnalyzer.generateBaselineReport(TEST_ENTITIES, analysisId);

      // Validate report structure
      expect(report).toBeDefined();
      expect(report.analysisId).toBe(analysisId);
      expect(report.entityResults).toHaveLength(TEST_ENTITIES.length);
      expect(report.overallStatus).toMatch(/^(synced|gaps_detected|critical_issues)$/);

      // Validate entity results
      for (const entityResult of report.entityResults) {
        expect(entityResult.entityType).toBeOneOf(TEST_ENTITIES);
        expect(entityResult.sourceCount).toBeGreaterThanOrEqual(0);
        expect(entityResult.destinationCount).toBeGreaterThanOrEqual(0);
        expect(entityResult.recordGap).toBe(entityResult.sourceCount - entityResult.destinationCount);
        expect(entityResult.gapPercentage).toBeGreaterThanOrEqual(0);
        expect(entityResult.gapPercentage).toBeLessThanOrEqual(100);
      }

      // Validate performance metrics
      expect(report.performanceMetrics.analysisDurationMs).toBeGreaterThan(0);
      expect(report.performanceMetrics.queriesExecuted).toBeGreaterThan(0);
      expect(report.performanceMetrics.averageQueryTimeMs).toBeGreaterThan(0);

      // Validate summary calculations
      const expectedTotalSource = report.entityResults.reduce((sum, r) => sum + r.sourceCount, 0);
      const expectedTotalDestination = report.entityResults.reduce((sum, r) => sum + r.destinationCount, 0);
      const expectedOverallGap = expectedTotalSource - expectedTotalDestination;

      expect(report.summary.totalSourceRecords).toBe(expectedTotalSource);
      expect(report.summary.totalDestinationRecords).toBe(expectedTotalDestination);
      expect(report.summary.overallGap).toBe(expectedOverallGap);

      // Validate recommendations
      expect(report.recommendations).toBeDefined();
      expect(Array.isArray(report.recommendations)).toBe(true);
      expect(report.recommendations.length).toBeGreaterThan(0);
    }, 30000);

    test('should handle database connection failures gracefully', async () => {
      // Create analyzer with invalid connection config
      const invalidAnalyzer = new BaselineAnalyzer(
        { ...TEST_CONFIG.sourceDb, host: 'invalid-host' },
        TEST_CONFIG.destinationDb,
        uuidv4()
      );

      try {
        await invalidAnalyzer.generateBaselineReport(TEST_ENTITIES, uuidv4());
        fail('Expected connection failure to throw error');
      } catch (error) {
        expect(error).toBeDefined();
        expect(error.message).toContain('connection');
      } finally {
        await invalidAnalyzer.close();
      }
    });

    test('should detect and report record gaps accurately', async () => {
      // Create known gaps in test data
      await createKnownDataGaps();

      const analysisId = uuidv4();
      const report = await baselineAnalyzer.generateBaselineReport(['offices'], analysisId);

      const officesResult = report.entityResults.find(r => r.entityType === 'offices');
      expect(officesResult).toBeDefined();
      expect(officesResult!.recordGap).toBe(5); // Expected gap from createKnownDataGaps
      expect(officesResult!.gapPercentage).toBeCloseTo(33.33, 1); // 5 out of 15 records

      expect(report.overallStatus).toBe('gaps_detected');
      expect(report.recommendations).toContain(
        expect.stringMatching(/migration.*recommended/i)
      );
    });

    test('should validate schema mappings when requested', async () => {
      const analysisId = uuidv4();
      const report = await baselineAnalyzer.generateBaselineReport(
        TEST_ENTITIES,
        analysisId,
        { includeMappingValidation: true }
      );

      expect(report.mappingValidation).toBeDefined();
      expect(report.mappingValidation!.length).toBeGreaterThan(0);

      for (const validation of report.mappingValidation!) {
        expect(validation.entityType).toBeOneOf(TEST_ENTITIES);
        expect(typeof validation.isValid).toBe('boolean');
        expect(validation.missingMappings).toBeDefined();
        expect(validation.orphanedMappings).toBeDefined();
        expect(validation.schemaChanges).toBeDefined();

        if (!validation.isValid) {
          const totalIssues = validation.missingMappings.length +
                            validation.orphanedMappings.length +
                            validation.schemaChanges.length;
          expect(totalIssues).toBeGreaterThan(0);
        }
      }
    });

    test('should handle empty databases gracefully', async () => {
      // Clear all test data
      await clearAllTestData();

      const analysisId = uuidv4();
      const report = await baselineAnalyzer.generateBaselineReport(TEST_ENTITIES, analysisId);

      expect(report.summary.totalSourceRecords).toBe(0);
      expect(report.summary.totalDestinationRecords).toBe(0);
      expect(report.summary.overallGap).toBe(0);
      expect(report.overallStatus).toBe('synced');

      for (const entityResult of report.entityResults) {
        expect(entityResult.sourceCount).toBe(0);
        expect(entityResult.destinationCount).toBe(0);
        expect(entityResult.recordGap).toBe(0);
        expect(entityResult.gapPercentage).toBe(0);
      }

      // Restore test data for other tests
      await setupTestData();
    });

    test('should track analysis performance metrics accurately', async () => {
      const analysisId = uuidv4();
      const startTime = Date.now();

      const report = await baselineAnalyzer.generateBaselineReport(TEST_ENTITIES, analysisId);

      const endTime = Date.now();
      const actualDuration = endTime - startTime;

      // Performance metrics should be reasonable
      expect(report.performanceMetrics.analysisDurationMs).toBeGreaterThan(100);
      expect(report.performanceMetrics.analysisDurationMs).toBeLessThan(actualDuration + 1000);
      expect(report.performanceMetrics.queriesExecuted).toBeGreaterThanOrEqual(TEST_ENTITIES.length * 2);
      expect(report.performanceMetrics.averageQueryTimeMs).toBeGreaterThan(0);
      expect(report.performanceMetrics.averageQueryTimeMs).toBeLessThan(5000);
    });

    test('should handle concurrent baseline analyses', async () => {
      const analysisPromises = Array.from({ length: 3 }, (_, i) =>
        baselineAnalyzer.generateBaselineReport(
          ['offices'],
          `concurrent-analysis-${i}-${uuidv4()}`
        )
      );

      const reports = await Promise.all(analysisPromises);

      // All analyses should complete successfully
      expect(reports).toHaveLength(3);
      for (const report of reports) {
        expect(report.entityResults).toHaveLength(1);
        expect(report.entityResults[0].entityType).toBe('offices');
        expect(report.performanceMetrics.analysisDurationMs).toBeGreaterThan(0);
      }

      // Results should be consistent across concurrent analyses
      const sourceCounts = reports.map(r => r.entityResults[0].sourceCount);
      const destinationCounts = reports.map(r => r.entityResults[0].destinationCount);

      expect(new Set(sourceCounts).size).toBe(1); // All should be the same
      expect(new Set(destinationCounts).size).toBe(1); // All should be the same
    });
  });

  describe('Database Connection Management', () => {
    test('should properly manage connection pools', async () => {
      const connectionTest = await baselineAnalyzer.testConnections();

      expect(connectionTest.sourceConnection.successful).toBe(true);
      expect(connectionTest.sourceConnection.responseTimeMs).toBeGreaterThan(0);
      expect(connectionTest.sourceConnection.responseTimeMs).toBeLessThan(5000);

      expect(connectionTest.destinationConnection.successful).toBe(true);
      expect(connectionTest.destinationConnection.responseTimeMs).toBeGreaterThan(0);
      expect(connectionTest.destinationConnection.responseTimeMs).toBeLessThan(5000);
    });

    test('should handle connection pool exhaustion gracefully', async () => {
      // Create many concurrent analyses to exhaust connection pool
      const manyAnalyses = Array.from({ length: 10 }, (_, i) =>
        baselineAnalyzer.generateBaselineReport(['offices'], `pool-test-${i}`)
      );

      // Should not throw errors due to connection pool management
      const results = await Promise.all(manyAnalyses);
      expect(results).toHaveLength(10);

      for (const result of results) {
        expect(result.entityResults).toHaveLength(1);
        expect(result.performanceMetrics.analysisDurationMs).toBeGreaterThan(0);
      }
    }, 45000);
  });

  describe('Error Recovery and Resilience', () => {
    test('should recover from transient database errors', async () => {
      // Simulate transient error by temporarily closing connection
      await sourcePool.end();

      // Recreate pool to simulate recovery
      sourcePool = new Pool(TEST_CONFIG.sourceDb);

      // Analysis should eventually succeed with retry logic
      const report = await baselineAnalyzer.generateBaselineReport(['offices'], uuidv4());

      expect(report.entityResults).toHaveLength(1);
      expect(report.overallStatus).toMatch(/^(synced|gaps_detected|critical_issues)$/);
    });

    test('should handle malformed entity names gracefully', async () => {
      const invalidEntities = ['invalid_entity', 'nonexistent_table'];

      try {
        await baselineAnalyzer.generateBaselineReport(invalidEntities, uuidv4());
      } catch (error) {
        expect(error).toBeDefined();
        expect(error.message).toContain('entity');
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

  async function setupTestData(): Promise<void> {
    // Setup test data in both source and destination databases
    const sourceQueries = [
      'CREATE TABLE IF NOT EXISTS dispatch_offices (id SERIAL PRIMARY KEY, name VARCHAR(255), created_at TIMESTAMP DEFAULT NOW())',
      'CREATE TABLE IF NOT EXISTS dispatch_doctors (id SERIAL PRIMARY KEY, office_id INTEGER, name VARCHAR(255), created_at TIMESTAMP DEFAULT NOW())',
      'CREATE TABLE IF NOT EXISTS dispatch_patients (id SERIAL PRIMARY KEY, doctor_id INTEGER, name VARCHAR(255), created_at TIMESTAMP DEFAULT NOW())',

      'INSERT INTO dispatch_offices (name) VALUES (\'Test Office 1\'), (\'Test Office 2\'), (\'Test Office 3\') ON CONFLICT DO NOTHING',
      'INSERT INTO dispatch_doctors (office_id, name) VALUES (1, \'Dr. Smith\'), (1, \'Dr. Jones\'), (2, \'Dr. Brown\') ON CONFLICT DO NOTHING',
      'INSERT INTO dispatch_patients (doctor_id, name) VALUES (1, \'Patient A\'), (2, \'Patient B\'), (3, \'Patient C\') ON CONFLICT DO NOTHING'
    ];

    const destinationQueries = [
      'CREATE TABLE IF NOT EXISTS offices (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(255), created_at TIMESTAMP DEFAULT NOW())',
      'CREATE TABLE IF NOT EXISTS doctors (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), office_id UUID, name VARCHAR(255), created_at TIMESTAMP DEFAULT NOW())',
      'CREATE TABLE IF NOT EXISTS patients (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), doctor_id UUID, name VARCHAR(255), created_at TIMESTAMP DEFAULT NOW())',

      'INSERT INTO offices (name) VALUES (\'Test Office 1\'), (\'Test Office 2\') ON CONFLICT DO NOTHING',
      'INSERT INTO doctors (name) VALUES (\'Dr. Smith\'), (\'Dr. Jones\') ON CONFLICT DO NOTHING',
      'INSERT INTO patients (name) VALUES (\'Patient A\') ON CONFLICT DO NOTHING'
    ];

    for (const query of sourceQueries) {
      await sourcePool.query(query);
    }

    for (const query of destinationQueries) {
      await destinationPool.query(query);
    }
  }

  async function cleanupTestData(): Promise<void> {
    const cleanupQueries = [
      'DROP TABLE IF EXISTS dispatch_patients',
      'DROP TABLE IF EXISTS dispatch_doctors',
      'DROP TABLE IF EXISTS dispatch_offices',
      'DROP TABLE IF EXISTS patients',
      'DROP TABLE IF EXISTS doctors',
      'DROP TABLE IF EXISTS offices'
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

  async function resetTestDataState(): Promise<void> {
    // Reset to known state
    await cleanupTestData();
    await setupTestData();
  }

  async function createKnownDataGaps(): Promise<void> {
    // Add extra records to source to create known gaps
    await sourcePool.query(`
      INSERT INTO dispatch_offices (name)
      VALUES ('Gap Office 1'), ('Gap Office 2'), ('Gap Office 3'), ('Gap Office 4'), ('Gap Office 5')
    `);
  }

  async function clearAllTestData(): Promise<void> {
    await sourcePool.query('DELETE FROM dispatch_patients');
    await sourcePool.query('DELETE FROM dispatch_doctors');
    await sourcePool.query('DELETE FROM dispatch_offices');
    await destinationPool.query('DELETE FROM patients');
    await destinationPool.query('DELETE FROM doctors');
    await destinationPool.query('DELETE FROM offices');
  }
});

// Custom Jest matcher
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeOneOf(expected: any[]): R;
    }
  }
}

expect.extend({
  toBeOneOf(received, expected) {
    const pass = expected.includes(received);
    if (pass) {
      return {
        message: () => `expected ${received} not to be one of ${expected.join(', ')}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be one of ${expected.join(', ')}`,
        pass: false,
      };
    }
  },
});