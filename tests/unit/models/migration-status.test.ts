/**
 * Unit Tests: MigrationStatus Model
 * Tests status tracking, entity arrays, progress calculations, state machine transitions
 */

import { diffMigrationTestUtils } from '../../setup';

// Import the model interfaces (will be implemented after tests)
type MigrationStatusEnum = 'pending' | 'running' | 'paused' | 'completed' | 'failed';

interface MigrationStatus {
  id: string;
  migration_session_id: string;
  overall_status: MigrationStatusEnum;
  entities_pending: string[];
  entities_running: string[];
  entities_completed: string[];
  entities_failed: string[];
  total_records_processed: number;
  total_records_remaining: number;
  estimated_completion: Date | null;
  error_summary: object;
  performance_metrics: object;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface MigrationStatusCreateInput {
  migration_session_id?: string;
  overall_status?: MigrationStatusEnum;
  entities_pending?: string[];
  entities_running?: string[];
  entities_completed?: string[];
  entities_failed?: string[];
  total_records_processed?: number;
  total_records_remaining?: number;
  estimated_completion?: Date | null;
  error_summary?: object;
  performance_metrics?: object;
}

interface MigrationStatusUpdateInput {
  overall_status?: MigrationStatusEnum;
  entities_pending?: string[];
  entities_running?: string[];
  entities_completed?: string[];
  entities_failed?: string[];
  total_records_processed?: number;
  total_records_remaining?: number;
  estimated_completion?: Date | null;
  error_summary?: object;
  performance_metrics?: object;
}

// Mock implementation for testing (will be replaced with actual implementation)
class MockMigrationStatus {
  static create(input: MigrationStatusCreateInput = {}): MigrationStatus {
    const now = new Date();

    return {
      id: diffMigrationTestUtils.generateTestUUID(),
      migration_session_id: input.migration_session_id || diffMigrationTestUtils.generateTestUUID(),
      overall_status: input.overall_status || 'pending',
      entities_pending: input.entities_pending || [],
      entities_running: input.entities_running || [],
      entities_completed: input.entities_completed || [],
      entities_failed: input.entities_failed || [],
      total_records_processed: input.total_records_processed || 0,
      total_records_remaining: input.total_records_remaining || 0,
      estimated_completion: input.estimated_completion || null,
      error_summary: input.error_summary || {},
      performance_metrics: input.performance_metrics || {},
      started_at: input.overall_status === 'running' ? now : null,
      completed_at: null,
      created_at: now,
      updated_at: now
    };
  }

  static validate(status: MigrationStatus): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate overall_status
    const validStatuses: MigrationStatusEnum[] = ['pending', 'running', 'paused', 'completed', 'failed'];
    if (!validStatuses.includes(status.overall_status)) {
      errors.push('Invalid overall_status');
    }

    // Validate entity arrays don't overlap
    const allEntities = [
      ...status.entities_pending,
      ...status.entities_running,
      ...status.entities_completed,
      ...status.entities_failed
    ];

    const uniqueEntities = new Set(allEntities);
    if (allEntities.length !== uniqueEntities.size) {
      errors.push('Entity arrays must not overlap - entities cannot be in multiple states');
    }

    // Validate non-negative counts
    if (status.total_records_processed < 0) {
      errors.push('total_records_processed must be non-negative');
    }

    if (status.total_records_remaining < 0) {
      errors.push('total_records_remaining must be non-negative');
    }

    // Validate completed_at is after started_at
    if (status.completed_at && status.started_at && status.completed_at < status.started_at) {
      errors.push('completed_at must be after started_at');
    }

    // Validate status consistency
    if (status.overall_status === 'completed' && status.entities_running.length > 0) {
      errors.push('Cannot have running entities when overall status is completed');
    }

    if (status.overall_status === 'completed' && status.entities_pending.length > 0) {
      errors.push('Cannot have pending entities when overall status is completed');
    }

    if (status.overall_status === 'running' && status.entities_running.length === 0 && status.entities_pending.length === 0) {
      errors.push('Running status requires at least one running or pending entity');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static updateStatus(
    currentStatus: MigrationStatus,
    updates: MigrationStatusUpdateInput
  ): MigrationStatus {
    const now = new Date();
    const updatedStatus = { ...currentStatus, ...updates, updated_at: now };

    // Auto-set timestamps based on status transitions
    if (updates.overall_status) {
      if (updates.overall_status === 'running' && currentStatus.overall_status === 'pending') {
        updatedStatus.started_at = now;
      }

      if (updates.overall_status === 'completed' || updates.overall_status === 'failed') {
        updatedStatus.completed_at = now;
      }

      if (updates.overall_status === 'running' && currentStatus.overall_status === 'paused') {
        // Resume - don't change started_at
      }
    }

    return updatedStatus;
  }

  static calculateProgress(status: MigrationStatus): {
    progressPercentage: number;
    isComplete: boolean;
    estimatedTimeRemaining: number | null;
    throughputRecordsPerSecond: number | null;
  } {
    const totalRecords = status.total_records_processed + status.total_records_remaining;
    const progressPercentage = totalRecords > 0
      ? Math.round((status.total_records_processed / totalRecords) * 100 * 100) / 100 // Round to 2 decimals
      : 0;

    const isComplete = status.overall_status === 'completed' || status.total_records_remaining === 0;

    let estimatedTimeRemaining: number | null = null;
    let throughputRecordsPerSecond: number | null = null;

    if (status.started_at && status.overall_status === 'running') {
      const elapsedMs = Date.now() - status.started_at.getTime();
      const elapsedSeconds = elapsedMs / 1000;

      if (elapsedSeconds > 0 && status.total_records_processed > 0) {
        throughputRecordsPerSecond = Math.round((status.total_records_processed / elapsedSeconds) * 100) / 100;

        if (throughputRecordsPerSecond > 0 && status.total_records_remaining > 0) {
          estimatedTimeRemaining = Math.round(status.total_records_remaining / throughputRecordsPerSecond);
        }
      }
    }

    return {
      progressPercentage,
      isComplete,
      estimatedTimeRemaining,
      throughputRecordsPerSecond
    };
  }

  static getStatusSummary(status: MigrationStatus): {
    totalEntities: number;
    entitiesInProgress: number;
    entitiesCompleted: number;
    entitiesFailed: number;
    successRate: number | null;
  } {
    const totalEntities = status.entities_pending.length +
                         status.entities_running.length +
                         status.entities_completed.length +
                         status.entities_failed.length;

    const entitiesInProgress = status.entities_pending.length + status.entities_running.length;
    const entitiesCompleted = status.entities_completed.length;
    const entitiesFailed = status.entities_failed.length;

    const completedOrFailed = entitiesCompleted + entitiesFailed;
    const successRate = completedOrFailed > 0
      ? Math.round((entitiesCompleted / completedOrFailed) * 100 * 100) / 100
      : null;

    return {
      totalEntities,
      entitiesInProgress,
      entitiesCompleted,
      entitiesFailed,
      successRate
    };
  }
}

describe('MigrationStatus Model', () => {
  describe('Creation and Validation', () => {
    test('should create valid status with default values', () => {
      const status = MockMigrationStatus.create();

      expect(status).toBeDefined();
      expect(status.id).toBeDefined();
      expect(status.migration_session_id).toBeDefined();
      expect(status.overall_status).toBe('pending');
      expect(status.entities_pending).toEqual([]);
      expect(status.entities_running).toEqual([]);
      expect(status.entities_completed).toEqual([]);
      expect(status.entities_failed).toEqual([]);
      expect(status.total_records_processed).toBe(0);
      expect(status.total_records_remaining).toBe(0);
      expect(status.estimated_completion).toBeNull();
      expect(status.error_summary).toEqual({});
      expect(status.performance_metrics).toEqual({});
      expect(status.started_at).toBeNull();
      expect(status.completed_at).toBeNull();
      expect(status.created_at).toBeInstanceOf(Date);
      expect(status.updated_at).toBeInstanceOf(Date);
    });

    test('should create status with custom values', () => {
      const customSessionId = diffMigrationTestUtils.generateTestUUID();
      const input: MigrationStatusCreateInput = {
        migration_session_id: customSessionId,
        overall_status: 'running',
        entities_pending: ['patients', 'orders'],
        entities_running: ['doctors'],
        entities_completed: ['offices'],
        total_records_processed: 1000,
        total_records_remaining: 500,
        performance_metrics: { throughput: 100 }
      };

      const status = MockMigrationStatus.create(input);

      expect(status.migration_session_id).toBe(customSessionId);
      expect(status.overall_status).toBe('running');
      expect(status.entities_pending).toEqual(['patients', 'orders']);
      expect(status.entities_running).toEqual(['doctors']);
      expect(status.entities_completed).toEqual(['offices']);
      expect(status.total_records_processed).toBe(1000);
      expect(status.total_records_remaining).toBe(500);
      expect(status.performance_metrics).toEqual({ throughput: 100 });
      expect(status.started_at).toBeInstanceOf(Date); // Auto-set for running status
    });
  });

  describe('Validation Rules', () => {
    test('should pass validation for valid status', () => {
      const status = MockMigrationStatus.create({
        overall_status: 'running',
        entities_pending: ['patients'],
        entities_running: ['doctors'],
        entities_completed: ['offices'],
        total_records_processed: 500,
        total_records_remaining: 300
      });

      const validation = MockMigrationStatus.validate(status);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should fail validation for invalid overall_status', () => {
      const status = MockMigrationStatus.create({
        overall_status: 'invalid_status' as MigrationStatusEnum
      });

      const validation = MockMigrationStatus.validate(status);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Invalid overall_status');
    });

    test('should fail validation for overlapping entity arrays', () => {
      const status = MockMigrationStatus.create({
        entities_pending: ['doctors', 'patients'],
        entities_running: ['doctors'], // Overlap with pending
        entities_completed: ['offices']
      });

      const validation = MockMigrationStatus.validate(status);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Entity arrays must not overlap - entities cannot be in multiple states');
    });

    test('should fail validation for negative record counts', () => {
      const status = MockMigrationStatus.create({
        total_records_processed: -100,
        total_records_remaining: -50
      });

      const validation = MockMigrationStatus.validate(status);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('total_records_processed must be non-negative');
      expect(validation.errors).toContain('total_records_remaining must be non-negative');
    });

    test('should fail validation for invalid timestamp order', () => {
      const status = MockMigrationStatus.create({
        overall_status: 'completed'
      });

      // Manually set invalid timestamps
      status.started_at = new Date('2025-10-26T12:00:00Z');
      status.completed_at = new Date('2025-10-26T11:00:00Z'); // Before started_at

      const validation = MockMigrationStatus.validate(status);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('completed_at must be after started_at');
    });

    test('should fail validation for inconsistent completed status', () => {
      const status = MockMigrationStatus.create({
        overall_status: 'completed',
        entities_running: ['doctors'], // Should not have running entities when completed
        entities_pending: ['patients'] // Should not have pending entities when completed
      });

      const validation = MockMigrationStatus.validate(status);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Cannot have running entities when overall status is completed');
      expect(validation.errors).toContain('Cannot have pending entities when overall status is completed');
    });

    test('should fail validation for inconsistent running status', () => {
      const status = MockMigrationStatus.create({
        overall_status: 'running',
        entities_running: [], // No running entities
        entities_pending: []  // No pending entities
      });

      const validation = MockMigrationStatus.validate(status);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Running status requires at least one running or pending entity');
    });
  });

  describe('Status Updates and State Transitions', () => {
    test('should update status correctly', () => {
      const originalStatus = MockMigrationStatus.create({
        overall_status: 'pending',
        entities_pending: ['doctors', 'patients'],
        total_records_processed: 0
      });

      const originalUpdatedAt = originalStatus.updated_at;

      // Wait a small amount to ensure timestamp difference
      setTimeout(() => {
        const updatedStatus = MockMigrationStatus.updateStatus(originalStatus, {
          overall_status: 'running',
          entities_pending: ['patients'],
          entities_running: ['doctors'],
          total_records_processed: 100
        });

        expect(updatedStatus.overall_status).toBe('running');
        expect(updatedStatus.entities_pending).toEqual(['patients']);
        expect(updatedStatus.entities_running).toEqual(['doctors']);
        expect(updatedStatus.total_records_processed).toBe(100);
        expect(updatedStatus.started_at).toBeInstanceOf(Date); // Auto-set when transitioning to running
        expect(updatedStatus.updated_at.getTime()).toBeGreaterThanOrEqual(originalUpdatedAt.getTime());
      }, 10);
    });

    test('should set completion timestamp when transitioning to completed', () => {
      const runningStatus = MockMigrationStatus.create({
        overall_status: 'running',
        entities_running: ['doctors']
      });

      const completedStatus = MockMigrationStatus.updateStatus(runningStatus, {
        overall_status: 'completed',
        entities_running: [],
        entities_completed: ['doctors']
      });

      expect(completedStatus.overall_status).toBe('completed');
      expect(completedStatus.completed_at).toBeInstanceOf(Date);
    });

    test('should set completion timestamp when transitioning to failed', () => {
      const runningStatus = MockMigrationStatus.create({
        overall_status: 'running',
        entities_running: ['doctors']
      });

      const failedStatus = MockMigrationStatus.updateStatus(runningStatus, {
        overall_status: 'failed',
        entities_running: [],
        entities_failed: ['doctors']
      });

      expect(failedStatus.overall_status).toBe('failed');
      expect(failedStatus.completed_at).toBeInstanceOf(Date);
    });

    test('should not change started_at when resuming from pause', () => {
      const originalStartTime = new Date('2025-10-26T10:00:00Z');
      const pausedStatus = MockMigrationStatus.create({
        overall_status: 'paused',
        entities_pending: ['patients']
      });
      pausedStatus.started_at = originalStartTime;

      const resumedStatus = MockMigrationStatus.updateStatus(pausedStatus, {
        overall_status: 'running',
        entities_running: ['patients'],
        entities_pending: []
      });

      expect(resumedStatus.overall_status).toBe('running');
      expect(resumedStatus.started_at).toEqual(originalStartTime); // Should not change
    });
  });

  describe('Progress Calculations', () => {
    test('should calculate progress correctly for running migration', () => {
      const startTime = new Date(Date.now() - 60000); // 1 minute ago
      const status = MockMigrationStatus.create({
        overall_status: 'running',
        total_records_processed: 750,
        total_records_remaining: 250,
        entities_running: ['doctors']
      });
      status.started_at = startTime;

      const progress = MockMigrationStatus.calculateProgress(status);

      expect(progress.progressPercentage).toBe(75); // 750/1000 * 100
      expect(progress.isComplete).toBe(false);
      expect(progress.throughputRecordsPerSecond).toBeCloseTo(12.5, 1); // 750 records / 60 seconds
      expect(progress.estimatedTimeRemaining).toBeCloseTo(20, 0); // 250 / 12.5
    });

    test('should calculate 100% progress for completed migration', () => {
      const status = MockMigrationStatus.create({
        overall_status: 'completed',
        total_records_processed: 1000,
        total_records_remaining: 0
      });

      const progress = MockMigrationStatus.calculateProgress(status);

      expect(progress.progressPercentage).toBe(100);
      expect(progress.isComplete).toBe(true);
    });

    test('should handle zero records scenario', () => {
      const status = MockMigrationStatus.create({
        overall_status: 'pending',
        total_records_processed: 0,
        total_records_remaining: 0
      });

      const progress = MockMigrationStatus.calculateProgress(status);

      expect(progress.progressPercentage).toBe(0);
      expect(progress.isComplete).toBe(true); // No records to process
      expect(progress.throughputRecordsPerSecond).toBeNull();
      expect(progress.estimatedTimeRemaining).toBeNull();
    });
  });

  describe('Status Summary', () => {
    test('should calculate status summary correctly', () => {
      const status = MockMigrationStatus.create({
        entities_pending: ['patients', 'orders'],
        entities_running: ['doctors'],
        entities_completed: ['offices', 'cases'],
        entities_failed: ['files']
      });

      const summary = MockMigrationStatus.getStatusSummary(status);

      expect(summary.totalEntities).toBe(6);
      expect(summary.entitiesInProgress).toBe(3); // pending + running
      expect(summary.entitiesCompleted).toBe(2);
      expect(summary.entitiesFailed).toBe(1);
      expect(summary.successRate).toBeCloseTo(66.67, 2); // 2/(2+1) * 100
    });

    test('should handle no completed or failed entities', () => {
      const status = MockMigrationStatus.create({
        entities_pending: ['patients', 'doctors'],
        entities_running: ['offices']
      });

      const summary = MockMigrationStatus.getStatusSummary(status);

      expect(summary.totalEntities).toBe(3);
      expect(summary.entitiesInProgress).toBe(3);
      expect(summary.entitiesCompleted).toBe(0);
      expect(summary.entitiesFailed).toBe(0);
      expect(summary.successRate).toBeNull(); // No completed or failed entities
    });
  });

  describe('Integration with Test Utilities', () => {
    test('should work with test utility helper', () => {
      const testData = diffMigrationTestUtils.createTestMigrationStatus({
        overall_status: 'running',
        total_records_processed: 2000
      });

      expect(testData.overall_status).toBe('running');
      expect(testData.total_records_processed).toBe(2000);
      expect(testData.migration_session_id).toBeDefined();
    });
  });
});