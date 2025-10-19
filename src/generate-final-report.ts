/**
 * T030: Comprehensive final report generator
 * Generates comprehensive final report documenting all completed migrations and system readiness
 */

import { DatabaseConnectionManager } from './database/connection-manager';
import { MigrationReportGenerator } from './reporting/report-generator';
import { FinalSystemValidator } from '../validation/final-system-validation';
import {
  TableMigrationResult,
  SystemValidationResult,
  ValidationResult,
  MigrationStats
} from './interfaces/migration-types';

export class ComprehensiveFinalReportGenerator {
  private connectionManager: DatabaseConnectionManager;
  private reportGenerator: MigrationReportGenerator;
  private systemValidator: FinalSystemValidator;

  constructor() {
    this.connectionManager = DatabaseConnectionManager.fromEnvironment();
    this.reportGenerator = new MigrationReportGenerator();
    this.systemValidator = new FinalSystemValidator();
  }

  async generateComprehensiveReport(): Promise<string> {
    console.log('📋 Generating comprehensive final migration report...\n');

    try {
      // Initialize connections
      await this.connectionManager.initializePools();

      // 1. Run final system validation
      console.log('🔍 Running final system validation...');
      const systemValidation = await this.systemValidator.validateFinalSystem();

      // 2. Gather migration statistics
      console.log('📊 Gathering migration statistics...');
      const migrationStats = await this.gatherMigrationStatistics();

      // 3. Generate executive summary
      console.log('📈 Generating executive summary...');
      const executiveSummary = this.generateExecutiveSummary(systemValidation, migrationStats);

      // 4. Generate technical details
      console.log('🔧 Generating technical details...');
      const technicalDetails = await this.generateTechnicalDetails(systemValidation);

      // 5. Generate recommendations
      console.log('💡 Generating recommendations...');
      const recommendations = this.generateRecommendations(systemValidation);

      // 6. Compile comprehensive report
      const report = this.compileComprehensiveReport({
        executiveSummary,
        systemValidation,
        migrationStats,
        technicalDetails,
        recommendations
      });

      // 7. Save report
      const reportPath = 'COMPREHENSIVE_FINAL_MIGRATION_REPORT.md';
      await this.reportGenerator.saveReport(report, reportPath);

      console.log(`\n📋 Comprehensive final report saved: ${reportPath}`);
      return report;

    } catch (error) {
      console.error('❌ Failed to generate comprehensive report:', error);
      throw error;
    } finally {
      await this.connectionManager.closeAll();
    }
  }

  private async gatherMigrationStatistics(): Promise<{
    totalTables: number;
    totalRecords: number;
    migrationDuration: number;
    successRate: number;
    tableBreakdown: Array<{
      table: string;
      records: number;
      status: string;
    }>;
  }> {
    const targetClient = this.connectionManager.getTargetClient();

    // Get record counts for all migrated tables
    const finalTables = [
      'technicians',
      'technician_roles',
      'message_attachments',
      'template_view_groups',
      'template_view_roles',
      'treatment_discussions',
      'brackets',
      'order_cases',
      'purchases'
    ];

    const tableBreakdown = await Promise.all(
      finalTables.map(async (tableName) => {
        try {
          const count = await this.connectionManager.getRecordCount(targetClient, tableName);
          return {
            table: tableName,
            records: count,
            status: count > 0 ? 'completed' : 'empty'
          };
        } catch (error) {
          return {
            table: tableName,
            records: 0,
            status: 'not_found'
          };
        }
      })
    );

    const totalRecords = tableBreakdown.reduce((sum, t) => sum + t.records, 0);
    const completedTables = tableBreakdown.filter(t => t.status === 'completed').length;
    const successRate = finalTables.length > 0 ? (completedTables / finalTables.length) * 100 : 0;

    return {
      totalTables: finalTables.length,
      totalRecords,
      migrationDuration: 0, // Calculated from logs if available
      successRate,
      tableBreakdown
    };
  }

  private generateExecutiveSummary(
    systemValidation: SystemValidationResult,
    migrationStats: any
  ): string {
    const status = systemValidation.overallStatus;
    const statusEmoji = status === 'ready' ? '✅' : status === 'partial' ? '⚠️' : '❌';
    const statusText = status === 'ready' ? 'READY FOR PRODUCTION' :
                     status === 'partial' ? 'PARTIALLY COMPLETE' : 'REQUIRES ATTENTION';

    return `
# Executive Summary

## Overall Status: ${statusEmoji} ${statusText}

**Migration Completion Date**: ${new Date().toISOString().split('T')[0]}

**Key Metrics**:
- **Tables Migrated**: ${systemValidation.summary.tables.completed}/${systemValidation.summary.tables.total}
- **Total Records**: ${systemValidation.summary.records.total.toLocaleString()}
- **Success Rate**: ${migrationStats.successRate.toFixed(1)}%
- **System Status**: ${statusText}

## Business Impact

${this.generateBusinessImpactSummary(systemValidation, migrationStats)}

## Critical Actions Required

${systemValidation.recommendedActions.length > 0
  ? systemValidation.recommendedActions.map((action, i) => `${i + 1}. ${action}`).join('\n')
  : '✅ No critical actions required - system is ready for production use'
}

---
`;
  }

  private generateBusinessImpactSummary(
    systemValidation: SystemValidationResult,
    migrationStats: any
  ): string {
    const completedTables = systemValidation.summary.tables.completed;
    const totalRecords = systemValidation.summary.records.total;

    if (systemValidation.overallStatus === 'ready') {
      return `
✅ **Migration Successfully Completed**: All critical database tables have been migrated with ${totalRecords.toLocaleString()} records transferred successfully.

🚀 **System Readiness**: The target system is fully operational and ready for production deployment.

📊 **Data Integrity**: Comprehensive validation confirms data integrity and relationships are maintained across all migrated tables.`;
    } else if (systemValidation.overallStatus === 'partial') {
      return `
⚠️ **Partial Migration**: ${completedTables} tables completed with ${totalRecords.toLocaleString()} records transferred.

🔧 **Action Required**: Some tables require attention before full production deployment.

📋 **Business Continuity**: Core functionality is available, but some features may be limited until remaining issues are resolved.`;
    } else {
      return `
❌ **Migration Issues**: Critical issues detected that prevent production deployment.

🛑 **System Status**: Target system requires immediate attention before business operations can proceed.

🔧 **Priority**: Address critical errors before considering production deployment.`;
    }
  }

  private async generateTechnicalDetails(systemValidation: SystemValidationResult): Promise<string> {
    let details = `
# Technical Details

## Database Migration Architecture

**Source System**: Legacy PostgreSQL with integer primary keys
**Target System**: Modern Supabase/PostgreSQL with UUID-based architecture
**Migration Approach**: Batch processing with error recovery and resume capability

## Table Migration Results

| Table | Status | Records | Issues | Dependencies |
|-------|--------|---------|--------|--------------|
`;

    for (const tableResult of systemValidation.tableResults) {
      const statusEmoji = tableResult.status === 'completed' ? '✅' :
                         tableResult.status === 'partial' ? '⚠️' : '❌';
      const issueCount = tableResult.validationResult.issues.length;
      const dependencies = tableResult.metadata?.dependencies?.join(', ') || 'None';

      details += `| ${tableResult.tableName} | ${statusEmoji} ${tableResult.status} | ${tableResult.targetRecords.toLocaleString()} | ${issueCount} | ${dependencies} |\n`;
    }

    details += `\n## System Validation Results\n\n`;

    // Add system check details
    const systemChecks = [
      { name: 'Database Connectivity', result: systemValidation.systemChecks.connectivity },
      { name: 'Schema Validation', result: systemValidation.systemChecks.schema },
      { name: 'Dependencies', result: systemValidation.systemChecks.dependencies },
      { name: 'Cross-table Relationships', result: systemValidation.systemChecks.relationships },
      { name: 'Performance Assessment', result: systemValidation.systemChecks.performance },
      { name: 'Data Integrity', result: systemValidation.systemChecks.integrity }
    ];

    for (const check of systemChecks) {
      const statusEmoji = check.result.isValid ? '✅' : '❌';
      const issueCount = check.result.issues.filter(i => i.severity === 'error').length;

      details += `### ${statusEmoji} ${check.name}\n`;
      details += `- **Status**: ${check.result.isValid ? 'PASSED' : 'FAILED'}\n`;
      details += `- **Records Validated**: ${check.result.totalRecords.toLocaleString()}\n`;
      details += `- **Critical Issues**: ${issueCount}\n`;

      if (check.result.issues.length > 0) {
        details += `- **Issues**:\n`;
        check.result.issues.forEach((issue, i) => {
          details += `  ${i + 1}. [${issue.severity.toUpperCase()}] ${issue.message}\n`;
        });
      }
      details += `\n`;
    }

    // Add performance metrics
    details += await this.generatePerformanceMetrics();

    return details;
  }

  private async generatePerformanceMetrics(): Promise<string> {
    const targetClient = this.connectionManager.getTargetClient();

    try {
      // Get database size information
      const dbSizeResult = await targetClient.query(`
        SELECT
          pg_size_pretty(pg_database_size(current_database())) as database_size,
          COUNT(*) as total_tables
        FROM information_schema.tables
        WHERE table_schema = 'public'
      `);

      const databaseSize = dbSizeResult.rows[0]?.database_size || 'Unknown';
      const totalTables = dbSizeResult.rows[0]?.total_tables || 'Unknown';

      // Get index information
      const indexResult = await targetClient.query(`
        SELECT COUNT(*) as index_count
        FROM pg_indexes
        WHERE schemaname = 'public'
      `);

      const indexCount = indexResult.rows[0]?.index_count || 'Unknown';

      return `
## Performance Metrics

| Metric | Value |
|--------|-------|
| Database Size | ${databaseSize} |
| Total Tables | ${totalTables} |
| Indexes Created | ${indexCount} |
| Migration Method | Batch Processing |
| Error Recovery | ✅ Supported |
| Resume Capability | ✅ Supported |

## Migration Infrastructure

- **Batch Size**: 500-2000 records per batch (configurable)
- **Error Handling**: Comprehensive with automatic retry logic
- **Progress Tracking**: Real-time with ETA calculations
- **Validation**: Multi-level (completeness, integrity, business rules)
- **Rollback Support**: Available for all migrations
- **Audit Trail**: Complete with legacy ID preservation

`;
    } catch (error) {
      return `
## Performance Metrics

Unable to gather performance metrics: ${(error as Error).message}

`;
    }
  }

  private generateRecommendations(systemValidation: SystemValidationResult): string {
    let recommendations = `
# Recommendations & Next Steps

## Immediate Actions

`;

    const criticalIssues = systemValidation.tableResults
      .flatMap(t => t.validationResult.issues)
      .filter(i => i.severity === 'error');

    if (criticalIssues.length > 0) {
      recommendations += `
### 🚨 Critical Issues (Must Fix Before Production)

`;
      criticalIssues.forEach((issue, i) => {
        recommendations += `${i + 1}. **${issue.table}**: ${issue.message}\n`;
        if (issue.suggestedFix) {
          recommendations += `   *Solution*: ${issue.suggestedFix}\n`;
        }
        recommendations += `\n`;
      });
    }

    const warnings = systemValidation.tableResults
      .flatMap(t => t.validationResult.issues)
      .filter(i => i.severity === 'warning');

    if (warnings.length > 0) {
      recommendations += `
### ⚠️ Warnings (Recommended to Address)

`;
      warnings.slice(0, 10).forEach((issue, i) => {
        recommendations += `${i + 1}. **${issue.table}**: ${issue.message}\n`;
        if (issue.suggestedFix) {
          recommendations += `   *Suggestion*: ${issue.suggestedFix}\n`;
        }
        recommendations += `\n`;
      });

      if (warnings.length > 10) {
        recommendations += `... and ${warnings.length - 10} more warnings (see individual table reports)\n\n`;
      }
    }

    recommendations += `
## Production Readiness Checklist

`;

    const readinessItems = [
      { item: 'Database connectivity tested', status: systemValidation.systemChecks.connectivity.isValid },
      { item: 'All critical tables migrated', status: systemValidation.summary.tables.failed === 0 },
      { item: 'Foreign key relationships validated', status: systemValidation.systemChecks.relationships.isValid },
      { item: 'Data integrity verified', status: systemValidation.systemChecks.integrity.isValid },
      { item: 'Performance baseline established', status: systemValidation.systemChecks.performance.isValid },
      { item: 'Backup and recovery procedures documented', status: false }, // Always false - manual task
      { item: 'Monitoring and alerting configured', status: false }, // Always false - manual task
      { item: 'User acceptance testing completed', status: false } // Always false - manual task
    ];

    readinessItems.forEach(item => {
      const statusEmoji = item.status ? '✅' : '🔲';
      recommendations += `- ${statusEmoji} ${item.item}\n`;
    });

    recommendations += `
## Post-Migration Tasks

### 1. Performance Optimization
- Review query performance on migrated tables
- Consider additional indexing for frequently accessed data
- Monitor database performance under production load

### 2. Data Validation
- Conduct user acceptance testing on migrated data
- Verify business processes work with new data structure
- Validate reporting and analytics functionality

### 3. System Monitoring
- Implement database monitoring and alerting
- Set up automated backup procedures
- Create operational runbooks for maintenance

### 4. Documentation
- Update system documentation with new database schema
- Document migration procedures for future reference
- Create troubleshooting guides for common issues

## Migration Archive

For compliance and future reference, preserve:
- All migration scripts and configurations
- Detailed migration logs and reports
- Validation results and issue resolution records
- Legacy ID mapping tables for data traceability

---

*Report generated on ${new Date().toISOString()} by Comprehensive Final Report Generator*
`;

    return recommendations;
  }

  private compileComprehensiveReport(components: {
    executiveSummary: string;
    systemValidation: SystemValidationResult;
    migrationStats: any;
    technicalDetails: string;
    recommendations: string;
  }): string {
    return `
# 🚀 Final Database Migration Report

**Project**: Final Database Migration Phase - Remaining Tables
**Date**: ${new Date().toISOString().split('T')[0]}
**Status**: ${components.systemValidation.overallStatus.toUpperCase()}

${components.executiveSummary}

${components.technicalDetails}

${components.recommendations}

---

## Migration Summary Statistics

| Category | Value |
|----------|-------|
| Migration Tables | ${components.systemValidation.summary.tables.total} |
| Successfully Completed | ${components.systemValidation.summary.tables.completed} |
| Partially Completed | ${components.systemValidation.summary.tables.partial} |
| Failed | ${components.systemValidation.summary.tables.failed} |
| Total Records Migrated | ${components.systemValidation.summary.records.total.toLocaleString()} |
| Overall Success Rate | ${((components.systemValidation.summary.tables.completed / components.systemValidation.summary.tables.total) * 100).toFixed(1)}% |

## Record Distribution by Table

${components.systemValidation.summary.records.byTable
  .sort((a, b) => b.count - a.count)
  .map(t => `- **${t.table}**: ${t.count.toLocaleString()} records`)
  .join('\n')}

## System Validation Summary

- **Database Connectivity**: ${components.systemValidation.systemChecks.connectivity.isValid ? '✅ PASSED' : '❌ FAILED'}
- **Schema Validation**: ${components.systemValidation.systemChecks.schema.isValid ? '✅ PASSED' : '❌ FAILED'}
- **Dependencies**: ${components.systemValidation.systemChecks.dependencies.isValid ? '✅ PASSED' : '❌ FAILED'}
- **Relationships**: ${components.systemValidation.systemChecks.relationships.isValid ? '✅ PASSED' : '❌ FAILED'}
- **Performance**: ${components.systemValidation.systemChecks.performance.isValid ? '✅ PASSED' : '❌ FAILED'}
- **Data Integrity**: ${components.systemValidation.systemChecks.integrity.isValid ? '✅ PASSED' : '❌ FAILED'}

---

*This comprehensive report documents the completion of the final database migration phase, including all remaining tables from the legacy system to the modern Supabase architecture. The migration preserves data integrity while establishing UUID-based relationships and comprehensive audit trails.*

**🔗 Related Documents**:
- Individual table migration reports (TABLENAME_MIGRATION_REPORT.md)
- Individual table validation reports (TABLENAME_VALIDATION_REPORT.md)
- Final system validation report (FINAL_SYSTEM_VALIDATION_REPORT.md)

**📞 Support**: For questions about this migration or system issues, refer to the project documentation and migration logs preserved in the dataload directory.
`;
  }
}

// Main execution
async function main() {
  try {
    const generator = new ComprehensiveFinalReportGenerator();
    const report = await generator.generateComprehensiveReport();

    console.log('\n=== COMPREHENSIVE FINAL REPORT GENERATED ===');
    console.log('📋 Report includes:');
    console.log('   - Executive summary with business impact');
    console.log('   - Detailed technical validation results');
    console.log('   - Performance metrics and statistics');
    console.log('   - Production readiness recommendations');
    console.log('   - Complete migration audit trail');
    console.log('=============================================\n');

    // Also generate a brief console summary
    console.log('📊 Quick Summary:');
    console.log('   📁 Report saved as: COMPREHENSIVE_FINAL_MIGRATION_REPORT.md');
    console.log('   📈 Contains complete migration documentation');
    console.log('   🔍 Includes system readiness assessment');
    console.log('   💡 Provides actionable recommendations');

  } catch (error) {
    console.error('❌ Failed to generate comprehensive report:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { main as generateComprehensiveFinalReport, ComprehensiveFinalReportGenerator };