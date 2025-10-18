/**
 * T019: Technician roles migration script
 * Migrates technician role assignments from dispatch_technician_role to technician_roles table
 * Links roles to existing technicians via legacy technician ID relationships
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

// Source interface for dispatch_technician_role
interface SourceTechnicianRole {
  id: number;
  technician_id: number;
  role_name: string;
  role_type: string | null;
  permissions: string | null; // JSON string or comma-separated
  scope_type: string | null;
  scope_id: number | null;
  effective_date: Date;
  expiry_date: Date | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

// Target interface for technician_roles
interface TargetTechnicianRole {
  id?: string;
  technician_id: string;
  role_name: string;
  role_type?: string;
  permissions?: any; // JSONB array
  scope_type?: string;
  scope_id?: string;
  effective_date: Date;
  expiry_date?: Date;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  legacy_role_id: number;
  legacy_technician_id: number;
  metadata: any;
}

export class TechnicianRolesMigration {
  private config: MigrationConfig;
  private connectionManager: DatabaseConnectionManager;
  private lookupBuilder: LookupMappingBuilder;
  private batchProcessor: BatchProcessor<SourceTechnicianRole, TargetTechnicianRole>;
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
    console.log('🚀 Starting technician roles migration...');

    try {
      // Initialize connections
      await this.connectionManager.initializeClients();

      // Build lookup mappings (including technicians)
      console.log('📊 Building lookup mappings...');
      const lookupMappings = await this.buildLookupMappings();

      // Get source data count
      const sourceCount = await this.getSourceCount();
      console.log(`📈 Found ${sourceCount} technician roles to migrate`);

      // Initialize progress tracking
      const progress = globalProgressTracker.initializeProgress(
        'technician-roles',
        sourceCount,
        this.config.batchSize
      );

      // Process in batches
      const migrationStats = await this.processBatches(lookupMappings, sourceCount);

      // Generate final stats
      const finalStats = globalProgressTracker.generateFinalStats('technician-roles');
      if (finalStats) {
        migrationStats.startTime = finalStats.startTime;
        migrationStats.endTime = finalStats.endTime;
        migrationStats.duration = finalStats.duration;
      }

      // Validate migration results
      const validation = await this.validateMigration();

      const result: TableMigrationResult = {
        tableName: 'technician_roles',
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
      console.error('❌ Technician roles migration failed:', error);
      throw error;
    } finally {
      await this.connectionManager.closeAll();
    }
  }

  private async buildLookupMappings(): Promise<LookupMappings & { technicians: Map<number, string> }> {
    const baseMappings = await this.lookupBuilder.buildAllMappings();

    // Build technician mapping (legacy_technician_id -> UUID)
    const technicianMapping = new Map<number, string>();
    const targetClient = this.connectionManager.getTargetClient();

    const technicianResult = await targetClient.query(`
      SELECT id, legacy_technician_id
      FROM technicians
      WHERE legacy_technician_id IS NOT NULL
    `);

    for (const row of technicianResult.rows) {
      technicianMapping.set(row.legacy_technician_id, row.id);
    }

    console.log(`📊 Built technician mapping: ${technicianMapping.size} entries`);

    return {
      ...baseMappings,
      technicians: technicianMapping
    };
  }

  private async getSourceCount(): Promise<number> {
    const sourceClient = this.connectionManager.getSourceClient();
    const result = await sourceClient.query('SELECT COUNT(*) as count FROM dispatch_technician_role');
    return parseInt(result.rows[0].count);
  }

  private async processBatches(
    lookupMappings: LookupMappings & { technicians: Map<number, string> },
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
            sourceTable: 'dispatch_technician_role',
            targetTable: 'technician_roles',
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
        globalProgressTracker.updateProgress('technician-roles', batchResult);

        // Print progress
        globalProgressTracker.printProgress('technician-roles');

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

  private async getBatchData(batchNumber: number): Promise<SourceTechnicianRole[]> {
    const sourceClient = this.connectionManager.getSourceClient();
    const offset = (batchNumber - 1) * this.config.batchSize;

    const query = `
      SELECT
        tr.id,
        tr.technician_id,
        tr.role_name,
        tr.role_type,
        tr.permissions,
        tr.scope_type,
        tr.scope_id,
        tr.effective_date,
        tr.expiry_date,
        tr.is_active,
        tr.created_at,
        tr.updated_at
      FROM dispatch_technician_role tr
      ORDER BY tr.id
      LIMIT $1 OFFSET $2
    `;

    const result = await sourceClient.query(query, [this.config.batchSize, offset]);
    return result.rows;
  }

  private transformRecord(
    sourceRecord: SourceTechnicianRole,
    lookupMappings: LookupMappings & { technicians: Map<number, string> }
  ): TargetTechnicianRole | null {
    try {
      // Find technician ID via legacy technician ID
      const technician_id = lookupMappings.technicians.get(sourceRecord.technician_id);

      if (!technician_id) {
        console.warn(`⚠️ No technician found for role ${sourceRecord.id} with technician_id ${sourceRecord.technician_id}`);
        return null; // Skip records without valid technician linkage
      }

      // Parse permissions
      const permissions = this.parsePermissions(sourceRecord.permissions);

      // Normalize role type
      const role_type = this.normalizeRoleType(sourceRecord.role_type);

      // Handle scope_id (could reference offices, departments, etc.)
      let scope_id: string | undefined;
      if (sourceRecord.scope_id && sourceRecord.scope_type === 'office') {
        // Try to map to office UUID if scope_type is office
        scope_id = lookupMappings.offices?.get(sourceRecord.scope_id);
      }
      // For other scope types, we'll leave scope_id as null for now
      // since we don't have department mappings in the current system

      return {
        technician_id,
        role_name: sourceRecord.role_name,
        role_type,
        permissions,
        scope_type: sourceRecord.scope_type,
        scope_id,
        effective_date: sourceRecord.effective_date,
        expiry_date: sourceRecord.expiry_date,
        is_active: sourceRecord.is_active,
        created_at: sourceRecord.created_at,
        updated_at: sourceRecord.updated_at,
        legacy_role_id: sourceRecord.id,
        legacy_technician_id: sourceRecord.technician_id,
        metadata: {
          migrationDate: new Date().toISOString(),
          sourceTable: 'dispatch_technician_role',
          originalData: {
            permissions: sourceRecord.permissions,
            scope_id: sourceRecord.scope_id
          }
        }
      };

    } catch (error) {
      console.error(`❌ Error transforming technician role record ${sourceRecord.id}:`, error);
      return null;
    }
  }

  private parsePermissions(permissions: string | null): any {
    if (!permissions) return [];

    try {
      // Try to parse as JSON first
      if (permissions.startsWith('[') || permissions.startsWith('{')) {
        return JSON.parse(permissions);
      }

      // Otherwise, split by comma and clean up
      return permissions
        .split(',')
        .map(p => p.trim())
        .filter(p => p.length > 0);

    } catch (error) {
      console.warn(`⚠️ Failed to parse permissions: ${permissions}`);
      return [];
    }
  }

  private normalizeRoleType(role_type: string | null): string | undefined {
    if (!role_type) return undefined;

    const normalized = role_type.toLowerCase().trim();

    switch (normalized) {
      case 'system':
      case 'admin':
      case 'administrator':
        return 'system';
      case 'clinical':
      case 'clinical_staff':
      case 'clinician':
        return 'clinical';
      case 'administrative':
      case 'admin_staff':
      case 'office':
        return 'administrative';
      default:
        return role_type; // Keep original if not recognized
    }
  }

  private generateInsertQuery(): { query: string; params: string[] } {
    const query = `
      INSERT INTO technician_roles (
        technician_id, role_name, role_type, permissions, scope_type, scope_id,
        effective_date, expiry_date, is_active,
        created_at, updated_at, legacy_role_id, legacy_technician_id, metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9,
        $10, $11, $12, $13, $14
      )
    `;

    const params = [
      'technician_id', 'role_name', 'role_type', 'permissions', 'scope_type', 'scope_id',
      'effective_date', 'expiry_date', 'is_active',
      'created_at', 'updated_at', 'legacy_role_id', 'legacy_technician_id', 'metadata'
    ];

    return { query, params };
  }

  private async validateMigration(): Promise<ValidationResult> {
    console.log('🔍 Validating technician roles migration...');

    return await this.validator.validateTable(
      'dispatch_technician_role',
      'technician_roles',
      [
        { foreignKeyField: 'technician_id', referencedTable: 'technicians' }
      ],
      [
        {
          query: `SELECT COUNT(*) as count FROM technician_roles WHERE technician_id IS NULL`,
          description: 'Records with null technician_id',
          severity: 'error',
          suggestedFix: 'Ensure all roles have valid technician linkage'
        },
        {
          query: `SELECT COUNT(*) as count FROM technician_roles WHERE legacy_role_id IS NULL`,
          description: 'Records missing legacy role ID',
          severity: 'error',
          suggestedFix: 'All records should preserve legacy role ID'
        },
        {
          query: `SELECT COUNT(*) as count FROM technician_roles WHERE role_name IS NULL OR role_name = ''`,
          description: 'Records with empty role names',
          severity: 'error',
          suggestedFix: 'All roles should have a name'
        },
        {
          query: `SELECT COUNT(*) as count FROM technician_roles WHERE effective_date IS NULL`,
          description: 'Records with null effective date',
          severity: 'error',
          suggestedFix: 'All roles should have an effective date'
        },
        {
          query: `SELECT COUNT(*) as count FROM technician_roles WHERE expiry_date < effective_date`,
          description: 'Records with expiry date before effective date',
          severity: 'warning',
          suggestedFix: 'Review date logic for expired roles'
        }
      ]
    );
  }

  private async generateReport(result: TableMigrationResult): Promise<void> {
    const report = await this.reportGenerator.generateTableReport(
      'technician-roles',
      result.migrationStats,
      result.validationResult
    );

    const reportPath = 'TECHNICIAN_ROLES_MIGRATION_REPORT.md';
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
    const migration = new TechnicianRolesMigration();
    const result = await migration.migrate();

    console.log('\n=== TECHNICIAN ROLES MIGRATION SUMMARY ===');
    console.log(`Status: ${result.status.toUpperCase()}`);
    console.log(`Source records: ${result.sourceRecords}`);
    console.log(`Target records: ${result.targetRecords}`);
    console.log(`Success rate: ${((result.targetRecords / result.sourceRecords) * 100).toFixed(2)}%`);
    console.log(`Duration: ${(result.executionTime / 1000).toFixed(2)}s`);
    console.log(`Validation: ${result.validationResult.isValid ? 'PASSED' : 'FAILED'}`);
    console.log('==========================================\n');

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

export { main as migrateTechnicianRoles };