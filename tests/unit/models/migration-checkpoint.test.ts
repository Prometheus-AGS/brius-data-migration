/**
 * Unit Tests: MigrationCheckpoint Model
 * Tests checkpoint creation, validation rules, and state transitions
 */

import { diffMigrationTestUtils } from '../../setup';

// Import the model interfaces (will be implemented after tests)
interface MigrationCheckpoint {
  id: string;
  entity_type: string;
  migration_run_id: string;
  last_processed_id: string;
  batch_position: number;
  records_processed: number;
  records_remaining: number;
  checkpoint_data: object;
  created_at: Date;
  updated_at: Date;
}

interface MigrationCheckpointCreateInput {
  entity_type: string;
  migration_run_id: string;
  last_processed_id?: string;
  batch_position?: number;
  records_processed?: number;
  records_remaining?: number;
  checkpoint_data?: object;
}

// Mock implementation for testing (will be replaced with actual implementation)
class MockMigrationCheckpoint {
  static create(input: MigrationCheckpointCreateInput): MigrationCheckpoint {
    // Basic validation
    if (!input.entity_type || !input.migration_run_id) {
      throw new Error('entity_type and migration_run_id are required');
    }

    return {
      id: diffMigrationTestUtils.generateTestUUID(),
      entity_type: input.entity_type,
      migration_run_id: input.migration_run_id,
      last_processed_id: input.last_processed_id || '',
      batch_position: input.batch_position || 0,
      records_processed: input.records_processed || 0,
      records_remaining: input.records_remaining || 0,
      checkpoint_data: input.checkpoint_data || {},
      created_at: new Date(),
      updated_at: new Date()
    };
  }

  static validate(checkpoint: MigrationCheckpoint): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate entity_type
    const validEntityTypes = [
      'offices', 'doctors', 'doctor_offices', 'patients', 'orders',
      'cases', 'files', 'case_files', 'messages', 'message_files',
      'jaw', 'dispatch_records', 'system_messages', 'message_attachments'
    ];

    if (!validEntityTypes.includes(checkpoint.entity_type)) {
      errors.push('Invalid entity_type');
    }

    // Validate non-negative numbers
    if (checkpoint.records_processed < 0) {
      errors.push('records_processed must be non-negative');
    }

    if (checkpoint.records_remaining < 0) {
      errors.push('records_remaining must be non-negative');
    }

    if (checkpoint.batch_position < 0) {
      errors.push('batch_position must be non-negative');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static updateProgress(
    checkpoint: MigrationCheckpoint,
    updates: Partial<Pick<MigrationCheckpoint, 'last_processed_id' | 'batch_position' | 'records_processed' | 'records_remaining' | 'checkpoint_data'>>
  ): MigrationCheckpoint {
    return {
      ...checkpoint,
      ...updates,
      updated_at: new Date()
    };
  }
}

describe('MigrationCheckpoint Model', () => {
  describe('Creation and Validation', () => {
    test('should create valid checkpoint with required fields', () => {
      const input: MigrationCheckpointCreateInput = {
        entity_type: 'offices',
        migration_run_id: 'run-123'
      };

      const checkpoint = MockMigrationCheckpoint.create(input);

      expect(checkpoint).toBeDefined();
      expect(checkpoint.id).toBeDefined();
      expect(checkpoint.entity_type).toBe('offices');
      expect(checkpoint.migration_run_id).toBe('run-123');
      expect(checkpoint.batch_position).toBe(0);
      expect(checkpoint.records_processed).toBe(0);
      expect(checkpoint.records_remaining).toBe(0);
      expect(checkpoint.checkpoint_data).toEqual({});
      expect(checkpoint.created_at).toBeInstanceOf(Date);
      expect(checkpoint.updated_at).toBeInstanceOf(Date);
    });

    test('should create checkpoint with all optional fields', () => {
      const input: MigrationCheckpointCreateInput = {
        entity_type: 'doctors',
        migration_run_id: 'run-456',
        last_processed_id: 'record-100',
        batch_position: 5,
        records_processed: 500,
        records_remaining: 200,
        checkpoint_data: { batch_info: 'test data' }
      };

      const checkpoint = MockMigrationCheckpoint.create(input);

      expect(checkpoint.last_processed_id).toBe('record-100');
      expect(checkpoint.batch_position).toBe(5);
      expect(checkpoint.records_processed).toBe(500);
      expect(checkpoint.records_remaining).toBe(200);
      expect(checkpoint.checkpoint_data).toEqual({ batch_info: 'test data' });
    });

    test('should throw error when required fields are missing', () => {
      expect(() => {
        MockMigrationCheckpoint.create({} as MigrationCheckpointCreateInput);
      }).toThrow('entity_type and migration_run_id are required');

      expect(() => {
        MockMigrationCheckpoint.create({ entity_type: 'offices' } as MigrationCheckpointCreateInput);
      }).toThrow('entity_type and migration_run_id are required');
    });
  });

  describe('Validation Rules', () => {
    test('should pass validation for valid checkpoint', () => {
      const checkpoint = MockMigrationCheckpoint.create({
        entity_type: 'offices',
        migration_run_id: 'run-123',
        records_processed: 100,
        records_remaining: 50,
        batch_position: 2
      });

      const validation = MockMigrationCheckpoint.validate(checkpoint);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should fail validation for invalid entity_type', () => {
      const checkpoint = MockMigrationCheckpoint.create({
        entity_type: 'invalid_entity',
        migration_run_id: 'run-123'
      });

      const validation = MockMigrationCheckpoint.validate(checkpoint);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Invalid entity_type');
    });

    test('should fail validation for negative records_processed', () => {
      const checkpoint = MockMigrationCheckpoint.create({
        entity_type: 'offices',
        migration_run_id: 'run-123',
        records_processed: -10
      });

      const validation = MockMigrationCheckpoint.validate(checkpoint);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('records_processed must be non-negative');
    });

    test('should fail validation for negative records_remaining', () => {
      const checkpoint = MockMigrationCheckpoint.create({
        entity_type: 'offices',
        migration_run_id: 'run-123',
        records_remaining: -5
      });

      const validation = MockMigrationCheckpoint.validate(checkpoint);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('records_remaining must be non-negative');
    });

    test('should fail validation for negative batch_position', () => {
      const checkpoint = MockMigrationCheckpoint.create({
        entity_type: 'offices',
        migration_run_id: 'run-123',
        batch_position: -1
      });

      const validation = MockMigrationCheckpoint.validate(checkpoint);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('batch_position must be non-negative');
    });

    test('should accumulate multiple validation errors', () => {
      const checkpoint = MockMigrationCheckpoint.create({
        entity_type: 'invalid_entity',
        migration_run_id: 'run-123',
        records_processed: -10,
        records_remaining: -5,
        batch_position: -1
      });

      const validation = MockMigrationCheckpoint.validate(checkpoint);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(4);
      expect(validation.errors).toContain('Invalid entity_type');
      expect(validation.errors).toContain('records_processed must be non-negative');
      expect(validation.errors).toContain('records_remaining must be non-negative');
      expect(validation.errors).toContain('batch_position must be non-negative');
    });
  });

  describe('State Transitions', () => {
    test('should update checkpoint progress correctly', () => {
      const originalCheckpoint = MockMigrationCheckpoint.create({
        entity_type: 'offices',
        migration_run_id: 'run-123',
        records_processed: 100,
        records_remaining: 200
      });

      const originalUpdatedAt = originalCheckpoint.updated_at;

      // Wait a small amount to ensure timestamp difference
      setTimeout(() => {
        const updatedCheckpoint = MockMigrationCheckpoint.updateProgress(originalCheckpoint, {
          last_processed_id: 'record-150',
          batch_position: 3,
          records_processed: 150,
          records_remaining: 150,
          checkpoint_data: { progress: 'updated' }
        });

        expect(updatedCheckpoint.last_processed_id).toBe('record-150');
        expect(updatedCheckpoint.batch_position).toBe(3);
        expect(updatedCheckpoint.records_processed).toBe(150);
        expect(updatedCheckpoint.records_remaining).toBe(150);
        expect(updatedCheckpoint.checkpoint_data).toEqual({ progress: 'updated' });
        expect(updatedCheckpoint.updated_at.getTime()).toBeGreaterThanOrEqual(originalUpdatedAt.getTime());

        // Ensure other fields remain unchanged
        expect(updatedCheckpoint.id).toBe(originalCheckpoint.id);
        expect(updatedCheckpoint.entity_type).toBe(originalCheckpoint.entity_type);
        expect(updatedCheckpoint.migration_run_id).toBe(originalCheckpoint.migration_run_id);
        expect(updatedCheckpoint.created_at).toBe(originalCheckpoint.created_at);
      }, 10);
    });

    test('should handle partial updates', () => {
      const originalCheckpoint = MockMigrationCheckpoint.create({
        entity_type: 'doctors',
        migration_run_id: 'run-456',
        records_processed: 200,
        records_remaining: 100
      });

      const updatedCheckpoint = MockMigrationCheckpoint.updateProgress(originalCheckpoint, {
        records_processed: 250
      });

      expect(updatedCheckpoint.records_processed).toBe(250);
      expect(updatedCheckpoint.records_remaining).toBe(100); // Unchanged
      expect(updatedCheckpoint.last_processed_id).toBe(''); // Unchanged
    });
  });

  describe('Entity Type Validation', () => {
    const validEntityTypes = [
      'offices', 'doctors', 'doctor_offices', 'patients', 'orders',
      'cases', 'files', 'case_files', 'messages', 'message_files',
      'jaw', 'dispatch_records', 'system_messages', 'message_attachments'
    ];

    test.each(validEntityTypes)('should accept valid entity type: %s', (entityType) => {
      const checkpoint = MockMigrationCheckpoint.create({
        entity_type: entityType,
        migration_run_id: 'run-test'
      });

      const validation = MockMigrationCheckpoint.validate(checkpoint);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).not.toContain('Invalid entity_type');
    });

    test('should reject invalid entity types', () => {
      const invalidTypes = ['invalid', 'unknown_entity', '', null, undefined];

      invalidTypes.forEach(invalidType => {
        const checkpoint = MockMigrationCheckpoint.create({
          entity_type: invalidType as string,
          migration_run_id: 'run-test'
        });

        const validation = MockMigrationCheckpoint.validate(checkpoint);

        expect(validation.isValid).toBe(false);
        expect(validation.errors).toContain('Invalid entity_type');
      });
    });
  });

  describe('Integration with Test Utilities', () => {
    test('should work with test utility helper', () => {
      const testData = diffMigrationTestUtils.createTestCheckpointData({
        entity_type: 'patients',
        records_processed: 750
      });

      expect(testData.entity_type).toBe('patients');
      expect(testData.records_processed).toBe(750);
      expect(testData.migration_run_id).toBeDefined();
      expect(testData.checkpoint_data).toBeDefined();
    });
  });
});