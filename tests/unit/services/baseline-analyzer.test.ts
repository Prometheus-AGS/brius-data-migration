/**
 * Unit Tests: BaselineAnalyzer Service
 * Tests database comparison, record counting, mapping analysis, gap identification
 */

import { diffMigrationTestUtils } from '../../setup';

// Import the service interfaces (will be implemented after tests)
interface DatabaseConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
}

interface EntityAnalysisResult {
  entityType: string;
  sourceCount: number;
  destinationCount: number;
  recordGap: number;
  gapPercentage: number;
  hasData: boolean;
  lastMigrationTimestamp: Date | null;
  analysisTimestamp: Date;
}

interface MappingValidationResult {
  entityType: string;
  isValid: boolean;
  missingMappings: string[];
  orphanedMappings: string[];
  schemaChanges: Array<{
    field: string;
    changeType: 'added' | 'removed' | 'modified';
    details: string;
  }>;
}

interface BaselineAnalysisReport {
  analysisId: string;
  sessionId: string;
  totalEntities: number;
  entitiesAnalyzed: string[];
  overallStatus: 'healthy' | 'gaps_detected' | 'critical_issues';
  entityResults: EntityAnalysisResult[];
  mappingValidation: MappingValidationResult[];
  recommendations: string[];
  summary: {
    totalSourceRecords: number;
    totalDestinationRecords: number;
    overallGap: number;
    averageGapPercentage: number;
    entitiesWithGaps: number;
  };
  performanceMetrics: {
    analysisDurationMs: number;
    queriesExecuted: number;
    averageQueryTimeMs: number;
  };
  generatedAt: Date;
}

// Mock implementation for testing (will be replaced with actual implementation)
class MockBaselineAnalyzer {
  private sourceConfig: DatabaseConnectionConfig;
  private destinationConfig: DatabaseConnectionConfig;

  constructor(sourceConfig: DatabaseConnectionConfig, destinationConfig: DatabaseConnectionConfig) {
    this.sourceConfig = sourceConfig;
    this.destinationConfig = destinationConfig;
  }

  static validateConfig(config: DatabaseConnectionConfig): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.host) errors.push('host is required');
    if (!config.database) errors.push('database is required');
    if (!config.user) errors.push('user is required');
    if (!config.password) errors.push('password is required');
    if (config.port && (config.port < 1 || config.port > 65535)) errors.push('port must be between 1 and 65535');

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  async analyzeEntity(entityType: string): Promise<EntityAnalysisResult> {
    // Mock implementation
    const mockData = {
      offices: { source: 150, destination: 150, lastMigration: new Date('2025-10-25') },
      doctors: { source: 450, destination: 448, lastMigration: new Date('2025-10-25') },
      patients: { source: 2500, destination: 2480, lastMigration: new Date('2025-10-24') },
      orders: { source: 15000, destination: 14950, lastMigration: new Date('2025-10-24') }
    };

    const data = mockData[entityType as keyof typeof mockData] || { source: 0, destination: 0, lastMigration: null };
    const recordGap = data.source - data.destination;
    const gapPercentage = data.source > 0 ? Math.round((recordGap / data.source) * 100 * 100) / 100 : 0;

    return {
      entityType,
      sourceCount: data.source,
      destinationCount: data.destination,
      recordGap,
      gapPercentage,
      hasData: data.source > 0,
      lastMigrationTimestamp: data.lastMigration,
      analysisTimestamp: new Date()
    };
  }

  async validateMappings(entityType: string): Promise<MappingValidationResult> {
    // Mock implementation for testing
    const mockMappings = {
      offices: { isValid: true, missing: [], orphaned: [], changes: [] },
      doctors: {
        isValid: false,
        missing: ['specialty_id'],
        orphaned: ['old_region_code'],
        changes: [{ field: 'phone', changeType: 'modified', details: 'Changed from varchar(15) to varchar(20)' }]
      },
      patients: { isValid: true, missing: [], orphaned: [], changes: [] },
      orders: {
        isValid: false,
        missing: ['urgency_level'],
        orphaned: [],
        changes: []
      }
    };

    const mapping = mockMappings[entityType as keyof typeof mockMappings] ||
                   { isValid: true, missing: [], orphaned: [], changes: [] };

    return {
      entityType,
      isValid: mapping.isValid,
      missingMappings: mapping.missing,
      orphanedMappings: mapping.orphaned,
      schemaChanges: mapping.changes as any[]
    };
  }

  async analyzeAllEntities(entityTypes: string[]): Promise<EntityAnalysisResult[]> {
    const results: EntityAnalysisResult[] = [];

    for (const entityType of entityTypes) {
      const result = await this.analyzeEntity(entityType);
      results.push(result);
    }

    return results;
  }

  async generateBaselineReport(
    entityTypes: string[],
    sessionId?: string
  ): Promise<BaselineAnalysisReport> {
    const startTime = Date.now();
    const analysisId = diffMigrationTestUtils.generateTestUUID();
    const actualSessionId = sessionId || diffMigrationTestUtils.generateTestUUID();

    // Analyze entities
    const entityResults = await this.analyzeAllEntities(entityTypes);

    // Validate mappings
    const mappingValidation: MappingValidationResult[] = [];
    for (const entityType of entityTypes) {
      const validation = await this.validateMappings(entityType);
      mappingValidation.push(validation);
    }

    // Calculate summary
    const totalSourceRecords = entityResults.reduce((sum, result) => sum + result.sourceCount, 0);
    const totalDestinationRecords = entityResults.reduce((sum, result) => sum + result.destinationCount, 0);
    const overallGap = totalSourceRecords - totalDestinationRecords;
    const averageGapPercentage = entityResults.length > 0
      ? entityResults.reduce((sum, result) => sum + result.gapPercentage, 0) / entityResults.length
      : 0;
    const entitiesWithGaps = entityResults.filter(result => result.recordGap > 0).length;

    // Determine overall status
    let overallStatus: 'healthy' | 'gaps_detected' | 'critical_issues' = 'healthy';
    const hasSignificantGaps = entitiesWithGaps > 0 && averageGapPercentage > 5;
    const hasMappingIssues = mappingValidation.some(v => !v.isValid);

    if (hasSignificantGaps || hasMappingIssues) {
      overallStatus = averageGapPercentage > 15 ? 'critical_issues' : 'gaps_detected';
    }

    // Generate recommendations
    const recommendations: string[] = [];
    if (entitiesWithGaps > 0) {
      recommendations.push(`${entitiesWithGaps} entities have record gaps - investigate missing data`);
    }
    if (hasMappingIssues) {
      recommendations.push('Some entities have mapping validation issues - review schema changes');
    }
    if (averageGapPercentage > 10) {
      recommendations.push('High average gap percentage - consider full re-sync for affected entities');
    }
    if (recommendations.length === 0) {
      recommendations.push('All entities appear healthy - ready for differential migration');
    }

    const endTime = Date.now();

    return {
      analysisId,
      sessionId: actualSessionId,
      totalEntities: entityTypes.length,
      entitiesAnalyzed: [...entityTypes],
      overallStatus,
      entityResults,
      mappingValidation,
      recommendations,
      summary: {
        totalSourceRecords,
        totalDestinationRecords,
        overallGap,
        averageGapPercentage: Math.round(averageGapPercentage * 100) / 100,
        entitiesWithGaps
      },
      performanceMetrics: {
        analysisDurationMs: endTime - startTime,
        queriesExecuted: entityTypes.length * 4, // Mock calculation
        averageQueryTimeMs: Math.round((endTime - startTime) / (entityTypes.length * 4))
      },
      generatedAt: new Date()
    };
  }

  async compareSchemaVersions(entityType: string): Promise<{
    sourceSchema: object;
    destinationSchema: object;
    differences: Array<{
      type: 'column_added' | 'column_removed' | 'column_modified' | 'constraint_changed';
      field: string;
      sourceValue: any;
      destinationValue: any;
    }>;
    isCompatible: boolean;
  }> {
    // Mock schema comparison
    const mockDifferences = {
      offices: [],
      doctors: [
        {
          type: 'column_modified' as const,
          field: 'phone',
          sourceValue: 'varchar(15)',
          destinationValue: 'varchar(20)'
        }
      ],
      patients: [],
      orders: [
        {
          type: 'column_added' as const,
          field: 'urgency_level',
          sourceValue: null,
          destinationValue: 'integer'
        }
      ]
    };

    const differences = mockDifferences[entityType as keyof typeof mockDifferences] || [];
    const isCompatible = differences.length === 0 ||
                        differences.every(diff => diff.type === 'column_added');

    return {
      sourceSchema: { table: entityType, columns: ['id', 'name', 'created_at'] },
      destinationSchema: { table: entityType, columns: ['id', 'name', 'created_at', 'updated_at'] },
      differences,
      isCompatible
    };
  }

  async identifyDataQualityIssues(entityType: string, sampleSize: number = 100): Promise<{
    entityType: string;
    sampleSize: number;
    issues: Array<{
      issueType: 'missing_required_field' | 'invalid_format' | 'constraint_violation' | 'orphaned_reference';
      recordId: string;
      field: string;
      description: string;
      severity: 'low' | 'medium' | 'high';
    }>;
    qualityScore: number; // 0-100
    recommendations: string[];
  }> {
    // Mock data quality analysis
    const mockIssues = {
      offices: [],
      doctors: [
        {
          issueType: 'invalid_format' as const,
          recordId: 'doctor-123',
          field: 'phone',
          description: 'Phone number format invalid: "555.123.4567"',
          severity: 'medium' as const
        }
      ],
      patients: [
        {
          issueType: 'missing_required_field' as const,
          recordId: 'patient-456',
          field: 'date_of_birth',
          description: 'Required field date_of_birth is null',
          severity: 'high' as const
        }
      ],
      orders: []
    };

    const issues = mockIssues[entityType as keyof typeof mockIssues] || [];
    const qualityScore = Math.max(0, 100 - (issues.length * 10));

    const recommendations: string[] = [];
    if (issues.length > 0) {
      recommendations.push(`Found ${issues.length} data quality issues - review and clean data before migration`);
      const highSeverityIssues = issues.filter(issue => issue.severity === 'high');
      if (highSeverityIssues.length > 0) {
        recommendations.push(`${highSeverityIssues.length} high severity issues must be resolved before migration`);
      }
    } else {
      recommendations.push('No data quality issues detected in sample');
    }

    return {
      entityType,
      sampleSize,
      issues,
      qualityScore,
      recommendations
    };
  }

  async testConnections(): Promise<{
    sourceConnection: { successful: boolean; error?: string; latencyMs?: number };
    destinationConnection: { successful: boolean; error?: string; latencyMs?: number };
  }> {
    // Mock connection testing
    return {
      sourceConnection: { successful: true, latencyMs: 25 },
      destinationConnection: { successful: true, latencyMs: 15 }
    };
  }
}

describe('BaselineAnalyzer Service', () => {
  let analyzer: MockBaselineAnalyzer;
  const mockSourceConfig: DatabaseConnectionConfig = {
    host: 'source-db.example.com',
    port: 5432,
    database: 'legacy_db',
    user: 'migration_user',
    password: 'secure_password',
    ssl: true
  };

  const mockDestinationConfig: DatabaseConnectionConfig = {
    host: 'destination-db.example.com',
    port: 5432,
    database: 'modern_db',
    user: 'migration_user',
    password: 'secure_password',
    ssl: true
  };

  beforeEach(() => {
    analyzer = new MockBaselineAnalyzer(mockSourceConfig, mockDestinationConfig);
  });

  describe('Configuration Validation', () => {
    test('should validate correct database configuration', () => {
      const validation = MockBaselineAnalyzer.validateConfig(mockSourceConfig);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should fail validation for missing required fields', () => {
      const invalidConfig = {
        host: '',
        port: 5432,
        database: '',
        user: 'user',
        password: ''
      };

      const validation = MockBaselineAnalyzer.validateConfig(invalidConfig);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('host is required');
      expect(validation.errors).toContain('database is required');
      expect(validation.errors).toContain('password is required');
    });

    test('should fail validation for invalid port', () => {
      const invalidConfig = {
        ...mockSourceConfig,
        port: 70000
      };

      const validation = MockBaselineAnalyzer.validateConfig(invalidConfig);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('port must be between 1 and 65535');
    });
  });

  describe('Entity Analysis', () => {
    test('should analyze entity record counts correctly', async () => {
      const result = await analyzer.analyzeEntity('doctors');

      expect(result).toBeDefined();
      expect(result.entityType).toBe('doctors');
      expect(result.sourceCount).toBeGreaterThan(0);
      expect(result.destinationCount).toBeGreaterThan(0);
      expect(result.recordGap).toBe(result.sourceCount - result.destinationCount);
      expect(result.gapPercentage).toBeGreaterThanOrEqual(0);
      expect(result.hasData).toBe(true);
      expect(result.analysisTimestamp).toBeInstanceOf(Date);
    });

    test('should handle entity with no data', async () => {
      const result = await analyzer.analyzeEntity('nonexistent_entity');

      expect(result.entityType).toBe('nonexistent_entity');
      expect(result.sourceCount).toBe(0);
      expect(result.destinationCount).toBe(0);
      expect(result.recordGap).toBe(0);
      expect(result.gapPercentage).toBe(0);
      expect(result.hasData).toBe(false);
      expect(result.lastMigrationTimestamp).toBeNull();
    });

    test('should calculate gap percentage correctly', async () => {
      const result = await analyzer.analyzeEntity('doctors');

      const expectedGapPercentage = Math.round(
        (result.recordGap / result.sourceCount) * 100 * 100
      ) / 100;

      expect(result.gapPercentage).toBe(expectedGapPercentage);
    });
  });

  describe('Mapping Validation', () => {
    test('should validate entity mappings correctly', async () => {
      const result = await analyzer.validateMappings('offices');

      expect(result).toBeDefined();
      expect(result.entityType).toBe('offices');
      expect(result.isValid).toBe(true);
      expect(result.missingMappings).toEqual([]);
      expect(result.orphanedMappings).toEqual([]);
      expect(result.schemaChanges).toEqual([]);
    });

    test('should identify mapping issues', async () => {
      const result = await analyzer.validateMappings('doctors');

      expect(result.entityType).toBe('doctors');
      expect(result.isValid).toBe(false);
      expect(result.missingMappings).toContain('specialty_id');
      expect(result.orphanedMappings).toContain('old_region_code');
      expect(result.schemaChanges).toHaveLength(1);
      expect(result.schemaChanges[0].field).toBe('phone');
      expect(result.schemaChanges[0].changeType).toBe('modified');
    });
  });

  describe('Baseline Report Generation', () => {
    test('should generate comprehensive baseline report', async () => {
      const entityTypes = ['offices', 'doctors', 'patients'];
      const sessionId = diffMigrationTestUtils.generateTestUUID();

      const report = await analyzer.generateBaselineReport(entityTypes, sessionId);

      expect(report).toBeDefined();
      expect(report.analysisId).toBeDefined();
      expect(report.sessionId).toBe(sessionId);
      expect(report.totalEntities).toBe(3);
      expect(report.entitiesAnalyzed).toEqual(entityTypes);
      expect(report.entityResults).toHaveLength(3);
      expect(report.mappingValidation).toHaveLength(3);
      expect(report.recommendations).toBeDefined();
      expect(report.summary).toBeDefined();
      expect(report.performanceMetrics).toBeDefined();
      expect(report.generatedAt).toBeInstanceOf(Date);
    });

    test('should calculate report summary correctly', async () => {
      const entityTypes = ['offices', 'doctors'];
      const report = await analyzer.generateBaselineReport(entityTypes);

      expect(report.summary.totalSourceRecords).toBeGreaterThan(0);
      expect(report.summary.totalDestinationRecords).toBeGreaterThan(0);
      expect(report.summary.overallGap).toBe(
        report.summary.totalSourceRecords - report.summary.totalDestinationRecords
      );
      expect(report.summary.entitiesWithGaps).toBeGreaterThanOrEqual(0);
      expect(report.summary.averageGapPercentage).toBeGreaterThanOrEqual(0);
    });

    test('should determine correct overall status', async () => {
      const healthyEntities = ['offices'];
      const healthyReport = await analyzer.generateBaselineReport(healthyEntities);
      expect(['healthy', 'gaps_detected']).toContain(healthyReport.overallStatus);

      const problematicEntities = ['doctors', 'orders'];
      const problematicReport = await analyzer.generateBaselineReport(problematicEntities);
      expect(['gaps_detected', 'critical_issues']).toContain(problematicReport.overallStatus);
    });

    test('should generate appropriate recommendations', async () => {
      const entityTypes = ['doctors', 'patients'];
      const report = await analyzer.generateBaselineReport(entityTypes);

      expect(report.recommendations).toBeDefined();
      expect(report.recommendations.length).toBeGreaterThan(0);
      expect(Array.isArray(report.recommendations)).toBe(true);
    });
  });

  describe('Schema Comparison', () => {
    test('should compare schema versions', async () => {
      const result = await analyzer.compareSchemaVersions('doctors');

      expect(result).toBeDefined();
      expect(result.sourceSchema).toBeDefined();
      expect(result.destinationSchema).toBeDefined();
      expect(result.differences).toBeDefined();
      expect(result.isCompatible).toBeDefined();
    });

    test('should identify schema differences', async () => {
      const result = await analyzer.compareSchemaVersions('orders');

      expect(result.differences).toHaveLength(1);
      expect(result.differences[0].type).toBe('column_added');
      expect(result.differences[0].field).toBe('urgency_level');
      expect(result.isCompatible).toBe(true); // Column addition is compatible
    });

    test('should handle entities with no schema differences', async () => {
      const result = await analyzer.compareSchemaVersions('offices');

      expect(result.differences).toHaveLength(0);
      expect(result.isCompatible).toBe(true);
    });
  });

  describe('Data Quality Analysis', () => {
    test('should identify data quality issues', async () => {
      const result = await analyzer.identifyDataQualityIssues('patients', 50);

      expect(result).toBeDefined();
      expect(result.entityType).toBe('patients');
      expect(result.sampleSize).toBe(50);
      expect(result.issues).toBeDefined();
      expect(result.qualityScore).toBeGreaterThanOrEqual(0);
      expect(result.qualityScore).toBeLessThanOrEqual(100);
      expect(result.recommendations).toBeDefined();
    });

    test('should calculate quality score correctly', async () => {
      const resultWithIssues = await analyzer.identifyDataQualityIssues('patients');
      expect(resultWithIssues.qualityScore).toBeLessThan(100);

      const resultWithoutIssues = await analyzer.identifyDataQualityIssues('offices');
      expect(resultWithoutIssues.qualityScore).toBe(100);
    });

    test('should provide appropriate recommendations', async () => {
      const result = await analyzer.identifyDataQualityIssues('doctors');

      expect(result.recommendations).toBeDefined();
      expect(result.recommendations.length).toBeGreaterThan(0);

      if (result.issues.length > 0) {
        expect(result.recommendations.some(rec => rec.includes('data quality issues'))).toBe(true);
      }
    });
  });

  describe('Connection Testing', () => {
    test('should test database connections', async () => {
      const result = await analyzer.testConnections();

      expect(result).toBeDefined();
      expect(result.sourceConnection).toBeDefined();
      expect(result.destinationConnection).toBeDefined();
      expect(result.sourceConnection.successful).toBe(true);
      expect(result.destinationConnection.successful).toBe(true);
      expect(result.sourceConnection.latencyMs).toBeGreaterThan(0);
      expect(result.destinationConnection.latencyMs).toBeGreaterThan(0);
    });
  });

  describe('Integration with Test Utilities', () => {
    test('should work with test utility helper', () => {
      const testData = diffMigrationTestUtils.createTestBaselineResult({
        entityType: 'test_entity',
        sourceCount: 100,
        destinationCount: 95
      });

      expect(testData.entityType).toBe('test_entity');
      expect(testData.sourceCount).toBe(100);
      expect(testData.destinationCount).toBe(95);
      expect(testData.recordGap).toBe(5);
    });
  });
});