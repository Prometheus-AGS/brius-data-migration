/**
 * Unit Tests for Report Generator Service
 */

import { promises as fs } from 'fs';
import { ReportGenerator } from '../../../src/migration-coverage/services/report-generator';
import { CoverageCalculator } from '../../../src/migration-coverage/services/coverage-calculator';
import { MigrationScript, DataEntity, MigrationMetrics, ExecutionLog, CoverageReport, DataDomain, MigrationStatus, OperationType, LogLevel } from '../../../src/migration-coverage/models';
import { ValidationResult, ValidationSummary, DataIntegrityCheck } from '../../../src/migration-coverage/services/data-validator';

// Mock fs promises
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    writeFile: jest.fn()
  }
}));

const mockMkdir = fs.mkdir as jest.MockedFunction<typeof fs.mkdir>;
const mockWriteFile = fs.writeFile as jest.MockedFunction<typeof fs.writeFile>;

describe('ReportGenerator', () => {
  let reportGenerator: ReportGenerator;
  let mockCoverageCalculator: jest.Mocked<CoverageCalculator>;

  beforeEach(() => {
    mockCoverageCalculator = {
      calculateDomainCoverageDetails: jest.fn(),
      calculateEntityCoverage: jest.fn(),
      findBottlenecks: jest.fn(),
      calculateCompletionEstimate: jest.fn(),
      calculateMigrationVelocity: jest.fn(),
      calculateRiskScore: jest.fn(),
      generateCoverageReport: jest.fn()
    } as any;

    reportGenerator = new ReportGenerator(mockCoverageCalculator, './test-reports');

    jest.clearAllMocks();
  });

  describe('generateExecutiveSummary', () => {
    it('should generate comprehensive executive summary', async () => {
      const mockScripts = [
        new MigrationScript({
          name: 'script1',
          filePath: '/test/script1.ts',
          category: 'core',
          domain: DataDomain.CLINICAL,
          status: MigrationStatus.COMPLETED
        }),
        new MigrationScript({
          name: 'script2',
          filePath: '/test/script2.ts',
          category: 'business',
          domain: DataDomain.BUSINESS,
          status: MigrationStatus.PENDING
        })
      ];

      const mockEntities = [
        new DataEntity({
          name: 'patients',
          domainId: DataDomain.CLINICAL,
          totalRecords: 1000,
          migratedRecords: 950,
          failedRecords: 50
        })
      ];

      const mockMetrics = [
        new MigrationMetrics({
          scriptId: 'script1',
          recordsProcessed: 1000,
          recordsSuccessful: 950,
          recordsFailed: 50,
          executionTimeMs: 5000,
          throughputPerSecond: 190
        })
      ];

      // Mock calculator methods
      mockCoverageCalculator.calculateDomainCoverageDetails.mockReturnValue([
        {
          domain: DataDomain.CLINICAL,
          totalScripts: 1,
          completedScripts: 1,
          totalRecords: 1000,
          migratedRecords: 950,
          averageSuccessRate: 0.95,
          coverage: 1.0
        },
        {
          domain: DataDomain.BUSINESS,
          totalScripts: 1,
          completedScripts: 0,
          totalRecords: 500,
          migratedRecords: 0,
          averageSuccessRate: 0,
          coverage: 0
        }
      ]);

      mockCoverageCalculator.calculateRiskScore.mockReturnValue(0.3);
      mockCoverageCalculator.calculateCompletionEstimate.mockReturnValue({
        estimatedDays: 5,
        confidence: 0.8
      });
      mockCoverageCalculator.calculateMigrationVelocity.mockReturnValue(1.2);
      mockCoverageCalculator.findBottlenecks.mockReturnValue([
        { domain: DataDomain.BUSINESS, issue: 'Low completion rate', impact: 5 }
      ]);

      const summary = await reportGenerator.generateExecutiveSummary(mockScripts, mockEntities, mockMetrics);

      expect(summary.totalScripts).toBe(2);
      expect(summary.completedScripts).toBe(1);
      expect(summary.overallProgress).toBe(0.5);
      expect(summary.totalRecordsMigrated).toBe(950);
      expect(summary.averageSuccessRate).toBe(0.95);
      expect(summary.riskLevel).toBe('medium');
      expect(summary.estimatedCompletion).toContain('5 days');
      expect(summary.keyMetrics.highestPerformingDomain).toBe(DataDomain.CLINICAL);
      expect(summary.keyMetrics.lowestPerformingDomain).toBe(DataDomain.BUSINESS);
      expect(summary.keyMetrics.criticalIssuesCount).toBe(0);
      expect(summary.keyMetrics.recentActivity).toBe(1.2);
    });

    it('should handle empty data gracefully', async () => {
      mockCoverageCalculator.calculateDomainCoverageDetails.mockReturnValue([]);
      mockCoverageCalculator.calculateRiskScore.mockReturnValue(0);
      mockCoverageCalculator.calculateCompletionEstimate.mockReturnValue({
        estimatedDays: Infinity,
        confidence: 0
      });
      mockCoverageCalculator.calculateMigrationVelocity.mockReturnValue(0);
      mockCoverageCalculator.findBottlenecks.mockReturnValue([]);

      const summary = await reportGenerator.generateExecutiveSummary([], [], []);

      expect(summary.totalScripts).toBe(0);
      expect(summary.completedScripts).toBe(0);
      expect(summary.overallProgress).toBe(0);
      expect(summary.totalRecordsMigrated).toBe(0);
      expect(summary.averageSuccessRate).toBe(0);
      expect(summary.riskLevel).toBe('low');
      expect(summary.estimatedCompletion).toBe('Unable to estimate');
      expect(summary.keyMetrics.highestPerformingDomain).toBe('None');
      expect(summary.keyMetrics.lowestPerformingDomain).toBe('None');
    });
  });

  describe('generateDetailedAnalytics', () => {
    it('should generate comprehensive detailed analytics', async () => {
      const mockScripts = [
        new MigrationScript({
          name: 'script1',
          filePath: '/test/script1.ts',
          category: 'core',
          domain: DataDomain.CLINICAL,
          status: MigrationStatus.COMPLETED
        })
      ];

      const mockEntities = [
        new DataEntity({
          name: 'patients',
          domainId: DataDomain.CLINICAL,
          totalRecords: 1000,
          migratedRecords: 950,
          failedRecords: 50
        })
      ];

      const mockMetrics = [
        new MigrationMetrics({
          scriptId: 'script1',
          executionDate: '2024-01-01T00:00:00.000Z',
          recordsProcessed: 1000,
          recordsSuccessful: 950,
          recordsFailed: 50,
          executionTimeMs: 5000,
          throughputPerSecond: 190
        })
      ];

      const mockLogs = [
        new ExecutionLog({
          operationType: OperationType.MIGRATE,
          level: LogLevel.INFO,
          message: 'Migration completed',
          timestamp: '2024-01-01T00:00:00.000Z'
        })
      ];

      mockCoverageCalculator.calculateDomainCoverageDetails.mockReturnValue([
        {
          domain: DataDomain.CLINICAL,
          totalScripts: 1,
          completedScripts: 1,
          totalRecords: 1000,
          migratedRecords: 950,
          averageSuccessRate: 0.95,
          coverage: 1.0
        }
      ]);

      mockCoverageCalculator.calculateEntityCoverage.mockReturnValue([
        {
          entityName: 'patients',
          domainId: DataDomain.CLINICAL,
          totalRecords: 1000,
          migratedRecords: 950,
          failedRecords: 50,
          successRate: 0.95,
          lastMigrated: '2024-01-01T00:00:00.000Z'
        }
      ]);

      mockCoverageCalculator.findBottlenecks.mockReturnValue([]);

      const analytics = await reportGenerator.generateDetailedAnalytics(
        mockScripts,
        mockEntities,
        mockMetrics,
        mockLogs
      );

      expect(analytics.domainBreakdown).toHaveLength(1);
      expect(analytics.entityPerformance).toHaveLength(1);
      expect(analytics.migrationTrends).toBeInstanceOf(Array);
      expect(analytics.performanceMetrics.averageExecutionTime).toBe(5000);
      expect(analytics.performanceMetrics.throughputPerSecond).toBe(190);
      expect(analytics.performanceMetrics.errorRate).toBeCloseTo(0.05, 2);
      expect(analytics.bottlenecks).toHaveLength(0);
    });

    it('should calculate migration trends correctly', async () => {
      const mockLogs = [
        new ExecutionLog({
          operationType: OperationType.MIGRATE,
          level: LogLevel.INFO,
          message: 'Migration started',
          timestamp: '2024-01-01T10:00:00.000Z'
        }),
        new ExecutionLog({
          operationType: OperationType.MIGRATE,
          level: LogLevel.INFO,
          message: 'Migration completed',
          timestamp: '2024-01-01T11:00:00.000Z'
        })
      ];

      const mockMetrics = [
        new MigrationMetrics({
          scriptId: 'script1',
          executionDate: '2024-01-01T10:30:00.000Z',
          recordsProcessed: 1000,
          recordsSuccessful: 950,
          recordsFailed: 50,
          executionTimeMs: 5000,
          throughputPerSecond: 190
        })
      ];

      mockCoverageCalculator.calculateDomainCoverageDetails.mockReturnValue([]);
      mockCoverageCalculator.calculateEntityCoverage.mockReturnValue([]);
      mockCoverageCalculator.findBottlenecks.mockReturnValue([]);

      const analytics = await reportGenerator.generateDetailedAnalytics([], [], mockMetrics, mockLogs);

      expect(analytics.migrationTrends).toHaveLength(1);
      expect(analytics.migrationTrends[0].date).toBe('2024-01-01');
      expect(analytics.migrationTrends[0].completedScripts).toBe(2);
      expect(analytics.migrationTrends[0].recordsMigrated).toBe(950);
      expect(analytics.migrationTrends[0].successRate).toBe(0.95);
    });
  });

  describe('generateValidationReport', () => {
    it('should generate comprehensive validation report', async () => {
      const mockValidationResults: ValidationResult[] = [
        {
          ruleId: 'rule1',
          ruleName: 'Critical Rule',
          passed: true,
          actualValue: 0,
          severity: 'critical',
          message: 'Validation passed',
          executionTime: 100
        },
        {
          ruleId: 'rule2',
          ruleName: 'Warning Rule',
          passed: false,
          actualValue: 5,
          expectedValue: 0,
          severity: 'warning',
          message: 'Validation failed',
          executionTime: 150
        },
        {
          ruleId: 'rule3',
          ruleName: 'Critical Failure',
          passed: false,
          actualValue: 10,
          expectedValue: 0,
          severity: 'critical',
          message: 'Critical validation failed',
          executionTime: 200
        }
      ];

      const mockSummary: ValidationSummary = {
        totalRules: 3,
        passedRules: 1,
        failedRules: 2,
        criticalFailures: 1,
        warningCount: 1,
        overallScore: 66.7,
        executionTime: 450
      };

      const mockIntegrityChecks: DataIntegrityCheck[] = [
        {
          entityName: 'patients',
          checkType: 'referential',
          passed: true,
          details: 'All patient references valid',
          affectedRecords: 0
        },
        {
          entityName: 'orders',
          checkType: 'completeness',
          passed: false,
          details: 'Missing required fields',
          affectedRecords: 25
        }
      ];

      const report = await reportGenerator.generateValidationReport(
        mockValidationResults,
        mockSummary,
        mockIntegrityChecks
      );

      expect(report).toContain('# Migration Validation Report');
      expect(report).toContain('**Total Rules Executed:** 3');
      expect(report).toContain('**Rules Passed:** 1');
      expect(report).toContain('**Rules Failed:** 2');
      expect(report).toContain('**Critical Failures:** 1');
      expect(report).toContain('**Overall Score:** 66.7%');
      expect(report).toContain('❌ Critical Failures (1)');
      expect(report).toContain('⚠️ Warnings (1)');
      expect(report).toContain('✅ Passed (1)');
      expect(report).toContain('## Data Integrity Checks');
      expect(report).toContain('Failed Integrity Checks (1)');
      expect(report).toContain('Passed Integrity Checks (1)');
    });

    it('should handle empty validation results', async () => {
      const mockSummary: ValidationSummary = {
        totalRules: 0,
        passedRules: 0,
        failedRules: 0,
        criticalFailures: 0,
        warningCount: 0,
        overallScore: 100,
        executionTime: 0
      };

      const report = await reportGenerator.generateValidationReport([], mockSummary, []);

      expect(report).toContain('**Total Rules Executed:** 0');
      expect(report).toContain('**Overall Score:** 100%');
      expect(report).toContain('✅ Passed (0)');
    });
  });

  describe('generateCoverageReport', () => {
    it('should generate reports in different formats', async () => {
      const mockCoverageReport = new CoverageReport({
        totalScripts: 10,
        completedScripts: 8,
        totalRecords: 10000,
        migratedRecords: 9500,
        overallSuccessRate: 0.95,
        clinicalCoverage: 1.0,
        businessCoverage: 0.8,
        communicationsCoverage: 0.6,
        technicalCoverage: 0.9
      });

      // Test JSON format
      const jsonReport = await reportGenerator.generateCoverageReport(mockCoverageReport, {
        format: 'json'
      });

      expect(jsonReport).toContain('"totalScripts": 10');
      expect(jsonReport).toContain('"completedScripts": 8');

      // Test Markdown format
      const markdownReport = await reportGenerator.generateCoverageReport(mockCoverageReport, {
        format: 'markdown'
      });

      expect(markdownReport).toContain('# Migration Coverage Report');
      expect(markdownReport).toContain('- **Total Scripts:** 10');
      expect(markdownReport).toContain('- **Completed Scripts:** 8');

      // Test HTML format
      const htmlReport = await reportGenerator.generateCoverageReport(mockCoverageReport, {
        format: 'html'
      });

      expect(htmlReport).toContain('<html>');
      expect(htmlReport).toContain('<h1>Migration Coverage Report</h1>');
      expect(htmlReport).toContain('8/10');

      // Test CSV format
      const csvReport = await reportGenerator.generateCoverageReport(mockCoverageReport, {
        format: 'csv'
      });

      expect(csvReport).toContain('Metric,Value');
      expect(csvReport).toContain('Total Scripts,10');
      expect(csvReport).toContain('Completed Scripts,8');
    });
  });

  describe('generateComprehensiveReport', () => {
    it('should generate comprehensive report with all data', async () => {
      const mockScripts = [
        new MigrationScript({
          name: 'test-script',
          filePath: '/test/script.ts',
          category: 'core',
          domain: DataDomain.CLINICAL,
          status: MigrationStatus.COMPLETED
        })
      ];

      const mockEntities = [
        new DataEntity({
          name: 'patients',
          domainId: DataDomain.CLINICAL,
          totalRecords: 1000,
          migratedRecords: 950,
          failedRecords: 50
        })
      ];

      const mockMetrics = [
        new MigrationMetrics({
          scriptId: 'test-script',
          recordsProcessed: 1000,
          recordsSuccessful: 950,
          recordsFailed: 50,
          executionTimeMs: 5000,
          throughputPerSecond: 190
        })
      ];

      const mockLogs = [
        new ExecutionLog({
          operationType: OperationType.MIGRATE,
          level: LogLevel.INFO,
          message: 'Migration completed',
          timestamp: new Date().toISOString()
        })
      ];

      const mockValidationResults: ValidationResult[] = [
        {
          ruleId: 'rule1',
          ruleName: 'Test Rule',
          passed: true,
          actualValue: 0,
          severity: 'critical',
          message: 'Validation passed',
          executionTime: 100
        }
      ];

      const mockValidationSummary: ValidationSummary = {
        totalRules: 1,
        passedRules: 1,
        failedRules: 0,
        criticalFailures: 0,
        warningCount: 0,
        overallScore: 100,
        executionTime: 100
      };

      const mockIntegrityChecks: DataIntegrityCheck[] = [
        {
          entityName: 'patients',
          checkType: 'referential',
          passed: true,
          details: 'All references valid',
          affectedRecords: 0
        }
      ];

      // Mock all calculator methods
      mockCoverageCalculator.calculateDomainCoverageDetails.mockReturnValue([
        {
          domain: DataDomain.CLINICAL,
          totalScripts: 1,
          completedScripts: 1,
          totalRecords: 1000,
          migratedRecords: 950,
          averageSuccessRate: 0.95,
          coverage: 1.0
        }
      ]);

      mockCoverageCalculator.calculateEntityCoverage.mockReturnValue([
        {
          entityName: 'patients',
          domainId: DataDomain.CLINICAL,
          totalRecords: 1000,
          migratedRecords: 950,
          failedRecords: 50,
          successRate: 0.95,
          lastMigrated: new Date().toISOString()
        }
      ]);

      mockCoverageCalculator.calculateRiskScore.mockReturnValue(0.1);
      mockCoverageCalculator.calculateCompletionEstimate.mockReturnValue({
        estimatedDays: 0,
        confidence: 1.0
      });
      mockCoverageCalculator.calculateMigrationVelocity.mockReturnValue(1.0);
      mockCoverageCalculator.findBottlenecks.mockReturnValue([]);

      const report = await reportGenerator.generateComprehensiveReport(
        mockScripts,
        mockEntities,
        mockMetrics,
        mockLogs,
        mockValidationResults,
        mockValidationSummary,
        mockIntegrityChecks,
        { includeDetails: true }
      );

      expect(report).toContain('# Comprehensive Migration Coverage Report');
      expect(report).toContain('## Executive Summary');
      expect(report).toContain('## Domain Analysis');
      expect(report).toContain('## Performance Analysis');
      expect(report).toContain('## Validation Summary');
      expect(report).toContain('## Top Entity Performance');
      expect(report).toContain('Migration Progress:** 100%');
      expect(report).toContain('Risk Level:** LOW');
    });
  });

  describe('saveReport', () => {
    it('should save report to file successfully', async () => {
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      const reportContent = '# Test Report\n\nThis is a test report.';
      const filename = 'test-report';

      const savedPath = await reportGenerator.saveReport(reportContent, filename, 'md');

      expect(mockMkdir).toHaveBeenCalledWith('./test-reports', { recursive: true });
      expect(mockWriteFile).toHaveBeenCalled();
      expect(savedPath).toContain('test-report');
      expect(savedPath).toContain('.md');
    });

    it('should handle file save errors', async () => {
      mockMkdir.mockRejectedValue(new Error('Permission denied'));

      const reportContent = '# Test Report';
      const filename = 'test-report';

      await expect(
        reportGenerator.saveReport(reportContent, filename, 'md')
      ).rejects.toThrow('Failed to save report');
    });
  });

  describe('private helper methods', () => {
    it('should generate migration trends correctly', () => {
      const reportGenerator = new ReportGenerator(mockCoverageCalculator);
      const generateTrends = (reportGenerator as any).generateMigrationTrends;

      const mockLogs = [
        new ExecutionLog({
          operationType: OperationType.MIGRATE,
          level: LogLevel.INFO,
          message: 'Migration completed',
          timestamp: '2024-01-01T10:00:00.000Z'
        })
      ];

      const mockMetrics = [
        new MigrationMetrics({
          scriptId: 'script1',
          executionDate: '2024-01-01T10:30:00.000Z',
          recordsProcessed: 1000,
          recordsSuccessful: 950,
          recordsFailed: 50,
          executionTimeMs: 5000,
          throughputPerSecond: 190
        })
      ];

      const trends = generateTrends(mockLogs, mockMetrics);

      expect(trends).toHaveLength(1);
      expect(trends[0].date).toBe('2024-01-01');
      expect(trends[0].recordsMigrated).toBe(950);
      expect(trends[0].successRate).toBe(0.95);
    });
  });
});