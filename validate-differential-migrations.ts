/**
 * Comprehensive Differential Migration Validation
 * Validates all completed differential migrations and relationship integrity
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface ValidationResult {
  entity: string;
  sourceCount: number;
  targetCount: number;
  migratedCount: number;
  gap: number;
  gapPercentage: number;
  status: 'complete' | 'partial' | 'failed';
  issues: string[];
}

interface MigrationValidationReport {
  timestamp: Date;
  totalEntitiesChecked: number;
  completedMigrations: number;
  totalRecordsMigrated: number;
  overallStatus: 'success' | 'partial' | 'critical_issues';
  results: ValidationResult[];
  recommendations: string[];
  nextSteps: string[];
}

class DifferentialMigrationValidator {
  private sourcePool: Pool;
  private targetPool: Pool;

  constructor() {
    this.sourcePool = new Pool({
      host: process.env.SOURCE_DB_HOST,
      port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
      database: process.env.SOURCE_DB_NAME,
      user: process.env.SOURCE_DB_USER,
      password: process.env.SOURCE_DB_PASSWORD,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    this.targetPool = new Pool({
      host: process.env.TARGET_DB_HOST,
      port: parseInt(process.env.TARGET_DB_PORT || '5432'),
      database: process.env.TARGET_DB_NAME,
      user: process.env.TARGET_DB_USER,
      password: process.env.TARGET_DB_PASSWORD,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }

  /**
   * Validate offices migration
   */
  private async validateOffices(): Promise<ValidationResult> {
    const issues: string[] = [];

    try {
      const sourceResult = await this.sourcePool.query('SELECT COUNT(*) as count FROM dispatch_office');
      const targetResult = await this.targetPool.query('SELECT COUNT(*) as count FROM offices');
      const migratedResult = await this.targetPool.query('SELECT COUNT(*) as count FROM offices WHERE legacy_office_id IS NOT NULL');

      const sourceCount = parseInt(sourceResult.rows[0].count);
      const targetCount = parseInt(targetResult.rows[0].count);
      const migratedCount = parseInt(migratedResult.rows[0].count);
      const gap = sourceCount - migratedCount;
      const gapPercentage = sourceCount > 0 ? (gap / sourceCount) * 100 : 0;

      let status: 'complete' | 'partial' | 'failed' = 'complete';
      if (gap > 0) {
        if (gap < sourceCount * 0.05) status = 'partial'; // Less than 5% missing
        else status = 'failed';
        issues.push(`${gap} offices not migrated`);
      }

      return {
        entity: 'offices',
        sourceCount,
        targetCount,
        migratedCount,
        gap,
        gapPercentage,
        status,
        issues
      };
    } catch (error) {
      return {
        entity: 'offices',
        sourceCount: 0,
        targetCount: 0,
        migratedCount: 0,
        gap: 0,
        gapPercentage: 0,
        status: 'failed',
        issues: [`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`]
      };
    }
  }

  /**
   * Validate files migration
   */
  private async validateFiles(): Promise<ValidationResult> {
    const issues: string[] = [];

    try {
      const sourceResult = await this.sourcePool.query('SELECT COUNT(*) as count FROM dispatch_file');
      const targetResult = await this.targetPool.query('SELECT COUNT(*) as count FROM files');
      const migratedResult = await this.targetPool.query('SELECT COUNT(*) as count FROM files WHERE legacy_file_id IS NOT NULL');

      const sourceCount = parseInt(sourceResult.rows[0].count);
      const targetCount = parseInt(targetResult.rows[0].count);
      const migratedCount = parseInt(migratedResult.rows[0].count);
      const gap = sourceCount - migratedCount;
      const gapPercentage = sourceCount > 0 ? (gap / sourceCount) * 100 : 0;

      let status: 'complete' | 'partial' | 'failed' = 'complete';
      if (gap > 0) {
        if (gap < sourceCount * 0.05) status = 'partial';
        else status = 'failed';
        issues.push(`${gap} files not migrated`);
      }

      // Check file-order relationships
      const orphanedFilesResult = await this.targetPool.query(`
        SELECT COUNT(*) as count
        FROM files f
        WHERE f.order_id IS NOT NULL
        AND f.order_id NOT IN (SELECT id FROM orders)
      `);

      const orphanedFiles = parseInt(orphanedFilesResult.rows[0].count);
      if (orphanedFiles > 0) {
        issues.push(`${orphanedFiles} files have orphaned order references`);
        status = status === 'complete' ? 'partial' : status;
      }

      return {
        entity: 'files',
        sourceCount,
        targetCount,
        migratedCount,
        gap,
        gapPercentage,
        status,
        issues
      };
    } catch (error) {
      return {
        entity: 'files',
        sourceCount: 0,
        targetCount: 0,
        migratedCount: 0,
        gap: 0,
        gapPercentage: 0,
        status: 'failed',
        issues: [`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`]
      };
    }
  }

  /**
   * Validate messages migration
   */
  private async validateMessages(): Promise<ValidationResult> {
    const issues: string[] = [];

    try {
      const sourceResult = await this.sourcePool.query('SELECT COUNT(*) as count FROM dispatch_record');
      const targetResult = await this.targetPool.query('SELECT COUNT(*) as count FROM messages');
      const migratedResult = await this.targetPool.query('SELECT COUNT(*) as count FROM messages WHERE legacy_record_id IS NOT NULL');

      const sourceCount = parseInt(sourceResult.rows[0].count);
      const targetCount = parseInt(targetResult.rows[0].count);
      const migratedCount = parseInt(migratedResult.rows[0].count);
      const gap = sourceCount - migratedCount;
      const gapPercentage = sourceCount > 0 ? (gap / sourceCount) * 100 : 0;

      let status: 'complete' | 'partial' | 'failed' = 'complete';
      if (gap > 0) {
        if (gap < sourceCount * 0.05) status = 'partial';
        else status = 'failed';
        issues.push(`${gap} messages/records not migrated`);
      }

      return {
        entity: 'messages',
        sourceCount,
        targetCount,
        migratedCount,
        gap,
        gapPercentage,
        status,
        issues
      };
    } catch (error) {
      return {
        entity: 'messages',
        sourceCount: 0,
        targetCount: 0,
        migratedCount: 0,
        gap: 0,
        gapPercentage: 0,
        status: 'failed',
        issues: [`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`]
      };
    }
  }

  /**
   * Validate orders migration (even though incomplete)
   */
  private async validateOrders(): Promise<ValidationResult> {
    const issues: string[] = [];

    try {
      const sourceResult = await this.sourcePool.query('SELECT COUNT(*) as count FROM dispatch_instruction');
      const targetResult = await this.targetPool.query('SELECT COUNT(*) as count FROM orders');
      const migratedResult = await this.targetPool.query('SELECT COUNT(*) as count FROM orders WHERE legacy_instruction_id IS NOT NULL');

      const sourceCount = parseInt(sourceResult.rows[0].count);
      const targetCount = parseInt(targetResult.rows[0].count);
      const migratedCount = parseInt(migratedResult.rows[0].count);
      const gap = sourceCount - migratedCount;
      const gapPercentage = sourceCount > 0 ? (gap / sourceCount) * 100 : 0;

      let status: 'complete' | 'partial' | 'failed' = 'complete';
      if (gap > 0) {
        if (gap < sourceCount * 0.05) status = 'partial';
        else status = 'failed';
        issues.push(`${gap} orders not migrated (schema dependency issues)`);
      }

      return {
        entity: 'orders',
        sourceCount,
        targetCount,
        migratedCount,
        gap,
        gapPercentage,
        status,
        issues
      };
    } catch (error) {
      return {
        entity: 'orders',
        sourceCount: 0,
        targetCount: 0,
        migratedCount: 0,
        gap: 0,
        gapPercentage: 0,
        status: 'failed',
        issues: [`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`]
      };
    }
  }

  /**
   * Check relationship integrity
   */
  private async validateRelationshipIntegrity(): Promise<string[]> {
    const issues: string[] = [];

    try {
      // Check files -> orders relationships
      const fileOrderIssues = await this.targetPool.query(`
        SELECT COUNT(*) as count
        FROM files f
        WHERE f.order_id IS NOT NULL
        AND f.order_id NOT IN (SELECT id FROM orders)
      `);

      const fileOrderCount = parseInt(fileOrderIssues.rows[0].count);
      if (fileOrderCount > 0) {
        issues.push(`${fileOrderCount} files have broken order references`);
      }

      // Check orders -> profiles relationships
      const orderPatientIssues = await this.targetPool.query(`
        SELECT COUNT(*) as count
        FROM orders o
        WHERE o.patient_id IS NOT NULL
        AND o.patient_id NOT IN (SELECT id FROM profiles WHERE profile_type = 'patient')
      `);

      const orderPatientCount = parseInt(orderPatientIssues.rows[0].count);
      if (orderPatientCount > 0) {
        issues.push(`${orderPatientCount} orders have broken patient references`);
      }

      // Check messages -> profiles relationships
      const messageSenderIssues = await this.targetPool.query(`
        SELECT COUNT(*) as count
        FROM messages m
        WHERE m.sender_id IS NOT NULL
        AND m.sender_id NOT IN (SELECT id FROM profiles)
      `);

      const messageSenderCount = parseInt(messageSenderIssues.rows[0].count);
      if (messageSenderCount > 0) {
        issues.push(`${messageSenderCount} messages have broken sender references`);
      }

    } catch (error) {
      issues.push(`Relationship validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return issues;
  }

  /**
   * Main validation function
   */
  async validate(): Promise<MigrationValidationReport> {
    console.log('🔍 Starting comprehensive differential migration validation...');

    const results: ValidationResult[] = [];
    let totalRecordsMigrated = 0;

    // Validate each entity
    console.log('\n📊 Validating individual entities...');

    console.log('🏢 Validating offices...');
    const officesResult = await this.validateOffices();
    results.push(officesResult);
    totalRecordsMigrated += officesResult.migratedCount;

    console.log('📁 Validating files...');
    const filesResult = await this.validateFiles();
    results.push(filesResult);
    totalRecordsMigrated += filesResult.migratedCount;

    console.log('💬 Validating messages...');
    const messagesResult = await this.validateMessages();
    results.push(messagesResult);
    totalRecordsMigrated += messagesResult.migratedCount;

    console.log('📋 Validating orders...');
    const ordersResult = await this.validateOrders();
    results.push(ordersResult);
    totalRecordsMigrated += ordersResult.migratedCount;

    // Validate relationships
    console.log('\n🔗 Validating relationship integrity...');
    const relationshipIssues = await this.validateRelationshipIntegrity();

    // Generate overall assessment
    const completedMigrations = results.filter(r => r.status === 'complete').length;
    const partialMigrations = results.filter(r => r.status === 'partial').length;
    const failedMigrations = results.filter(r => r.status === 'failed').length;

    let overallStatus: 'success' | 'partial' | 'critical_issues';
    if (failedMigrations === 0 && partialMigrations <= 1) {
      overallStatus = 'success';
    } else if (completedMigrations >= 2) {
      overallStatus = 'partial';
    } else {
      overallStatus = 'critical_issues';
    }

    // Generate recommendations
    const recommendations: string[] = [];
    const nextSteps: string[] = [];

    if (ordersResult.status === 'failed') {
      recommendations.push('Orders migration blocked by schema dependencies - requires investigation of dispatch_doctor table availability');
      nextSteps.push('Investigate source database schema for doctor/office relationships');
      nextSteps.push('Consider alternative mapping strategy for orders migration');
    }

    if (relationshipIssues.length > 0) {
      recommendations.push('Relationship integrity issues detected - may affect application functionality');
      nextSteps.push('Fix broken foreign key references before production deployment');
    }

    if (completedMigrations >= 3) {
      recommendations.push('Majority of differential migrations completed successfully');
      nextSteps.push('Ready to deploy completed migrations to staging environment');
    }

    const report: MigrationValidationReport = {
      timestamp: new Date(),
      totalEntitiesChecked: results.length,
      completedMigrations,
      totalRecordsMigrated,
      overallStatus,
      results,
      recommendations,
      nextSteps
    };

    return report;
  }

  /**
   * Display validation report
   */
  displayReport(report: MigrationValidationReport): void {
    console.log('\n🎉 DIFFERENTIAL MIGRATION VALIDATION REPORT');
    console.log('==========================================');
    console.log(`📅 Timestamp: ${report.timestamp.toISOString()}`);
    console.log(`📊 Overall Status: ${report.overallStatus.toUpperCase()}`);
    console.log(`🎯 Entities Checked: ${report.totalEntitiesChecked}`);
    console.log(`✅ Completed Migrations: ${report.completedMigrations}`);
    console.log(`📁 Total Records Migrated: ${report.totalRecordsMigrated.toLocaleString()}`);

    console.log('\n📋 ENTITY-BY-ENTITY RESULTS:');
    console.log('=================================');

    report.results.forEach(result => {
      const statusIcon = result.status === 'complete' ? '✅' : result.status === 'partial' ? '⚠️' : '❌';
      console.log(`\n${statusIcon} ${result.entity.toUpperCase()}`);
      console.log(`   Source Records: ${result.sourceCount.toLocaleString()}`);
      console.log(`   Target Records: ${result.targetCount.toLocaleString()}`);
      console.log(`   Migrated Records: ${result.migratedCount.toLocaleString()}`);
      console.log(`   Gap: ${result.gap.toLocaleString()} (${result.gapPercentage.toFixed(2)}%)`);
      console.log(`   Status: ${result.status}`);

      if (result.issues.length > 0) {
        console.log(`   Issues:`);
        result.issues.forEach(issue => console.log(`     • ${issue}`));
      }
    });

    if (report.recommendations.length > 0) {
      console.log('\n💡 RECOMMENDATIONS:');
      report.recommendations.forEach((rec, i) => console.log(`   ${i + 1}. ${rec}`));
    }

    if (report.nextSteps.length > 0) {
      console.log('\n🔄 NEXT STEPS:');
      report.nextSteps.forEach((step, i) => console.log(`   ${i + 1}. ${step}`));
    }

    // Summary statistics
    const totalSourceRecords = report.results.reduce((sum, r) => sum + r.sourceCount, 0);
    const totalMigratedRecords = report.results.reduce((sum, r) => sum + r.migratedCount, 0);
    const overallSuccessRate = totalSourceRecords > 0 ? (totalMigratedRecords / totalSourceRecords) * 100 : 0;

    console.log('\n📈 SUMMARY STATISTICS:');
    console.log(`   Total Source Records: ${totalSourceRecords.toLocaleString()}`);
    console.log(`   Total Migrated Records: ${totalMigratedRecords.toLocaleString()}`);
    console.log(`   Overall Success Rate: ${overallSuccessRate.toFixed(2)}%`);

    if (overallSuccessRate >= 95) {
      console.log(`   🏆 ACHIEVEMENT: Excellent migration performance (${overallSuccessRate.toFixed(2)}%)`);
    } else if (overallSuccessRate >= 85) {
      console.log(`   👍 RESULT: Good migration performance (${overallSuccessRate.toFixed(2)}%)`);
    } else {
      console.log(`   ⚠️  CAUTION: Migration needs improvement (${overallSuccessRate.toFixed(2)}%)`);
    }
  }

  /**
   * Cleanup database connections
   */
  async cleanup(): Promise<void> {
    try {
      await this.sourcePool.end();
      await this.targetPool.end();
    } catch (error) {
      console.error('❌ Error during cleanup:', error);
    }
  }
}

// Main execution
async function main() {
  const validator = new DifferentialMigrationValidator();

  try {
    const report = await validator.validate();
    validator.displayReport(report);
  } catch (error) {
    console.error('❌ Validation failed:', error);
    process.exit(1);
  } finally {
    await validator.cleanup();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Script execution failed:', error);
    process.exit(1);
  });
}

export { DifferentialMigrationValidator };