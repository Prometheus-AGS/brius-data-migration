/**
 * Reports Controller
 *
 * Handles report generation and download endpoints.
 */

import { Request, Response } from 'express';
import { ReportGenerator, ReportOptions } from '../services/report-generator';
import { CoverageCalculator } from '../services/coverage-calculator';
import { DataValidator } from '../services/data-validator';
import { MigrationScriptAnalyzer } from '../services/migration-script-analyzer';
import { MigrationScript, DataEntity, MigrationMetrics, ExecutionLog } from '../models';
import { Pool } from 'pg';

export class ReportsController {
  private readonly reportGenerator: ReportGenerator;
  private readonly coverageCalculator: CoverageCalculator;
  private readonly dataValidator: DataValidator;
  private readonly scriptAnalyzer: MigrationScriptAnalyzer;
  private readonly dbPool: Pool;

  constructor(
    reportGenerator: ReportGenerator,
    coverageCalculator: CoverageCalculator,
    dataValidator: DataValidator,
    scriptAnalyzer: MigrationScriptAnalyzer,
    dbPool: Pool
  ) {
    this.reportGenerator = reportGenerator;
    this.coverageCalculator = coverageCalculator;
    this.dataValidator = dataValidator;
    this.scriptAnalyzer = scriptAnalyzer;
    this.dbPool = dbPool;
  }

  /**
   * GET /reports/generate
   * Generates comprehensive migration reports
   */
  public async generateReports(req: Request, res: Response): Promise<void> {
    try {
      const startTime = Date.now();

      // Parse query parameters
      const reportType = (req.query.type as string) || 'comprehensive';
      const format = (req.query.format as string) || 'json';
      const includeCharts = req.query.includeCharts === 'true';
      const includeDetails = req.query.includeDetails === 'true';
      const includeValidation = req.query.includeValidation === 'true';
      const saveToFile = req.query.saveToFile === 'true';

      // Validate parameters
      const validReportTypes = ['comprehensive', 'coverage', 'validation', 'executive', 'detailed'];
      if (!validReportTypes.includes(reportType)) {
        res.status(400).json({
          error: 'Bad Request',
          message: `Invalid report type. Valid types: ${validReportTypes.join(', ')}`,
          timestamp: new Date().toISOString()
        });
        return;
      }

      const validFormats = ['json', 'html', 'markdown', 'csv'];
      if (!validFormats.includes(format)) {
        res.status(400).json({
          error: 'Bad Request',
          message: `Invalid format. Valid formats: ${validFormats.join(', ')}`,
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Gather data for report generation
      const reportData = await this.gatherReportData(includeValidation);

      // Generate report based on type
      let reportContent: string;
      let contentType: string;
      let filename: string;

      const reportOptions: ReportOptions = {
        includeCharts,
        includeDetails,
        format: format as any
      };

      switch (reportType) {
        case 'comprehensive':
          reportContent = await this.generateComprehensiveReport(reportData, reportOptions, includeValidation);
          break;
        case 'coverage':
          reportContent = await this.generateCoverageReport(reportData, reportOptions);
          break;
        case 'validation':
          if (!includeValidation) {
            res.status(400).json({
              error: 'Bad Request',
              message: 'Validation report requires includeValidation=true',
              timestamp: new Date().toISOString()
            });
            return;
          }
          reportContent = await this.generateValidationReport(reportData, reportOptions);
          break;
        case 'executive':
          reportContent = await this.generateExecutiveReport(reportData, reportOptions);
          break;
        case 'detailed':
          reportContent = await this.generateDetailedReport(reportData, reportOptions);
          break;
        default:
          reportContent = await this.generateComprehensiveReport(reportData, reportOptions, includeValidation);
      }

      // Set content type and filename based on format
      switch (format) {
        case 'html':
          contentType = 'text/html';
          filename = `migration-${reportType}-report.html`;
          break;
        case 'markdown':
          contentType = 'text/markdown';
          filename = `migration-${reportType}-report.md`;
          break;
        case 'csv':
          contentType = 'text/csv';
          filename = `migration-${reportType}-report.csv`;
          break;
        default:
          contentType = 'application/json';
          filename = `migration-${reportType}-report.json`;
      }

      // Save to file if requested
      let savedPath: string | null = null;
      if (saveToFile) {
        try {
          savedPath = await this.reportGenerator.saveReport(
            reportContent,
            `migration-${reportType}-report`,
            format
          );
        } catch (error) {
          console.warn('Failed to save report to file:', error);
        }
      }

      // Prepare response
      const responseTime = Date.now() - startTime;

      if (format === 'json') {
        // For JSON format, wrap content in metadata
        const jsonResponse = {
          reportType,
          format,
          generatedAt: new Date().toISOString(),
          responseTime,
          savedPath,
          metadata: {
            totalScripts: reportData.scripts.length,
            totalEntities: reportData.entities.length,
            includeCharts,
            includeDetails,
            includeValidation
          },
          content: JSON.parse(reportContent)
        };

        // Validate JSON response structure
        this.validateReportsResponse(jsonResponse);

        res.status(200).json(jsonResponse);
      } else {
        // For other formats, return content directly with appropriate headers
        res.setHeader('Content-Type', contentType);
        if (saveToFile) {
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        }
        res.setHeader('X-Report-Type', reportType);
        res.setHeader('X-Generated-At', new Date().toISOString());
        res.setHeader('X-Response-Time', responseTime.toString());
        if (savedPath) {
          res.setHeader('X-Saved-Path', savedPath);
        }

        res.status(200).send(reportContent);
      }
    } catch (error) {
      console.error('Error generating reports:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to generate report',
        timestamp: new Date().toISOString()
      });
    }
  }

  private async gatherReportData(includeValidation: boolean): Promise<{
    scripts: MigrationScript[];
    entities: DataEntity[];
    metrics: MigrationMetrics[];
    logs: ExecutionLog[];
    validationResults?: any[];
    validationSummary?: any;
    integrityChecks?: any[];
  }> {
    // In a real implementation, this would fetch data from the database
    // For now, we'll use mock data or data from the calculators

    const scriptAnalysisResults = await this.scriptAnalyzer.analyzeAllScripts({
      includeTests: false,
      includeValidation: true,
      scanForDependencies: true
    });

    const scripts = scriptAnalysisResults.map(result => result.script);
    const entityCoverage = this.coverageCalculator.calculateEntityCoverage();

    // Convert entity coverage to DataEntity instances
    const entities = entityCoverage.map(ec => new DataEntity({
      name: ec.entityName,
      domainId: ec.domainId,
      totalRecords: ec.totalRecords,
      migratedRecords: ec.migratedRecords,
      failedRecords: ec.failedRecords,
      lastMigrated: ec.lastMigrated
    }));

    // Mock metrics and logs (in real implementation, fetch from database)
    const metrics: MigrationMetrics[] = [];
    const logs: ExecutionLog[] = [];

    const reportData: any = {
      scripts,
      entities,
      metrics,
      logs
    };

    if (includeValidation) {
      try {
        // Run validation for all entities
        const allValidationResults = [];
        const allIntegrityChecks = [];

        for (const entity of entities.slice(0, 5)) { // Limit to first 5 for performance
          const validationResults = await this.dataValidator.validateEntity(entity);
          allValidationResults.push(...validationResults);
        }

        const integrityChecks = await this.dataValidator.validateMigrationCompleteness('report_generation');
        allIntegrityChecks.push(...integrityChecks);

        const validationSummary = await this.dataValidator.generateValidationSummary(allValidationResults);

        reportData.validationResults = allValidationResults;
        reportData.validationSummary = validationSummary;
        reportData.integrityChecks = allIntegrityChecks;
      } catch (error) {
        console.warn('Error gathering validation data for report:', error);
      }
    }

    return reportData;
  }

  private async generateComprehensiveReport(
    reportData: any,
    options: ReportOptions,
    includeValidation: boolean
  ): Promise<string> {
    if (includeValidation && reportData.validationResults) {
      return this.reportGenerator.generateComprehensiveReport(
        reportData.scripts,
        reportData.entities,
        reportData.metrics,
        reportData.logs,
        reportData.validationResults,
        reportData.validationSummary,
        reportData.integrityChecks,
        options
      );
    } else {
      // Generate without validation data
      const executiveSummary = await this.reportGenerator.generateExecutiveSummary(
        reportData.scripts,
        reportData.entities,
        reportData.metrics
      );

      const detailedAnalytics = await this.reportGenerator.generateDetailedAnalytics(
        reportData.scripts,
        reportData.entities,
        reportData.metrics,
        reportData.logs
      );

      if (options.format === 'json') {
        return JSON.stringify({
          executiveSummary,
          detailedAnalytics,
          generatedAt: new Date().toISOString()
        }, null, 2);
      } else {
        // Generate markdown report
        let report = `# Comprehensive Migration Report\n\n`;
        report += `**Generated:** ${new Date().toISOString()}\n\n`;

        report += `## Executive Summary\n\n`;
        report += `- **Total Scripts:** ${executiveSummary.totalScripts}\n`;
        report += `- **Completed Scripts:** ${executiveSummary.completedScripts}\n`;
        report += `- **Overall Progress:** ${Math.round(executiveSummary.overallProgress * 100)}%\n`;
        report += `- **Records Migrated:** ${executiveSummary.totalRecordsMigrated.toLocaleString()}\n`;
        report += `- **Average Success Rate:** ${Math.round(executiveSummary.averageSuccessRate * 100)}%\n`;
        report += `- **Risk Level:** ${executiveSummary.riskLevel.toUpperCase()}\n\n`;

        return report;
      }
    }
  }

  private async generateCoverageReport(reportData: any, options: ReportOptions): Promise<string> {
    const coverageReport = this.coverageCalculator.generateCoverageReport();
    return this.reportGenerator.generateCoverageReport(coverageReport, options);
  }

  private async generateValidationReport(reportData: any, options: ReportOptions): Promise<string> {
    if (!reportData.validationResults || !reportData.validationSummary) {
      throw new Error('Validation data not available');
    }

    return this.reportGenerator.generateValidationReport(
      reportData.validationResults,
      reportData.validationSummary,
      reportData.integrityChecks || []
    );
  }

  private async generateExecutiveReport(reportData: any, options: ReportOptions): Promise<string> {
    const executiveSummary = await this.reportGenerator.generateExecutiveSummary(
      reportData.scripts,
      reportData.entities,
      reportData.metrics
    );

    if (options.format === 'json') {
      return JSON.stringify(executiveSummary, null, 2);
    } else {
      let report = `# Executive Migration Summary\n\n`;
      report += `**Generated:** ${new Date().toISOString()}\n\n`;

      report += `## Key Metrics\n\n`;
      report += `- **Migration Progress:** ${Math.round(executiveSummary.overallProgress * 100)}%\n`;
      report += `- **Scripts Status:** ${executiveSummary.completedScripts}/${executiveSummary.totalScripts} completed\n`;
      report += `- **Data Volume:** ${executiveSummary.totalRecordsMigrated.toLocaleString()} records migrated\n`;
      report += `- **Quality:** ${Math.round(executiveSummary.averageSuccessRate * 100)}% average success rate\n`;
      report += `- **Risk Assessment:** ${executiveSummary.riskLevel.toUpperCase()} risk level\n`;
      report += `- **Timeline:** ${executiveSummary.estimatedCompletion}\n\n`;

      report += `## Performance Highlights\n\n`;
      report += `- **Best Domain:** ${executiveSummary.keyMetrics.highestPerformingDomain}\n`;
      report += `- **Needs Attention:** ${executiveSummary.keyMetrics.lowestPerformingDomain}\n`;
      report += `- **Critical Issues:** ${executiveSummary.keyMetrics.criticalIssuesCount}\n`;
      report += `- **Recent Activity:** ${executiveSummary.keyMetrics.recentActivity} scripts/day\n\n`;

      return report;
    }
  }

  private async generateDetailedReport(reportData: any, options: ReportOptions): Promise<string> {
    const detailedAnalytics = await this.reportGenerator.generateDetailedAnalytics(
      reportData.scripts,
      reportData.entities,
      reportData.metrics,
      reportData.logs
    );

    if (options.format === 'json') {
      return JSON.stringify(detailedAnalytics, null, 2);
    } else {
      let report = `# Detailed Migration Analysis\n\n`;
      report += `**Generated:** ${new Date().toISOString()}\n\n`;

      report += `## Domain Performance\n\n`;
      detailedAnalytics.domainBreakdown.forEach(domain => {
        report += `### ${domain.domain}\n`;
        report += `- Coverage: ${Math.round(domain.coverage * 100)}%\n`;
        report += `- Scripts: ${domain.completedScripts}/${domain.totalScripts}\n`;
        report += `- Records: ${domain.migratedRecords.toLocaleString()}/${domain.totalRecords.toLocaleString()}\n`;
        report += `- Success Rate: ${Math.round(domain.averageSuccessRate * 100)}%\n\n`;
      });

      report += `## Performance Metrics\n\n`;
      report += `- **Average Execution Time:** ${Math.round(detailedAnalytics.performanceMetrics.averageExecutionTime)}ms\n`;
      report += `- **Throughput:** ${Math.round(detailedAnalytics.performanceMetrics.throughputPerSecond)} records/sec\n`;
      report += `- **Error Rate:** ${Math.round(detailedAnalytics.performanceMetrics.errorRate * 10000) / 100}%\n\n`;

      if (detailedAnalytics.bottlenecks.length > 0) {
        report += `## Issues & Bottlenecks\n\n`;
        detailedAnalytics.bottlenecks.forEach((bottleneck, index) => {
          report += `${index + 1}. **${bottleneck.domain}**: ${bottleneck.issue} (Impact: ${bottleneck.impact})\n`;
        });
      }

      return report;
    }
  }

  private validateReportsResponse(response: any): void {
    // Validate top-level structure
    const requiredFields = ['reportType', 'format', 'generatedAt', 'responseTime', 'metadata', 'content'];

    for (const field of requiredFields) {
      if (!(field in response)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate report type
    const validReportTypes = ['comprehensive', 'coverage', 'validation', 'executive', 'detailed'];
    if (!validReportTypes.includes(response.reportType)) {
      throw new Error(`Invalid reportType: ${response.reportType}`);
    }

    // Validate format
    const validFormats = ['json', 'html', 'markdown', 'csv'];
    if (!validFormats.includes(response.format)) {
      throw new Error(`Invalid format: ${response.format}`);
    }

    // Validate timestamps
    if (isNaN(Date.parse(response.generatedAt))) {
      throw new Error('generatedAt must be a valid ISO timestamp');
    }

    // Validate response time
    if (typeof response.responseTime !== 'number' || response.responseTime < 0) {
      throw new Error('responseTime must be a non-negative number');
    }

    // Validate metadata
    if (!response.metadata || typeof response.metadata !== 'object') {
      throw new Error('metadata must be an object');
    }

    const requiredMetadataFields = ['totalScripts', 'totalEntities', 'includeCharts', 'includeDetails', 'includeValidation'];
    requiredMetadataFields.forEach(field => {
      if (!(field in response.metadata)) {
        throw new Error(`Missing required metadata field: ${field}`);
      }
    });

    if (typeof response.metadata.totalScripts !== 'number' || response.metadata.totalScripts < 0) {
      throw new Error('metadata.totalScripts must be a non-negative number');
    }

    if (typeof response.metadata.totalEntities !== 'number' || response.metadata.totalEntities < 0) {
      throw new Error('metadata.totalEntities must be a non-negative number');
    }

    // Validate saved path if present
    if (response.savedPath !== null && response.savedPath !== undefined) {
      if (typeof response.savedPath !== 'string') {
        throw new Error('savedPath must be null or a string');
      }
    }

    // Validate content
    if (!response.content) {
      throw new Error('content is required');
    }
  }
}