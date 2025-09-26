/**
 * Report Generator Service
 *
 * Generates comprehensive migration reports, summaries, and analytics.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import {
  MigrationScript,
  DataDomain,
  DataEntity,
  CoverageReport,
  MigrationMetrics,
  ExecutionLog
} from '../models';
import { CoverageCalculator, DomainCoverage, EntityCoverage } from './coverage-calculator';
import { ValidationResult, ValidationSummary, DataIntegrityCheck } from './data-validator';

export interface ReportOptions {
  includeCharts?: boolean;
  includeDetails?: boolean;
  format?: 'html' | 'markdown' | 'json' | 'csv';
  outputPath?: string;
}

export interface ExecutiveSummary {
  totalScripts: number;
  completedScripts: number;
  overallProgress: number;
  totalRecordsMigrated: number;
  averageSuccessRate: number;
  riskLevel: 'low' | 'medium' | 'high';
  estimatedCompletion: string;
  keyMetrics: {
    highestPerformingDomain: string;
    lowestPerformingDomain: string;
    criticalIssuesCount: number;
    recentActivity: number;
  };
}

export interface DetailedAnalytics {
  domainBreakdown: DomainCoverage[];
  entityPerformance: EntityCoverage[];
  migrationTrends: {
    date: string;
    completedScripts: number;
    recordsMigrated: number;
    successRate: number;
  }[];
  performanceMetrics: {
    averageExecutionTime: number;
    throughputPerSecond: number;
    errorRate: number;
  };
  bottlenecks: {
    domain: string;
    issue: string;
    impact: number;
  }[];
}

export class ReportGenerator {
  private readonly coverageCalculator: CoverageCalculator;
  private readonly outputDirectory: string;

  constructor(coverageCalculator: CoverageCalculator, outputDirectory: string = './reports') {
    this.coverageCalculator = coverageCalculator;
    this.outputDirectory = outputDirectory;
  }

  public async generateExecutiveSummary(
    scripts: MigrationScript[],
    entities: DataEntity[],
    metrics: MigrationMetrics[]
  ): Promise<ExecutiveSummary> {
    const completedScripts = scripts.filter(s => s.status === 'completed');
    const totalRecordsMigrated = metrics.reduce((sum, m) => sum + m.recordsSuccessful, 0);
    const successRates = metrics
      .map(m => m.getSuccessRate())
      .filter(rate => rate > 0);

    const averageSuccessRate = successRates.length > 0
      ? successRates.reduce((sum, rate) => sum + rate, 0) / successRates.length
      : 0;

    const domainCoverage = this.coverageCalculator.calculateDomainCoverageDetails();
    const sortedDomains = domainCoverage.sort((a, b) => b.coverage - a.coverage);

    const riskScore = this.coverageCalculator.calculateRiskScore();
    const riskLevel = riskScore < 0.3 ? 'low' : riskScore < 0.6 ? 'medium' : 'high';

    const completion = this.coverageCalculator.calculateCompletionEstimate();
    const estimatedCompletion = completion.estimatedDays === Infinity
      ? 'Unable to estimate'
      : `${completion.estimatedDays} days (${Math.round(completion.confidence * 100)}% confidence)`;

    const recentActivity = this.coverageCalculator.calculateMigrationVelocity(7);
    const bottlenecks = this.coverageCalculator.findBottlenecks();

    return {
      totalScripts: scripts.length,
      completedScripts: completedScripts.length,
      overallProgress: scripts.length > 0 ? completedScripts.length / scripts.length : 0,
      totalRecordsMigrated,
      averageSuccessRate,
      riskLevel,
      estimatedCompletion,
      keyMetrics: {
        highestPerformingDomain: sortedDomains[0]?.domain || 'None',
        lowestPerformingDomain: sortedDomains[sortedDomains.length - 1]?.domain || 'None',
        criticalIssuesCount: bottlenecks.filter(b => b.impact > 5).length,
        recentActivity: Math.round(recentActivity * 10) / 10
      }
    };
  }

  public async generateDetailedAnalytics(
    scripts: MigrationScript[],
    entities: DataEntity[],
    metrics: MigrationMetrics[],
    logs: ExecutionLog[]
  ): Promise<DetailedAnalytics> {
    const domainBreakdown = this.coverageCalculator.calculateDomainCoverageDetails();
    const entityPerformance = this.coverageCalculator.calculateEntityCoverage();

    // Generate migration trends
    const trends = this.generateMigrationTrends(logs, metrics);

    // Calculate performance metrics
    const executionTimes = metrics.map(m => m.executionTimeMs).filter(t => t > 0);
    const throughputs = metrics.map(m => m.throughputPerSecond).filter(t => t > 0);
    const errorCounts = metrics.map(m => m.recordsFailed);

    const performanceMetrics = {
      averageExecutionTime: executionTimes.length > 0
        ? executionTimes.reduce((sum, t) => sum + t, 0) / executionTimes.length
        : 0,
      throughputPerSecond: throughputs.length > 0
        ? throughputs.reduce((sum, t) => sum + t, 0) / throughputs.length
        : 0,
      errorRate: metrics.length > 0
        ? errorCounts.reduce((sum, c) => sum + c, 0) / metrics.reduce((sum, m) => sum + m.recordsProcessed, 1)
        : 0
    };

    const bottlenecks = this.coverageCalculator.findBottlenecks();

    return {
      domainBreakdown,
      entityPerformance,
      migrationTrends: trends,
      performanceMetrics,
      bottlenecks
    };
  }

  public async generateValidationReport(
    validationResults: ValidationResult[],
    validationSummary: ValidationSummary,
    integrityChecks: DataIntegrityCheck[]
  ): Promise<string> {
    const timestamp = new Date().toISOString();

    let report = `# Migration Validation Report\n\n`;
    report += `**Generated:** ${timestamp}\n\n`;

    // Summary section
    report += `## Executive Summary\n\n`;
    report += `- **Total Rules Executed:** ${validationSummary.totalRules}\n`;
    report += `- **Rules Passed:** ${validationSummary.passedRules}\n`;
    report += `- **Rules Failed:** ${validationSummary.failedRules}\n`;
    report += `- **Critical Failures:** ${validationSummary.criticalFailures}\n`;
    report += `- **Warnings:** ${validationSummary.warningCount}\n`;
    report += `- **Overall Score:** ${validationSummary.overallScore}%\n`;
    report += `- **Execution Time:** ${validationSummary.executionTime}ms\n\n`;

    // Validation results
    report += `## Detailed Validation Results\n\n`;

    const criticalFailures = validationResults.filter(r => !r.passed && r.severity === 'critical');
    const warnings = validationResults.filter(r => !r.passed && r.severity === 'warning');
    const passed = validationResults.filter(r => r.passed);

    if (criticalFailures.length > 0) {
      report += `### ❌ Critical Failures (${criticalFailures.length})\n\n`;
      criticalFailures.forEach(result => {
        report += `- **${result.ruleName}**: ${result.message}\n`;
        if (result.expectedValue !== undefined) {
          report += `  - Expected: ${result.expectedValue}, Actual: ${result.actualValue}\n`;
        }
      });
      report += `\n`;
    }

    if (warnings.length > 0) {
      report += `### ⚠️ Warnings (${warnings.length})\n\n`;
      warnings.forEach(result => {
        report += `- **${result.ruleName}**: ${result.message}\n`;
      });
      report += `\n`;
    }

    report += `### ✅ Passed (${passed.length})\n\n`;
    passed.forEach(result => {
      report += `- **${result.ruleName}**: ${result.message}\n`;
    });

    // Integrity checks
    if (integrityChecks.length > 0) {
      report += `\n## Data Integrity Checks\n\n`;

      const failedChecks = integrityChecks.filter(c => !c.passed);
      const passedChecks = integrityChecks.filter(c => c.passed);

      if (failedChecks.length > 0) {
        report += `### Failed Integrity Checks (${failedChecks.length})\n\n`;
        failedChecks.forEach(check => {
          report += `- **${check.entityName}** (${check.checkType}): ${check.details}\n`;
          report += `  - Affected Records: ${check.affectedRecords}\n`;
        });
        report += `\n`;
      }

      report += `### Passed Integrity Checks (${passedChecks.length})\n\n`;
      passedChecks.forEach(check => {
        report += `- **${check.entityName}** (${check.checkType}): ${check.details}\n`;
      });
    }

    return report;
  }

  public async generateCoverageReport(
    coverageReport: CoverageReport,
    options: ReportOptions = {}
  ): Promise<string> {
    const format = options.format || 'markdown';

    switch (format) {
      case 'html':
        return this.generateHTMLCoverageReport(coverageReport, options);
      case 'json':
        return JSON.stringify(coverageReport.toJSON(), null, 2);
      case 'csv':
        return this.generateCSVCoverageReport(coverageReport);
      default:
        return this.generateMarkdownCoverageReport(coverageReport, options);
    }
  }

  public async saveReport(content: string, filename: string, format: string = 'md'): Promise<string> {
    try {
      await fs.mkdir(this.outputDirectory, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fullFilename = `${filename}_${timestamp}.${format}`;
      const filepath = join(this.outputDirectory, fullFilename);

      await fs.writeFile(filepath, content, 'utf-8');
      return filepath;
    } catch (error) {
      throw new Error(`Failed to save report: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  public async generateComprehensiveReport(
    scripts: MigrationScript[],
    entities: DataEntity[],
    metrics: MigrationMetrics[],
    logs: ExecutionLog[],
    validationResults: ValidationResult[],
    validationSummary: ValidationSummary,
    integrityChecks: DataIntegrityCheck[],
    options: ReportOptions = {}
  ): Promise<string> {
    const timestamp = new Date().toISOString();
    const executiveSummary = await this.generateExecutiveSummary(scripts, entities, metrics);
    const detailedAnalytics = await this.generateDetailedAnalytics(scripts, entities, metrics, logs);

    let report = `# Comprehensive Migration Coverage Report\n\n`;
    report += `**Generated:** ${timestamp}\n\n`;

    // Executive Summary
    report += `## Executive Summary\n\n`;
    report += `### Overall Progress\n`;
    report += `- **Migration Progress:** ${Math.round(executiveSummary.overallProgress * 100)}%\n`;
    report += `- **Scripts Completed:** ${executiveSummary.completedScripts}/${executiveSummary.totalScripts}\n`;
    report += `- **Records Migrated:** ${executiveSummary.totalRecordsMigrated.toLocaleString()}\n`;
    report += `- **Average Success Rate:** ${Math.round(executiveSummary.averageSuccessRate * 100)}%\n`;
    report += `- **Risk Level:** ${executiveSummary.riskLevel.toUpperCase()}\n`;
    report += `- **Estimated Completion:** ${executiveSummary.estimatedCompletion}\n\n`;

    report += `### Key Metrics\n`;
    report += `- **Best Performing Domain:** ${executiveSummary.keyMetrics.highestPerformingDomain}\n`;
    report += `- **Needs Attention:** ${executiveSummary.keyMetrics.lowestPerformingDomain}\n`;
    report += `- **Critical Issues:** ${executiveSummary.keyMetrics.criticalIssuesCount}\n`;
    report += `- **Recent Activity:** ${executiveSummary.keyMetrics.recentActivity} scripts/day\n\n`;

    // Domain Breakdown
    report += `## Domain Analysis\n\n`;
    detailedAnalytics.domainBreakdown.forEach(domain => {
      report += `### ${domain.domain}\n`;
      report += `- **Coverage:** ${Math.round(domain.coverage * 100)}%\n`;
      report += `- **Scripts:** ${domain.completedScripts}/${domain.totalScripts}\n`;
      report += `- **Records:** ${domain.migratedRecords.toLocaleString()}/${domain.totalRecords.toLocaleString()}\n`;
      report += `- **Success Rate:** ${Math.round(domain.averageSuccessRate * 100)}%\n\n`;
    });

    // Performance Metrics
    report += `## Performance Analysis\n\n`;
    report += `- **Average Execution Time:** ${Math.round(detailedAnalytics.performanceMetrics.averageExecutionTime)}ms\n`;
    report += `- **Average Throughput:** ${Math.round(detailedAnalytics.performanceMetrics.throughputPerSecond)} records/sec\n`;
    report += `- **Error Rate:** ${Math.round(detailedAnalytics.performanceMetrics.errorRate * 10000) / 100}%\n\n`;

    // Bottlenecks
    if (detailedAnalytics.bottlenecks.length > 0) {
      report += `## Issues & Bottlenecks\n\n`;
      detailedAnalytics.bottlenecks.forEach((bottleneck, index) => {
        report += `${index + 1}. **${bottleneck.domain}**: ${bottleneck.issue} (Impact: ${bottleneck.impact})\n`;
      });
      report += `\n`;
    }

    // Validation Summary
    report += `## Validation Summary\n\n`;
    report += `- **Overall Score:** ${validationSummary.overallScore}%\n`;
    report += `- **Rules Passed:** ${validationSummary.passedRules}/${validationSummary.totalRules}\n`;
    report += `- **Critical Failures:** ${validationSummary.criticalFailures}\n`;
    report += `- **Warnings:** ${validationSummary.warningCount}\n\n`;

    // Entity Performance (top 10)
    if (options.includeDetails) {
      report += `## Top Entity Performance\n\n`;
      const topEntities = detailedAnalytics.entityPerformance.slice(0, 10);
      topEntities.forEach((entity, index) => {
        report += `${index + 1}. **${entity.entityName}**: ${Math.round(entity.successRate * 100)}% `;
        report += `(${entity.migratedRecords.toLocaleString()}/${entity.totalRecords.toLocaleString()} records)\n`;
      });
      report += `\n`;
    }

    return report;
  }

  private generateMigrationTrends(logs: ExecutionLog[], metrics: MigrationMetrics[]): {
    date: string;
    completedScripts: number;
    recordsMigrated: number;
    successRate: number;
  }[] {
    const trendsMap = new Map<string, {
      completedScripts: number;
      totalRecords: number;
      successfulRecords: number;
    }>();

    // Process logs
    logs.forEach(log => {
      const date = log.timestamp.split('T')[0];
      if (!trendsMap.has(date)) {
        trendsMap.set(date, { completedScripts: 0, totalRecords: 0, successfulRecords: 0 });
      }

      const trend = trendsMap.get(date)!;
      if (log.operationType === 'migrate' && log.level === 'info') {
        trend.completedScripts++;
      }
    });

    // Process metrics
    metrics.forEach(metric => {
      const date = metric.executionDate.split('T')[0];
      if (!trendsMap.has(date)) {
        trendsMap.set(date, { completedScripts: 0, totalRecords: 0, successfulRecords: 0 });
      }

      const trend = trendsMap.get(date)!;
      trend.totalRecords += metric.recordsProcessed;
      trend.successfulRecords += metric.recordsSuccessful;
    });

    // Convert to array and calculate success rates
    return Array.from(trendsMap.entries())
      .map(([date, data]) => ({
        date,
        completedScripts: data.completedScripts,
        recordsMigrated: data.successfulRecords,
        successRate: data.totalRecords > 0 ? data.successfulRecords / data.totalRecords : 0
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  private generateMarkdownCoverageReport(coverageReport: CoverageReport, options: ReportOptions): string {
    let report = `# Migration Coverage Report\n\n`;
    report += `**Generated:** ${coverageReport.reportDate}\n\n`;

    report += `## Summary\n\n`;
    report += `- **Total Scripts:** ${coverageReport.totalScripts}\n`;
    report += `- **Completed Scripts:** ${coverageReport.completedScripts}\n`;
    report += `- **Total Records:** ${coverageReport.totalRecords.toLocaleString()}\n`;
    report += `- **Migrated Records:** ${coverageReport.migratedRecords.toLocaleString()}\n`;
    report += `- **Overall Success Rate:** ${Math.round(coverageReport.overallSuccessRate * 100)}%\n\n`;

    report += `## Domain Coverage\n\n`;
    report += `- **Clinical:** ${Math.round(coverageReport.clinicalCoverage * 100)}%\n`;
    report += `- **Business:** ${Math.round(coverageReport.businessCoverage * 100)}%\n`;
    report += `- **Communications:** ${Math.round(coverageReport.communicationsCoverage * 100)}%\n`;
    report += `- **Technical:** ${Math.round(coverageReport.technicalCoverage * 100)}%\n\n`;

    return report;
  }

  private generateHTMLCoverageReport(coverageReport: CoverageReport, options: ReportOptions): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Migration Coverage Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .summary { background: #f5f5f5; padding: 20px; border-radius: 5px; }
        .metric { display: inline-block; margin: 10px; padding: 15px; background: white; border-radius: 5px; }
        .domain { margin: 10px 0; }
        .progress-bar { width: 100%; height: 20px; background: #eee; border-radius: 10px; overflow: hidden; }
        .progress-fill { height: 100%; background: linear-gradient(90deg, #ff4444, #ffaa00, #00aa44); }
    </style>
</head>
<body>
    <h1>Migration Coverage Report</h1>
    <p><strong>Generated:</strong> ${coverageReport.reportDate}</p>

    <div class="summary">
        <h2>Summary</h2>
        <div class="metric">
            <h3>${coverageReport.completedScripts}/${coverageReport.totalScripts}</h3>
            <p>Scripts Completed</p>
        </div>
        <div class="metric">
            <h3>${coverageReport.migratedRecords.toLocaleString()}</h3>
            <p>Records Migrated</p>
        </div>
        <div class="metric">
            <h3>${Math.round(coverageReport.overallSuccessRate * 100)}%</h3>
            <p>Success Rate</p>
        </div>
    </div>

    <h2>Domain Coverage</h2>
    <div class="domain">
        <p><strong>Clinical:</strong> ${Math.round(coverageReport.clinicalCoverage * 100)}%</p>
        <div class="progress-bar">
            <div class="progress-fill" style="width: ${coverageReport.clinicalCoverage * 100}%"></div>
        </div>
    </div>
    <div class="domain">
        <p><strong>Business:</strong> ${Math.round(coverageReport.businessCoverage * 100)}%</p>
        <div class="progress-bar">
            <div class="progress-fill" style="width: ${coverageReport.businessCoverage * 100}%"></div>
        </div>
    </div>
    <div class="domain">
        <p><strong>Communications:</strong> ${Math.round(coverageReport.communicationsCoverage * 100)}%</p>
        <div class="progress-bar">
            <div class="progress-fill" style="width: ${coverageReport.communicationsCoverage * 100}%"></div>
        </div>
    </div>
    <div class="domain">
        <p><strong>Technical:</strong> ${Math.round(coverageReport.technicalCoverage * 100)}%</p>
        <div class="progress-bar">
            <div class="progress-fill" style="width: ${coverageReport.technicalCoverage * 100}%"></div>
        </div>
    </div>
</body>
</html>`;
  }

  private generateCSVCoverageReport(coverageReport: CoverageReport): string {
    let csv = 'Metric,Value\n';
    csv += `Total Scripts,${coverageReport.totalScripts}\n`;
    csv += `Completed Scripts,${coverageReport.completedScripts}\n`;
    csv += `Total Records,${coverageReport.totalRecords}\n`;
    csv += `Migrated Records,${coverageReport.migratedRecords}\n`;
    csv += `Overall Success Rate,${coverageReport.overallSuccessRate}\n`;
    csv += `Clinical Coverage,${coverageReport.clinicalCoverage}\n`;
    csv += `Business Coverage,${coverageReport.businessCoverage}\n`;
    csv += `Communications Coverage,${coverageReport.communicationsCoverage}\n`;
    csv += `Technical Coverage,${coverageReport.technicalCoverage}\n`;
    return csv;
  }
}