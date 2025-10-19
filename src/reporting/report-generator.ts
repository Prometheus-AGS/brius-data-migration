/**
 * T009: Report generator
 * Generates comprehensive migration reports in markdown format
 */

import {
  ReportGenerator,
  MigrationStats,
  ValidationResult,
  TableMigrationResult,
  ProgressTracker
} from '../interfaces/migration-types';

export class MigrationReportGenerator implements ReportGenerator {
  /**
   * Generate migration report for a single table
   */
  async generateTableReport(
    serviceName: string,
    stats: MigrationStats,
    validation: ValidationResult
  ): Promise<string> {
    const successRate = stats.totalProcessed > 0
      ? ((stats.successful / stats.totalProcessed) * 100).toFixed(2)
      : '0.00';

    const duration = this.formatDuration(stats.duration);

    let report = `# Migration Report: ${serviceName}\n\n`;
    report += `**Date**: ${stats.startTime.toISOString().split('T')[0]}\n`;
    report += `**Duration**: ${duration}\n`;
    report += `**Status**: ${validation.isValid ? '✅ SUCCESS' : '❌ ISSUES FOUND'}\n\n`;

    // Statistics section
    report += `## Migration Statistics\n\n`;
    report += `| Metric | Value |\n`;
    report += `|--------|-------|\n`;
    report += `| Total Processed | ${stats.totalProcessed.toLocaleString()} |\n`;
    report += `| Successfully Migrated | ${stats.successful.toLocaleString()} |\n`;
    report += `| Failed | ${stats.failed.toLocaleString()} |\n`;
    report += `| Skipped | ${stats.skipped.toLocaleString()} |\n`;
    report += `| Success Rate | ${successRate}% |\n`;
    report += `| Start Time | ${stats.startTime.toISOString()} |\n`;
    report += `| End Time | ${stats.endTime.toISOString()} |\n`;
    report += `| Duration | ${duration} |\n\n`;

    // Validation section
    report += `## Data Validation\n\n`;
    report += `| Metric | Value |\n`;
    report += `|--------|-------|\n`;
    report += `| Total Records | ${validation.totalRecords.toLocaleString()} |\n`;
    report += `| Valid Records | ${validation.validRecords.toLocaleString()} |\n`;
    report += `| Invalid Records | ${validation.invalidRecords.toLocaleString()} |\n`;
    report += `| Missing Records | ${validation.missingRecords.toLocaleString()} |\n`;
    report += `| Validation Status | ${validation.isValid ? '✅ PASSED' : '❌ FAILED'} |\n\n`;

    // Issues section
    if (validation.issues.length > 0) {
      report += `## Issues Found\n\n`;

      const errors = validation.issues.filter(i => i.severity === 'error');
      const warnings = validation.issues.filter(i => i.severity === 'warning');
      const info = validation.issues.filter(i => i.severity === 'info');

      if (errors.length > 0) {
        report += `### ❌ Errors (${errors.length})\n\n`;
        errors.forEach((issue, i) => {
          report += `${i + 1}. **${issue.table}**`;
          if (issue.field) report += `.${issue.field}`;
          report += `: ${issue.message}\n`;
          if (issue.suggestedFix) {
            report += `   *Fix*: ${issue.suggestedFix}\n`;
          }
          report += `\n`;
        });
      }

      if (warnings.length > 0) {
        report += `### ⚠️ Warnings (${warnings.length})\n\n`;
        warnings.forEach((issue, i) => {
          report += `${i + 1}. **${issue.table}**`;
          if (issue.field) report += `.${issue.field}`;
          report += `: ${issue.message}\n`;
          if (issue.suggestedFix) {
            report += `   *Suggestion*: ${issue.suggestedFix}\n`;
          }
          report += `\n`;
        });
      }

      if (info.length > 0) {
        report += `### ℹ️ Information (${info.length})\n\n`;
        info.forEach((issue, i) => {
          report += `${i + 1}. **${issue.table}**`;
          if (issue.field) report += `.${issue.field}`;
          report += `: ${issue.message}\n\n`;
        });
      }
    }

    // Performance section
    if (stats.duration > 0) {
      const recordsPerSecond = Math.round(stats.successful / (stats.duration / 1000));
      report += `## Performance Metrics\n\n`;
      report += `| Metric | Value |\n`;
      report += `|--------|-------|\n`;
      report += `| Processing Rate | ${recordsPerSecond} records/second |\n`;
      report += `| Average Batch Time | ${(stats.duration / Math.ceil(stats.totalProcessed / 500)).toFixed(0)}ms |\n\n`;
    }

    // Error details section
    if (stats.errorDetails && stats.errorDetails.length > 0) {
      report += `## Error Details\n\n`;
      stats.errorDetails.forEach((error, i) => {
        report += `${i + 1}. ${error}\n`;
      });
      report += `\n`;
    }

    return report;
  }

  /**
   * Generate comprehensive final report
   */
  async generateFinalReport(allResults: TableMigrationResult[]): Promise<string> {
    const totalTables = allResults.length;
    const completedTables = allResults.filter(r => r.status === 'completed').length;
    const failedTables = allResults.filter(r => r.status === 'failed').length;
    const partialTables = allResults.filter(r => r.status === 'partial').length;

    const totalRecords = allResults.reduce((sum, r) => sum + r.sourceRecords, 0);
    const migratedRecords = allResults.reduce((sum, r) => sum + r.migrationStats.successful, 0);
    const totalDuration = allResults.reduce((sum, r) => sum + r.executionTime, 0);

    const overallSuccessRate = totalRecords > 0
      ? ((migratedRecords / totalRecords) * 100).toFixed(2)
      : '0.00';

    let report = `# Final Database Migration Report\n\n`;
    report += `**Generated**: ${new Date().toISOString()}\n`;
    report += `**Migration Phase**: Final Tables Migration\n`;
    report += `**Status**: ${failedTables === 0 ? '✅ SUCCESS' : '❌ ISSUES FOUND'}\n\n`;

    // Executive Summary
    report += `## Executive Summary\n\n`;
    report += `| Metric | Value |\n`;
    report += `|--------|-------|\n`;
    report += `| Total Tables | ${totalTables} |\n`;
    report += `| Successfully Completed | ${completedTables} |\n`;
    report += `| Partially Completed | ${partialTables} |\n`;
    report += `| Failed | ${failedTables} |\n`;
    report += `| Total Source Records | ${totalRecords.toLocaleString()} |\n`;
    report += `| Successfully Migrated | ${migratedRecords.toLocaleString()} |\n`;
    report += `| Overall Success Rate | ${overallSuccessRate}% |\n`;
    report += `| Total Duration | ${this.formatDuration(totalDuration)} |\n\n`;

    // Table-by-table results
    report += `## Table Migration Results\n\n`;

    for (const result of allResults) {
      const tableSuccessRate = result.sourceRecords > 0
        ? ((result.migrationStats.successful / result.sourceRecords) * 100).toFixed(2)
        : '0.00';

      const statusEmoji = result.status === 'completed' ? '✅' : result.status === 'partial' ? '⚠️' : '❌';

      report += `### ${statusEmoji} ${result.tableName}\n\n`;
      report += `| Metric | Value |\n`;
      report += `|--------|-------|\n`;
      report += `| Source Records | ${result.sourceRecords.toLocaleString()} |\n`;
      report += `| Target Records | ${result.targetRecords.toLocaleString()} |\n`;
      report += `| Successfully Migrated | ${result.migrationStats.successful.toLocaleString()} |\n`;
      report += `| Failed | ${result.migrationStats.failed.toLocaleString()} |\n`;
      report += `| Skipped | ${result.migrationStats.skipped.toLocaleString()} |\n`;
      report += `| Success Rate | ${tableSuccessRate}% |\n`;
      report += `| Duration | ${this.formatDuration(result.executionTime)} |\n`;
      report += `| Status | ${result.status.toUpperCase()} |\n`;

      // Add validation status
      const validationEmoji = result.validationResult.isValid ? '✅' : '❌';
      report += `| Validation | ${validationEmoji} ${result.validationResult.isValid ? 'PASSED' : 'FAILED'} |\n\n`;

      // Add issues if any
      if (result.validationResult.issues.length > 0) {
        const errorCount = result.validationResult.issues.filter(i => i.severity === 'error').length;
        const warningCount = result.validationResult.issues.filter(i => i.severity === 'warning').length;

        report += `**Issues**: ${errorCount} errors, ${warningCount} warnings\n\n`;
      }
    }

    // Overall system status
    const allTablesValid = allResults.every(r => r.validationResult.isValid);
    const allTablesCompleted = allResults.every(r => r.status === 'completed');

    report += `## System Status\n\n`;
    report += `| Component | Status |\n`;
    report += `|-----------|--------|\n`;
    report += `| Migration Completion | ${allTablesCompleted ? '✅ ALL COMPLETE' : '❌ INCOMPLETE'} |\n`;
    report += `| Data Validation | ${allTablesValid ? '✅ ALL VALID' : '❌ ISSUES FOUND'} |\n`;
    report += `| System Readiness | ${allTablesCompleted && allTablesValid ? '✅ READY' : '❌ NOT READY'} |\n\n`;

    // Recommendations
    report += `## Recommendations\n\n`;

    if (failedTables > 0) {
      report += `### ❌ Critical Issues\n`;
      report += `- ${failedTables} table(s) failed to migrate completely\n`;
      report += `- Review individual table reports for specific issues\n`;
      report += `- Re-run failed migrations after addressing root causes\n\n`;
    }

    if (partialTables > 0) {
      report += `### ⚠️ Attention Required\n`;
      report += `- ${partialTables} table(s) partially migrated\n`;
      report += `- Review skipped records and validation warnings\n`;
      report += `- Consider re-running with data cleanup if needed\n\n`;
    }

    if (allTablesCompleted && allTablesValid) {
      report += `### ✅ Success\n`;
      report += `- All tables successfully migrated with ${overallSuccessRate}% success rate\n`;
      report += `- System is ready for production use\n`;
      report += `- Consider performance testing with full dataset\n`;
      report += `- Archive migration logs and scripts for future reference\n\n`;
    }

    return report;
  }

  /**
   * Generate progress report (for real-time monitoring)
   */
  generateProgressReport(currentProgress: ProgressTracker[]): string {
    let report = `\n=== REAL-TIME MIGRATION PROGRESS ===\n`;
    report += `Generated: ${new Date().toISOString()}\n\n`;

    for (const progress of currentProgress) {
      const progressPercent = progress.progressPercentage.toFixed(1);
      const processed = progress.processedRecords.toLocaleString();
      const total = progress.totalRecords.toLocaleString();

      report += `📊 Progress: ${progressPercent}% (${processed}/${total})\n`;
      report += `   Batch: ${progress.currentBatch}/${progress.totalBatches}\n`;
      report += `   Success: ${progress.successfulRecords.toLocaleString()}\n`;
      report += `   Skipped: ${progress.skippedRecords.toLocaleString()}\n`;
      report += `   Errors: ${progress.failedRecords.toLocaleString()}\n`;

      if (progress.estimatedTimeRemaining > 0) {
        const eta = new Date(Date.now() + progress.estimatedTimeRemaining);
        report += `   ETA: ${eta.toISOString()}\n`;
      }
      report += `\n`;
    }

    report += `=====================================\n`;
    return report;
  }

  /**
   * Generate summary report for multiple migrations
   */
  generateSummaryReport(results: TableMigrationResult[]): string {
    const totalTables = results.length;
    const completedTables = results.filter(r => r.status === 'completed').length;
    const totalRecords = results.reduce((sum, r) => sum + r.sourceRecords, 0);
    const migratedRecords = results.reduce((sum, r) => sum + r.migrationStats.successful, 0);
    const totalDuration = results.reduce((sum, r) => sum + r.executionTime, 0);

    let report = `\n=== MIGRATION SUMMARY ===\n`;
    report += `Tables: ${completedTables}/${totalTables} completed\n`;
    report += `Records: ${migratedRecords.toLocaleString()}/${totalRecords.toLocaleString()} migrated\n`;
    report += `Duration: ${this.formatDuration(totalDuration)}\n`;
    report += `Success Rate: ${totalRecords > 0 ? ((migratedRecords / totalRecords) * 100).toFixed(2) : '0.00'}%\n`;
    report += `========================\n\n`;

    return report;
  }

  /**
   * Save report to file
   */
  async saveReport(content: string, fileName: string): Promise<void> {
    const fs = await import('fs/promises');
    const path = `/usr/local/src/sage/dataload/${fileName}`;

    try {
      await fs.writeFile(path, content, 'utf8');
      console.log(`📋 Report saved: ${path}`);
    } catch (error) {
      console.error(`Failed to save report: ${error}`);
      throw error;
    }
  }

  /**
   * Format duration from milliseconds to human-readable format
   */
  private formatDuration(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Generate error summary from multiple migration results
   */
  generateErrorSummary(results: TableMigrationResult[]): string {
    const allIssues = results.flatMap(r => r.validationResult.issues);
    const errors = allIssues.filter(i => i.severity === 'error');
    const warnings = allIssues.filter(i => i.severity === 'warning');

    let summary = `\n=== ERROR SUMMARY ===\n`;
    summary += `Total Issues: ${allIssues.length}\n`;
    summary += `Errors: ${errors.length}\n`;
    summary += `Warnings: ${warnings.length}\n\n`;

    if (errors.length > 0) {
      summary += `Critical Errors:\n`;
      errors.slice(0, 5).forEach((error, i) => {
        summary += `${i + 1}. ${error.table}: ${error.message}\n`;
      });
      if (errors.length > 5) {
        summary += `... and ${errors.length - 5} more errors\n`;
      }
      summary += `\n`;
    }

    if (warnings.length > 0) {
      summary += `Key Warnings:\n`;
      warnings.slice(0, 5).forEach((warning, i) => {
        summary += `${i + 1}. ${warning.table}: ${warning.message}\n`;
      });
      if (warnings.length > 5) {
        summary += `... and ${warnings.length - 5} more warnings\n`;
      }
    }

    summary += `====================\n\n`;
    return summary;
  }

  /**
   * Generate execution timeline from migration results
   */
  generateTimeline(results: TableMigrationResult[]): string {
    let timeline = `\n=== MIGRATION TIMELINE ===\n`;

    // Sort by execution time (assuming they ran sequentially)
    const sortedResults = [...results].sort((a, b) =>
      a.migrationStats.startTime.getTime() - b.migrationStats.startTime.getTime()
    );

    for (const result of sortedResults) {
      const status = result.status === 'completed' ? '✅' : result.status === 'partial' ? '⚠️' : '❌';
      const startTime = result.migrationStats.startTime.toISOString();
      const duration = this.formatDuration(result.executionTime);

      timeline += `${status} ${result.tableName}\n`;
      timeline += `   Started: ${startTime}\n`;
      timeline += `   Duration: ${duration}\n`;
      timeline += `   Records: ${result.migrationStats.successful.toLocaleString()}/${result.sourceRecords.toLocaleString()}\n\n`;
    }

    timeline += `========================\n\n`;
    return timeline;
  }

  /**
   * Generate concise console progress report
   */
  static generateConsoleProgress(
    tableName: string,
    batchNumber: number,
    totalBatches: number,
    processed: number,
    total: number,
    successful: number,
    skipped: number,
    errors: number
  ): void {
    const progressPercent = ((processed / total) * 100).toFixed(1);
    const batchPercent = ((batchNumber / totalBatches) * 100).toFixed(1);

    console.log(`📊 ${tableName}:`);
    console.log(`   Progress: ${progressPercent}% (${processed.toLocaleString()}/${total.toLocaleString()})`);
    console.log(`   Batch: ${batchNumber}/${totalBatches} (${batchPercent}%)`);
    console.log(`   Results: Success: ${successful.toLocaleString()}, Skipped: ${skipped.toLocaleString()}, Errors: ${errors.toLocaleString()}`);
  }
}