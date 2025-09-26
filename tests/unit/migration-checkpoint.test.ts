// Migration Checkpoint Model Unit Tests
// Comprehensive test suite for MigrationCheckpointModel

import { Pool, PoolClient } from 'pg';
import { MigrationCheckpointModel } from '../../src/models/migration-checkpoint';
import {
  MigrationCheckpoint,
  OperationType,
  CheckpointStatus,
  CheckpointError
} from '../../src/types/migration-types';

// Mock database for testing
const mockPool = {
  query: jest.fn(),
  connect: jest.fn(),
  end: jest.fn()
} as unknown as Pool;

describe('MigrationCheckpointModel', () => {
  let model: MigrationCheckpointModel;
  let mockQuery: jest.Mock;

  beforeEach(() => {
    model = new MigrationCheckpointModel(mockPool);
    mockQuery = mockPool.query as jest.Mock;
    mockQuery.mockClear();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    const mockCheckpointData = {
      operation_type: OperationType.DIFFERENTIAL_MIGRATION,
      entity_type: 'offices',
      last_processed_id: '100',
      records_processed: 100,
      records_total: 1000,
      batch_size: 50,
      status: CheckpointStatus.IN_PROGRESS,
      started_at: new Date('2023-01-01T10:00:00Z'),
      completed_at: null,
      error_message: null,
      metadata: { test: 'value' }
    };

    const mockCheckpointResult = {
      id: 'checkpoint-uuid-123',
      ...mockCheckpointData,
      created_at: new Date('2023-01-01T10:00:00Z'),
      updated_at: new Date('2023-01-01T10:00:00Z'),
      metadata: JSON.stringify(mockCheckpointData.metadata)
    };

    it('should create a new checkpoint successfully', async () => {
      mockQuery.mockResolvedValue({ rows: [mockCheckpointResult] });

      const result = await model.create(mockCheckpointData);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO migration_checkpoints'),
        [
          mockCheckpointData.operation_type,
          mockCheckpointData.entity_type,
          mockCheckpointData.last_processed_id,
          mockCheckpointData.records_processed,
          mockCheckpointData.records_total,
          mockCheckpointData.batch_size,
          mockCheckpointData.status,
          mockCheckpointData.started_at,
          mockCheckpointData.completed_at,
          mockCheckpointData.error_message,
          JSON.stringify(mockCheckpointData.metadata)
        ]
      );

      expect(result).toEqual({
        id: 'checkpoint-uuid-123',
        operation_type: mockCheckpointData.operation_type,
        entity_type: mockCheckpointData.entity_type,
        last_processed_id: mockCheckpointData.last_processed_id,
        records_processed: mockCheckpointData.records_processed,
        records_total: mockCheckpointData.records_total,
        batch_size: mockCheckpointData.batch_size,
        status: mockCheckpointData.status,
        started_at: mockCheckpointData.started_at,
        completed_at: mockCheckpointData.completed_at,
        error_message: mockCheckpointData.error_message,
        metadata: mockCheckpointData.metadata,
        created_at: mockCheckpointResult.created_at,
        updated_at: mockCheckpointResult.updated_at
      });
    });

    it('should throw CheckpointError when database insert fails', async () => {
      const dbError = new Error('Database connection failed');
      mockQuery.mockRejectedValue(dbError);

      await expect(model.create(mockCheckpointData)).rejects.toThrow(CheckpointError);
      await expect(model.create(mockCheckpointData)).rejects.toThrow('Failed to create checkpoint');
    });

    it('should handle null metadata correctly', async () => {
      const checkpointWithNullMetadata = { ...mockCheckpointData, metadata: null };
      const resultWithNullMetadata = { ...mockCheckpointResult, metadata: null };

      mockQuery.mockResolvedValue({ rows: [resultWithNullMetadata] });

      const result = await model.create(checkpointWithNullMetadata);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO migration_checkpoints'),
        expect.arrayContaining([JSON.stringify(null)])
      );

      expect(result.metadata).toBeNull();
    });
  });

  describe('update', () => {
    const checkpointId = 'checkpoint-uuid-123';
    const updateData = {
      records_processed: 200,
      last_processed_id: '200',
      status: CheckpointStatus.COMPLETED,
      completed_at: new Date('2023-01-01T11:00:00Z')
    };

    const mockUpdatedResult = {
      id: checkpointId,
      operation_type: OperationType.DIFFERENTIAL_MIGRATION,
      entity_type: 'offices',
      ...updateData,
      created_at: new Date('2023-01-01T10:00:00Z'),
      updated_at: new Date('2023-01-01T11:00:00Z'),
      metadata: JSON.stringify({ updated: true })
    };

    it('should update checkpoint successfully', async () => {
      mockQuery.mockResolvedValue({ rows: [mockUpdatedResult] });

      const result = await model.update(checkpointId, updateData);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE migration_checkpoints'),
        expect.arrayContaining([checkpointId])
      );

      expect(result.records_processed).toBe(updateData.records_processed);
      expect(result.status).toBe(updateData.status);
      expect(result.completed_at).toEqual(updateData.completed_at);
    });

    it('should throw CheckpointError when update fails', async () => {
      mockQuery.mockRejectedValue(new Error('Update failed'));

      await expect(model.update(checkpointId, updateData)).rejects.toThrow(CheckpointError);
    });

    it('should throw CheckpointError when checkpoint not found', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await expect(model.update(checkpointId, updateData)).rejects.toThrow(CheckpointError);
      await expect(model.update(checkpointId, updateData)).rejects.toThrow('Checkpoint not found');
    });
  });

  describe('findById', () => {
    const checkpointId = 'checkpoint-uuid-123';
    const mockCheckpoint = {
      id: checkpointId,
      operation_type: OperationType.DIFFERENTIAL_MIGRATION,
      entity_type: 'offices',
      records_processed: 100,
      status: CheckpointStatus.IN_PROGRESS,
      created_at: new Date('2023-01-01T10:00:00Z'),
      updated_at: new Date('2023-01-01T10:00:00Z'),
      metadata: JSON.stringify({ test: 'value' })
    };

    it('should find checkpoint by ID successfully', async () => {
      mockQuery.mockResolvedValue({ rows: [mockCheckpoint] });

      const result = await model.findById(checkpointId);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM migration_checkpoints WHERE id = $1'),
        [checkpointId]
      );

      expect(result).toBeDefined();
      expect(result?.id).toBe(checkpointId);
      expect(result?.metadata).toEqual({ test: 'value' });
    });

    it('should return null when checkpoint not found', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await model.findById(checkpointId);

      expect(result).toBeNull();
    });

    it('should throw CheckpointError when database query fails', async () => {
      mockQuery.mockRejectedValue(new Error('Database error'));

      await expect(model.findById(checkpointId)).rejects.toThrow(CheckpointError);
    });
  });

  describe('list', () => {
    const mockCheckpoints = [
      {
        id: 'checkpoint-1',
        operation_type: OperationType.DIFFERENTIAL_MIGRATION,
        entity_type: 'offices',
        status: CheckpointStatus.COMPLETED,
        created_at: new Date('2023-01-01T10:00:00Z'),
        metadata: JSON.stringify({ test: 1 })
      },
      {
        id: 'checkpoint-2',
        operation_type: OperationType.SYNC,
        entity_type: 'doctors',
        status: CheckpointStatus.IN_PROGRESS,
        created_at: new Date('2023-01-01T11:00:00Z'),
        metadata: JSON.stringify({ test: 2 })
      }
    ];

    it('should list checkpoints with default options', async () => {
      mockQuery.mockResolvedValue({ rows: mockCheckpoints });

      const result = await model.list({});

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM migration_checkpoints'),
        []
      );

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('checkpoint-1');
      expect(result[1].id).toBe('checkpoint-2');
    });

    it('should filter by entity type', async () => {
      mockQuery.mockResolvedValue({ rows: [mockCheckpoints[0]] });

      const result = await model.list({ entityType: 'offices' });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE entity_type = $1'),
        ['offices']
      );

      expect(result).toHaveLength(1);
      expect(result[0].entity_type).toBe('offices');
    });

    it('should filter by operation type', async () => {
      mockQuery.mockResolvedValue({ rows: [mockCheckpoints[1]] });

      const result = await model.list({ operationType: OperationType.SYNC });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('operation_type = $1'),
        [OperationType.SYNC]
      );

      expect(result).toHaveLength(1);
      expect(result[0].operation_type).toBe(OperationType.SYNC);
    });

    it('should apply limit', async () => {
      mockQuery.mockResolvedValue({ rows: [mockCheckpoints[0]] });

      const result = await model.list({ limit: 1 });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $1'),
        [1]
      );

      expect(result).toHaveLength(1);
    });

    it('should handle multiple filters', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await model.list({
        entityType: 'offices',
        operationType: OperationType.DIFFERENTIAL_MIGRATION,
        status: CheckpointStatus.COMPLETED,
        limit: 10
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE entity_type = $1 AND operation_type = $2 AND status = $3'),
        ['offices', OperationType.DIFFERENTIAL_MIGRATION, CheckpointStatus.COMPLETED, 10]
      );
    });
  });

  describe('delete', () => {
    const checkpointId = 'checkpoint-uuid-123';

    it('should delete checkpoint successfully', async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 });

      const result = await model.delete(checkpointId);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM migration_checkpoints WHERE id = $1'),
        [checkpointId]
      );

      expect(result).toBe(true);
    });

    it('should return false when checkpoint not found', async () => {
      mockQuery.mockResolvedValue({ rowCount: 0 });

      const result = await model.delete(checkpointId);

      expect(result).toBe(false);
    });

    it('should throw CheckpointError when delete fails', async () => {
      mockQuery.mockRejectedValue(new Error('Delete failed'));

      await expect(model.delete(checkpointId)).rejects.toThrow(CheckpointError);
    });
  });

  describe('getCheckpointInfo', () => {
    const mockCheckpointInfo = {
      entity_type: 'offices',
      operation_type: OperationType.DIFFERENTIAL_MIGRATION,
      total_checkpoints: 5,
      active_checkpoints: 2,
      completed_checkpoints: 3,
      failed_checkpoints: 0,
      last_checkpoint_date: new Date('2023-01-01T10:00:00Z'),
      total_records_processed: 1000
    };

    it('should get checkpoint info for specific entity and operation', async () => {
      mockQuery.mockResolvedValue({ rows: [mockCheckpointInfo] });

      const result = await model.getCheckpointInfo('offices', OperationType.DIFFERENTIAL_MIGRATION);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('GROUP BY entity_type, operation_type'),
        ['offices', OperationType.DIFFERENTIAL_MIGRATION]
      );

      expect(result).toEqual({
        entityType: 'offices',
        operationType: OperationType.DIFFERENTIAL_MIGRATION,
        totalCheckpoints: 5,
        activeCheckpoints: 2,
        completedCheckpoints: 3,
        failedCheckpoints: 0,
        lastCheckpointDate: mockCheckpointInfo.last_checkpoint_date,
        totalRecordsProcessed: 1000
      });
    });

    it('should get checkpoint info for entity only', async () => {
      mockQuery.mockResolvedValue({ rows: [mockCheckpointInfo] });

      const result = await model.getCheckpointInfo('offices');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE entity_type = $1'),
        ['offices']
      );

      expect(result).toBeDefined();
      expect(result?.entityType).toBe('offices');
    });

    it('should return null when no checkpoint info found', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await model.getCheckpointInfo('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('mapRowToCheckpoint', () => {
    it('should map database row to checkpoint object correctly', async () => {
      const mockRow = {
        id: 'checkpoint-uuid-123',
        operation_type: OperationType.DIFFERENTIAL_MIGRATION,
        entity_type: 'offices',
        last_processed_id: '100',
        records_processed: 100,
        records_total: 1000,
        batch_size: 50,
        status: CheckpointStatus.IN_PROGRESS,
        started_at: new Date('2023-01-01T10:00:00Z'),
        completed_at: null,
        error_message: null,
        metadata: JSON.stringify({ test: 'value' }),
        created_at: new Date('2023-01-01T10:00:00Z'),
        updated_at: new Date('2023-01-01T10:00:00Z')
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const checkpoint = await model.findById('checkpoint-uuid-123');

      expect(checkpoint).toEqual({
        id: 'checkpoint-uuid-123',
        operation_type: OperationType.DIFFERENTIAL_MIGRATION,
        entity_type: 'offices',
        last_processed_id: '100',
        records_processed: 100,
        records_total: 1000,
        batch_size: 50,
        status: CheckpointStatus.IN_PROGRESS,
        started_at: mockRow.started_at,
        completed_at: null,
        error_message: null,
        metadata: { test: 'value' },
        created_at: mockRow.created_at,
        updated_at: mockRow.updated_at
      });
    });

    it('should handle null metadata correctly', async () => {
      const mockRow = {
        id: 'checkpoint-uuid-123',
        operation_type: OperationType.DIFFERENTIAL_MIGRATION,
        entity_type: 'offices',
        metadata: null,
        created_at: new Date(),
        updated_at: new Date()
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const checkpoint = await model.findById('checkpoint-uuid-123');

      expect(checkpoint?.metadata).toBeNull();
    });

    it('should handle invalid JSON metadata gracefully', async () => {
      const mockRow = {
        id: 'checkpoint-uuid-123',
        operation_type: OperationType.DIFFERENTIAL_MIGRATION,
        entity_type: 'offices',
        metadata: 'invalid-json-{',
        created_at: new Date(),
        updated_at: new Date()
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const checkpoint = await model.findById('checkpoint-uuid-123');

      // Should handle invalid JSON gracefully (implementation dependent)
      expect(checkpoint).toBeDefined();
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle empty results gracefully', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await model.list({});

      expect(result).toEqual([]);
    });

    it('should handle very large checkpoint metadata', async () => {
      const largeMetadata = { data: 'x'.repeat(10000) };
      const checkpointData = {
        operation_type: OperationType.DIFFERENTIAL_MIGRATION,
        entity_type: 'offices',
        records_processed: 100,
        batch_size: 50,
        status: CheckpointStatus.IN_PROGRESS,
        started_at: new Date(),
        metadata: largeMetadata
      };

      mockQuery.mockResolvedValue({
        rows: [{
          id: 'test-id',
          ...checkpointData,
          metadata: JSON.stringify(largeMetadata),
          created_at: new Date(),
          updated_at: new Date()
        }]
      });

      const result = await model.create(checkpointData);

      expect(result.metadata).toEqual(largeMetadata);
    });

    it('should handle concurrent checkpoint creation', async () => {
      // Simulate unique constraint violation
      const uniqueConstraintError = new Error('duplicate key value violates unique constraint');
      mockQuery.mockRejectedValue(uniqueConstraintError);

      const checkpointData = {
        operation_type: OperationType.DIFFERENTIAL_MIGRATION,
        entity_type: 'offices',
        records_processed: 100,
        batch_size: 50,
        status: CheckpointStatus.IN_PROGRESS,
        started_at: new Date(),
        metadata: {}
      };

      await expect(model.create(checkpointData)).rejects.toThrow(CheckpointError);
    });
  });
});

// Export for potential integration with other test files
export { mockPool };