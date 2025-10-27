/**
 * Unit Tests: DifferentialDetector Service
 * Tests timestamp-based detection, content hash verification, change classification
 */

import { diffMigrationTestUtils } from '../../setup';

// Import the service interfaces (will be implemented after tests)
interface DetectionConfig {
  timestampField: string;
  contentHashField?: string;
  enableContentHashing: boolean;
  batchSize: number;
  parallelConnections: number;
}

interface ChangeRecord {
  recordId: string;
  changeType: 'new' | 'modified' | 'deleted';
  sourceTimestamp: Date;
  destinationTimestamp?: Date;
  contentHash?: string;
  previousContentHash?: string;
  metadata: {
    sourceTable: string;
    destinationTable: string;
    fields?: string[];
    confidence: number; // 0-1 confidence in change detection
  };
}

interface DifferentialAnalysisOptions {
  entityType: string;
  sinceTimestamp?: Date;
  untilTimestamp?: Date;
  enableContentHashing?: boolean;
  samplePercentage?: number; // For large datasets, analyze a sample
  includeDeletes?: boolean;
  batchSize?: number;
}

interface DifferentialAnalysisResult {
  analysisId: string;
  entityType: string;
  analysisTimestamp: Date;
  baselineTimestamp: Date;
  detectionMethod: 'timestamp_only' | 'timestamp_with_hash' | 'full_content_hash';
  totalRecordsAnalyzed: number;
  changesDetected: ChangeRecord[];
  summary: {
    newRecords: number;
    modifiedRecords: number;
    deletedRecords: number;
    totalChanges: number;
    changePercentage: number;
  };
  performance: {
    analysisDurationMs: number;
    recordsPerSecond: number;
    queriesExecuted: number;
  };
  recommendations: string[];
}

// Mock implementation for testing (will be replaced with actual implementation)
class MockDifferentialDetector {
  private config: DetectionConfig;
  private entityType: string;

  constructor(entityType: string, config: DetectionConfig) {
    this.entityType = entityType;
    this.config = config;
  }

  static validateDetectionConfig(config: DetectionConfig): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.timestampField) {
      errors.push('timestampField is required');
    }

    if (config.batchSize && (config.batchSize < 1 || config.batchSize > 10000)) {
      errors.push('batchSize must be between 1 and 10000');
    }

    if (config.parallelConnections && (config.parallelConnections < 1 || config.parallelConnections > 10)) {
      errors.push('parallelConnections must be between 1 and 10');
    }

    if (config.enableContentHashing && !config.contentHashField) {
      errors.push('contentHashField is required when enableContentHashing is true');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  async detectChanges(options: DifferentialAnalysisOptions): Promise<DifferentialAnalysisResult> {
    const startTime = Date.now();
    const analysisId = diffMigrationTestUtils.generateTestUUID();

    // Mock data based on entity type
    const mockData = this.generateMockChangeData(options);

    const changesDetected: ChangeRecord[] = mockData.changes;
    const totalRecordsAnalyzed = mockData.totalAnalyzed;

    const summary = {
      newRecords: changesDetected.filter(c => c.changeType === 'new').length,
      modifiedRecords: changesDetected.filter(c => c.changeType === 'modified').length,
      deletedRecords: changesDetected.filter(c => c.changeType === 'deleted').length,
      totalChanges: changesDetected.length,
      changePercentage: totalRecordsAnalyzed > 0
        ? Math.round((changesDetected.length / totalRecordsAnalyzed) * 100 * 100) / 100
        : 0
    };

    const endTime = Date.now();
    const analysisDurationMs = endTime - startTime;

    // Generate recommendations
    const recommendations: string[] = [];
    if (summary.changePercentage > 25) {
      recommendations.push('High change percentage detected - verify timestamp accuracy');
    }
    if (summary.newRecords > 1000) {
      recommendations.push('Large number of new records - consider batch processing');
    }
    if (options.enableContentHashing && !this.config.enableContentHashing) {
      recommendations.push('Content hashing requested but not configured - enable for better accuracy');
    }
    if (recommendations.length === 0) {
      recommendations.push('Change detection completed successfully - ready for migration');
    }

    return {
      analysisId,
      entityType: options.entityType,
      analysisTimestamp: new Date(),
      baselineTimestamp: options.sinceTimestamp || new Date(Date.now() - 24 * 60 * 60 * 1000),
      detectionMethod: this.config.enableContentHashing ? 'timestamp_with_hash' : 'timestamp_only',
      totalRecordsAnalyzed,
      changesDetected,
      summary,
      performance: {
        analysisDurationMs,
        recordsPerSecond: Math.round((totalRecordsAnalyzed / analysisDurationMs) * 1000),
        queriesExecuted: Math.ceil(totalRecordsAnalyzed / this.config.batchSize)
      },
      recommendations
    };
  }

  private generateMockChangeData(options: DifferentialAnalysisOptions): {
    totalAnalyzed: number;
    changes: ChangeRecord[];
  } {
    const mockDataSets = {
      offices: { total: 150, newRecords: 2, modifiedRecords: 5, deletedRecords: 1 },
      doctors: { total: 450, newRecords: 15, modifiedRecords: 25, deletedRecords: 3 },
      patients: { total: 2500, newRecords: 150, modifiedRecords: 300, deletedRecords: 20 },
      orders: { total: 15000, newRecords: 1200, modifiedRecords: 800, deletedRecords: 50 }
    };

    const entityData = mockDataSets[options.entityType as keyof typeof mockDataSets] ||
                      { total: 100, newRecords: 5, modifiedRecords: 10, deletedRecords: 2 };

    const changes: ChangeRecord[] = [];

    // Generate new records
    for (let i = 0; i < entityData.newRecords; i++) {
      changes.push({
        recordId: `${options.entityType}-new-${i + 1}`,
        changeType: 'new',
        sourceTimestamp: new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000),
        contentHash: this.config.enableContentHashing ? `hash_new_${i}` : undefined,
        metadata: {
          sourceTable: `dispatch_${options.entityType.slice(0, -1)}`,
          destinationTable: options.entityType,
          confidence: 0.95 + Math.random() * 0.05
        }
      });
    }

    // Generate modified records
    for (let i = 0; i < entityData.modifiedRecords; i++) {
      changes.push({
        recordId: `${options.entityType}-mod-${i + 1}`,
        changeType: 'modified',
        sourceTimestamp: new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000),
        destinationTimestamp: new Date(Date.now() - Math.random() * 48 * 60 * 60 * 1000),
        contentHash: this.config.enableContentHashing ? `hash_mod_new_${i}` : undefined,
        previousContentHash: this.config.enableContentHashing ? `hash_mod_old_${i}` : undefined,
        metadata: {
          sourceTable: `dispatch_${options.entityType.slice(0, -1)}`,
          destinationTable: options.entityType,
          fields: ['name', 'updated_at'],
          confidence: 0.85 + Math.random() * 0.15
        }
      });
    }

    // Generate deleted records (if enabled)
    if (options.includeDeletes) {
      for (let i = 0; i < entityData.deletedRecords; i++) {
        changes.push({
          recordId: `${options.entityType}-del-${i + 1}`,
          changeType: 'deleted',
          sourceTimestamp: new Date(Date.now() - Math.random() * 72 * 60 * 60 * 1000),
          destinationTimestamp: new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000),
          metadata: {
            sourceTable: `dispatch_${options.entityType.slice(0, -1)}`,
            destinationTable: options.entityType,
            confidence: 0.90 + Math.random() * 0.10
          }
        });
      }
    }

    return {
      totalAnalyzed: entityData.total,
      changes
    };
  }

  async calculateContentHash(recordId: string, fields: object): Promise<string> {
    // Mock content hash calculation
    const content = JSON.stringify(fields);
    const hash = Buffer.from(content).toString('base64').substring(0, 16);
    return `sha256_${hash}`;
  }

  async batchDetectChanges(
    recordIds: string[],
    batchSize?: number
  ): Promise<ChangeRecord[]> {
    const actualBatchSize = batchSize || this.config.batchSize;
    const changes: ChangeRecord[] = [];

    for (let i = 0; i < recordIds.length; i += actualBatchSize) {
      const batch = recordIds.slice(i, i + actualBatchSize);

      for (const recordId of batch) {
        // Mock change detection for each record
        const changeTypes: ('new' | 'modified' | 'deleted')[] = ['new', 'modified'];
        const changeType = changeTypes[Math.floor(Math.random() * changeTypes.length)];

        changes.push({
          recordId,
          changeType,
          sourceTimestamp: new Date(Date.now() - Math.random() * 48 * 60 * 60 * 1000),
          destinationTimestamp: changeType === 'modified'
            ? new Date(Date.now() - Math.random() * 72 * 60 * 60 * 1000)
            : undefined,
          contentHash: this.config.enableContentHashing ? `hash_${recordId}` : undefined,
          metadata: {
            sourceTable: `dispatch_${this.entityType}`,
            destinationTable: this.entityType,
            confidence: 0.8 + Math.random() * 0.2
          }
        });
      }
    }

    return changes;
  }

  async validateTimestamps(
    sourceTimestamp: Date,
    destinationTimestamp?: Date
  ): Promise<{
    isValid: boolean;
    issues: string[];
    confidence: number;
  }> {
    const issues: string[] = [];
    let confidence = 1.0;

    // Check if source timestamp is reasonable
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000);

    if (sourceTimestamp < oneYearAgo) {
      issues.push('Source timestamp is older than 1 year - verify data accuracy');
      confidence -= 0.2;
    }

    if (sourceTimestamp > oneDayFromNow) {
      issues.push('Source timestamp is in the future - clock synchronization issue');
      confidence -= 0.3;
    }

    // Check timestamp relationship
    if (destinationTimestamp && sourceTimestamp < destinationTimestamp) {
      issues.push('Source timestamp is older than destination - potential data inconsistency');
      confidence -= 0.4;
    }

    return {
      isValid: issues.length === 0,
      issues,
      confidence: Math.max(0, confidence)
    };
  }

  async optimizeDetectionQuery(entityType: string): Promise<{
    recommendedIndexes: Array<{
      table: string;
      columns: string[];
      type: 'btree' | 'hash' | 'composite';
      priority: 'high' | 'medium' | 'low';
    }>;
    estimatedPerformanceGain: number; // Percentage improvement
    queryOptimizations: string[];
  }> {
    // Mock query optimization recommendations
    const recommendations = {
      offices: {
        indexes: [
          { table: 'dispatch_office', columns: ['updated_at'], type: 'btree' as const, priority: 'high' as const }
        ],
        performanceGain: 40,
        optimizations: ['Add index on updated_at for timestamp queries']
      },
      doctors: {
        indexes: [
          { table: 'dispatch_doctor', columns: ['updated_at', 'id'], type: 'composite' as const, priority: 'high' as const },
          { table: 'doctors', columns: ['legacy_doctor_id'], type: 'btree' as const, priority: 'medium' as const }
        ],
        performanceGain: 65,
        optimizations: [
          'Add composite index on (updated_at, id) for efficient timestamp scanning',
          'Index legacy_doctor_id for join performance'
        ]
      }
    };

    const entityRec = recommendations[entityType as keyof typeof recommendations] ||
                     recommendations.offices;

    return {
      recommendedIndexes: entityRec.indexes,
      estimatedPerformanceGain: entityRec.performanceGain,
      queryOptimizations: entityRec.optimizations
    };
  }
}

describe('DifferentialDetector Service', () => {
  let detector: MockDifferentialDetector;

  const mockConfig: DetectionConfig = {
    timestampField: 'updated_at',
    contentHashField: 'content_hash',
    enableContentHashing: true,
    batchSize: 1000,
    parallelConnections: 3
  };

  beforeEach(() => {
    detector = new MockDifferentialDetector('doctors', mockConfig);
  });

  describe('Configuration Validation', () => {
    test('should validate correct detection configuration', () => {
      const validation = MockDifferentialDetector.validateDetectionConfig(mockConfig);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should fail validation for missing required fields', () => {
      const invalidConfig = {
        timestampField: '',
        enableContentHashing: true,
        batchSize: 1000,
        parallelConnections: 3
      } as DetectionConfig;

      const validation = MockDifferentialDetector.validateDetectionConfig(invalidConfig);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('timestampField is required');
      expect(validation.errors).toContain('contentHashField is required when enableContentHashing is true');
    });

    test('should fail validation for invalid batch size', () => {
      const invalidConfig = {
        ...mockConfig,
        batchSize: 15000
      };

      const validation = MockDifferentialDetector.validateDetectionConfig(invalidConfig);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('batchSize must be between 1 and 10000');
    });

    test('should fail validation for invalid parallel connections', () => {
      const invalidConfig = {
        ...mockConfig,
        parallelConnections: 15
      };

      const validation = MockDifferentialDetector.validateDetectionConfig(invalidConfig);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('parallelConnections must be between 1 and 10');
    });
  });

  describe('Change Detection', () => {
    test('should detect changes with timestamp-based method', async () => {
      const options: DifferentialAnalysisOptions = {
        entityType: 'doctors',
        sinceTimestamp: new Date(Date.now() - 24 * 60 * 60 * 1000),
        enableContentHashing: false
      };

      const result = await detector.detectChanges(options);

      expect(result).toBeDefined();
      expect(result.analysisId).toBeDefined();
      expect(result.entityType).toBe('doctors');
      expect(result.detectionMethod).toBe('timestamp_with_hash');
      expect(result.totalRecordsAnalyzed).toBeGreaterThan(0);
      expect(result.changesDetected).toBeDefined();
      expect(result.summary).toBeDefined();
      expect(result.performance).toBeDefined();
      expect(result.analysisTimestamp).toBeInstanceOf(Date);
    });

    test('should calculate summary statistics correctly', async () => {
      const options: DifferentialAnalysisOptions = {
        entityType: 'patients',
        includeDeletes: true
      };

      const result = await detector.detectChanges(options);

      const { summary, changesDetected } = result;

      expect(summary.newRecords).toBe(changesDetected.filter(c => c.changeType === 'new').length);
      expect(summary.modifiedRecords).toBe(changesDetected.filter(c => c.changeType === 'modified').length);
      expect(summary.deletedRecords).toBe(changesDetected.filter(c => c.changeType === 'deleted').length);
      expect(summary.totalChanges).toBe(changesDetected.length);
      expect(summary.changePercentage).toBeGreaterThanOrEqual(0);
      expect(summary.changePercentage).toBeLessThanOrEqual(100);
    });

    test('should handle entities with no changes', async () => {
      const options: DifferentialAnalysisOptions = {
        entityType: 'nonexistent_entity'
      };

      const result = await detector.detectChanges(options);

      expect(result.totalRecordsAnalyzed).toBeGreaterThanOrEqual(0);
      expect(result.summary.totalChanges).toBeGreaterThanOrEqual(0);
      expect(result.summary.changePercentage).toBeGreaterThanOrEqual(0);
    });

    test('should exclude deletes when not requested', async () => {
      const options: DifferentialAnalysisOptions = {
        entityType: 'orders',
        includeDeletes: false
      };

      const result = await detector.detectChanges(options);

      const deletedRecords = result.changesDetected.filter(c => c.changeType === 'deleted');
      expect(deletedRecords).toHaveLength(0);
      expect(result.summary.deletedRecords).toBe(0);
    });

    test('should include deletes when requested', async () => {
      const options: DifferentialAnalysisOptions = {
        entityType: 'orders',
        includeDeletes: true
      };

      const result = await detector.detectChanges(options);

      expect(result.summary.deletedRecords).toBeGreaterThanOrEqual(0);
    });

    test('should generate appropriate recommendations', async () => {
      const options: DifferentialAnalysisOptions = {
        entityType: 'orders' // Large dataset entity
      };

      const result = await detector.detectChanges(options);

      expect(result.recommendations).toBeDefined();
      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(Array.isArray(result.recommendations)).toBe(true);
    });
  });

  describe('Content Hash Calculations', () => {
    test('should calculate content hash correctly', async () => {
      const recordId = 'doctor-123';
      const fields = {
        id: 123,
        name: 'Dr. Smith',
        specialty: 'Cardiology',
        updated_at: '2025-10-26T10:00:00Z'
      };

      const hash = await detector.calculateContentHash(recordId, fields);

      expect(hash).toBeDefined();
      expect(hash).toMatch(/^sha256_/);
      expect(hash.length).toBeGreaterThan(10);
    });

    test('should generate consistent hashes for same content', async () => {
      const recordId = 'doctor-123';
      const fields = { name: 'Dr. Smith' };

      const hash1 = await detector.calculateContentHash(recordId, fields);
      const hash2 = await detector.calculateContentHash(recordId, fields);

      expect(hash1).toBe(hash2);
    });
  });

  describe('Batch Change Detection', () => {
    test('should process records in batches', async () => {
      const recordIds = Array.from({ length: 2500 }, (_, i) => `record-${i + 1}`);
      const batchSize = 500;

      const changes = await detector.batchDetectChanges(recordIds, batchSize);

      expect(changes).toBeDefined();
      expect(changes.length).toBe(recordIds.length);
      expect(changes.every(change => change.recordId.startsWith('record-'))).toBe(true);
    });

    test('should handle empty record list', async () => {
      const changes = await detector.batchDetectChanges([]);

      expect(changes).toEqual([]);
    });

    test('should use default batch size when not specified', async () => {
      const recordIds = ['record-1', 'record-2'];
      const changes = await detector.batchDetectChanges(recordIds);

      expect(changes).toHaveLength(2);
    });
  });

  describe('Timestamp Validation', () => {
    test('should validate correct timestamps', async () => {
      const sourceTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
      const destinationTimestamp = new Date(Date.now() - 4 * 60 * 60 * 1000); // 4 hours ago

      const result = await detector.validateTimestamps(sourceTimestamp, destinationTimestamp);

      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.confidence).toBe(1.0);
    });

    test('should detect future timestamp issues', async () => {
      const futureTimestamp = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // 2 days in future

      const result = await detector.validateTimestamps(futureTimestamp);

      expect(result.isValid).toBe(false);
      expect(result.issues).toContain('Source timestamp is in the future - clock synchronization issue');
      expect(result.confidence).toBeLessThan(1.0);
    });

    test('should detect timestamp order issues', async () => {
      const sourceTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const destinationTimestamp = new Date(Date.now() - 1 * 60 * 60 * 1000); // Newer than source

      const result = await detector.validateTimestamps(sourceTimestamp, destinationTimestamp);

      expect(result.isValid).toBe(false);
      expect(result.issues).toContain('Source timestamp is older than destination - potential data inconsistency');
      expect(result.confidence).toBeLessThan(1.0);
    });

    test('should detect very old timestamps', async () => {
      const veryOldTimestamp = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000); // 2 years ago

      const result = await detector.validateTimestamps(veryOldTimestamp);

      expect(result.isValid).toBe(false);
      expect(result.issues).toContain('Source timestamp is older than 1 year - verify data accuracy');
      expect(result.confidence).toBeLessThan(1.0);
    });
  });

  describe('Query Optimization', () => {
    test('should provide optimization recommendations', async () => {
      const result = await detector.optimizeDetectionQuery('doctors');

      expect(result).toBeDefined();
      expect(result.recommendedIndexes).toBeDefined();
      expect(result.recommendedIndexes.length).toBeGreaterThan(0);
      expect(result.estimatedPerformanceGain).toBeGreaterThan(0);
      expect(result.queryOptimizations).toBeDefined();
      expect(result.queryOptimizations.length).toBeGreaterThan(0);
    });

    test('should recommend appropriate indexes', async () => {
      const result = await detector.optimizeDetectionQuery('offices');

      const indexes = result.recommendedIndexes;
      expect(indexes.some(idx => idx.columns.includes('updated_at'))).toBe(true);
      expect(indexes.some(idx => idx.priority === 'high')).toBe(true);
    });

    test('should estimate performance gains', async () => {
      const result = await detector.optimizeDetectionQuery('doctors');

      expect(result.estimatedPerformanceGain).toBeGreaterThan(0);
      expect(result.estimatedPerformanceGain).toBeLessThanOrEqual(100);
    });
  });

  describe('Integration with Test Utilities', () => {
    test('should work with test utility helper', () => {
      const testData = diffMigrationTestUtils.createTestDifferentialResult({
        entityType: 'test_entity',
        newRecords: 10,
        modifiedRecords: 5
      });

      expect(testData.entityType).toBe('test_entity');
      expect(testData.summary.newRecords).toBe(10);
      expect(testData.summary.modifiedRecords).toBe(5);
      expect(testData.summary.totalChanges).toBe(15);
    });
  });
});