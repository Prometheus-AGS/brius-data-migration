/**
 * Unit Tests for Data Validator Service
 */

import { DataValidator, ValidationRule, ValidationResult } from '../../../src/migration-coverage/services/data-validator';
import { DataEntity } from '../../../src/migration-coverage/models';
import { Pool } from 'pg';

// Mock pg Pool
jest.mock('pg');

describe('DataValidator', () => {
  let validator: DataValidator;
  let mockSourcePool: jest.Mocked<Pool>;
  let mockTargetPool: jest.Mocked<Pool>;
  let mockClient: any;

  beforeEach(() => {
    // Setup mock client
    mockClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(),
      release: jest.fn()
    };

    // Setup mock pools
    mockSourcePool = {
      connect: jest.fn().mockResolvedValue(mockClient),
      query: jest.fn()
    } as any;

    mockTargetPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
      query: jest.fn()
    } as any;

    validator = new DataValidator(mockSourcePool, mockTargetPool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateEntity', () => {
    it('should validate an entity successfully', async () => {
      const entity = new DataEntity({
        name: 'patients',
        domainId: 'clinical',
        totalRecords: 1000,
        migratedRecords: 950,
        failedRecords: 50,
        targetTable: 'patients'
      });

      // Mock successful validation queries
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // No null primary keys
        .mockResolvedValueOnce({ rows: [{ duplicates: '0' }] }) // No duplicate keys
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }); // No missing legacy metadata

      const results = await validator.validateEntity(entity);

      expect(results).toBeInstanceOf(Array);
      expect(results.length).toBeGreaterThan(0);

      // Check that all validations passed
      const passedResults = results.filter(r => r.passed);
      expect(passedResults.length).toBeGreaterThan(0);
    });

    it('should detect validation failures', async () => {
      const entity = new DataEntity({
        name: 'patients',
        domainId: 'clinical',
        totalRecords: 1000,
        migratedRecords: 950,
        failedRecords: 50,
        targetTable: 'patients'
      });

      // Mock validation failures
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ count: '5' }] }) // 5 null primary keys
        .mockResolvedValueOnce({ rows: [{ duplicates: '2' }] }) // 2 duplicate keys
        .mockResolvedValueOnce({ rows: [{ count: '10' }] }); // 10 missing legacy metadata

      const results = await validator.validateEntity(entity);

      expect(results).toBeInstanceOf(Array);

      // Check that some validations failed
      const failedResults = results.filter(r => !r.passed);
      expect(failedResults.length).toBeGreaterThan(0);

      // Check specific failure details
      const nullPkFailure = failedResults.find(r => r.ruleId === 'null_primary_keys');
      expect(nullPkFailure).toBeDefined();
      expect(nullPkFailure?.actualValue).toBe(5);
    });

    it('should handle validation errors gracefully', async () => {
      const entity = new DataEntity({
        name: 'patients',
        domainId: 'clinical',
        totalRecords: 1000,
        migratedRecords: 950,
        failedRecords: 50,
        targetTable: 'patients'
      });

      // Mock database error
      mockClient.query.mockRejectedValue(new Error('Database connection failed'));

      const results = await validator.validateEntity(entity);

      expect(results).toBeInstanceOf(Array);
      expect(results.length).toBeGreaterThan(0);

      // All results should be failures due to the error
      const failedResults = results.filter(r => !r.passed);
      expect(failedResults.length).toBe(results.length);

      expect(failedResults[0].message).toContain('failed');
    });
  });

  describe('validateMigrationCompleteness', () => {
    it('should validate migration completeness successfully', async () => {
      // Mock successful integrity checks
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // Patient-office references OK
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // Order-patient references OK
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // Required fields OK
        .mockResolvedValueOnce({ rows: [{ duplicates: '0' }] }); // Uniqueness OK

      const checks = await validator.validateMigrationCompleteness('test-script-id');

      expect(checks).toBeInstanceOf(Array);
      expect(checks.length).toBeGreaterThan(0);

      // All checks should pass
      const passedChecks = checks.filter(c => c.passed);
      expect(passedChecks.length).toBe(checks.length);
    });

    it('should detect referential integrity issues', async () => {
      // Mock referential integrity failures
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ count: '5' }] }) // 5 orphaned patients
        .mockResolvedValueOnce({ rows: [{ count: '3' }] }) // 3 orphaned orders
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // Required fields OK
        .mockResolvedValueOnce({ rows: [{ duplicates: '0' }] }); // Uniqueness OK

      const checks = await validator.validateMigrationCompleteness('test-script-id');

      expect(checks).toBeInstanceOf(Array);

      const failedChecks = checks.filter(c => !c.passed);
      expect(failedChecks.length).toBeGreaterThan(0);

      const referentialFailures = failedChecks.filter(c => c.checkType === 'referential');
      expect(referentialFailures.length).toBeGreaterThan(0);
    });
  });

  describe('validateCrossEntityConsistency', () => {
    it('should validate cross-entity consistency', async () => {
      // Mock cross-entity validation queries
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // Office-patient consistency
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // Doctor-patient consistency
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }); // Order-patient consistency

      const results = await validator.validateCrossEntityConsistency();

      expect(results).toBeInstanceOf(Array);
      expect(results.length).toBeGreaterThan(0);

      // Check that results have expected structure
      results.forEach(result => {
        expect(result).toHaveProperty('ruleId');
        expect(result).toHaveProperty('ruleName');
        expect(result).toHaveProperty('passed');
        expect(result).toHaveProperty('actualValue');
        expect(result).toHaveProperty('severity');
        expect(result).toHaveProperty('message');
      });
    });

    it('should detect cross-entity inconsistencies', async () => {
      // Mock cross-entity validation failures
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ count: '2' }] }) // 2 invalid office references
        .mockResolvedValueOnce({ rows: [{ count: '1' }] }) // 1 invalid doctor reference
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }); // Order-patient OK

      const results = await validator.validateCrossEntityConsistency();

      const failedResults = results.filter(r => !r.passed);
      expect(failedResults.length).toBeGreaterThan(0);

      // Check critical failures are properly identified
      const criticalFailures = failedResults.filter(r => r.severity === 'critical');
      expect(criticalFailures.length).toBeGreaterThan(0);
    });
  });

  describe('generateValidationSummary', () => {
    it('should generate correct validation summary', async () => {
      const mockResults: ValidationResult[] = [
        {
          ruleId: 'test-rule-1',
          ruleName: 'Test Rule 1',
          passed: true,
          actualValue: 0,
          severity: 'critical',
          message: 'Test passed',
          executionTime: 100
        },
        {
          ruleId: 'test-rule-2',
          ruleName: 'Test Rule 2',
          passed: false,
          actualValue: 5,
          severity: 'critical',
          message: 'Test failed',
          executionTime: 150
        },
        {
          ruleId: 'test-rule-3',
          ruleName: 'Test Rule 3',
          passed: false,
          actualValue: 2,
          severity: 'warning',
          message: 'Test warning',
          executionTime: 75
        }
      ];

      const summary = await validator.generateValidationSummary(mockResults);

      expect(summary.totalRules).toBe(3);
      expect(summary.passedRules).toBe(1);
      expect(summary.failedRules).toBe(2);
      expect(summary.criticalFailures).toBe(1);
      expect(summary.warningCount).toBe(1);
      expect(summary.executionTime).toBe(325);
      expect(summary.overallScore).toBeGreaterThan(0);
      expect(summary.overallScore).toBeLessThan(100);
    });

    it('should calculate perfect score for all passing validations', async () => {
      const mockResults: ValidationResult[] = [
        {
          ruleId: 'test-rule-1',
          ruleName: 'Test Rule 1',
          passed: true,
          actualValue: 0,
          severity: 'critical',
          message: 'Test passed',
          executionTime: 100
        },
        {
          ruleId: 'test-rule-2',
          ruleName: 'Test Rule 2',
          passed: true,
          actualValue: 0,
          severity: 'warning',
          message: 'Test passed',
          executionTime: 50
        }
      ];

      const summary = await validator.generateValidationSummary(mockResults);

      expect(summary.totalRules).toBe(2);
      expect(summary.passedRules).toBe(2);
      expect(summary.failedRules).toBe(0);
      expect(summary.criticalFailures).toBe(0);
      expect(summary.warningCount).toBe(0);
      expect(summary.overallScore).toBeCloseTo(100, 1);
    });
  });

  describe('validateDataConsistency', () => {
    it('should validate data consistency between source and target', async () => {
      // Mock record count queries
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ count: '1000' }] }) // Source count
        .mockResolvedValueOnce({ rows: [{ count: '1000' }] }); // Target count

      const result = await validator.validateDataConsistency('dispatch_patients', 'patients');

      expect(result.ruleId).toBe('consistency_dispatch_patients');
      expect(result.passed).toBe(true);
      expect(result.actualValue).toBe(1000);
      expect(result.expectedValue).toBe(1000);
      expect(result.severity).toBe('critical');
      expect(result.executionTime).toBeGreaterThan(0);
    });

    it('should detect record count mismatches', async () => {
      // Mock mismatched record counts
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ count: '1000' }] }) // Source count
        .mockResolvedValueOnce({ rows: [{ count: '950' }] }); // Target count (missing 50)

      const result = await validator.validateDataConsistency('dispatch_patients', 'patients');

      expect(result.passed).toBe(false);
      expect(result.actualValue).toBe(950);
      expect(result.expectedValue).toBe(1000);
      expect(result.message).toContain('mismatch');
      expect(result.message).toContain('expected 1000, got 950');
    });

    it('should handle database errors gracefully', async () => {
      mockClient.query.mockRejectedValue(new Error('Connection timeout'));

      const result = await validator.validateDataConsistency('dispatch_patients', 'patients');

      expect(result.passed).toBe(false);
      expect(result.actualValue).toBe(0);
      expect(result.message).toContain('failed');
      expect(result.message).toContain('Connection timeout');
    });
  });

  describe('validateBusinessRules', () => {
    it('should validate entity-specific business rules', async () => {
      // Mock business rule validation
      mockClient.query.mockResolvedValue({ rows: [{ count: '0' }] });

      const results = await validator.validateBusinessRules('patients');

      expect(results).toBeInstanceOf(Array);

      if (results.length > 0) {
        results.forEach(result => {
          expect(result).toHaveProperty('ruleId');
          expect(result).toHaveProperty('passed');
          expect(result).toHaveProperty('severity');
          expect(result.executionTime).toBeGreaterThan(0);
        });
      }
    });

    it('should detect business rule violations', async () => {
      // Mock business rule failures
      mockClient.query.mockResolvedValue({ rows: [{ count: '5' }] });

      const results = await validator.validateBusinessRules('patients');

      if (results.length > 0) {
        const failedResults = results.filter(r => !r.passed);
        expect(failedResults.length).toBeGreaterThan(0);

        failedResults.forEach(result => {
          expect(result.actualValue).toBe(5);
          expect(result.message).toContain('violation');
        });
      }
    });

    it('should return empty array for unknown entities', () => {
      const results = validator.validateBusinessRules('unknown_entity');
      expect(results).resolves.toEqual([]);
    });
  });

  describe('error handling', () => {
    it('should handle pool connection errors', async () => {
      mockTargetPool.connect.mockRejectedValue(new Error('Pool exhausted'));

      const entity = new DataEntity({
        name: 'test-entity',
        domainId: 'test',
        totalRecords: 100,
        migratedRecords: 50,
        failedRecords: 10
      });

      const results = await validator.validateEntity(entity);

      expect(results).toBeInstanceOf(Array);
      expect(results.length).toBeGreaterThan(0);

      // All results should be failures due to connection error
      const failedResults = results.filter(r => !r.passed);
      expect(failedResults.length).toBe(results.length);
    });

    it('should handle client release errors gracefully', async () => {
      mockClient.release.mockImplementation(() => {
        throw new Error('Release failed');
      });

      const entity = new DataEntity({
        name: 'test-entity',
        domainId: 'test',
        totalRecords: 100,
        migratedRecords: 50,
        failedRecords: 10
      });

      // Should not throw despite client release error
      await expect(validator.validateEntity(entity)).resolves.toBeDefined();
    });
  });

  describe('validation rule evaluation', () => {
    it('should evaluate "zero" expected result correctly', () => {
      const validator = new DataValidator(mockSourcePool, mockTargetPool);
      const evaluateRule = (validator as any).evaluateRule;

      const rule: ValidationRule = {
        id: 'test-rule',
        name: 'Test Rule',
        description: 'Test',
        query: 'SELECT COUNT(*)',
        expectedResult: 'zero',
        severity: 'critical'
      };

      expect(evaluateRule(rule, 0)).toBe(true);
      expect(evaluateRule(rule, 1)).toBe(false);
      expect(evaluateRule(rule, -1)).toBe(false);
    });

    it('should evaluate "positive" expected result correctly', () => {
      const validator = new DataValidator(mockSourcePool, mockTargetPool);
      const evaluateRule = (validator as any).evaluateRule;

      const rule: ValidationRule = {
        id: 'test-rule',
        name: 'Test Rule',
        description: 'Test',
        query: 'SELECT COUNT(*)',
        expectedResult: 'positive',
        severity: 'critical'
      };

      expect(evaluateRule(rule, 1)).toBe(true);
      expect(evaluateRule(rule, 100)).toBe(true);
      expect(evaluateRule(rule, 0)).toBe(false);
      expect(evaluateRule(rule, -1)).toBe(false);
    });

    it('should evaluate "equals" expected result correctly', () => {
      const validator = new DataValidator(mockSourcePool, mockTargetPool);
      const evaluateRule = (validator as any).evaluateRule;

      const rule: ValidationRule = {
        id: 'test-rule',
        name: 'Test Rule',
        description: 'Test',
        query: 'SELECT COUNT(*)',
        expectedResult: 'equals',
        threshold: 50,
        severity: 'critical'
      };

      expect(evaluateRule(rule, 50)).toBe(true);
      expect(evaluateRule(rule, 49)).toBe(false);
      expect(evaluateRule(rule, 51)).toBe(false);
    });

    it('should evaluate "custom" expected result correctly', () => {
      const validator = new DataValidator(mockSourcePool, mockTargetPool);
      const evaluateRule = (validator as any).evaluateRule;

      const rule: ValidationRule = {
        id: 'test-rule',
        name: 'Test Rule',
        description: 'Test',
        query: 'SELECT COUNT(*)',
        expectedResult: 'custom',
        threshold: 10,
        severity: 'critical'
      };

      expect(evaluateRule(rule, 5)).toBe(true);
      expect(evaluateRule(rule, 10)).toBe(true);
      expect(evaluateRule(rule, 15)).toBe(false);
    });
  });
});