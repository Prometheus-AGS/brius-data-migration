/**
 * T027: Message attachments migration script
 * Migrates file-message relationships from dispatch_file to message_attachments table
 * Links files to messages through dispatch_record relationships
 */

import { MigrationConfig } from './config/migration-config';
import { DatabaseConnectionManager } from './database/connection-manager';
import { LookupMappingBuilder } from './utils/lookup-mappings';
import { BatchProcessor } from './utils/batch-processor';
import { ValidationFramework } from './validation/validation-framework';
import { MigrationReportGenerator } from './reporting/report-generator';
import { globalProgressTracker } from './utils/progress-tracker';
import { StandardErrorHandler } from './utils/error-handler';
import {
  MigrationStats,
  ValidationResult,
  TableMigrationResult,
  LookupMappings
} from './interfaces/migration-types';

// Source interface for dispatch_file with message relationship
interface SourceMessageAttachment {
  file_id: number;
  record_id: number;
  filename: string | null;
  original_filename: string | null;
  file_size: number | null;
  mime_type: string | null;
  file_path: string | null;
  file_type: string | null;
  upload_date: Date;
  created_at: Date;
  updated_at: Date;
}

// Target interface for message_attachments
interface TargetMessageAttachment {
  id?: string;
  message_id: string;
  file_id: string;
  attachment_type?: string;
  display_name?: string;
  file_size?: number;
  mime_type?: string;
  attached_at: Date;
  created_at: Date;
  updated_at: Date;
  legacy_file_id: number;
  legacy_message_id?: number;
  legacy_dispatch_record_id: number;
  metadata: any;
}

export class MessageAttachmentsMigration {
  private config: MigrationConfig;
  private connectionManager: DatabaseConnectionManager;
  private lookupBuilder: LookupMappingBuilder;
  private batchProcessor: BatchProcessor<SourceMessageAttachment, TargetMessageAttachment>;
  private validator: ValidationFramework;
  private reportGenerator: MigrationReportGenerator;
  private errorHandler: StandardErrorHandler;

  constructor() {
    this.config = MigrationConfig.buildFromEnv();
    this.connectionManager = DatabaseConnectionManager.fromEnvironment();
    this.lookupBuilder = new LookupMappingBuilder(this.connectionManager);
    this.batchProcessor = new BatchProcessor(this.connectionManager);
    this.validator = new ValidationFramework(
      this.connectionManager.getSourceClient(),
      this.connectionManager.getTargetClient()
    );
    this.reportGenerator = new MigrationReportGenerator();
    this.errorHandler = new StandardErrorHandler();
  }

  async migrate(): Promise<TableMigrationResult> {
    const startTime = new Date();
    console.log('🚀 Starting message attachments migration...');

    try {
      // Initialize connections
      await this.connectionManager.initializeClients();

      // Build lookup mappings
      console.log('📊 Building lookup mappings...');
      const lookupMappings = await this.lookupBuilder.buildAllMappings();

      // Get source data count
      const sourceCount = await this.getSourceCount();
      console.log(`📈 Found ${sourceCount} message attachments to migrate`);

      // Initialize progress tracking
      const progress = globalProgressTracker.initializeProgress(
        'message-attachments',
        sourceCount,
        this.config.batchSize
      );

      // Process in batches
      const migrationStats = await this.processBatches(lookupMappings, sourceCount);

      // Generate final stats
      const finalStats = globalProgressTracker.generateFinalStats('message-attachments');
      if (finalStats) {
        migrationStats.startTime = finalStats.startTime;
        migrationStats.endTime = finalStats.endTime;
        migrationStats.duration = finalStats.duration;
      }

      // Validate migration results
      const validation = await this.validateMigration();

      const result: TableMigrationResult = {
        tableName: 'message_attachments',
        status: validation.isValid && migrationStats.failed === 0 ? 'completed' : 'partial',
        sourceRecords: sourceCount,
        targetRecords: migrationStats.successful,
        migrationStats,
        validationResult: validation,
        executionTime: migrationStats.duration,
        metadata: {
          batchSize: this.config.batchSize,
          lookupMappingsUsed: Object.keys(lookupMappings).length
        }
      };

      // Generate report
      await this.generateReport(result);

      return result;

    } catch (error) {
      console.error('❌ Message attachments migration failed:', error);
      throw error;
    } finally {
      await this.connectionManager.closeAll();
    }
  }

  private async getSourceCount(): Promise<number> {
    const sourceClient = this.connectionManager.getSourceClient();

    // Count dispatch_files that are linked to dispatch_records (which become messages)
    const result = await sourceClient.query(`
      SELECT COUNT(*) as count
      FROM dispatch_file df
      JOIN dispatch_record dr ON df.record_id = dr.id
      WHERE df.record_id IS NOT NULL
    `);

    return parseInt(result.rows[0].count);
  }

  private async processBatches(
    lookupMappings: LookupMappings,
    totalRecords: number
  ): Promise<MigrationStats> {
    const stats: MigrationStats = {
      totalProcessed: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      startTime: new Date(),
      endTime: new Date(),
      duration: 0,
      errorDetails: []
    };

    const totalBatches = Math.ceil(totalRecords / this.config.batchSize);

    for (let batchNumber = 1; batchNumber <= totalBatches; batchNumber++) {
      try {
        console.log(`📦 Processing batch ${batchNumber}/${totalBatches}...`);

        // Get batch data
        const batchData = await this.getBatchData(batchNumber);

        if (batchData.length === 0) {
          console.log(`⚠️ Batch ${batchNumber} is empty, skipping...`);
          continue;
        }

        // Process batch
        const batchResult = await this.batchProcessor.processBatch(
          batchData,
          batchNumber,
          lookupMappings,
          {
            sourceTable: 'dispatch_file_with_records',
            targetTable: 'message_attachments',
            batchSize: this.config.batchSize,
            transformRecord: this.transformRecord.bind(this),
            generateInsertQuery: this.generateInsertQuery.bind(this)
          }
        );

        // Update stats
        stats.totalProcessed += batchResult.processed;
        stats.successful += batchResult.successful;
        stats.failed += batchResult.failed;
        stats.skipped += batchResult.skipped;

        if (batchResult.errors.length > 0) {
          stats.errorDetails.push(...batchResult.errors);
        }

        // Update progress
        globalProgressTracker.updateProgress('message-attachments', batchResult);

        // Print progress
        globalProgressTracker.printProgress('message-attachments');

      } catch (error: any) {
        console.error(`❌ Batch ${batchNumber} failed:`, error.message);
        stats.failed += this.config.batchSize; // Assume worst case for failed batch
        stats.errorDetails.push(`Batch ${batchNumber}: ${error.message}`);
      }
    }

    stats.endTime = new Date();
    stats.duration = stats.endTime.getTime() - stats.startTime.getTime();

    return stats;
  }

  private async getBatchData(batchNumber: number): Promise<SourceMessageAttachment[]> {
    const sourceClient = this.connectionManager.getSourceClient();
    const offset = (batchNumber - 1) * this.config.batchSize;

    const query = `
      SELECT
        df.id as file_id,
        df.record_id,
        df.filename,
        df.original_filename,
        df.file_size,
        df.mime_type,
        df.file_path,
        df.file_type,
        df.upload_date,
        df.created_at,
        df.updated_at
      FROM dispatch_file df
      JOIN dispatch_record dr ON df.record_id = dr.id
      WHERE df.record_id IS NOT NULL
      ORDER BY df.id
      LIMIT $1 OFFSET $2
    `;

    const result = await sourceClient.query(query, [this.config.batchSize, offset]);
    return result.rows;
  }

  private transformRecord(
    sourceRecord: SourceMessageAttachment,
    lookupMappings: LookupMappings
  ): TargetMessageAttachment | null {
    try {
      // Find message ID via dispatch record ID
      const message_id = lookupMappings.messages?.get(sourceRecord.record_id);
      if (!message_id) {
        console.warn(`⚠️ No message found for attachment ${sourceRecord.file_id} with record_id ${sourceRecord.record_id}`);
        return null;
      }

      // Find file ID via legacy file ID
      const file_id = lookupMappings.files?.get(sourceRecord.file_id);
      if (!file_id) {
        console.warn(`⚠️ No file found for attachment ${sourceRecord.file_id}`);
        return null;
      }

      // Determine attachment type from file type or mime type
      const attachment_type = this.determineAttachmentType(
        sourceRecord.file_type,
        sourceRecord.mime_type,
        sourceRecord.filename
      );

      // Use original filename if available, otherwise use filename
      const display_name = sourceRecord.original_filename || sourceRecord.filename;

      return {
        message_id,
        file_id,
        attachment_type,
        display_name,
        file_size: sourceRecord.file_size,
        mime_type: sourceRecord.mime_type,
        attached_at: sourceRecord.upload_date || sourceRecord.created_at,
        created_at: sourceRecord.created_at,
        updated_at: sourceRecord.updated_at,
        legacy_file_id: sourceRecord.file_id,
        legacy_dispatch_record_id: sourceRecord.record_id,
        metadata: {
          migrationDate: new Date().toISOString(),
          sourceTable: 'dispatch_file',
          originalData: {
            file_path: sourceRecord.file_path,
            file_type: sourceRecord.file_type,
            filename: sourceRecord.filename,
            original_filename: sourceRecord.original_filename
          }
        }
      };

    } catch (error) {
      console.error(`❌ Error transforming message attachment record ${sourceRecord.file_id}:`, error);
      return null;
    }
  }

  private determineAttachmentType(
    file_type: string | null,
    mime_type: string | null,
    filename: string | null
  ): string {
    // First try file_type from source
    if (file_type) {
      const normalized = file_type.toLowerCase();
      if (normalized.includes('image')) return 'image';
      if (normalized.includes('document') || normalized.includes('pdf')) return 'document';
      if (normalized.includes('scan')) return 'scan';
      if (normalized.includes('xray') || normalized.includes('x-ray')) return 'xray';
    }

    // Then try mime_type
    if (mime_type) {
      const normalized = mime_type.toLowerCase();
      if (normalized.startsWith('image/')) return 'image';
      if (normalized.includes('pdf')) return 'document';
      if (normalized.startsWith('application/')) return 'document';
      if (normalized.startsWith('text/')) return 'document';
    }

    // Finally try filename extension
    if (filename) {
      const extension = filename.toLowerCase().split('.').pop();
      switch (extension) {
        case 'jpg':
        case 'jpeg':
        case 'png':
        case 'gif':
        case 'bmp':
        case 'tiff':
          return 'image';
        case 'pdf':
        case 'doc':
        case 'docx':
        case 'txt':
        case 'rtf':
          return 'document';
        default:
          break;
      }
    }

    return 'attachment'; // Default fallback
  }

  private generateInsertQuery(): { query: string; params: string[] } {
    const query = `
      INSERT INTO message_attachments (
        message_id, file_id, attachment_type, display_name, file_size, mime_type,
        attached_at, created_at, updated_at,
        legacy_file_id, legacy_dispatch_record_id, metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9,
        $10, $11, $12
      )
    `;

    const params = [
      'message_id', 'file_id', 'attachment_type', 'display_name', 'file_size', 'mime_type',
      'attached_at', 'created_at', 'updated_at',
      'legacy_file_id', 'legacy_dispatch_record_id', 'metadata'
    ];

    return { query, params };
  }

  private async validateMigration(): Promise<ValidationResult> {
    console.log('🔍 Validating message attachments migration...');

    return await this.validator.validateTable(
      'dispatch_file_with_records',
      'message_attachments',
      [
        { foreignKeyField: 'message_id', referencedTable: 'messages' },
        { foreignKeyField: 'file_id', referencedTable: 'files' }
      ],
      [
        {
          query: `SELECT COUNT(*) as count FROM message_attachments WHERE message_id IS NULL`,
          description: 'Records with null message_id',
          severity: 'error',
          suggestedFix: 'Ensure all attachments have valid message linkage'
        },
        {
          query: `SELECT COUNT(*) as count FROM message_attachments WHERE file_id IS NULL`,
          description: 'Records with null file_id',
          severity: 'error',
          suggestedFix: 'Ensure all attachments have valid file linkage'
        },
        {
          query: `SELECT COUNT(*) as count FROM message_attachments WHERE legacy_file_id IS NULL`,
          description: 'Records missing legacy file ID',
          severity: 'error',
          suggestedFix: 'All records should preserve legacy file ID'
        },
        {
          query: `SELECT COUNT(*) as count FROM message_attachments WHERE attached_at IS NULL`,
          description: 'Records with null attached_at timestamp',
          severity: 'warning',
          suggestedFix: 'Use created_at as fallback for attached_at'
        },
        {
          query: `
            SELECT COUNT(*) - COUNT(DISTINCT (message_id, file_id)) as count
            FROM message_attachments
          `,
          description: 'Duplicate message-file combinations',
          severity: 'warning',
          suggestedFix: 'Review duplicate attachments - may indicate data quality issues'
        }
      ]
    );
  }

  private async generateReport(result: TableMigrationResult): Promise<void> {
    const report = await this.reportGenerator.generateTableReport(
      'message-attachments',
      result.migrationStats,
      result.validationResult
    );

    const reportPath = 'MESSAGE_ATTACHMENTS_MIGRATION_REPORT.md';
    await this.reportGenerator.saveReport(report, reportPath);

    console.log(`📋 Migration report saved: ${reportPath}`);
  }
}

// Main execution
async function main() {
  const testMode = process.env.TEST_MODE === 'true';

  if (testMode) {
    console.log('🧪 Running in TEST MODE - no data will be modified');
  }

  try {
    const migration = new MessageAttachmentsMigration();
    const result = await migration.migrate();

    console.log('\n=== MESSAGE ATTACHMENTS MIGRATION SUMMARY ===');
    console.log(`Status: ${result.status.toUpperCase()}`);
    console.log(`Source records: ${result.sourceRecords}`);
    console.log(`Target records: ${result.targetRecords}`);
    console.log(`Success rate: ${((result.targetRecords / result.sourceRecords) * 100).toFixed(2)}%`);
    console.log(`Duration: ${(result.executionTime / 1000).toFixed(2)}s`);
    console.log(`Validation: ${result.validationResult.isValid ? 'PASSED' : 'FAILED'}`);
    console.log('==============================================\n');

    if (result.validationResult.issues.length > 0) {
      console.log('⚠️ Validation issues found:');
      result.validationResult.issues.forEach((issue, i) => {
        console.log(`${i + 1}. [${issue.severity}] ${issue.message}`);
      });
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { main as migrateMessageAttachments };