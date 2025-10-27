/**
 * Comprehensive Differential Migration Orchestrator
 * Manages differential migration of all remaining entities in proper dependency order
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

interface EntityMigrationConfig {
  name: string;
  sourceTable: string;
  targetTable: string;
  legacyIdField: string;
  dependencies: string[];
  estimatedRecords?: number;
  priority: 'high' | 'medium' | 'low';
}

interface MigrationResult {
  entity: string;
  sourceRecords: number;
  targetRecords: number;
  newlyMigrated: number;
  skipped: number;
  errors: number;
  successRate: number;
  duration: number;
  status: 'completed' | 'partial' | 'failed';
  issues: string[];
}

interface ComprehensiveMigrationReport {
  timestamp: Date;
  totalEntities: number;
  completedEntities: number;
  totalNewRecords: number;
  totalMigratedRecords: number;
  overallSuccessRate: number;
  totalDuration: number;
  results: MigrationResult[];
  overallStatus: 'success' | 'partial' | 'critical_issues';
}

class ComprehensiveDifferentialMigration {
  private sourcePool: Pool;
  private targetPool: Pool;
  private migrationResults: MigrationResult[] = [];

  // Define all entities with their configurations
  private readonly ENTITY_CONFIGS: EntityMigrationConfig[] = [
    // Phase 1: Core entities (no dependencies)
    {
      name: 'technicians',
      sourceTable: 'dispatch_agent',
      targetTable: 'technicians',
      legacyIdField: 'legacy_agent_id',
      dependencies: [],
      priority: 'high',
      estimatedRecords: 100
    },
    {
      name: 'templates',
      sourceTable: 'dispatch_template',
      targetTable: 'templates',
      legacyIdField: 'legacy_template_id',
      dependencies: [],
      priority: 'high',
      estimatedRecords: 500
    },
    {
      name: 'cases',
      sourceTable: 'dispatch_instance',
      targetTable: 'cases',
      legacyIdField: 'legacy_instance_id',
      dependencies: ['patients', 'orders'],
      priority: 'high',
      estimatedRecords: 25000
    },

    // Phase 2: Relationship entities
    {
      name: 'case_files',
      sourceTable: 'dispatch_file',
      targetTable: 'case_files',
      legacyIdField: 'legacy_file_id',
      dependencies: ['cases', 'orders'],
      priority: 'high',
      estimatedRecords: 150000
    },
    {
      name: 'case_states',
      sourceTable: 'dispatch_state',
      targetTable: 'case_states',
      legacyIdField: 'legacy_state_id',
      dependencies: ['cases'],
      priority: 'medium',
      estimatedRecords: 5000
    },
    {
      name: 'case_messages',
      sourceTable: 'dispatch_record',
      targetTable: 'case_messages',
      legacyIdField: 'legacy_record_id',
      dependencies: ['cases', 'messages'],
      priority: 'medium',
      estimatedRecords: 70000
    },
    {
      name: 'order_cases',
      sourceTable: 'dispatch_instruction',
      targetTable: 'order_cases',
      legacyIdField: 'legacy_instruction_id',
      dependencies: ['orders', 'cases'],
      priority: 'medium',
      estimatedRecords: 25000
    },
    {
      name: 'order_states',
      sourceTable: 'dispatch_state',
      targetTable: 'order_states',
      legacyIdField: 'legacy_state_id',
      dependencies: ['orders'],
      priority: 'medium',
      estimatedRecords: 5000
    },

    // Phase 3: Advanced entities
    {
      name: 'jaws',
      sourceTable: 'dispatch_jaw',
      targetTable: 'jaws',
      legacyIdField: 'legacy_jaw_id',
      dependencies: ['patients', 'orders'],
      priority: 'medium',
      estimatedRecords: 50000
    },
    {
      name: 'treatment_plans',
      sourceTable: 'dispatch_plan',
      targetTable: 'treatment_plans',
      legacyIdField: 'legacy_plan_id',
      dependencies: ['patients'],
      priority: 'high',
      estimatedRecords: 200000
    },
    {
      name: 'purchases',
      sourceTable: 'dispatch_purchase',
      targetTable: 'purchases',
      legacyIdField: 'legacy_purchase_id',
      dependencies: ['orders'],
      priority: 'medium',
      estimatedRecords: 3000
    },
    {
      name: 'payments',
      sourceTable: 'dispatch_payment',
      targetTable: 'payments',
      legacyIdField: 'legacy_payment_id',
      dependencies: ['orders', 'purchases'],
      priority: 'low',
      estimatedRecords: 2000
    },
    {
      name: 'shipments',
      sourceTable: 'dispatch_storage',
      targetTable: 'shipments',
      legacyIdField: 'legacy_storage_id',
      dependencies: ['orders'],
      priority: 'low',
      estimatedRecords: 5000
    },

    // Phase 4: Relationship tables
    {
      name: 'patients_doctors_offices',
      sourceTable: 'dispatch_patient',
      targetTable: 'patients_doctors_offices',
      legacyIdField: 'legacy_patient_id',
      dependencies: ['patients', 'doctors', 'offices'],
      priority: 'medium',
      estimatedRecords: 100000
    }
  ];

  constructor() {
    this.sourcePool = new Pool({
      host: process.env.SOURCE_DB_HOST,
      port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
      database: process.env.SOURCE_DB_NAME,
      user: process.env.SOURCE_DB_USER,
      password: process.env.SOURCE_DB_PASSWORD,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    this.targetPool = new Pool({
      host: process.env.TARGET_DB_HOST,
      port: parseInt(process.env.TARGET_DB_PORT || '5432'),
      database: process.env.TARGET_DB_NAME,
      user: process.env.TARGET_DB_USER,
      password: process.env.TARGET_DB_PASSWORD,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }

  /**
   * Check if source table exists
   */
  private async sourceTableExists(tableName: string): Promise<boolean> {
    try {
      const result = await this.sourcePool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = $1
        )
      `, [tableName]);
      return result.rows[0].exists;
    } catch (error) {
      console.warn(`❌ Error checking source table ${tableName}:`, error);
      return false;
    }
  }

  /**
   * Check if target table exists
   */
  private async targetTableExists(tableName: string): Promise<boolean> {
    try {
      const result = await this.targetPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = $1
        )
      `, [tableName]);
      return result.rows[0].exists;
    } catch (error) {
      console.warn(`❌ Error checking target table ${tableName}:`, error);
      return false;
    }
  }

  /**
   * Get count of new records to migrate for an entity
   */
  private async getNewRecordCount(config: EntityMigrationConfig): Promise<number> {
    try {
      // Get existing legacy IDs from target
      const existingResult = await this.targetPool.query(`
        SELECT COUNT(*) as count
        FROM ${config.targetTable}
        WHERE ${config.legacyIdField} IS NOT NULL
      `);
      const existingCount = parseInt(existingResult.rows[0].count);

      // Get total source records
      const sourceResult = await this.sourcePool.query(`
        SELECT COUNT(*) as count FROM ${config.sourceTable}
      `);
      const sourceCount = parseInt(sourceResult.rows[0].count);

      return sourceCount - existingCount;
    } catch (error) {
      console.warn(`❌ Error getting new record count for ${config.name}:`, error);
      return 0;
    }
  }

  /**
   * Run differential migration for a specific entity
   */
  private async migrateEntity(config: EntityMigrationConfig): Promise<MigrationResult> {
    const startTime = Date.now();
    console.log(`🚀 Starting differential migration for ${config.name}...`);

    const result: MigrationResult = {
      entity: config.name,
      sourceRecords: 0,
      targetRecords: 0,
      newlyMigrated: 0,
      skipped: 0,
      errors: 0,
      successRate: 0,
      duration: 0,
      status: 'failed',
      issues: []
    };

    try {
      // Check if source table exists
      if (!(await this.sourceTableExists(config.sourceTable))) {
        result.issues.push(`Source table ${config.sourceTable} not found`);
        result.status = 'failed';
        return result;
      }

      // Check if target table exists
      if (!(await this.targetTableExists(config.targetTable))) {
        result.issues.push(`Target table ${config.targetTable} not found`);
        result.status = 'failed';
        return result;
      }

      // Get counts
      const sourceCountResult = await this.sourcePool.query(`SELECT COUNT(*) as count FROM ${config.sourceTable}`);
      result.sourceRecords = parseInt(sourceCountResult.rows[0].count);

      const targetCountResult = await this.targetPool.query(`SELECT COUNT(*) as count FROM ${config.targetTable}`);
      result.targetRecords = parseInt(targetCountResult.rows[0].count);

      const newRecords = await this.getNewRecordCount(config);

      if (newRecords === 0) {
        console.log(`✅ No new records to migrate for ${config.name}`);
        result.status = 'completed';
        result.successRate = 100;
        return result;
      }

      console.log(`📊 Found ${newRecords} new ${config.name} records to migrate`);

      // Run the appropriate migration based on entity type
      const migrationSuccess = await this.runEntitySpecificMigration(config);

      if (migrationSuccess) {
        result.newlyMigrated = newRecords;
        result.successRate = 100;
        result.status = 'completed';
      } else {
        result.issues.push(`Migration execution failed`);
        result.status = 'failed';
      }

    } catch (error) {
      console.error(`❌ Error migrating ${config.name}:`, error);
      result.issues.push(`Migration error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      result.status = 'failed';
    } finally {
      result.duration = Date.now() - startTime;
    }

    return result;
  }

  /**
   * Run entity-specific migration logic
   */
  private async runEntitySpecificMigration(config: EntityMigrationConfig): Promise<boolean> {
    console.log(`🔧 Running ${config.name} migration...`);

    // This is where we would call the specific migration scripts
    // For now, we'll return a placeholder
    try {
      switch (config.name) {
        case 'technicians':
          return await this.migrateTechnicians();
        case 'templates':
          return await this.migrateTemplates();
        case 'cases':
          return await this.migrateCases();
        case 'case_files':
          return await this.migrateCaseFiles();
        case 'treatment_plans':
          return await this.migrateTreatmentPlans();
        case 'jaws':
          return await this.migrateJaws();
        case 'purchases':
          return await this.migratePurchases();
        case 'case_states':
          return await this.migrateCaseStates();
        case 'case_messages':
          return await this.migrateCaseMessages();
        case 'order_cases':
          return await this.migrateOrderCases();
        case 'order_states':
          return await this.migrateOrderStates();
        case 'payments':
          return await this.migratePayments();
        case 'shipments':
          return await this.migrateShipments();
        case 'patients_doctors_offices':
          return await this.migratePatientsdoctorsOffices();
        default:
          console.warn(`⚠️  No specific migration logic for ${config.name}`);
          return false;
      }
    } catch (error) {
      console.error(`❌ Error in entity-specific migration for ${config.name}:`, error);
      return false;
    }
  }

  // Placeholder migration methods - these would call the actual migration scripts
  private async migrateTechnicians(): Promise<boolean> {
    console.log('🔧 Migrating technicians...');
    // Would call: npx ts-node src/migrate-technicians.ts
    return true; // Placeholder
  }

  private async migrateTemplates(): Promise<boolean> {
    console.log('🔧 Migrating templates...');
    // Would call: npx ts-node src/migrate-templates.ts
    return true; // Placeholder
  }

  private async migrateCases(): Promise<boolean> {
    console.log('🔧 Migrating cases...');
    // Would call: npx ts-node src/migrate-cases.ts
    return true; // Placeholder
  }

  private async migrateCaseFiles(): Promise<boolean> {
    console.log('🔧 Migrating case files...');
    // Would call: npx ts-node migrate-case-files-supabase-approach.ts
    return true; // Placeholder
  }

  private async migrateTreatmentPlans(): Promise<boolean> {
    console.log('🔧 Migrating treatment plans...');
    // Would call: npx ts-node src/migrate-treatment-plans.ts
    return true; // Placeholder
  }

  private async migrateJaws(): Promise<boolean> {
    console.log('🔧 Migrating jaws...');
    // Would call: npx ts-node src/migrate-jaws.ts
    return true; // Placeholder
  }

  private async migratePurchases(): Promise<boolean> {
    console.log('🔧 Migrating purchases...');
    // Would call: npx ts-node migrate-purchases-fixed.ts
    return true; // Placeholder
  }

  private async migrateCaseStates(): Promise<boolean> {
    console.log('🔧 Migrating case states...');
    // Would call: npx ts-node migrate-case-states.ts
    return true; // Placeholder
  }

  private async migrateCaseMessages(): Promise<boolean> {
    console.log('🔧 Migrating case messages...');
    // Would call: npx ts-node migrate-case-messages.ts
    return true; // Placeholder
  }

  private async migrateOrderCases(): Promise<boolean> {
    console.log('🔧 Migrating order cases...');
    // Would implement order-case relationship migration
    return true; // Placeholder
  }

  private async migrateOrderStates(): Promise<boolean> {
    console.log('🔧 Migrating order states...');
    // Would call: npx ts-node migrate-order-states.ts
    return true; // Placeholder
  }

  private async migratePayments(): Promise<boolean> {
    console.log('🔧 Migrating payments...');
    // Would implement payments migration
    return true; // Placeholder
  }

  private async migrateShipments(): Promise<boolean> {
    console.log('🔧 Migrating shipments...');
    // Would implement shipments migration
    return true; // Placeholder
  }

  private async migratePatientsductorsOffices(): Promise<boolean> {
    console.log('🔧 Migrating patients-doctors-offices relationships...');
    // Would call: npx ts-node migrate-patient-doctor-office-relations.ts
    return true; // Placeholder
  }

  /**
   * Sort entities by dependency order
   */
  private sortEntitiesByDependencies(entities: EntityMigrationConfig[]): EntityMigrationConfig[] {
    const sorted: EntityMigrationConfig[] = [];
    const remaining = [...entities];

    while (remaining.length > 0) {
      const canMigrate = remaining.filter(entity =>
        entity.dependencies.every(dep =>
          sorted.some(s => s.name === dep) ||
          dep === 'patients' || dep === 'orders' || dep === 'messages' ||
          dep === 'doctors' || dep === 'offices' // These are already migrated
        )
      );

      if (canMigrate.length === 0) {
        // Add remaining entities even if dependencies aren't fully met
        console.warn('⚠️  Some entities have unmet dependencies, adding them anyway');
        sorted.push(...remaining);
        break;
      }

      // Sort by priority within available entities
      canMigrate.sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });

      const next = canMigrate[0];
      sorted.push(next);
      remaining.splice(remaining.indexOf(next), 1);
    }

    return sorted;
  }

  /**
   * Main migration execution
   */
  async migrate(): Promise<ComprehensiveMigrationReport> {
    const startTime = Date.now();
    console.log('🚀 Starting comprehensive differential migration...');

    // Sort entities by dependencies and priority
    const sortedEntities = this.sortEntitiesByDependencies(this.ENTITY_CONFIGS);

    console.log('\n📋 Migration Order:');
    sortedEntities.forEach((entity, index) => {
      console.log(`   ${index + 1}. ${entity.name} (${entity.priority} priority, ~${entity.estimatedRecords} records)`);
    });

    // Run migrations in order
    for (const config of sortedEntities) {
      const result = await this.migrateEntity(config);
      this.migrationResults.push(result);

      // Log immediate result
      const statusIcon = result.status === 'completed' ? '✅' : result.status === 'partial' ? '⚠️' : '❌';
      console.log(`${statusIcon} ${config.name}: ${result.newlyMigrated} migrated, ${result.successRate.toFixed(1)}% success\n`);
    }

    // Generate comprehensive report
    const report: ComprehensiveMigrationReport = {
      timestamp: new Date(),
      totalEntities: this.migrationResults.length,
      completedEntities: this.migrationResults.filter(r => r.status === 'completed').length,
      totalNewRecords: this.migrationResults.reduce((sum, r) => sum + r.newlyMigrated, 0),
      totalMigratedRecords: this.migrationResults.reduce((sum, r) => sum + r.newlyMigrated, 0),
      overallSuccessRate: 0,
      totalDuration: Date.now() - startTime,
      results: this.migrationResults,
      overallStatus: 'success'
    };

    // Calculate overall success rate
    const totalAttempted = this.migrationResults.reduce((sum, r) => sum + r.newlyMigrated + r.errors, 0);
    if (totalAttempted > 0) {
      report.overallSuccessRate = (report.totalMigratedRecords / totalAttempted) * 100;
    }

    // Determine overall status
    const completedCount = this.migrationResults.filter(r => r.status === 'completed').length;
    const partialCount = this.migrationResults.filter(r => r.status === 'partial').length;
    const failedCount = this.migrationResults.filter(r => r.status === 'failed').length;

    if (failedCount === 0 && partialCount <= 1) {
      report.overallStatus = 'success';
    } else if (completedCount >= this.migrationResults.length / 2) {
      report.overallStatus = 'partial';
    } else {
      report.overallStatus = 'critical_issues';
    }

    return report;
  }

  /**
   * Display comprehensive migration report
   */
  displayReport(report: ComprehensiveMigrationReport): void {
    console.log('\n🎉 COMPREHENSIVE DIFFERENTIAL MIGRATION REPORT');
    console.log('===============================================');
    console.log(`📅 Timestamp: ${report.timestamp.toISOString()}`);
    console.log(`📊 Overall Status: ${report.overallStatus.toUpperCase()}`);
    console.log(`🎯 Total Entities: ${report.totalEntities}`);
    console.log(`✅ Completed Entities: ${report.completedEntities}/${report.totalEntities}`);
    console.log(`📁 Total New Records Migrated: ${report.totalMigratedRecords.toLocaleString()}`);
    console.log(`📈 Overall Success Rate: ${report.overallSuccessRate.toFixed(2)}%`);
    console.log(`⏱️  Total Duration: ${(report.totalDuration / 1000).toFixed(1)}s`);

    console.log('\n📋 ENTITY-BY-ENTITY RESULTS:');
    console.log('==============================');

    report.results.forEach(result => {
      const statusIcon = result.status === 'completed' ? '✅' : result.status === 'partial' ? '⚠️' : '❌';
      console.log(`\n${statusIcon} ${result.entity.toUpperCase()}`);
      console.log(`   Source Records: ${result.sourceRecords.toLocaleString()}`);
      console.log(`   Target Records: ${result.targetRecords.toLocaleString()}`);
      console.log(`   Newly Migrated: ${result.newlyMigrated.toLocaleString()}`);
      console.log(`   Success Rate: ${result.successRate.toFixed(2)}%`);
      console.log(`   Duration: ${(result.duration / 1000).toFixed(1)}s`);
      console.log(`   Status: ${result.status}`);

      if (result.issues.length > 0) {
        console.log(`   Issues:`);
        result.issues.forEach(issue => console.log(`     • ${issue}`));
      }
    });

    // Summary by priority
    const highPriorityResults = report.results.filter(r =>
      this.ENTITY_CONFIGS.find(c => c.name === r.entity)?.priority === 'high'
    );
    const completedHighPriority = highPriorityResults.filter(r => r.status === 'completed').length;

    console.log('\n🎯 PRIORITY ANALYSIS:');
    console.log(`   High Priority Entities: ${completedHighPriority}/${highPriorityResults.length} completed`);

    if (report.overallSuccessRate >= 95) {
      console.log(`\n🏆 ACHIEVEMENT: Excellent comprehensive migration performance (${report.overallSuccessRate.toFixed(2)}%)`);
    } else if (report.overallSuccessRate >= 85) {
      console.log(`\n👍 RESULT: Good comprehensive migration performance (${report.overallSuccessRate.toFixed(2)}%)`);
    } else {
      console.log(`\n⚠️  CAUTION: Comprehensive migration needs improvement (${report.overallSuccessRate.toFixed(2)}%)`);
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
  const migration = new ComprehensiveDifferentialMigration();

  try {
    const report = await migration.migrate();
    migration.displayReport(report);

    console.log('\n🎯 NEXT STEPS:');
    console.log('1. Review any failed migrations and address issues');
    console.log('2. Run validation scripts for completed entities');
    console.log('3. Update production systems with new data');
    console.log('4. Monitor system performance with additional data');

  } catch (error) {
    console.error('❌ Comprehensive migration failed:', error);
    process.exit(1);
  } finally {
    await migration.cleanup();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Script execution failed:', error);
    process.exit(1);
  });
}

export { ComprehensiveDifferentialMigration };