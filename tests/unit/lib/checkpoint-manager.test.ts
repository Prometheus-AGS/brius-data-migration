/**
 * CheckpointManager Library Tests
 * Tests checkpoint save/restore, state serialization, and recovery operations
 */

import { Pool, PoolClient } from 'pg';
import { CheckpointManager, type CheckpointConfig, type CheckpointData, type RecoveryInfo, type CheckpointMetadata, type SerializationResult, type CheckpointValidation } from '../../../src/differential-migration/lib/checkpoint-manager';
import { MigrationCheckpoint } from '../../../src/differential-migration/models/migration-checkpoint';

// Mock pg module
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    query: jest.fn(),
    end: jest.fn()
  }))
}));

// Mock file system operations
jest.mock('fs/promises', () => ({
  writeFile: jest.fn(),
  readFile: jest.fn(),
  unlink: jest.fn(),
  readdir: jest.fn(),
  stat: jest.fn()
}));

import * as fs from 'fs/promises';

describe('CheckpointManager', () => {
  let manager: CheckpointManager;
  let mockPool: jest.Mocked<Pool>;
  let mockClient: jest.Mocked<PoolClient>;

  const config: CheckpointConfig = {
    pool: null as any, // Will be mocked
    checkpointDir: '/tmp/test-checkpoints',
    enableFileBackup: true,
    enableDatabaseBackup: true,
    maxCheckpoints: 10,
    compressionEnabled: true,
    encryptionEnabled: false,
    retentionDays: 7,
    validationEnabled: true
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockClient = {
      query: jest.fn(),
      release: jest.fn()
    } as any;

    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
      query: jest.fn(),
      end: jest.fn()
    } as any;

    config.pool = mockPool;
    manager = new CheckpointManager(config);
  });

  describe('Checkpoint Creation and Saving', () => {
    test('should create checkpoint with comprehensive state', async () => {
      const checkpointData: CheckpointData = {
        sessionId: 'session_123',
        entityType: 'users',
        migrationRunId: 'run_456',
        batchPosition: 5,
        recordsProcessed: 2500,
        recordsRemaining: 7500,
        lastProcessedId: 'user_2500',
        processingState: {
          currentBatch: 5,
          batchSize: 500,
          startTime: new Date('2024-01-01T10:00:00Z'),
          totalBatches: 20,
          errorCount: 0,
          retryCount: 0
        },
        metadata: {
          sourceTable: 'dispatch_users',
          destinationTable: 'users',
          migrationStrategy: 'differential',
          dependencies: ['offices']
        }
      };

      const mockCheckpoint = {
        id: 'checkpoint_789',
        entity_type: 'users',
        migration_run_id: 'run_456',
        created_at: new Date(),
        last_processed_id: 'user_2500',
        batch_position: 5,
        records_processed: 2500,
        records_remaining: 7500,
        checkpoint_data: checkpointData
      };

      mockClient.query.mockResolvedValue({
        rows: [mockCheckpoint],
        rowCount: 1
      });

      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

      const result = await manager.createCheckpoint(checkpointData);

      expect(result.success).toBe(true);
      expect(result.checkpointId).toBe('checkpoint_789');
      expect(result.backupLocations).toContain('database');
      expect(result.backupLocations).toContain('file');

      // Verify database save
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO migration_checkpoints'),
        expect.arrayContaining([
          'users',
          'run_456',
          'user_2500',
          5,
          2500,
          7500,
          expect.any(String) // JSON serialized data
        ])
      );

      // Verify file backup
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('checkpoint_789.json'),
        expect.stringContaining('"sessionId":"session_123"'),
        'utf8'
      );
    });

    test('should handle checkpoint creation with compression', async () => {
      const largeCheckpointData: CheckpointData = {
        sessionId: 'session_large',
        entityType: 'orders',
        migrationRunId: 'run_large',
        batchPosition: 100,
        recordsProcessed: 50000,
        recordsRemaining: 450000,
        lastProcessedId: 'order_50000',
        processingState: {
          currentBatch: 100,
          batchSize: 500,
          startTime: new Date(),
          totalBatches: 1000,
          errorCount: 5,
          retryCount: 2,
          failedRecords: new Array(100).fill(0).map((_, i) => `order_${i}`),
          performanceMetrics: {
            averageBatchTimeMs: 150,
            recordsPerSecond: 3333,
            memoryUsageMb: 256
          }
        },
        metadata: {
          sourceTable: 'dispatch_orders',
          destinationTable: 'orders',
          migrationStrategy: 'bulk_insert'
        }
      };

      mockClient.query.mockResolvedValue({
        rows: [{ id: 'checkpoint_compressed' }],
        rowCount: 1
      });

      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

      const result = await manager.createCheckpoint(largeCheckpointData);

      expect(result.success).toBe(true);
      expect(result.compressed).toBe(true);
      expect(result.compressionRatio).toBeGreaterThan(0);
    });

    test('should generate checkpoint metadata accurately', async () => {
      const checkpointData: CheckpointData = {
        sessionId: 'session_metadata',
        entityType: 'doctors',
        migrationRunId: 'run_metadata',
        batchPosition: 10,
        recordsProcessed: 5000,
        recordsRemaining: 5000,
        lastProcessedId: 'doctor_5000',
        processingState: {
          currentBatch: 10,
          batchSize: 500,
          startTime: new Date('2024-01-01T09:00:00Z'),
          totalBatches: 20,
          errorCount: 2,
          retryCount: 1
        }
      };

      const metadata = await manager.generateCheckpointMetadata(checkpointData);

      expect(metadata.entityType).toBe('doctors');
      expect(metadata.progressPercentage).toBe(50); // 5000 / (5000 + 5000) * 100
      expect(metadata.estimatedTimeRemaining).toBeGreaterThan(0);
      expect(metadata.isResumable).toBe(true);
      expect(metadata.checksumValid).toBe(true);
      expect(metadata.size).toBeGreaterThan(0);
      expect(metadata.version).toBe('1.0');
    });
  });

  describe('Checkpoint Loading and Recovery', () => {
    test('should load checkpoint from database successfully', async () => {
      const mockCheckpointData = {
        sessionId: 'session_load',
        entityType: 'patients',
        migrationRunId: 'run_load',
        batchPosition: 15,
        recordsProcessed: 7500,
        recordsRemaining: 2500,
        lastProcessedId: 'patient_7500',
        processingState: {
          currentBatch: 15,
          batchSize: 500,
          startTime: new Date('2024-01-01T08:00:00Z'),
          totalBatches: 20,
          errorCount: 1,
          retryCount: 0
        }
      };

      const mockDbResult = {
        rows: [{
          id: 'checkpoint_load',
          entity_type: 'patients',
          migration_run_id: 'run_load',
          created_at: new Date('2024-01-01T10:30:00Z'),
          last_processed_id: 'patient_7500',
          batch_position: 15,
          records_processed: 7500,
          records_remaining: 2500,
          checkpoint_data: JSON.stringify(mockCheckpointData)
        }],
        rowCount: 1
      };

      mockClient.query.mockResolvedValue(mockDbResult);

      const checkpoint = await manager.loadCheckpoint('checkpoint_load');

      expect(checkpoint.success).toBe(true);
      expect(checkpoint.data?.sessionId).toBe('session_load');
      expect(checkpoint.data?.batchPosition).toBe(15);
      expect(checkpoint.data?.recordsProcessed).toBe(7500);
      expect(checkpoint.source).toBe('database');
    });

    test('should load checkpoint from file backup when database fails', async () => {
      const mockFileContent = JSON.stringify({
        sessionId: 'session_file',
        entityType: 'orders',
        migrationRunId: 'run_file',
        batchPosition: 25,
        recordsProcessed: 12500,
        recordsRemaining: 37500,
        lastProcessedId: 'order_12500'
      });

      // Database load fails
      mockClient.query.mockRejectedValue(new Error('Database unavailable'));

      // File load succeeds
      (fs.readFile as jest.Mock).mockResolvedValue(mockFileContent);

      const checkpoint = await manager.loadCheckpoint('checkpoint_file');

      expect(checkpoint.success).toBe(true);
      expect(checkpoint.data?.sessionId).toBe('session_file');
      expect(checkpoint.data?.batchPosition).toBe(25);
      expect(checkpoint.source).toBe('file');
      expect(checkpoint.fallbackUsed).toBe(true);
    });

    test('should validate checkpoint integrity on load', async () => {
      const mockCheckpointData = {
        sessionId: 'session_validate',
        entityType: 'cases',
        migrationRunId: 'run_validate',
        batchPosition: 5,
        recordsProcessed: 2500,
        recordsRemaining: 7500,
        lastProcessedId: 'case_2500',
        checksum: 'invalid_checksum'
      };

      mockClient.query.mockResolvedValue({
        rows: [{
          id: 'checkpoint_validate',
          checkpoint_data: JSON.stringify(mockCheckpointData)
        }],
        rowCount: 1
      });

      const checkpoint = await manager.loadCheckpoint('checkpoint_validate');

      expect(checkpoint.success).toBe(false);
      expect(checkpoint.validationErrors).toContain('Checksum validation failed');
    });

    test('should provide recovery information for failed migrations', async () => {
      const mockCheckpoints = [
        {
          id: 'checkpoint_1',
          entity_type: 'users',
          created_at: new Date('2024-01-01T10:00:00Z'),
          batch_position: 5,
          records_processed: 2500
        },
        {
          id: 'checkpoint_2',
          entity_type: 'users',
          created_at: new Date('2024-01-01T10:30:00Z'),
          batch_position: 10,
          records_processed: 5000
        }
      ];

      mockClient.query.mockResolvedValue({
        rows: mockCheckpoints,
        rowCount: 2
      });

      const recoveryInfo = await manager.getRecoveryInfo('session_recovery', 'users');

      expect(recoveryInfo.hasRecoverableState).toBe(true);
      expect(recoveryInfo.availableCheckpoints).toHaveLength(2);
      expect(recoveryInfo.recommendedCheckpoint).toBe('checkpoint_2');
      expect(recoveryInfo.estimatedRecoveryTime).toBeGreaterThan(0);

      const latestCheckpoint = recoveryInfo.availableCheckpoints[1];
      expect(latestCheckpoint.progressPercentage).toBeGreaterThan(0);
      expect(latestCheckpoint.isValid).toBe(true);
    });
  });

  describe('State Serialization and Deserialization', () => {
    test('should serialize complex state with nested objects', async () => {
      const complexState: CheckpointData = {
        sessionId: 'session_complex',
        entityType: 'products',
        migrationRunId: 'run_complex',
        batchPosition: 50,
        recordsProcessed: 25000,
        recordsRemaining: 75000,
        lastProcessedId: 'product_25000',
        processingState: {
          currentBatch: 50,
          batchSize: 500,
          startTime: new Date('2024-01-01T07:00:00Z'),
          totalBatches: 200,
          errorCount: 10,
          retryCount: 3,
          failedRecords: ['product_100', 'product_200', 'product_300'],
          skippedRecords: ['product_invalid_1', 'product_invalid_2'],
          performanceMetrics: {
            averageBatchTimeMs: 200,
            recordsPerSecond: 2500,
            memoryUsageMb: 512,
            peakMemoryMb: 768,
            cpuUsagePercent: 45.5
          },
          validationResults: {
            totalValidated: 1000,
            successfulValidations: 995,
            failedValidations: 5,
            validationErrors: ['Invalid email format', 'Missing required field']
          }
        },
        metadata: {
          sourceTable: 'dispatch_products',
          destinationTable: 'products',
          migrationStrategy: 'differential',
          dependencies: ['categories', 'suppliers'],
          configuration: {
            batchSize: 500,
            parallelProcessing: true,
            validationEnabled: true,
            checksumValidation: true
          }
        }
      };

      const serialized = await manager.serializeState(complexState);

      expect(serialized.success).toBe(true);
      expect(serialized.serializedData).toBeDefined();
      expect(serialized.checksum).toBeDefined();
      expect(serialized.size).toBeGreaterThan(0);
      expect(serialized.compressed).toBe(true);

      // Test deserialization
      const deserialized = await manager.deserializeState(serialized.serializedData, serialized.checksum);

      expect(deserialized.success).toBe(true);
      expect(deserialized.data?.sessionId).toBe('session_complex');
      expect(deserialized.data?.processingState?.performanceMetrics?.recordsPerSecond).toBe(2500);
      expect(deserialized.data?.metadata?.dependencies).toEqual(['categories', 'suppliers']);
    });

    test('should handle serialization of circular references safely', async () => {
      const stateWithCircularRef: any = {
        sessionId: 'session_circular',
        entityType: 'test_entity',
        migrationRunId: 'run_circular',
        batchPosition: 1,
        recordsProcessed: 100,
        recordsRemaining: 900,
        lastProcessedId: 'test_100'
      };

      // Create circular reference
      stateWithCircularRef.self = stateWithCircularRef;

      const serialized = await manager.serializeState(stateWithCircularRef);

      expect(serialized.success).toBe(true);
      expect(serialized.warnings).toContain('Circular reference detected and resolved');
    });

    test('should validate deserialized state integrity', async () => {
      const validState: CheckpointData = {
        sessionId: 'session_valid',
        entityType: 'messages',
        migrationRunId: 'run_valid',
        batchPosition: 20,
        recordsProcessed: 10000,
        recordsRemaining: 40000,
        lastProcessedId: 'message_10000'
      };

      const serialized = await manager.serializeState(validState);

      // Tamper with the data
      const tamperedData = serialized.serializedData.replace('message_10000', 'message_tampered');

      const deserialized = await manager.deserializeState(tamperedData, serialized.checksum);

      expect(deserialized.success).toBe(false);
      expect(deserialized.validationErrors).toContain('Data integrity check failed');
    });
  });

  describe('Checkpoint Management and Cleanup', () => {
    test('should list all checkpoints for a session', async () => {
      const mockCheckpoints = [
        {
          id: 'checkpoint_1',
          entity_type: 'users',
          created_at: new Date('2024-01-01T10:00:00Z'),
          batch_position: 5,
          records_processed: 2500,
          checkpoint_data: JSON.stringify({ sessionId: 'session_list' })
        },
        {
          id: 'checkpoint_2',
          entity_type: 'orders',
          created_at: new Date('2024-01-01T11:00:00Z'),
          batch_position: 15,
          records_processed: 7500,
          checkpoint_data: JSON.stringify({ sessionId: 'session_list' })
        }
      ];

      mockClient.query.mockResolvedValue({
        rows: mockCheckpoints,
        rowCount: 2
      });

      const checkpoints = await manager.listCheckpoints('session_list');

      expect(checkpoints).toHaveLength(2);
      expect(checkpoints[0].id).toBe('checkpoint_1');
      expect(checkpoints[0].entityType).toBe('users');
      expect(checkpoints[0].progressPercentage).toBeGreaterThan(0);
      expect(checkpoints[1].id).toBe('checkpoint_2');
      expect(checkpoints[1].entityType).toBe('orders');
    });

    test('should clean up old checkpoints based on retention policy', async () => {
      const now = new Date();
      const oldDate = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000); // 8 days ago

      const oldCheckpoints = [
        { id: 'old_checkpoint_1', created_at: oldDate },
        { id: 'old_checkpoint_2', created_at: oldDate }
      ];

      // Mock queries for finding and deleting old checkpoints
      mockClient.query
        .mockResolvedValueOnce({ rows: oldCheckpoints, rowCount: 2 })
        .mockResolvedValueOnce({ rowCount: 2 });

      (fs.unlink as jest.Mock).mockResolvedValue(undefined);

      const cleanupResult = await manager.cleanupOldCheckpoints();

      expect(cleanupResult.success).toBe(true);
      expect(cleanupResult.checkpointsRemoved).toBe(2);
      expect(cleanupResult.spaceReclaimed).toBeGreaterThan(0);

      // Verify database cleanup
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM migration_checkpoints'),
        expect.arrayContaining([expect.any(Date)])
      );

      // Verify file cleanup
      expect(fs.unlink).toHaveBeenCalledTimes(2);
    });

    test('should enforce maximum checkpoint limit', async () => {
      const mockCheckpoints = Array.from({ length: 15 }, (_, i) => ({
        id: `checkpoint_${i}`,
        created_at: new Date(Date.now() - i * 60 * 60 * 1000) // Each checkpoint 1 hour older
      }));

      mockClient.query
        .mockResolvedValueOnce({ rows: mockCheckpoints, rowCount: 15 })
        .mockResolvedValueOnce({ rowCount: 5 });

      const cleanupResult = await manager.enforceCheckpointLimit('session_limit');

      expect(cleanupResult.success).toBe(true);
      expect(cleanupResult.checkpointsRemoved).toBe(5); // 15 - 10 (maxCheckpoints)
    });

    test('should calculate checkpoint storage statistics', async () => {
      const mockStats = [
        { checkpoint_count: 25, total_size: '15 MB', avg_size: '614 KB' }
      ];

      mockClient.query.mockResolvedValue({ rows: mockStats, rowCount: 1 });

      (fs.readdir as jest.Mock).mockResolvedValue(['checkpoint_1.json', 'checkpoint_2.json']);
      (fs.stat as jest.Mock).mockResolvedValue({ size: 1024 * 1024 }); // 1MB each

      const stats = await manager.getStorageStatistics();

      expect(stats.totalCheckpoints).toBe(25);
      expect(stats.databaseSize).toBe('15 MB');
      expect(stats.fileBackupSize).toBe('2 MB');
      expect(stats.averageCheckpointSize).toBe('614 KB');
      expect(stats.oldestCheckpoint).toBeDefined();
      expect(stats.newestCheckpoint).toBeDefined();
    });
  });

  describe('Error Handling and Resilience', () => {
    test('should handle database connection failures gracefully', async () => {
      mockPool.connect.mockRejectedValue(new Error('Connection failed'));

      const checkpointData: CheckpointData = {
        sessionId: 'session_error',
        entityType: 'test_entity',
        migrationRunId: 'run_error',
        batchPosition: 1,
        recordsProcessed: 500,
        recordsRemaining: 4500,
        lastProcessedId: 'test_500'
      };

      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

      const result = await manager.createCheckpoint(checkpointData);

      expect(result.success).toBe(true);
      expect(result.backupLocations).toEqual(['file']);
      expect(result.warnings).toContain('Database backup failed, using file backup only');
    });

    test('should handle file system errors gracefully', async () => {
      const checkpointData: CheckpointData = {
        sessionId: 'session_fs_error',
        entityType: 'test_entity',
        migrationRunId: 'run_fs_error',
        batchPosition: 1,
        recordsProcessed: 500,
        recordsRemaining: 4500,
        lastProcessedId: 'test_500'
      };

      mockClient.query.mockResolvedValue({
        rows: [{ id: 'checkpoint_fs_error' }],
        rowCount: 1
      });

      (fs.writeFile as jest.Mock).mockRejectedValue(new Error('Disk full'));

      const result = await manager.createCheckpoint(checkpointData);

      expect(result.success).toBe(true);
      expect(result.backupLocations).toEqual(['database']);
      expect(result.warnings).toContain('File backup failed, using database backup only');
    });

    test('should validate checkpoint data before saving', async () => {
      const invalidCheckpointData = {
        // Missing required fields
        sessionId: '',
        entityType: '',
        batchPosition: -1,
        recordsProcessed: -100
      } as CheckpointData;

      const result = await manager.createCheckpoint(invalidCheckpointData);

      expect(result.success).toBe(false);
      expect(result.validationErrors).toContain('sessionId is required');
      expect(result.validationErrors).toContain('entityType is required');
      expect(result.validationErrors).toContain('batchPosition must be non-negative');
      expect(result.validationErrors).toContain('recordsProcessed must be non-negative');
    });
  });

  describe('Configuration and Validation', () => {
    test('should validate checkpoint manager configuration', () => {
      const validConfig: CheckpointConfig = {
        pool: mockPool,
        checkpointDir: '/tmp/checkpoints',
        enableFileBackup: true,
        enableDatabaseBackup: true,
        maxCheckpoints: 10,
        compressionEnabled: true,
        encryptionEnabled: false,
        retentionDays: 7,
        validationEnabled: true
      };

      const validation = CheckpointManager.validateConfig(validConfig);
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should reject invalid configuration', () => {
      const invalidConfig: CheckpointConfig = {
        pool: null as any,
        checkpointDir: '',
        enableFileBackup: false,
        enableDatabaseBackup: false,
        maxCheckpoints: 0,
        compressionEnabled: true,
        encryptionEnabled: false,
        retentionDays: -1,
        validationEnabled: true
      };

      const validation = CheckpointManager.validateConfig(invalidConfig);
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('pool is required');
      expect(validation.errors).toContain('checkpointDir is required when file backup is enabled');
      expect(validation.errors).toContain('At least one backup method must be enabled');
      expect(validation.errors).toContain('maxCheckpoints must be greater than 0');
      expect(validation.errors).toContain('retentionDays must be greater than 0');
    });

    test('should provide default configuration values', () => {
      const minimalConfig: CheckpointConfig = {
        pool: mockPool
      };

      const managerWithDefaults = new CheckpointManager(minimalConfig);
      const resolvedConfig = managerWithDefaults.getConfiguration();

      expect(resolvedConfig.enableFileBackup).toBe(true);
      expect(resolvedConfig.enableDatabaseBackup).toBe(true);
      expect(resolvedConfig.maxCheckpoints).toBe(10);
      expect(resolvedConfig.compressionEnabled).toBe(false);
      expect(resolvedConfig.retentionDays).toBe(30);
    });
  });
});