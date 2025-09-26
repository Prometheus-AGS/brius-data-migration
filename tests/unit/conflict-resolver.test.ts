// Conflict Resolver Service Unit Tests
// Comprehensive test suite for ConflictResolverService

import { Pool, PoolClient } from 'pg';
import { ConflictResolverService, ResolutionOptions, ConflictResolutionSummary, BackupInfo } from '../../src/services/conflict-resolver';
import { DataDifferentialModel } from '../../src/models/data-differential';
import {
  DataDifferential,
  ComparisonType,
  ResolutionStrategy,
  ConflictResolutionResult,
  ConflictResolutionError
} from '../../src/types/migration-types';

// Mock dependencies
jest.mock('../../src/models/data-differential');

const mockSourcePool = {
  query: jest.fn(),
  connect: jest.fn(),
  end: jest.fn()
} as unknown as Pool;

const mockTargetPool = {
  query: jest.fn(),
  connect: jest.fn(),
  end: jest.fn()
} as unknown as Pool;

const mockClient = {
  query: jest.fn(),
  release: jest.fn()
} as unknown as PoolClient;

describe('ConflictResolverService', () => {
  let service: ConflictResolverService;
  let mockDataModel: jest.Mocked<DataDifferentialModel>;

  const mockDataDifferential: DataDifferential = {
    id: 'diff-uuid-123',
    source_table: 'dispatch_offices',
    target_table: 'offices',
    comparison_type: ComparisonType.CONFLICTED_RECORDS,
    legacy_ids: ['101', '102', '103'],
    record_count: 3,
    comparison_criteria: {
      fields: ['name', 'address'],
      timestamp_threshold: '2023-01-01T00:00:00Z'
    },
    resolution_strategy: ResolutionStrategy.SOURCE_WINS,
    resolved: false,
    resolved_at: null,
    created_at: new Date('2023-01-01T10:00:00Z'),
    metadata: {
      conflict_details: {
        field_mismatches: ['name', 'phone'],
        source_updates: 3,
        target_updates: 1
      }
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockDataModel = new DataDifferentialModel(mockTargetPool) as jest.Mocked<DataDifferentialModel>;
    (DataDifferentialModel as jest.Mock).mockReturnValue(mockDataModel);

    service = new ConflictResolverService(mockSourcePool, mockTargetPool);

    // Setup default mock implementations
    mockSourcePool.connect = jest.fn().mockResolvedValue(mockClient);
    mockTargetPool.connect = jest.fn().mockResolvedValue(mockClient);
  });

  describe('constructor', () => {
    it('should initialize with database pools', () => {
      expect(service).toBeDefined();
      expect(DataDifferentialModel).toHaveBeenCalledWith(mockTargetPool);
    });

    it('should initialize with custom project root', () => {
      const customService = new ConflictResolverService(
        mockSourcePool,
        mockTargetPool,
        '/custom/root'
      );

      expect(customService).toBeDefined();
    });
  });

  describe('resolveAllConflicts', () => {
    beforeEach(() => {
      mockDataModel.list.mockResolvedValue([mockDataDifferential]);
    });

    it('should resolve all conflicts with source-wins strategy', async () => {
      const mockResolutionSummary: ConflictResolutionSummary = {
        totalConflicts: 3,
        resolvedConflicts: 3,
        failedConflicts: 0,
        skippedConflicts: 0,
        backupCreated: false,
        resolutionTime: 1000,
        strategy: ResolutionStrategy.SOURCE_WINS
      };

      // Mock the private method resolveEntityConflicts
      jest.spyOn(service as any, 'resolveEntityConflicts').mockResolvedValue(mockResolutionSummary);

      const result = await service.resolveAllConflicts();

      expect(mockDataModel.list).toHaveBeenCalledWith({ resolved: false });
      expect(result.conflicts_detected).toBe(3);
      expect(result.conflicts_resolved).toBe(3);
      expect(result.resolution_strategy).toBe(ResolutionStrategy.SOURCE_WINS);
      expect(result.failed_resolutions).toBe(0);
    });

    it('should handle empty conflict list', async () => {
      mockDataModel.list.mockResolvedValue([]);

      const result = await service.resolveAllConflicts();

      expect(result.conflicts_detected).toBe(0);
      expect(result.conflicts_resolved).toBe(0);
      expect(result.failed_resolutions).toBe(0);
    });

    it('should handle resolution failures gracefully', async () => {
      jest.spyOn(service as any, 'resolveEntityConflicts').mockRejectedValue(
        new Error('Resolution failed')
      );

      const result = await service.resolveAllConflicts();

      expect(result.conflicts_detected).toBe(0);
      expect(result.conflicts_resolved).toBe(0);
      expect(result.failed_resolutions).toBe(3); // Should count failed records
    });

    it('should process conflicts with custom options', async () => {
      const options: ResolutionOptions = {
        batchSize: 100,
        dryRun: true,
        createBackup: true,
        validateAfterResolution: true,
        maxRetries: 5
      };

      const mockSummary: ConflictResolutionSummary = {
        totalConflicts: 3,
        resolvedConflicts: 3,
        failedConflicts: 0,
        skippedConflicts: 0,
        backupCreated: true,
        resolutionTime: 1500,
        strategy: ResolutionStrategy.SOURCE_WINS
      };

      jest.spyOn(service as any, 'resolveEntityConflicts').mockResolvedValue(mockSummary);

      const result = await service.resolveAllConflicts(options);

      expect(result.conflicts_resolved).toBe(3);
      expect(result.resolution_details.entity_summaries[0].backupCreated).toBe(true);
    });
  });

  describe('resolveConflicts', () => {
    const conflicts = [mockDataDifferential];
    const strategy = ResolutionStrategy.SOURCE_WINS;

    it('should resolve specific conflicts with given strategy', async () => {
      mockClient.query.mockResolvedValue({ rows: [], rowCount: 3 });

      const results = await service.resolveConflicts(conflicts, strategy);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].strategy).toBe(strategy);
      expect(results[0].recordsAffected).toBe(3);
    });

    it('should handle dry run mode', async () => {
      const options: ResolutionOptions = { dryRun: true };

      const results = await service.resolveConflicts(conflicts, strategy, options);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].dryRun).toBe(true);
      // Should not execute actual updates in dry run
      expect(mockClient.query).not.toHaveBeenCalledWith(
        expect.stringContaining('UPDATE')
      );
    });

    it('should create backup when requested', async () => {
      const options: ResolutionOptions = { createBackup: true };

      jest.spyOn(service, 'createBackup').mockResolvedValue({
        backupId: 'backup-123',
        entityType: 'offices',
        recordCount: 3,
        createdAt: new Date(),
        backupLocation: '/tmp/backup-123.json'
      });

      mockClient.query.mockResolvedValue({ rows: [], rowCount: 3 });

      const results = await service.resolveConflicts(conflicts, strategy, options);

      expect(service.createBackup).toHaveBeenCalledWith(
        'offices',
        conflicts.map(c => c.id)
      );
      expect(results[0].backupInfo).toBeDefined();
    });

    it('should handle resolution errors with retries', async () => {
      const options: ResolutionOptions = { maxRetries: 3 };

      mockClient.query
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce({ rows: [], rowCount: 3 });

      const results = await service.resolveConflicts(conflicts, strategy, options);

      expect(results[0].success).toBe(true);
      expect(results[0].retryCount).toBe(2);
    });

    it('should fail after exhausting retries', async () => {
      const options: ResolutionOptions = { maxRetries: 2 };

      mockClient.query.mockRejectedValue(new Error('Persistent failure'));

      const results = await service.resolveConflicts(conflicts, strategy, options);

      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('Persistent failure');
      expect(results[0].retryCount).toBe(2);
    });

    it('should validate after resolution when requested', async () => {
      const options: ResolutionOptions = { validateAfterResolution: true };

      mockClient.query.mockResolvedValue({ rows: [], rowCount: 3 });
      jest.spyOn(service as any, 'validateResolution').mockResolvedValue(true);

      const results = await service.resolveConflicts(conflicts, strategy, options);

      expect(results[0].success).toBe(true);
      expect(results[0].validated).toBe(true);
    });
  });

  describe('createBackup', () => {
    const entityType = 'offices';
    const conflictIds = ['diff-1', 'diff-2', 'diff-3'];

    it('should create backup successfully', async () => {
      const mockBackupData = [
        { id: '101', name: 'Office 1', address: '123 Main St' },
        { id: '102', name: 'Office 2', address: '456 Oak Ave' },
        { id: '103', name: 'Office 3', address: '789 Pine Rd' }
      ];

      mockClient.query.mockResolvedValue({ rows: mockBackupData });

      const backup = await service.createBackup(entityType, conflictIds);

      expect(backup.backupId).toBeDefined();
      expect(backup.entityType).toBe(entityType);
      expect(backup.recordCount).toBe(3);
      expect(backup.backupLocation).toContain('backup');
      expect(backup.createdAt).toBeInstanceOf(Date);
    });

    it('should handle empty backup data', async () => {
      mockClient.query.mockResolvedValue({ rows: [] });

      const backup = await service.createBackup(entityType, conflictIds);

      expect(backup.recordCount).toBe(0);
    });

    it('should handle backup creation errors', async () => {
      mockClient.query.mockRejectedValue(new Error('Backup query failed'));

      await expect(service.createBackup(entityType, conflictIds)).rejects.toThrow(
        'Backup query failed'
      );
    });
  });

  describe('getConflictStatistics', () => {
    it('should return conflict statistics', async () => {
      const mockStats = [
        {
          source_table: 'dispatch_offices',
          target_table: 'offices',
          comparison_type: ComparisonType.CONFLICTED_RECORDS,
          total_conflicts: 5,
          resolved_conflicts: 3,
          pending_conflicts: 2
        },
        {
          source_table: 'dispatch_doctors',
          target_table: 'doctors',
          comparison_type: ComparisonType.CONFLICTED_RECORDS,
          total_conflicts: 8,
          resolved_conflicts: 8,
          pending_conflicts: 0
        }
      ];

      mockDataModel.getConflictStatistics.mockResolvedValue(mockStats);

      const stats = await service.getConflictStatistics();

      expect(mockDataModel.getConflictStatistics).toHaveBeenCalled();
      expect(stats).toEqual(mockStats);
    });

    it('should handle empty statistics', async () => {
      mockDataModel.getConflictStatistics.mockResolvedValue([]);

      const stats = await service.getConflictStatistics();

      expect(stats).toEqual([]);
    });
  });

  describe('getPendingConflicts', () => {
    it('should return pending conflicts for entity', async () => {
      const pendingConflicts = [mockDataDifferential];
      mockDataModel.list.mockResolvedValue(pendingConflicts);

      const conflicts = await service.getPendingConflicts('offices');

      expect(mockDataModel.list).toHaveBeenCalledWith({
        sourceTable: 'dispatch_offices',
        resolved: false,
        comparisonType: ComparisonType.CONFLICTED_RECORDS
      });

      expect(conflicts).toEqual(pendingConflicts);
    });

    it('should return all pending conflicts when no entity specified', async () => {
      const allPendingConflicts = [mockDataDifferential];
      mockDataModel.list.mockResolvedValue(allPendingConflicts);

      const conflicts = await service.getPendingConflicts();

      expect(mockDataModel.list).toHaveBeenCalledWith({
        resolved: false,
        comparisonType: ComparisonType.CONFLICTED_RECORDS
      });

      expect(conflicts).toEqual(allPendingConflicts);
    });
  });

  describe('markConflictResolved', () => {
    const conflictId = 'diff-uuid-123';

    it('should mark conflict as resolved', async () => {
      const resolvedConflict = {
        ...mockDataDifferential,
        resolved: true,
        resolved_at: new Date(),
        resolution_strategy: ResolutionStrategy.SOURCE_WINS
      };

      mockDataModel.update.mockResolvedValue(resolvedConflict);

      const result = await service.markConflictResolved(
        conflictId,
        ResolutionStrategy.SOURCE_WINS
      );

      expect(mockDataModel.update).toHaveBeenCalledWith(
        conflictId,
        expect.objectContaining({
          resolved: true,
          resolution_strategy: ResolutionStrategy.SOURCE_WINS,
          resolved_at: expect.any(Date)
        })
      );

      expect(result.resolved).toBe(true);
      expect(result.resolution_strategy).toBe(ResolutionStrategy.SOURCE_WINS);
    });

    it('should handle marking non-existent conflict', async () => {
      mockDataModel.update.mockRejectedValue(new Error('Conflict not found'));

      await expect(
        service.markConflictResolved(conflictId, ResolutionStrategy.SOURCE_WINS)
      ).rejects.toThrow('Conflict not found');
    });
  });

  describe('private helper methods', () => {
    describe('groupDifferentialsByEntity', () => {
      it('should group differentials by entity type', () => {
        const differentials = [
          { ...mockDataDifferential, source_table: 'dispatch_offices' },
          { ...mockDataDifferential, id: 'diff-2', source_table: 'dispatch_doctors' },
          { ...mockDataDifferential, id: 'diff-3', source_table: 'dispatch_offices' }
        ];

        const grouped = (service as any).groupDifferentialsByEntity(differentials);

        expect(grouped).toHaveProperty('offices');
        expect(grouped).toHaveProperty('doctors');
        expect(grouped.offices).toHaveLength(2);
        expect(grouped.doctors).toHaveLength(1);
      });
    });

    describe('extractEntityTypeFromTable', () => {
      it('should extract entity type from dispatch table name', () => {
        const entityType = (service as any).extractEntityTypeFromTable('dispatch_offices');
        expect(entityType).toBe('offices');
      });

      it('should handle non-dispatch table names', () => {
        const entityType = (service as any).extractEntityTypeFromTable('custom_table');
        expect(entityType).toBe('custom_table');
      });
    });

    describe('validateResolution', () => {
      it('should validate successful resolution', async () => {
        mockClient.query.mockResolvedValue({ rows: [{ count: '0' }] });

        const isValid = await (service as any).validateResolution(
          'offices',
          ['101', '102'],
          mockClient
        );

        expect(isValid).toBe(true);
      });

      it('should detect failed resolution', async () => {
        mockClient.query.mockResolvedValue({ rows: [{ count: '2' }] });

        const isValid = await (service as any).validateResolution(
          'offices',
          ['101', '102'],
          mockClient
        );

        expect(isValid).toBe(false);
      });
    });
  });

  describe('error handling and edge cases', () => {
    it('should handle database connection failures', async () => {
      mockSourcePool.connect = jest.fn().mockRejectedValue(new Error('Connection failed'));

      await expect(
        service.resolveConflicts([mockDataDifferential], ResolutionStrategy.SOURCE_WINS)
      ).rejects.toThrow('Connection failed');
    });

    it('should handle invalid resolution strategy', async () => {
      const invalidStrategy = 'invalid_strategy' as ResolutionStrategy;

      await expect(
        service.resolveConflicts([mockDataDifferential], invalidStrategy)
      ).rejects.toThrow();
    });

    it('should handle large conflict batches', async () => {
      const largeConflictSet = Array.from({ length: 1000 }, (_, i) => ({
        ...mockDataDifferential,
        id: `diff-${i}`,
        legacy_ids: [`${i + 1000}`]
      }));

      mockClient.query.mockResolvedValue({ rows: [], rowCount: 1000 });

      const results = await service.resolveConflicts(
        largeConflictSet,
        ResolutionStrategy.SOURCE_WINS,
        { batchSize: 50 }
      );

      expect(results).toHaveLength(1000);
      expect(results.every(r => r.success)).toBe(true);
    });

    it('should handle conflicts with missing legacy IDs', async () => {
      const conflictWithoutIds = {
        ...mockDataDifferential,
        legacy_ids: []
      };

      const results = await service.resolveConflicts(
        [conflictWithoutIds],
        ResolutionStrategy.SOURCE_WINS
      );

      expect(results[0].success).toBe(true);
      expect(results[0].recordsAffected).toBe(0);
      expect(results[0].skipped).toBe(true);
    });

    it('should handle transaction rollback on failure', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockRejectedValueOnce(new Error('Update failed')) // UPDATE
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // ROLLBACK

      const results = await service.resolveConflicts(
        [mockDataDifferential],
        ResolutionStrategy.SOURCE_WINS
      );

      expect(results[0].success).toBe(false);
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });
});