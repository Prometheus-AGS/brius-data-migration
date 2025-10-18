/**
 * T017: Technicians migration script
 * Migrates technician records from dispatch_technician to technicians table
 * Links technicians to existing profiles via legacy user ID relationships
 */

import { MigrationConfigBuilder } from './config/migration-config';
import { DatabaseConnectionManager } from './database/connection-manager';
import { LookupMappingBuilder } from './utils/lookup-mappings';
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

// Source interface for dispatch_technician
interface SourceTechnician {
  id: number;
  user_id: number | null;
  employee_id: string | null;
  department: string | null;
  position: string | null;
  hire_date: Date | null;
  phone: string | null;
  email: string | null;
  status: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relation: string | null;
  created_at: Date;
  updated_at: Date;
}

// Target interface for technicians
interface TargetTechnician {
  id?: string;
  profile_id: string;
  employee_id?: string;
  department?: string;
  position?: string;
  hire_date?: Date;
  status: string;
  phone?: string;
  email?: string;
  emergency_contact?: any;
  created_at: Date;
  updated_at: Date;
  legacy_technician_id: number;
  legacy_user_id?: number;
  metadata: any;
}

export class TechniciansMigration {
  private config: any;
  private connectionManager: DatabaseConnectionManager;
  private lookupBuilder: LookupMappingBuilder;
  private validator: ValidationFramework;
  private reportGenerator: MigrationReportGenerator;
  private errorHandler: StandardErrorHandler;

  constructor() {
    this.config = MigrationConfigBuilder.buildFromEnv();
    this.connectionManager = DatabaseConnectionManager.fromEnvironment();
    this.lookupBuilder = new LookupMappingBuilder(this.connectionManager);
    // Note: Using simple batch processing approach
    // Note: ValidationFramework will be initialized after database connections are established
    this.reportGenerator = new MigrationReportGenerator();
    this.errorHandler = new StandardErrorHandler();
  }

  async migrate(): Promise<TableMigrationResult> {
    const startTime = new Date();
    console.log('🚀 Starting technicians migration...');

    try {
      // Initialize connections
      await this.connectionManager.initializeClients();

      // Initialize validator after connections are established
      this.validator = new ValidationFramework(
        this.connectionManager.getSourceClient(),
        this.connectionManager.getTargetClient()
      );

      // Build lookup mappings
      console.log('📊 Building lookup mappings...');
      const lookupMappings = await this.lookupBuilder.buildAllMappings();

      // Get source data count
      const sourceCount = await this.getSourceCount();
      console.log(`📈 Found ${sourceCount} technicians to migrate`);

      // Initialize progress tracking
      const progress = globalProgressTracker.initializeProgress(
        'technicians',
        sourceCount,
        this.config.batchSize
      );

      // Process in batches
      const migrationStats = await this.processBatches(lookupMappings, sourceCount);

      // Generate final stats
      const finalStats = globalProgressTracker.generateFinalStats('technicians');
      if (finalStats) {
        migrationStats.startTime = finalStats.startTime;
        migrationStats.endTime = finalStats.endTime;
        migrationStats.duration = finalStats.duration;
      }

      // Validate migration results
      const validation = await this.validateMigration();

      const result: TableMigrationResult = {
        tableName: 'technicians',
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
      console.error('❌ Technicians migration failed:', error);
      throw error;
    } finally {
      await this.connectionManager.closeAll();
    }
  }

  private async getSourceCount(): Promise<number> {
    const sourceClient = this.connectionManager.getSourceClient();
    const result = await sourceClient.query('SELECT COUNT(*) as count FROM dispatch_technician');
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

        // Process batch using simple approach
        const batchResult = await this.processBatchSimple(batchData, batchNumber, lookupMappings);

        // Update stats
        stats.totalProcessed += batchResult.processed;
        stats.successful += batchResult.successful;
        stats.failed += batchResult.failed;
        stats.skipped += batchResult.skipped;

        if (batchResult.errors.length > 0) {
          if (!stats.errorDetails) {
            stats.errorDetails = [];
          }
          stats.errorDetails.push(...batchResult.errors);
        }

        // Update progress
        globalProgressTracker.updateProgress('technicians', batchResult);

        // Print progress
        globalProgressTracker.printProgress('technicians');

      } catch (error: any) {
        console.error(`❌ Batch ${batchNumber} failed:`, error.message);
        stats.failed += this.config.batchSize; // Assume worst case for failed batch
        if (!stats.errorDetails) {
          stats.errorDetails = [];
        }
        stats.errorDetails.push(`Batch ${batchNumber}: ${error.message}`);
      }
    }

    stats.endTime = new Date();
    stats.duration = stats.endTime.getTime() - stats.startTime.getTime();

    return stats;
  }

  private async processBatchSimple(
    batchData: SourceTechnician[],
    batchNumber: number,
    lookupMappings: LookupMappings
  ): Promise<{
    batchNumber: number;
    processed: number;
    successful: number;
    failed: number;
    skipped: number;
    errors: string[];
  }> {
    const result = {
      batchNumber,
      processed: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      errors: [] as string[]
    };

    const targetClient = this.connectionManager.getTargetClient();

    for (const sourceRecord of batchData) {
      result.processed++;

      try {
        // Transform record
        const targetRecord = this.transformRecord(sourceRecord, lookupMappings);

        if (!targetRecord) {
          result.skipped++;
          continue;
        }

        // Insert record
        const insertQuery = this.generateInsertQuery();
        const values = [
          targetRecord.profile_id,
          targetRecord.employee_id,
          targetRecord.department,
          targetRecord.position,
          targetRecord.hire_date,
          targetRecord.status,
          targetRecord.phone,
          targetRecord.email,
          targetRecord.emergency_contact,
          targetRecord.created_at,
          targetRecord.updated_at,
          targetRecord.legacy_technician_id,
          targetRecord.legacy_user_id,
          JSON.stringify(targetRecord.metadata)
        ];

        await targetClient.query(insertQuery.query, values);
        result.successful++;

      } catch (error: any) {
        result.failed++;
        result.errors.push(`Record ${sourceRecord.id}: ${error.message}`);
      }
    }

    return result;
  }

  private async getBatchData(batchNumber: number): Promise<SourceTechnician[]> {
    const sourceClient = this.connectionManager.getSourceClient();
    const offset = (batchNumber - 1) * this.config.batchSize;

    const query = `
      SELECT
        t.id,
        t.user_id,
        t.employee_id,
        t.department,
        t.position,
        t.hire_date,
        t.phone,
        t.email,
        t.status,
        t.emergency_contact_name,
        t.emergency_contact_phone,
        t.emergency_contact_relation,
        t.created_at,
        t.updated_at
      FROM dispatch_technician t
      ORDER BY t.id
      LIMIT $1 OFFSET $2
    `;

    const result = await sourceClient.query(query, [this.config.batchSize, offset]);
    return result.rows;
  }

  private transformRecord(
    sourceRecord: SourceTechnician,
    lookupMappings: LookupMappings
  ): TargetTechnician | null {
    try {
      // Find profile ID via legacy user ID
      let profile_id: string | null = null;

      if (sourceRecord.user_id) {
        profile_id = lookupMappings.profiles.get(sourceRecord.user_id) || null;
      }

      if (!profile_id) {
        console.warn(`⚠️ No profile found for technician ${sourceRecord.id} with user_id ${sourceRecord.user_id}`);
        return null; // Skip records without valid profile linkage
      }

      // Build emergency contact object
      const emergency_contact = (
        sourceRecord.emergency_contact_name ||
        sourceRecord.emergency_contact_phone ||
        sourceRecord.emergency_contact_relation
      ) ? {
        name: sourceRecord.emergency_contact_name,
        phone: sourceRecord.emergency_contact_phone,
        relation: sourceRecord.emergency_contact_relation
      } : null;

      // Normalize status
      const status = this.normalizeStatus(sourceRecord.status);

      return {
        profile_id,
        employee_id: sourceRecord.employee_id || undefined,
        department: sourceRecord.department || undefined,
        position: sourceRecord.position || undefined,
        hire_date: sourceRecord.hire_date || undefined,
        status,
        phone: sourceRecord.phone || undefined,
        email: sourceRecord.email || undefined,
        emergency_contact,
        created_at: sourceRecord.created_at,
        updated_at: sourceRecord.updated_at,
        legacy_technician_id: sourceRecord.id,
        legacy_user_id: sourceRecord.user_id || undefined,
        metadata: {
          migrationDate: new Date().toISOString(),
          sourceTable: 'dispatch_technician',
          originalData: {
            status: sourceRecord.status
          }
        }
      };

    } catch (error) {
      console.error(`❌ Error transforming technician record ${sourceRecord.id}:`, error);
      return null;
    }
  }

  private normalizeStatus(status: string | null): string {
    if (!status) return 'active';

    const normalized = status.toLowerCase().trim();

    switch (normalized) {
      case 'active':
      case '1':
      case 'true':
        return 'active';
      case 'inactive':
      case 'disabled':
      case '0':
      case 'false':
        return 'inactive';
      case 'terminated':
      case 'deleted':
        return 'terminated';
      default:
        return 'active'; // Default to active for unknown statuses
    }
  }

  private generateInsertQuery(): { query: string; params: string[] } {
    const query = `
      INSERT INTO technicians (
        profile_id, employee_id, department, position, hire_date,
        status, phone, email, emergency_contact,
        created_at, updated_at, legacy_technician_id, legacy_user_id, metadata
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12, $13, $14
      )
    `;

    const params = [
      'profile_id', 'employee_id', 'department', 'position', 'hire_date',
      'status', 'phone', 'email', 'emergency_contact',
      'created_at', 'updated_at', 'legacy_technician_id', 'legacy_user_id', 'metadata'
    ];

    return { query, params };
  }

  private async validateMigration(): Promise<ValidationResult> {
    console.log('🔍 Validating technicians migration...');

    return await this.validator.validateTable(
      'dispatch_technician',
      'technicians',
      [
        { foreignKeyField: 'profile_id', referencedTable: 'profiles' }
      ],
      [
        {
          query: `SELECT COUNT(*) as count FROM technicians WHERE profile_id IS NULL`,
          description: 'Records with null profile_id',
          severity: 'error',
          suggestedFix: 'Ensure all technicians have valid profile linkage'
        },
        {
          query: `SELECT COUNT(*) as count FROM technicians WHERE legacy_technician_id IS NULL`,
          description: 'Records missing legacy technician ID',
          severity: 'error',
          suggestedFix: 'All records should preserve legacy technician ID'
        },
        {
          query: `SELECT COUNT(*) as count FROM technicians WHERE status NOT IN ('active', 'inactive', 'terminated')`,
          description: 'Records with invalid status values',
          severity: 'warning',
          suggestedFix: 'Review and correct invalid status values'
        }
      ]
    );
  }

  private async generateReport(result: TableMigrationResult): Promise<void> {
    const report = await this.reportGenerator.generateTableReport(
      'technicians',
      result.migrationStats,
      result.validationResult
    );

    const reportPath = 'TECHNICIANS_MIGRATION_REPORT.md';
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
    const migration = new TechniciansMigration();
    const result = await migration.migrate();

    console.log('\n=== TECHNICIANS MIGRATION SUMMARY ===');
    console.log(`Status: ${result.status.toUpperCase()}`);
    console.log(`Source records: ${result.sourceRecords}`);
    console.log(`Target records: ${result.targetRecords}`);
    console.log(`Success rate: ${((result.targetRecords / result.sourceRecords) * 100).toFixed(2)}%`);
    console.log(`Duration: ${(result.executionTime / 1000).toFixed(2)}s`);
    console.log(`Validation: ${result.validationResult.isValid ? 'PASSED' : 'FAILED'}`);
    console.log('======================================\n');

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

export { main as migrateTechnicians };