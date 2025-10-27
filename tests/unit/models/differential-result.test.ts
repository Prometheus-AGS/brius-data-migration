/**
 * Unit Tests: DifferentialAnalysisResult Model
 * Tests analysis result creation, record count validation, change percentage calculations
 */

import { diffMigrationTestUtils } from '../../setup';

// Import the model interfaces (will be implemented after tests)
interface DifferentialAnalysisResult {
  id: string;
  entity_type: string;
  analysis_timestamp: Date;
  source_record_count: number;
  destination_record_count: number;
  new_records: string[];
  modified_records: string[];
  deleted_records: string[];
  last_migration_timestamp: Date | null;
  analysis_metadata: object;
  created_at: Date;
  updated_at: Date;
}

interface DifferentialAnalysisCreateInput {
  entity_type: string;
  source_record_count: number;
  destination_record_count: number;
  new_records: string[];
  modified_records: string[];
  deleted_records: string[];
  last_migration_timestamp?: Date | null;
  analysis_metadata?: object;
}

// Mock implementation for testing (will be replaced with actual implementation)
class MockDifferentialAnalysisResult {
  static create(input: DifferentialAnalysisCreateInput): DifferentialAnalysisResult {
    // Basic validation
    if (!input.entity_type) {
      throw new Error('entity_type is required');
    }

    if (typeof input.source_record_count !== 'number' || input.source_record_count < 0) {
      throw new Error('source_record_count must be a non-negative number');
    }

    if (typeof input.destination_record_count !== 'number' || input.destination_record_count < 0) {
      throw new Error('destination_record_count must be a non-negative number');
    }

    return {
      id: diffMigrationTestUtils.generateTestUUID(),
      entity_type: input.entity_type,
      analysis_timestamp: new Date(),
      source_record_count: input.source_record_count,
      destination_record_count: input.destination_record_count,
      new_records: input.new_records || [],
      modified_records: input.modified_records || [],
      deleted_records: input.deleted_records || [],
      last_migration_timestamp: input.last_migration_timestamp || null,
      analysis_metadata: input.analysis_metadata || {},
      created_at: new Date(),
      updated_at: new Date()
    };
  }

  static validate(result: DifferentialAnalysisResult): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate entity_type
    const validEntityTypes = [
      'offices', 'doctors', 'doctor_offices', 'patients', 'orders',
      'cases', 'files', 'case_files', 'messages', 'message_files',
      'jaw', 'dispatch_records', 'system_messages', 'message_attachments'
    ];

    if (!validEntityTypes.includes(result.entity_type)) {
      errors.push('Invalid entity_type');
    }

    // Validate non-negative counts
    if (result.source_record_count < 0) {
      errors.push('source_record_count must be non-negative');
    }

    if (result.destination_record_count < 0) {
      errors.push('destination_record_count must be non-negative');
    }

    // Validate arrays
    if (!Array.isArray(result.new_records)) {
      errors.push('new_records must be an array');
    }

    if (!Array.isArray(result.modified_records)) {
      errors.push('modified_records must be an array');
    }

    if (!Array.isArray(result.deleted_records)) {
      errors.push('deleted_records must be an array');
    }

    // Validate analysis timestamp is reasonable (not in the future by more than 1 hour)
    const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
    if (result.analysis_timestamp > oneHourFromNow) {
      errors.push('analysis_timestamp cannot be more than 1 hour in the future');
    }

    // Validate total changes don't exceed reasonable limits (performance consideration)
    const totalChanges = result.new_records.length + result.modified_records.length + result.deleted_records.length;
    if (totalChanges > 1000000) { // 1M record limit
      errors.push('Total changes exceed maximum limit of 1,000,000 records');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static calculateChangeMetrics(result: DifferentialAnalysisResult) {
    const totalNewRecords = result.new_records.length;
    const totalModifiedRecords = result.modified_records.length;
    const totalDeletedRecords = result.deleted_records.length;
    const totalChanges = totalNewRecords + totalModifiedRecords + totalDeletedRecords;

    const changePercentage = result.source_record_count > 0
      ? ((totalNewRecords + totalModifiedRecords) / result.source_record_count) * 100
      : 0;

    const recordGap = result.source_record_count - result.destination_record_count;

    return {
      totalNewRecords,
      totalModifiedRecords,
      totalDeletedRecords,
      totalChanges,
      changePercentage: Math.round(changePercentage * 100) / 100, // Round to 2 decimal places
      recordGap,
      isSignificantChange: changePercentage > 5, // More than 5% change
      requiresAttention: recordGap > 100 || totalChanges > 10000 // Large gaps or high volume changes
    };
  }

  static filterRecordsByType(result: DifferentialAnalysisResult, recordType: 'new' | 'modified' | 'deleted'): string[] {
    switch (recordType) {
      case 'new':
        return result.new_records;
      case 'modified':
        return result.modified_records;
      case 'deleted':
        return result.deleted_records;
      default:
        return [];
    }
  }
}

describe('DifferentialAnalysisResult Model', () => {
  describe('Creation and Validation', () => {
    test('should create valid analysis result with required fields', () => {
      const input: DifferentialAnalysisCreateInput = {
        entity_type: 'offices',
        source_record_count: 100,
        destination_record_count: 95,
        new_records: ['101', '102'],
        modified_records: ['50', '75'],
        deleted_records: ['25']
      };

      const result = MockDifferentialAnalysisResult.create(input);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.entity_type).toBe('offices');
      expect(result.source_record_count).toBe(100);
      expect(result.destination_record_count).toBe(95);
      expect(result.new_records).toEqual(['101', '102']);
      expect(result.modified_records).toEqual(['50', '75']);
      expect(result.deleted_records).toEqual(['25']);
      expect(result.analysis_timestamp).toBeInstanceOf(Date);
      expect(result.last_migration_timestamp).toBeNull();
      expect(result.analysis_metadata).toEqual({});
    });

    test('should create analysis result with all optional fields', () => {
      const lastMigration = new Date('2025-10-25T10:00:00Z');
      const metadata = { analysis_duration_ms: 1500, method: 'timestamp_based' };

      const input: DifferentialAnalysisCreateInput = {
        entity_type: 'doctors',
        source_record_count: 200,
        destination_record_count: 190,
        new_records: ['201', '202', '203'],
        modified_records: ['150'],
        deleted_records: [],
        last_migration_timestamp: lastMigration,
        analysis_metadata: metadata
      };

      const result = MockDifferentialAnalysisResult.create(input);

      expect(result.last_migration_timestamp).toEqual(lastMigration);
      expect(result.analysis_metadata).toEqual(metadata);
      expect(result.deleted_records).toEqual([]);
    });

    test('should throw error when entity_type is missing', () => {
      expect(() => {
        MockDifferentialAnalysisResult.create({
          source_record_count: 100,
          destination_record_count: 95,
          new_records: [],
          modified_records: [],
          deleted_records: []
        } as DifferentialAnalysisCreateInput);
      }).toThrow('entity_type is required');
    });

    test('should throw error for invalid source_record_count', () => {
      expect(() => {
        MockDifferentialAnalysisResult.create({
          entity_type: 'offices',
          source_record_count: -10,
          destination_record_count: 95,
          new_records: [],
          modified_records: [],
          deleted_records: []
        });
      }).toThrow('source_record_count must be a non-negative number');
    });

    test('should throw error for invalid destination_record_count', () => {
      expect(() => {
        MockDifferentialAnalysisResult.create({
          entity_type: 'offices',
          source_record_count: 100,
          destination_record_count: -5,
          new_records: [],
          modified_records: [],
          deleted_records: []
        });
      }).toThrow('destination_record_count must be a non-negative number');
    });
  });

  describe('Validation Rules', () => {
    test('should pass validation for valid analysis result', () => {
      const result = MockDifferentialAnalysisResult.create({
        entity_type: 'patients',
        source_record_count: 1000,
        destination_record_count: 950,
        new_records: ['1001', '1002'],
        modified_records: ['500'],
        deleted_records: []
      });

      const validation = MockDifferentialAnalysisResult.validate(result);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should fail validation for invalid entity_type', () => {
      const result = MockDifferentialAnalysisResult.create({
        entity_type: 'invalid_entity',
        source_record_count: 100,
        destination_record_count: 95,
        new_records: [],
        modified_records: [],
        deleted_records: []
      });

      const validation = MockDifferentialAnalysisResult.validate(result);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Invalid entity_type');
    });

    test('should fail validation for future analysis_timestamp', () => {
      const result = MockDifferentialAnalysisResult.create({
        entity_type: 'offices',
        source_record_count: 100,
        destination_record_count: 95,
        new_records: [],
        modified_records: [],
        deleted_records: []
      });

      // Manually set timestamp to future
      result.analysis_timestamp = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours in future

      const validation = MockDifferentialAnalysisResult.validate(result);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('analysis_timestamp cannot be more than 1 hour in the future');
    });

    test('should fail validation for excessive total changes', () => {
      // Create arrays with more than 1M items (mocked for performance)
      const largeArray = new Array(500001).fill('record');

      const result = MockDifferentialAnalysisResult.create({
        entity_type: 'offices',
        source_record_count: 2000000,
        destination_record_count: 1000000,
        new_records: largeArray,
        modified_records: largeArray,
        deleted_records: []
      });

      const validation = MockDifferentialAnalysisResult.validate(result);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Total changes exceed maximum limit of 1,000,000 records');
    });
  });

  describe('Change Metrics Calculation', () => {
    test('should calculate metrics correctly for typical scenario', () => {
      const result = MockDifferentialAnalysisResult.create({
        entity_type: 'offices',
        source_record_count: 1000,
        destination_record_count: 980,
        new_records: ['1001', '1002', '1003'], // 3 new
        modified_records: ['500', '750'], // 2 modified
        deleted_records: ['100'] // 1 deleted
      });

      const metrics = MockDifferentialAnalysisResult.calculateChangeMetrics(result);

      expect(metrics.totalNewRecords).toBe(3);
      expect(metrics.totalModifiedRecords).toBe(2);
      expect(metrics.totalDeletedRecords).toBe(1);
      expect(metrics.totalChanges).toBe(6);
      expect(metrics.changePercentage).toBe(0.5); // (3+2)/1000 * 100 = 0.5%
      expect(metrics.recordGap).toBe(20); // 1000 - 980
      expect(metrics.isSignificantChange).toBe(false); // < 5%
      expect(metrics.requiresAttention).toBe(false); // Gap < 100, changes < 10000
    });

    test('should calculate metrics for significant change scenario', () => {
      const result = MockDifferentialAnalysisResult.create({
        entity_type: 'patients',
        source_record_count: 1000,
        destination_record_count: 900,
        new_records: new Array(80).fill('new'), // 80 new records
        modified_records: new Array(20).fill('mod'), // 20 modified records
        deleted_records: new Array(10).fill('del') // 10 deleted records
      });

      const metrics = MockDifferentialAnalysisResult.calculateChangeMetrics(result);

      expect(metrics.totalNewRecords).toBe(80);
      expect(metrics.totalModifiedRecords).toBe(20);
      expect(metrics.totalDeletedRecords).toBe(10);
      expect(metrics.totalChanges).toBe(110);
      expect(metrics.changePercentage).toBe(10); // (80+20)/1000 * 100 = 10%
      expect(metrics.recordGap).toBe(100); // 1000 - 900
      expect(metrics.isSignificantChange).toBe(true); // > 5%
      expect(metrics.requiresAttention).toBe(true); // Gap = 100 (threshold)
    });

    test('should handle zero source records', () => {
      const result = MockDifferentialAnalysisResult.create({
        entity_type: 'offices',
        source_record_count: 0,
        destination_record_count: 0,
        new_records: [],
        modified_records: [],
        deleted_records: []
      });

      const metrics = MockDifferentialAnalysisResult.calculateChangeMetrics(result);

      expect(metrics.changePercentage).toBe(0);
      expect(metrics.isSignificantChange).toBe(false);
    });

    test('should identify high-volume changes requiring attention', () => {
      const result = MockDifferentialAnalysisResult.create({
        entity_type: 'system_messages',
        source_record_count: 50000,
        destination_record_count: 40000,
        new_records: new Array(15000).fill('new'),
        modified_records: new Array(1000).fill('mod'),
        deleted_records: []
      });

      const metrics = MockDifferentialAnalysisResult.calculateChangeMetrics(result);

      expect(metrics.requiresAttention).toBe(true); // 16000 total changes > 10000
      expect(metrics.isSignificantChange).toBe(true); // 32% change rate
    });
  });

  describe('Record Filtering', () => {
    let testResult: DifferentialAnalysisResult;

    beforeEach(() => {
      testResult = MockDifferentialAnalysisResult.create({
        entity_type: 'doctors',
        source_record_count: 100,
        destination_record_count: 95,
        new_records: ['101', '102', '103'],
        modified_records: ['50', '75'],
        deleted_records: ['25']
      });
    });

    test('should filter new records correctly', () => {
      const newRecords = MockDifferentialAnalysisResult.filterRecordsByType(testResult, 'new');

      expect(newRecords).toEqual(['101', '102', '103']);
      expect(newRecords).toHaveLength(3);
    });

    test('should filter modified records correctly', () => {
      const modifiedRecords = MockDifferentialAnalysisResult.filterRecordsByType(testResult, 'modified');

      expect(modifiedRecords).toEqual(['50', '75']);
      expect(modifiedRecords).toHaveLength(2);
    });

    test('should filter deleted records correctly', () => {
      const deletedRecords = MockDifferentialAnalysisResult.filterRecordsByType(testResult, 'deleted');

      expect(deletedRecords).toEqual(['25']);
      expect(deletedRecords).toHaveLength(1);
    });

    test('should return empty array for invalid record type', () => {
      const invalidRecords = MockDifferentialAnalysisResult.filterRecordsByType(testResult, 'invalid' as any);

      expect(invalidRecords).toEqual([]);
      expect(invalidRecords).toHaveLength(0);
    });
  });

  describe('Integration with Test Utilities', () => {
    test('should work with test utility helper', () => {
      const testData = diffMigrationTestUtils.createTestAnalysisResult({
        entity_type: 'orders',
        source_record_count: 2000
      });

      expect(testData.entity_type).toBe('orders');
      expect(testData.source_record_count).toBe(2000);
      expect(testData.new_records).toBeDefined();
      expect(testData.modified_records).toBeDefined();
      expect(testData.deleted_records).toBeDefined();
    });
  });
});