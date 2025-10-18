/**
 * T028: Message attachments validation script
 * Comprehensive validation for migrated message attachment records
 */

import { DatabaseConnectionManager } from '../src/database/connection-manager';
import { ValidationFramework, ForeignKeyCheck, IntegrityCheck } from '../src/validation/validation-framework';
import { MigrationReportGenerator } from '../src/reporting/report-generator';
import {
  ValidationResult,
  ValidationIssue,
  MigrationStats
} from '../src/interfaces/migration-types';

export class MessageAttachmentsValidator {
  private connectionManager: DatabaseConnectionManager;
  private validator: ValidationFramework;
  private reportGenerator: MigrationReportGenerator;

  constructor() {
    this.connectionManager = DatabaseConnectionManager.fromEnvironment();
    this.validator = new ValidationFramework(
      this.connectionManager.getSourceClient(),
      this.connectionManager.getTargetClient()
    );
    this.reportGenerator = new MigrationReportGenerator();
  }

  async validate(): Promise<ValidationResult> {
    console.log('🔍 Starting comprehensive message attachments validation...');

    try {
      // Initialize connections
      await this.connectionManager.initializeClients();

      // Run all validation checks
      const results: ValidationResult[] = [];

      // 1. Data completeness validation
      console.log('📊 Validating data completeness...');
      const completenessResult = await this.validateCompleteness();
      results.push(completenessResult);

      // 2. Foreign key integrity validation
      console.log('🔗 Validating foreign key relationships...');
      const foreignKeyResult = await this.validateForeignKeys();
      results.push(foreignKeyResult);

      // 3. Data integrity validation
      console.log('✅ Validating data integrity...');
      const integrityResult = await this.validateDataIntegrity();
      results.push(integrityResult);

      // 4. Business logic validation
      console.log('🏢 Validating business rules...');
      const businessResult = await this.validateBusinessRules();
      results.push(businessResult);

      // 5. Attachment-specific validation
      console.log('📎 Validating attachment-specific rules...');
      const attachmentSpecificResult = await this.validateAttachmentSpecificRules();
      results.push(attachmentSpecificResult);

      // Combine all results
      const combinedResult = this.combineValidationResults(results);

      // Generate validation report
      await this.generateValidationReport(combinedResult);

      console.log(`✅ Message attachments validation completed: ${combinedResult.isValid ? 'PASSED' : 'FAILED'}`);
      return combinedResult;

    } catch (error) {
      console.error('❌ Message attachments validation failed:', error);
      throw error;
    } finally {
      await this.connectionManager.closeAll();
    }
  }

  private async validateCompleteness(): Promise<ValidationResult> {
    // For completeness, we need to compare against dispatch_file records linked to dispatch_record
    const sourceClient = this.connectionManager.getSourceClient();
    const targetClient = this.connectionManager.getTargetClient();

    try {
      // Get source count (dispatch_files linked to dispatch_records)
      const sourceResult = await sourceClient.query(`
        SELECT COUNT(*) as count
        FROM dispatch_file df
        JOIN dispatch_record dr ON df.record_id = dr.id
        WHERE df.record_id IS NOT NULL
      `);
      const sourceCount = parseInt(sourceResult.rows[0].count);

      // Get target count
      const targetResult = await targetClient.query(`
        SELECT COUNT(*) as count FROM message_attachments
      `);
      const targetCount = parseInt(targetResult.rows[0].count);

      const missingRecords = Math.max(0, sourceCount - targetCount);

      const issues: ValidationIssue[] = [];
      if (missingRecords > 0) {
        issues.push({
          severity: 'warning',
          table: 'message_attachments',
          message: `Missing ${missingRecords} records (source: ${sourceCount}, target: ${targetCount})`,
          suggestedFix: 'Re-run migration to capture missed attachments'
        });
      }

      return {
        isValid: missingRecords === 0,
        totalRecords: targetCount,
        validRecords: targetCount,
        invalidRecords: 0,
        missingRecords,
        issues
      };

    } catch (error: any) {
      return {
        isValid: false,
        totalRecords: 0,
        validRecords: 0,
        invalidRecords: 0,
        missingRecords: 0,
        issues: [{
          severity: 'error',
          table: 'message_attachments',
          message: `Completeness validation failed: ${error.message}`
        }]
      };
    }
  }

  private async validateForeignKeys(): Promise<ValidationResult> {
    const foreignKeyChecks: ForeignKeyCheck[] = [
      {
        foreignKeyField: 'message_id',
        referencedTable: 'messages',
        description: 'Message attachment linkage'
      },
      {
        foreignKeyField: 'file_id',
        referencedTable: 'files',
        description: 'File attachment linkage'
      }
    ];

    return await this.validator.validateForeignKeys('message_attachments', foreignKeyChecks);
  }

  private async validateDataIntegrity(): Promise<ValidationResult> {
    const integrityChecks: IntegrityCheck[] = [
      // Check for null message_id (should not exist)
      {
        query: `SELECT COUNT(*) as count FROM message_attachments WHERE message_id IS NULL`,
        description: 'Records with missing message linkage',
        severity: 'error',
        suggestedFix: 'All attachments must be linked to a valid message'
      },

      // Check for null file_id (should not exist)
      {
        query: `SELECT COUNT(*) as count FROM message_attachments WHERE file_id IS NULL`,
        description: 'Records with missing file linkage',
        severity: 'error',
        suggestedFix: 'All attachments must be linked to a valid file'
      },

      // Check for missing legacy file ID
      {
        query: `SELECT COUNT(*) as count FROM message_attachments WHERE legacy_file_id IS NULL`,
        description: 'Records missing legacy file ID',
        severity: 'error',
        suggestedFix: 'All records should preserve legacy file ID for traceability'
      },

      // Check for duplicate legacy file IDs
      {
        query: `
          SELECT COUNT(*) - COUNT(DISTINCT legacy_file_id) as count
          FROM message_attachments
          WHERE legacy_file_id IS NOT NULL
        `,
        description: 'Duplicate legacy file IDs',
        severity: 'error',
        suggestedFix: 'Each legacy file ID should appear only once'
      },

      // Check for duplicate message-file combinations
      {
        query: `
          SELECT COUNT(*) - COUNT(DISTINCT (message_id, file_id)) as count
          FROM message_attachments
        `,
        description: 'Duplicate message-file combinations',
        severity: 'warning',
        suggestedFix: 'Review duplicate attachments - may indicate data quality issues'
      },

      // Check for null attached_at timestamps
      {
        query: `SELECT COUNT(*) as count FROM message_attachments WHERE attached_at IS NULL`,
        description: 'Records with null attached_at timestamp',
        severity: 'warning',
        suggestedFix: 'Use created_at as fallback for attached_at'
      },

      // Check for future attached_at timestamps
      {
        query: `
          SELECT COUNT(*) as count
          FROM message_attachments
          WHERE attached_at > NOW()
        `,
        description: 'Records with future attached_at timestamps',
        severity: 'warning',
        suggestedFix: 'Review attachments with future timestamps'
      },

      // Check for inconsistent file sizes
      {
        query: `
          SELECT COUNT(*) as count
          FROM message_attachments
          WHERE file_size IS NOT NULL
          AND file_size < 0
        `,
        description: 'Records with negative file sizes',
        severity: 'warning',
        suggestedFix: 'Correct negative file size values'
      }
    ];

    return await this.validator.validateIntegrity('message_attachments', integrityChecks);
  }

  private async validateBusinessRules(): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    const targetClient = this.connectionManager.getTargetClient();

    try {
      // Get total record count
      const countResult = await targetClient.query('SELECT COUNT(*) as count FROM message_attachments');
      const totalRecords = parseInt(countResult.rows[0].count);

      // Business Rule 1: Verify message-file relationships are logically consistent
      const orphanedMessageAttachments = await targetClient.query(`
        SELECT COUNT(*) as count
        FROM message_attachments ma
        LEFT JOIN messages m ON ma.message_id = m.id
        LEFT JOIN files f ON ma.file_id = f.id
        WHERE m.id IS NULL OR f.id IS NULL
      `);

      if (parseInt(orphanedMessageAttachments.rows[0].count) > 0) {
        issues.push({
          severity: 'error',
          table: 'message_attachments',
          message: `${orphanedMessageAttachments.rows[0].count} attachments with invalid message or file references`,
          suggestedFix: 'Verify messages and files migrations completed successfully'
        });
      }

      // Business Rule 2: Check for attachments with missing display names for important file types
      const importantFilesWithoutNames = await targetClient.query(`
        SELECT COUNT(*) as count
        FROM message_attachments
        WHERE attachment_type IN ('document', 'scan', 'xray')
        AND (display_name IS NULL OR display_name = '')
      `);

      if (parseInt(importantFilesWithoutNames.rows[0].count) > 0) {
        issues.push({
          severity: 'warning',
          table: 'message_attachments',
          message: `${importantFilesWithoutNames.rows[0].count} important files without display names`,
          suggestedFix: 'Consider providing display names for documents, scans, and x-rays'
        });
      }

      // Business Rule 3: Check for very large files that might cause performance issues
      const largeFiles = await targetClient.query(`
        SELECT COUNT(*) as count
        FROM message_attachments
        WHERE file_size > 100000000  -- 100MB
      `);

      if (parseInt(largeFiles.rows[0].count) > 0) {
        issues.push({
          severity: 'info',
          table: 'message_attachments',
          message: `${largeFiles.rows[0].count} attachments larger than 100MB`,
          suggestedFix: 'Monitor large files for performance impact'
        });
      }

      // Business Rule 4: Check for inconsistent attachment timestamps with message timestamps
      const timestampInconsistencies = await targetClient.query(`
        SELECT COUNT(*) as count
        FROM message_attachments ma
        JOIN messages m ON ma.message_id = m.id
        WHERE ma.attached_at < m.created_at - INTERVAL '1 hour'
      `);

      if (parseInt(timestampInconsistencies.rows[0].count) > 0) {
        issues.push({
          severity: 'info',
          table: 'message_attachments',
          message: `${timestampInconsistencies.rows[0].count} attachments with timestamps significantly before message creation`,
          suggestedFix: 'Review attachment timestamps for data accuracy'
        });
      }

      // Business Rule 5: Check for messages with unusually high attachment counts
      const messagesWithManyAttachments = await targetClient.query(`
        SELECT COUNT(*) as count
        FROM (
          SELECT message_id
          FROM message_attachments
          GROUP BY message_id
          HAVING COUNT(*) > 20
        ) high_attachment_messages
      `);

      if (parseInt(messagesWithManyAttachments.rows[0].count) > 0) {
        issues.push({
          severity: 'info',
          table: 'message_attachments',
          message: `${messagesWithManyAttachments.rows[0].count} messages with more than 20 attachments`,
          suggestedFix: 'Review high-attachment messages for data quality'
        });
      }

      return {
        isValid: issues.filter(i => i.severity === 'error').length === 0,
        totalRecords,
        validRecords: totalRecords - issues.filter(i => i.severity === 'error').length,
        invalidRecords: issues.filter(i => i.severity === 'error').length,
        missingRecords: 0,
        issues
      };

    } catch (error: any) {
      return {
        isValid: false,
        totalRecords: 0,
        validRecords: 0,
        invalidRecords: 0,
        missingRecords: 0,
        issues: [{
          severity: 'error',
          table: 'message_attachments',
          message: `Business rule validation failed: ${error.message}`
        }]
      };
    }
  }

  private async validateAttachmentSpecificRules(): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    const targetClient = this.connectionManager.getTargetClient();

    try {
      // Get total record count
      const countResult = await targetClient.query('SELECT COUNT(*) as count FROM message_attachments');
      const totalRecords = parseInt(countResult.rows[0].count);

      // Attachment Rule 1: Check attachment type distribution
      const attachmentTypeDistribution = await targetClient.query(`
        SELECT
          COALESCE(attachment_type, 'unknown') as type,
          COUNT(*) as count
        FROM message_attachments
        GROUP BY attachment_type
        ORDER BY count DESC
      `);

      let typeInfo = attachmentTypeDistribution.rows.map(r => `${r.type}(${r.count})`).join(', ');
      if (typeInfo.length > 200) {
        typeInfo = typeInfo.substring(0, 200) + '...';
      }

      issues.push({
        severity: 'info',
        table: 'message_attachments',
        message: `Attachment type distribution: ${typeInfo}`,
        suggestedFix: 'Review distribution for data quality insights'
      });

      // Attachment Rule 2: Check for attachments with unknown types
      const unknownTypes = await targetClient.query(`
        SELECT COUNT(*) as count
        FROM message_attachments
        WHERE attachment_type IN ('attachment', 'unknown') OR attachment_type IS NULL
      `);

      if (parseInt(unknownTypes.rows[0].count) > 0) {
        issues.push({
          severity: 'warning',
          table: 'message_attachments',
          message: `${unknownTypes.rows[0].count} attachments with unknown/generic type`,
          suggestedFix: 'Consider improving attachment type detection logic'
        });
      }

      // Attachment Rule 3: Check MIME type consistency with attachment type
      const mimeTypeInconsistencies = await targetClient.query(`
        SELECT COUNT(*) as count
        FROM message_attachments
        WHERE (
          (attachment_type = 'image' AND mime_type IS NOT NULL AND NOT mime_type LIKE 'image/%')
          OR
          (attachment_type = 'document' AND mime_type IS NOT NULL AND mime_type LIKE 'image/%')
        )
      `);

      if (parseInt(mimeTypeInconsistencies.rows[0].count) > 0) {
        issues.push({
          severity: 'warning',
          table: 'message_attachments',
          message: `${mimeTypeInconsistencies.rows[0].count} attachments with inconsistent type/MIME type`,
          suggestedFix: 'Review attachment type classification logic'
        });
      }

      // Attachment Rule 4: Check for missing MIME types for modern attachments
      const missingMimeTypes = await targetClient.query(`
        SELECT COUNT(*) as count
        FROM message_attachments
        WHERE attached_at > '2020-01-01'
        AND mime_type IS NULL
      `);

      if (parseInt(missingMimeTypes.rows[0].count) > 0) {
        issues.push({
          severity: 'info',
          table: 'message_attachments',
          message: `${missingMimeTypes.rows[0].count} recent attachments without MIME type`,
          suggestedFix: 'Consider backfilling MIME types for recent attachments'
        });
      }

      // Attachment Rule 5: Check for very small files that might be corrupted
      const tinyFiles = await targetClient.query(`
        SELECT COUNT(*) as count
        FROM message_attachments
        WHERE file_size IS NOT NULL
        AND file_size < 10
        AND attachment_type != 'text'
      `);

      if (parseInt(tinyFiles.rows[0].count) > 0) {
        issues.push({
          severity: 'warning',
          table: 'message_attachments',
          message: `${tinyFiles.rows[0].count} non-text attachments smaller than 10 bytes`,
          suggestedFix: 'Review very small files - may be corrupted or empty'
        });
      }

      return {
        isValid: issues.filter(i => i.severity === 'error').length === 0,
        totalRecords,
        validRecords: totalRecords - issues.filter(i => i.severity === 'error').length,
        invalidRecords: issues.filter(i => i.severity === 'error').length,
        missingRecords: 0,
        issues
      };

    } catch (error: any) {
      return {
        isValid: false,
        totalRecords: 0,
        validRecords: 0,
        invalidRecords: 0,
        missingRecords: 0,
        issues: [{
          severity: 'error',
          table: 'message_attachments',
          message: `Attachment-specific validation failed: ${error.message}`
        }]
      };
    }
  }

  private combineValidationResults(results: ValidationResult[]): ValidationResult {
    const allIssues = results.flatMap(r => r.issues);
    const totalRecords = Math.max(...results.map(r => r.totalRecords));
    const hasErrors = allIssues.some(i => i.severity === 'error');

    return {
      isValid: !hasErrors,
      totalRecords,
      validRecords: Math.min(...results.map(r => r.validRecords)),
      invalidRecords: Math.max(...results.map(r => r.invalidRecords)),
      missingRecords: Math.max(...results.map(r => r.missingRecords)),
      issues: allIssues
    };
  }

  private async generateValidationReport(result: ValidationResult): Promise<void> {
    // Create mock migration stats for report generation
    const migrationStats: MigrationStats = {
      totalProcessed: result.totalRecords,
      successful: result.validRecords,
      failed: result.invalidRecords,
      skipped: result.missingRecords,
      startTime: new Date(),
      endTime: new Date(),
      duration: 0,
      errorDetails: result.issues.filter(i => i.severity === 'error').map(i => i.message)
    };

    const report = await this.reportGenerator.generateTableReport(
      'message-attachments-validation',
      migrationStats,
      result
    );

    const reportPath = 'MESSAGE_ATTACHMENTS_VALIDATION_REPORT.md';
    await this.reportGenerator.saveReport(report, reportPath);

    console.log(`📋 Validation report saved: ${reportPath}`);
  }

  async getValidationSummary(): Promise<{
    totalRecords: number;
    validRecords: number;
    issues: { errors: number; warnings: number; info: number };
    status: 'passed' | 'failed';
    attachmentTypeDistribution: { [type: string]: number };
    averageFileSize: number;
    largeFileCount: number;
  }> {
    const result = await this.validate();

    const errors = result.issues.filter(i => i.severity === 'error').length;
    const warnings = result.issues.filter(i => i.severity === 'warning').length;
    const info = result.issues.filter(i => i.severity === 'info').length;

    // Get attachment statistics
    const targetClient = this.connectionManager.getTargetClient();

    const attachmentTypeDistribution: { [type: string]: number } = {};
    const typeResult = await targetClient.query(`
      SELECT COALESCE(attachment_type, 'unknown') as attachment_type, COUNT(*) as count
      FROM message_attachments
      GROUP BY attachment_type
      ORDER BY count DESC
    `);

    let totalSize = 0;
    let totalFiles = 0;
    let largeFileCount = 0;

    for (const row of typeResult.rows) {
      attachmentTypeDistribution[row.attachment_type] = parseInt(row.count);
    }

    const sizeResult = await targetClient.query(`
      SELECT
        AVG(file_size::numeric) as avg_size,
        COUNT(*) as total_files,
        COUNT(CASE WHEN file_size > 10000000 THEN 1 END) as large_files
      FROM message_attachments
      WHERE file_size IS NOT NULL
    `);

    const averageFileSize = sizeResult.rows[0]?.avg_size ? parseFloat(sizeResult.rows[0].avg_size) : 0;
    largeFileCount = sizeResult.rows[0]?.large_files ? parseInt(sizeResult.rows[0].large_files) : 0;

    return {
      totalRecords: result.totalRecords,
      validRecords: result.validRecords,
      issues: { errors, warnings, info },
      status: result.isValid ? 'passed' : 'failed',
      attachmentTypeDistribution,
      averageFileSize,
      largeFileCount
    };
  }
}

// Main execution
async function main() {
  try {
    const validator = new MessageAttachmentsValidator();
    const result = await validator.validate();

    console.log('\n=== MESSAGE ATTACHMENTS VALIDATION SUMMARY ===');
    console.log(`Status: ${result.isValid ? 'PASSED' : 'FAILED'}`);
    console.log(`Total records: ${result.totalRecords}`);
    console.log(`Valid records: ${result.validRecords}`);
    console.log(`Invalid records: ${result.invalidRecords}`);
    console.log(`Missing records: ${result.missingRecords}`);
    console.log(`Issues found: ${result.issues.length}`);

    if (result.issues.length > 0) {
      const errors = result.issues.filter(i => i.severity === 'error').length;
      const warnings = result.issues.filter(i => i.severity === 'warning').length;
      const info = result.issues.filter(i => i.severity === 'info').length;

      console.log(`  - Errors: ${errors}`);
      console.log(`  - Warnings: ${warnings}`);
      console.log(`  - Info: ${info}`);
    }
    console.log('===============================================\n');

    if (!result.isValid) {
      console.log('❌ Critical issues found:');
      result.issues
        .filter(i => i.severity === 'error')
        .forEach((issue, i) => {
          console.log(`${i + 1}. ${issue.message}`);
          if (issue.suggestedFix) {
            console.log(`   Fix: ${issue.suggestedFix}`);
          }
        });
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Validation failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { main as validateMessageAttachments };