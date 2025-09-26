/**
 * Unit Tests for Coverage Calculator Service
 */

import { CoverageCalculator } from '../../../src/migration-coverage/services/coverage-calculator';
import { MigrationScript, DataDomain, DataEntity, MigrationStatus } from '../../../src/migration-coverage/models';

describe('CoverageCalculator', () => {
  let calculator: CoverageCalculator;

  beforeEach(() => {
    calculator = new CoverageCalculator();
  });

  afterEach(() => {
    // Clear all scripts and entities
    const scriptsField = (calculator as any).scripts;
    const entitiesField = (calculator as any).entities;
    scriptsField.clear();
    entitiesField.clear();
  });

  describe('calculateOverallCoverage', () => {
    it('should return empty coverage when no scripts exist', () => {
      const coverage = calculator.calculateOverallCoverage();

      expect(coverage.overall).toBe(0);
      expect(coverage.byDomain.size).toBe(0);
      expect(coverage.byCategory.size).toBe(0);
      expect(coverage.byStatus.size).toBe(0);
    });

    it('should calculate correct overall coverage with completed scripts', () => {
      // Add test scripts
      const script1 = new MigrationScript({
        name: 'test-script-1',
        filePath: '/test/script1.ts',
        category: 'core',
        domain: DataDomain.CLINICAL,
        status: MigrationStatus.COMPLETED
      });

      const script2 = new MigrationScript({
        name: 'test-script-2',
        filePath: '/test/script2.ts',
        category: 'business',
        domain: DataDomain.BUSINESS,
        status: MigrationStatus.PENDING
      });

      calculator.addScript(script1);
      calculator.addScript(script2);

      const coverage = calculator.calculateOverallCoverage();

      expect(coverage.overall).toBe(0.5); // 1 of 2 completed
      expect(coverage.byDomain.size).toBe(2);
      expect(coverage.byCategory.size).toBe(2);
      expect(coverage.byStatus.size).toBe(2);
    });

    it('should calculate domain coverage correctly', () => {
      const clinicalScript1 = new MigrationScript({
        name: 'clinical-1',
        filePath: '/test/clinical1.ts',
        category: 'core',
        domain: DataDomain.CLINICAL,
        status: MigrationStatus.COMPLETED
      });

      const clinicalScript2 = new MigrationScript({
        name: 'clinical-2',
        filePath: '/test/clinical2.ts',
        category: 'core',
        domain: DataDomain.CLINICAL,
        status: MigrationStatus.COMPLETED
      });

      const businessScript = new MigrationScript({
        name: 'business-1',
        filePath: '/test/business1.ts',
        category: 'business',
        domain: DataDomain.BUSINESS,
        status: MigrationStatus.PENDING
      });

      calculator.addScript(clinicalScript1);
      calculator.addScript(clinicalScript2);
      calculator.addScript(businessScript);

      const coverage = calculator.calculateOverallCoverage();

      expect(coverage.byDomain.get(DataDomain.CLINICAL)).toBe(1.0); // 2/2 completed
      expect(coverage.byDomain.get(DataDomain.BUSINESS)).toBe(0.0); // 0/1 completed
    });
  });

  describe('calculateDomainCoverageDetails', () => {
    it('should return empty array when no scripts exist', () => {
      const domainCoverage = calculator.calculateDomainCoverageDetails();
      expect(domainCoverage).toEqual([]);
    });

    it('should calculate domain coverage details correctly', () => {
      const script1 = new MigrationScript({
        name: 'test-script-1',
        filePath: '/test/script1.ts',
        category: 'core',
        domain: DataDomain.CLINICAL,
        status: MigrationStatus.COMPLETED,
        estimatedRecords: 1000,
        recordsProcessed: 950,
        successRate: 0.95
      });

      const script2 = new MigrationScript({
        name: 'test-script-2',
        filePath: '/test/script2.ts',
        category: 'core',
        domain: DataDomain.CLINICAL,
        status: MigrationStatus.COMPLETED,
        estimatedRecords: 500,
        recordsProcessed: 480,
        successRate: 0.96
      });

      calculator.addScript(script1);
      calculator.addScript(script2);

      const domainCoverage = calculator.calculateDomainCoverageDetails();

      expect(domainCoverage).toHaveLength(1);
      const clinical = domainCoverage[0];
      expect(clinical.domain).toBe(DataDomain.CLINICAL);
      expect(clinical.totalScripts).toBe(2);
      expect(clinical.completedScripts).toBe(2);
      expect(clinical.totalRecords).toBe(1500);
      expect(clinical.migratedRecords).toBe(1430);
      expect(clinical.coverage).toBe(1.0);
      expect(clinical.averageSuccessRate).toBeCloseTo(0.955, 3);
    });

    it('should sort domain coverage by coverage descending', () => {
      const highCoverageScript = new MigrationScript({
        name: 'high-coverage',
        filePath: '/test/high.ts',
        category: 'core',
        domain: DataDomain.CLINICAL,
        status: MigrationStatus.COMPLETED
      });

      const lowCoverageScript1 = new MigrationScript({
        name: 'low-coverage-1',
        filePath: '/test/low1.ts',
        category: 'business',
        domain: DataDomain.BUSINESS,
        status: MigrationStatus.COMPLETED
      });

      const lowCoverageScript2 = new MigrationScript({
        name: 'low-coverage-2',
        filePath: '/test/low2.ts',
        category: 'business',
        domain: DataDomain.BUSINESS,
        status: MigrationStatus.PENDING
      });

      calculator.addScript(highCoverageScript);
      calculator.addScript(lowCoverageScript1);
      calculator.addScript(lowCoverageScript2);

      const domainCoverage = calculator.calculateDomainCoverageDetails();

      expect(domainCoverage).toHaveLength(2);
      expect(domainCoverage[0].domain).toBe(DataDomain.CLINICAL);
      expect(domainCoverage[0].coverage).toBe(1.0);
      expect(domainCoverage[1].domain).toBe(DataDomain.BUSINESS);
      expect(domainCoverage[1].coverage).toBe(0.5);
    });
  });

  describe('calculateEntityCoverage', () => {
    it('should return empty array when no entities exist', () => {
      const entityCoverage = calculator.calculateEntityCoverage();
      expect(entityCoverage).toEqual([]);
    });

    it('should calculate entity coverage correctly', () => {
      const entity1 = new DataEntity({
        name: 'patients',
        domainId: DataDomain.CLINICAL,
        totalRecords: 10000,
        migratedRecords: 9500,
        failedRecords: 200
      });

      const entity2 = new DataEntity({
        name: 'orders',
        domainId: DataDomain.BUSINESS,
        totalRecords: 5000,
        migratedRecords: 5000,
        failedRecords: 0
      });

      calculator.addEntity(entity1);
      calculator.addEntity(entity2);

      const entityCoverage = calculator.calculateEntityCoverage();

      expect(entityCoverage).toHaveLength(2);

      // Should be sorted by success rate descending
      expect(entityCoverage[0].entityName).toBe('orders');
      expect(entityCoverage[0].successRate).toBe(1.0);

      expect(entityCoverage[1].entityName).toBe('patients');
      expect(entityCoverage[1].successRate).toBe(0.95);
    });
  });

  describe('calculateWeightedCoverage', () => {
    it('should return 0 when no scripts exist', () => {
      const weightedCoverage = calculator.calculateWeightedCoverage();
      expect(weightedCoverage).toBe(0);
    });

    it('should calculate weighted coverage based on domain importance', () => {
      const clinicalScript = new MigrationScript({
        name: 'clinical-script',
        filePath: '/test/clinical.ts',
        category: 'core',
        domain: DataDomain.CLINICAL,
        status: MigrationStatus.COMPLETED,
        successRate: 0.95
      });

      const technicalScript = new MigrationScript({
        name: 'technical-script',
        filePath: '/test/technical.ts',
        category: 'system',
        domain: DataDomain.TECHNICAL,
        status: MigrationStatus.COMPLETED,
        successRate: 0.90
      });

      calculator.addScript(clinicalScript);
      calculator.addScript(technicalScript);

      const weightedCoverage = calculator.calculateWeightedCoverage();

      // Clinical scripts should have higher weight than technical
      expect(weightedCoverage).toBeGreaterThan(0.92);
      expect(weightedCoverage).toBeLessThan(0.95);
    });
  });

  describe('calculateMigrationVelocity', () => {
    it('should return 0 when no recent completions', () => {
      const velocity = calculator.calculateMigrationVelocity(7);
      expect(velocity).toBe(0);
    });

    it('should calculate velocity based on recent completions', async () => {
      const recentScript = new MigrationScript({
        name: 'recent-script',
        filePath: '/test/recent.ts',
        category: 'core',
        domain: DataDomain.CLINICAL,
        status: MigrationStatus.COMPLETED,
        lastExecuted: new Date().toISOString() // Just completed
      });

      const oldScript = new MigrationScript({
        name: 'old-script',
        filePath: '/test/old.ts',
        category: 'core',
        domain: DataDomain.CLINICAL,
        status: MigrationStatus.COMPLETED,
        lastExecuted: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() // 10 days ago
      });

      calculator.addScript(recentScript);
      calculator.addScript(oldScript);

      const velocity = calculator.calculateMigrationVelocity(7);

      expect(velocity).toBeCloseTo(1/7, 3); // 1 script in 7 days
    });
  });

  describe('calculateRiskScore', () => {
    it('should return 0 when no scripts exist', () => {
      const riskScore = calculator.calculateRiskScore();
      expect(riskScore).toBe(0);
    });

    it('should calculate risk based on failed and pending scripts', () => {
      const completedScript = new MigrationScript({
        name: 'completed',
        filePath: '/test/completed.ts',
        category: 'core',
        domain: DataDomain.CLINICAL,
        status: MigrationStatus.COMPLETED
      });

      const failedScript = new MigrationScript({
        name: 'failed',
        filePath: '/test/failed.ts',
        category: 'core',
        domain: DataDomain.CLINICAL,
        status: MigrationStatus.FAILED
      });

      const pendingScript = new MigrationScript({
        name: 'pending',
        filePath: '/test/pending.ts',
        category: 'core',
        domain: DataDomain.CLINICAL,
        status: MigrationStatus.PENDING
      });

      calculator.addScript(completedScript);
      calculator.addScript(failedScript);
      calculator.addScript(pendingScript);

      const riskScore = calculator.calculateRiskScore();

      expect(riskScore).toBeGreaterThan(0);
      expect(riskScore).toBeLessThanOrEqual(1);
    });
  });

  describe('generateCoverageReport', () => {
    it('should generate a complete coverage report', () => {
      const script = new MigrationScript({
        name: 'test-script',
        filePath: '/test/script.ts',
        category: 'core',
        domain: DataDomain.CLINICAL,
        status: MigrationStatus.COMPLETED,
        estimatedRecords: 1000,
        recordsProcessed: 950,
        successRate: 0.95
      });

      calculator.addScript(script);

      const report = calculator.generateCoverageReport();

      expect(report.totalScripts).toBe(1);
      expect(report.completedScripts).toBe(1);
      expect(report.totalRecords).toBe(1000);
      expect(report.migratedRecords).toBe(950);
      expect(report.overallSuccessRate).toBeGreaterThan(0);
      expect(report.clinicalCoverage).toBe(1.0);
      expect(report.businessCoverage).toBe(0);
      expect(report.communicationsCoverage).toBe(0);
      expect(report.technicalCoverage).toBe(0);
    });
  });

  describe('calculateCompletionEstimate', () => {
    it('should return 0 days when no pending scripts', () => {
      const completedScript = new MigrationScript({
        name: 'completed',
        filePath: '/test/completed.ts',
        category: 'core',
        domain: DataDomain.CLINICAL,
        status: MigrationStatus.COMPLETED
      });

      calculator.addScript(completedScript);

      const estimate = calculator.calculateCompletionEstimate();

      expect(estimate.estimatedDays).toBe(0);
      expect(estimate.confidence).toBe(1.0);
    });

    it('should estimate completion time based on velocity', () => {
      // Add a recently completed script to establish velocity
      const recentScript = new MigrationScript({
        name: 'recent',
        filePath: '/test/recent.ts',
        category: 'core',
        domain: DataDomain.CLINICAL,
        status: MigrationStatus.COMPLETED,
        lastExecuted: new Date().toISOString()
      });

      // Add pending scripts
      const pendingScript1 = new MigrationScript({
        name: 'pending-1',
        filePath: '/test/pending1.ts',
        category: 'core',
        domain: DataDomain.CLINICAL,
        status: MigrationStatus.PENDING
      });

      const pendingScript2 = new MigrationScript({
        name: 'pending-2',
        filePath: '/test/pending2.ts',
        category: 'core',
        domain: DataDomain.CLINICAL,
        status: MigrationStatus.PENDING
      });

      calculator.addScript(recentScript);
      calculator.addScript(pendingScript1);
      calculator.addScript(pendingScript2);

      const estimate = calculator.calculateCompletionEstimate();

      expect(estimate.estimatedDays).toBeGreaterThan(0);
      expect(estimate.confidence).toBeGreaterThan(0);
      expect(estimate.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('findBottlenecks', () => {
    it('should identify low coverage domains as bottlenecks', () => {
      const goodScript1 = new MigrationScript({
        name: 'good-1',
        filePath: '/test/good1.ts',
        category: 'core',
        domain: DataDomain.CLINICAL,
        status: MigrationStatus.COMPLETED,
        successRate: 0.99
      });

      const goodScript2 = new MigrationScript({
        name: 'good-2',
        filePath: '/test/good2.ts',
        category: 'core',
        domain: DataDomain.CLINICAL,
        status: MigrationStatus.COMPLETED,
        successRate: 0.98
      });

      const poorScript = new MigrationScript({
        name: 'poor',
        filePath: '/test/poor.ts',
        category: 'business',
        domain: DataDomain.BUSINESS,
        status: MigrationStatus.PENDING,
        successRate: 0.80
      });

      calculator.addScript(goodScript1);
      calculator.addScript(goodScript2);
      calculator.addScript(poorScript);

      const bottlenecks = calculator.findBottlenecks();

      expect(bottlenecks.length).toBeGreaterThan(0);

      const businessBottleneck = bottlenecks.find(b => b.domain === DataDomain.BUSINESS);
      expect(businessBottleneck).toBeDefined();
      expect(businessBottleneck?.issue).toContain('Low completion rate');
    });

    it('should sort bottlenecks by impact descending', () => {
      const highImpactScript = new MigrationScript({
        name: 'high-impact',
        filePath: '/test/high.ts',
        category: 'core',
        domain: DataDomain.CLINICAL,
        status: MigrationStatus.PENDING
      });

      const lowImpactScript = new MigrationScript({
        name: 'low-impact',
        filePath: '/test/low.ts',
        category: 'system',
        domain: DataDomain.TECHNICAL,
        status: MigrationStatus.PENDING
      });

      calculator.addScript(highImpactScript);
      calculator.addScript(lowImpactScript);

      const bottlenecks = calculator.findBottlenecks();

      if (bottlenecks.length > 1) {
        expect(bottlenecks[0].impact).toBeGreaterThanOrEqual(bottlenecks[1].impact);
      }
    });
  });

  describe('addScript and removeScript', () => {
    it('should add and remove scripts correctly', () => {
      const script = new MigrationScript({
        name: 'test-script',
        filePath: '/test/script.ts',
        category: 'core',
        domain: DataDomain.CLINICAL,
        status: MigrationStatus.PENDING
      });

      calculator.addScript(script);
      expect(calculator.calculateOverallCoverage().overall).toBe(0);

      calculator.removeScript(script.id);
      expect(calculator.calculateOverallCoverage().overall).toBe(0);
    });
  });

  describe('addEntity and removeEntity', () => {
    it('should add and remove entities correctly', () => {
      const entity = new DataEntity({
        name: 'test-entity',
        domainId: DataDomain.CLINICAL,
        totalRecords: 100,
        migratedRecords: 50,
        failedRecords: 10
      });

      calculator.addEntity(entity);
      expect(calculator.calculateEntityCoverage()).toHaveLength(1);

      calculator.removeEntity(entity.id);
      expect(calculator.calculateEntityCoverage()).toHaveLength(0);
    });
  });
});