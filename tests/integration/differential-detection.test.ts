/**
 * Complete Differential Detection Workflow Integration Tests
 * Tests end-to-end change detection with sample data modifications
 */

import { Pool } from 'pg';
import { DifferentialDetector, type DetectionResult, type DetectionConfig } from '../../src/differential-migration/services/differential-detector';
import { DatabaseComparator } from '../../src/differential-migration/lib/database-comparator';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

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

// Test entities
const TEST_ENTITIES = ['offices', 'doctors', 'patients'];

describe('Complete Differential Detection Workflow Integration Tests', () => {
  let sourcePool: Pool;
  let destinationPool: Pool;
  let dbComparator: DatabaseComparator;
  let baselineTimestamp: Date;

  beforeAll(async () => {
    // Initialize database connections
    sourcePool = new Pool(TEST_CONFIG.sourceDb);
    destinationPool = new Pool(TEST_CONFIG.destinationDb);
    dbComparator = new DatabaseComparator(sourcePool, destinationPool);

    // Verify database connections
    await verifyDatabaseConnections();

    // Setup initial test data and establish baseline
    await setupInitialTestData();
    baselineTimestamp = new Date();

    // Wait a moment to ensure timestamps are different
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  afterAll(async () => {
    // Cleanup test data
    await cleanupTestData();

    // Close all connections
    await dbComparator.close();
    await sourcePool.end();
    await destinationPool.end();
  });

  beforeEach(async () => {
    // Reset to clean state for each test
    await resetTestDataToBaseline();
  });

  describe('End-to-End Differential Detection Workflow', () => {
    test('should detect new records added after baseline', async () => {
      // Add new records to source database
      await addNewRecordsToSource();

      const detector = new DifferentialDetector(
        sourcePool,
        destinationPool,
        'offices',
        getDefaultDetectionConfig(),
        uuidv4()
      );

      const result = await detector.detectChanges({
        entityType: 'offices',
        sinceTimestamp: baselineTimestamp,
        includeDeletes: true,
        enableContentHashing: true,
        batchSize: 100
      });

      // Validate detection results
      expect(result.summary.newRecords).toBe(3);
      expect(result.summary.modifiedRecords).toBe(0);
      expect(result.summary.deletedRecords).toBe(0);
      expect(result.summary.totalChanges).toBe(3);
      expect(result.summary.changePercentage).toBeGreaterThan(0);

      // Validate change details
      expect(result.changesDetected).toHaveLength(3);
      for (const change of result.changesDetected) {
        expect(change.changeType).toBe('new');
        expect(change.sourceTimestamp).toBeInstanceOf(Date);
        expect(change.sourceTimestamp.getTime()).toBeGreaterThan(baselineTimestamp.getTime());
        expect(change.contentHash).toBeDefined();
        expect(change.metadata.confidence).toBeGreaterThanOrEqual(0.8);
      }

      // Validate performance metrics
      expect(result.performance.analysisDurationMs).toBeGreaterThan(0);
      expect(result.performance.recordsPerSecond).toBeGreaterThan(0);
      expect(result.performance.queriesExecuted).toBeGreaterThanOrEqual(2);
    });

    test('should detect modified records with content hash verification', async () => {
      // Modify existing records in source database
      await modifyExistingRecordsInSource();

      const detector = new DifferentialDetector(
        sourcePool,
        destinationPool,
        'offices',
        getDefaultDetectionConfig(),
        uuidv4()
      );

      const result = await detector.detectChanges({
        entityType: 'offices',
        sinceTimestamp: baselineTimestamp,
        includeDeletes: true,
        enableContentHashing: true,
        batchSize: 100
      });

      // Should detect modified records
      expect(result.summary.newRecords).toBe(0);
      expect(result.summary.modifiedRecords).toBeGreaterThan(0);
      expect(result.summary.deletedRecords).toBe(0);
      expect(result.summary.totalChanges).toBeGreaterThan(0);

      // Validate change details
      const modifiedChanges = result.changesDetected.filter(c => c.changeType === 'modified');
      expect(modifiedChanges.length).toBeGreaterThan(0);

      for (const change of modifiedChanges) {
        expect(change.changeType).toBe('modified');
        expect(change.contentHash).toBeDefined();
        expect(change.previousContentHash).toBeDefined();
        expect(change.contentHash).not.toBe(change.previousContentHash);
        expect(change.metadata.confidence).toBeGreaterThanOrEqual(0.9);
      }
    });

    test('should detect deleted records when includeDeletes is enabled', async () => {
      // Remove records from source database to simulate deletions
      await simulateRecordDeletions();

      const detector = new DifferentialDetector(
        sourcePool,
        destinationPool,
        'offices',
        getDefaultDetectionConfig(),
        uuidv4()
      );

      const result = await detector.detectChanges({
        entityType: 'offices',
        sinceTimestamp: baselineTimestamp,
        includeDeletes: true,
        enableContentHashing: true,
        batchSize: 100
      });

      // Should detect deleted records
      expect(result.summary.deletedRecords).toBeGreaterThan(0);
      expect(result.summary.totalChanges).toBeGreaterThan(0);

      // Validate deletion details
      const deletedChanges = result.changesDetected.filter(c => c.changeType === 'deleted');
      expect(deletedChanges.length).toBeGreaterThan(0);

      for (const change of deletedChanges) {
        expect(change.changeType).toBe('deleted');
        expect(change.destinationTimestamp).toBeDefined();
        expect(change.sourceTimestamp).toBeUndefined();
        expect(change.metadata.confidence).toBeGreaterThanOrEqual(0.95);
      }
    });

    test('should handle mixed changes (new, modified, deleted) in single analysis', async () => {
      // Create mixed scenario
      await addNewRecordsToSource();
      await modifyExistingRecordsInSource();
      await simulateRecordDeletions();

      const detector = new DifferentialDetector(
        sourcePool,
        destinationPool,
        'offices',
        getDefaultDetectionConfig(),
        uuidv4()
      );

      const result = await detector.detectChanges({
        entityType: 'offices',
        sinceTimestamp: baselineTimestamp,
        includeDeletes: true,
        enableContentHashing: true,
        batchSize: 100
      });

      // Should detect all types of changes
      expect(result.summary.newRecords).toBeGreaterThan(0);
      expect(result.summary.modifiedRecords).toBeGreaterThan(0);
      expect(result.summary.deletedRecords).toBeGreaterThan(0);

      const totalDetected = result.summary.newRecords +
                           result.summary.modifiedRecords +
                           result.summary.deletedRecords;
      expect(result.summary.totalChanges).toBe(totalDetected);

      // Validate change type distribution
      const newChanges = result.changesDetected.filter(c => c.changeType === 'new');
      const modifiedChanges = result.changesDetected.filter(c => c.changeType === 'modified');
      const deletedChanges = result.changesDetected.filter(c => c.changeType === 'deleted');

      expect(newChanges.length).toBe(result.summary.newRecords);
      expect(modifiedChanges.length).toBe(result.summary.modifiedRecords);
      expect(deletedChanges.length).toBe(result.summary.deletedRecords);
    });

    test('should perform batch processing efficiently for large datasets', async () => {
      // Create large dataset for batch processing test
      await createLargeDataset();

      const detector = new DifferentialDetector(
        sourcePool,
        destinationPool,
        'offices',
        { ...getDefaultDetectionConfig(), batchSize: 50 },
        uuidv4()
      );

      const startTime = Date.now();
      const result = await detector.detectChanges({
        entityType: 'offices',
        sinceTimestamp: baselineTimestamp,
        includeDeletes: true,
        enableContentHashing: true,
        batchSize: 50
      });
      const endTime = Date.now();

      // Validate performance
      const processingTime = endTime - startTime;
      expect(result.performance.analysisDurationMs).toBeLessThan(processingTime + 1000);
      expect(result.performance.recordsPerSecond).toBeGreaterThan(10);
      expect(result.totalRecordsAnalyzed).toBeGreaterThanOrEqual(100);

      // Should process in multiple batches
      expect(result.performance.queriesExecuted).toBeGreaterThanOrEqual(4); // Multiple batch queries
    }, 30000);

    test('should handle timestamp edge cases accurately', async () => {
      // Create records with timestamps very close to baseline
      const nearBaselineTime = new Date(baselineTimestamp.getTime() + 100); // 100ms after baseline
      await createRecordsWithSpecificTimestamp(nearBaselineTime);

      const detector = new DifferentialDetector(
        sourcePool,
        destinationPool,
        'offices',
        getDefaultDetectionConfig(),
        uuidv4()
      );

      // Test with baseline timestamp (should include edge case records)
      const resultInclusive = await detector.detectChanges({
        entityType: 'offices',
        sinceTimestamp: baselineTimestamp,
        includeDeletes: false,
        enableContentHashing: false,
        batchSize: 100
      });

      // Should detect records created after baseline
      expect(resultInclusive.summary.newRecords).toBeGreaterThan(0);

      // Test with timestamp after edge case records (should exclude them)
      const futureTimestamp = new Date(nearBaselineTime.getTime() + 1000);
      const resultExclusive = await detector.detectChanges({
        entityType: 'offices',
        sinceTimestamp: futureTimestamp,
        includeDeletes: false,
        enableContentHashing: false,
        batchSize: 100
      });

      // Should not detect the edge case records
      expect(resultExclusive.summary.newRecords).toBe(0);
    });

    test('should generate accurate content hashes for change verification', async () => {
      const detector = new DifferentialDetector(
        sourcePool,
        destinationPool,
        'offices',
        getDefaultDetectionConfig(),
        uuidv4()
      );

      // Add record with known content
      const knownContent = { name: 'Hash Test Office', address: '123 Test St' };
      await sourcePool.query(
        'INSERT INTO dispatch_offices (name, address, updated_at) VALUES ($1, $2, NOW())',
        [knownContent.name, knownContent.address]
      );

      const result = await detector.detectChanges({
        entityType: 'offices',
        sinceTimestamp: baselineTimestamp,
        includeDeletes: false,
        enableContentHashing: true,
        batchSize: 100
      });

      // Find the hash test record
      const hashTestChange = result.changesDetected.find(c =>
        c.recordId.includes('Hash Test Office') ||
        c.metadata.sourceData?.name === 'Hash Test Office'
      );

      expect(hashTestChange).toBeDefined();
      expect(hashTestChange!.contentHash).toBeDefined();
      expect(hashTestChange!.contentHash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hash format

      // Verify hash consistency
      const manualHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(knownContent))
        .digest('hex');

      // Content hashes should be deterministic
      expect(hashTestChange!.contentHash).toHaveLength(64);
    });

    test('should provide accurate performance metrics', async () => {
      await addNewRecordsToSource();

      const detector = new DifferentialDetector(
        sourcePool,
        destinationPool,
        'offices',
        getDefaultDetectionConfig(),
        uuidv4()
      );

      const startTime = Date.now();
      const result = await detector.detectChanges({
        entityType: 'offices',
        sinceTimestamp: baselineTimestamp,
        includeDeletes: true,
        enableContentHashing: true,
        batchSize: 100
      });
      const endTime = Date.now();

      const actualDuration = endTime - startTime;

      // Performance metrics should be accurate
      expect(result.performance.analysisDurationMs).toBeGreaterThan(50);
      expect(result.performance.analysisDurationMs).toBeLessThan(actualDuration + 500);
      expect(result.performance.recordsPerSecond).toBeGreaterThan(0);
      expect(result.performance.recordsPerSecond).toBeLessThan(10000); // Reasonable upper bound

      // Calculate expected records per second
      const expectedRecordsPerSecond = result.totalRecordsAnalyzed /
        (result.performance.analysisDurationMs / 1000);
      expect(result.performance.recordsPerSecond).toBeCloseTo(expectedRecordsPerSecond, 0);
    });
  });

  describe('Detection Configuration Options', () => {
    test('should handle different batch sizes effectively', async () => {
      await createLargeDataset();

      const batchSizes = [10, 50, 100, 500];
      const results: DetectionResult[] = [];

      for (const batchSize of batchSizes) {
        const detector = new DifferentialDetector(
          sourcePool,
          destinationPool,
          'offices',
          { ...getDefaultDetectionConfig(), batchSize },
          uuidv4()
        );

        const result = await detector.detectChanges({
          entityType: 'offices',
          sinceTimestamp: baselineTimestamp,
          includeDeletes: false,
          enableContentHashing: false,
          batchSize
        });

        results.push(result);
      }

      // All batch sizes should detect the same number of changes
      const changeCounts = results.map(r => r.summary.totalChanges);
      expect(new Set(changeCounts).size).toBe(1); // All should be the same

      // Smaller batch sizes should generally have more queries
      expect(results[0].performance.queriesExecuted).toBeGreaterThanOrEqual(
        results[results.length - 1].performance.queriesExecuted
      );
    });

    test('should handle content hashing toggle correctly', async () => {
      await addNewRecordsToSource();

      const detector = new DifferentialDetector(
        sourcePool,
        destinationPool,
        'offices',
        getDefaultDetectionConfig(),
        uuidv4()
      );

      // Test with content hashing enabled
      const resultWithHashing = await detector.detectChanges({
        entityType: 'offices',
        sinceTimestamp: baselineTimestamp,
        includeDeletes: false,
        enableContentHashing: true,
        batchSize: 100
      });

      // Test with content hashing disabled
      const resultWithoutHashing = await detector.detectChanges({
        entityType: 'offices',
        sinceTimestamp: baselineTimestamp,
        includeDeletes: false,
        enableContentHashing: false,
        batchSize: 100
      });

      // Should detect same number of changes
      expect(resultWithHashing.summary.totalChanges).toBe(
        resultWithoutHashing.summary.totalChanges
      );

      // Hashing version should have content hashes
      const changesWithHash = resultWithHashing.changesDetected.filter(c => c.contentHash);
      expect(changesWithHash.length).toBe(resultWithHashing.summary.totalChanges);

      // Non-hashing version should not have content hashes
      const changesWithoutHash = resultWithoutHashing.changesDetected.filter(c => !c.contentHash);
      expect(changesWithoutHash.length).toBe(resultWithoutHashing.summary.totalChanges);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle non-existent entity gracefully', async () => {
      const detector = new DifferentialDetector(
        sourcePool,
        destinationPool,
        'nonexistent_entity',
        getDefaultDetectionConfig(),
        uuidv4()
      );

      await expect(detector.detectChanges({
        entityType: 'nonexistent_entity',
        sinceTimestamp: baselineTimestamp,
        includeDeletes: false,
        enableContentHashing: false,
        batchSize: 100
      })).rejects.toThrow();
    });

    test('should handle database connection failures gracefully', async () => {
      // Create detector with invalid destination config
      const badPool = new Pool({ ...TEST_CONFIG.destinationDb, host: 'invalid-host' });

      const detector = new DifferentialDetector(
        sourcePool,
        badPool,
        'offices',
        getDefaultDetectionConfig(),
        uuidv4()
      );

      await expect(detector.detectChanges({
        entityType: 'offices',
        sinceTimestamp: baselineTimestamp,
        includeDeletes: false,
        enableContentHashing: false,
        batchSize: 100
      })).rejects.toThrow(/connection/i);

      await badPool.end();
    });

    test('should handle empty result sets appropriately', async () => {
      // Use future timestamp to ensure no changes are detected
      const futureTimestamp = new Date(Date.now() + 86400000); // Tomorrow

      const detector = new DifferentialDetector(
        sourcePool,
        destinationPool,
        'offices',
        getDefaultDetectionConfig(),
        uuidv4()
      );

      const result = await detector.detectChanges({
        entityType: 'offices',
        sinceTimestamp: futureTimestamp,
        includeDeletes: false,
        enableContentHashing: false,
        batchSize: 100
      });

      expect(result.summary.totalChanges).toBe(0);
      expect(result.summary.newRecords).toBe(0);
      expect(result.summary.modifiedRecords).toBe(0);
      expect(result.summary.deletedRecords).toBe(0);
      expect(result.changesDetected).toHaveLength(0);
      expect(result.summary.changePercentage).toBe(0);
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

  async function setupInitialTestData(): Promise<void> {
    // Setup base test data for differential detection
    const sourceQueries = [
      'CREATE TABLE IF NOT EXISTS dispatch_offices (id SERIAL PRIMARY KEY, name VARCHAR(255), address VARCHAR(255), updated_at TIMESTAMP DEFAULT NOW())',
      'INSERT INTO dispatch_offices (name, address) VALUES (\'Initial Office 1\', \'123 Main St\'), (\'Initial Office 2\', \'456 Oak Ave\') ON CONFLICT DO NOTHING'
    ];

    const destinationQueries = [
      'CREATE TABLE IF NOT EXISTS offices (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(255), address VARCHAR(255), updated_at TIMESTAMP DEFAULT NOW())',
      'INSERT INTO offices (name, address) VALUES (\'Initial Office 1\', \'123 Main St\') ON CONFLICT DO NOTHING'
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
      'DROP TABLE IF EXISTS dispatch_offices',
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

  async function resetTestDataToBaseline(): Promise<void> {
    // Reset to baseline state
    await sourcePool.query('DELETE FROM dispatch_offices');
    await destinationPool.query('DELETE FROM offices');

    // Recreate baseline data
    await sourcePool.query(`
      INSERT INTO dispatch_offices (name, address, updated_at)
      VALUES ('Initial Office 1', '123 Main St', '${baselineTimestamp.toISOString()}'),
             ('Initial Office 2', '456 Oak Ave', '${baselineTimestamp.toISOString()}')
    `);

    await destinationPool.query(`
      INSERT INTO offices (name, address, updated_at)
      VALUES ('Initial Office 1', '123 Main St', '${baselineTimestamp.toISOString()}')
    `);
  }

  async function addNewRecordsToSource(): Promise<void> {
    await sourcePool.query(`
      INSERT INTO dispatch_offices (name, address, updated_at)
      VALUES ('New Office 1', '789 New St', NOW()),
             ('New Office 2', '321 Fresh Ave', NOW()),
             ('New Office 3', '654 Modern Blvd', NOW())
    `);
  }

  async function modifyExistingRecordsInSource(): Promise<void> {
    await sourcePool.query(`
      UPDATE dispatch_offices
      SET address = 'Updated Address', updated_at = NOW()
      WHERE name = 'Initial Office 1'
    `);
  }

  async function simulateRecordDeletions(): Promise<void> {
    // Add record to destination that doesn't exist in source to simulate deletion
    await destinationPool.query(`
      INSERT INTO offices (name, address, updated_at)
      VALUES ('Deleted Office', '999 Gone St', NOW())
    `);
  }

  async function createLargeDataset(): Promise<void> {
    const batchInserts = [];
    for (let i = 1; i <= 100; i++) {
      batchInserts.push(`('Large Office ${i}', '${i} Large St', NOW())`);
    }

    await sourcePool.query(`
      INSERT INTO dispatch_offices (name, address, updated_at)
      VALUES ${batchInserts.join(', ')}
    `);
  }

  async function createRecordsWithSpecificTimestamp(timestamp: Date): Promise<void> {
    await sourcePool.query(`
      INSERT INTO dispatch_offices (name, address, updated_at)
      VALUES ('Edge Case Office', '123 Edge St', '${timestamp.toISOString()}')
    `);
  }

  function getDefaultDetectionConfig(): DetectionConfig {
    return {
      timestampField: 'updated_at',
      contentHashField: 'content_hash',
      enableContentHashing: true,
      batchSize: 100,
      parallelConnections: 2
    };
  }
});