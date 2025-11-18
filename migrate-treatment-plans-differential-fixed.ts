import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

interface TreatmentPlan {
  id: number;
  instruction_id: number;
  project_id: number;
  notes: string | null;
  number: number | null;
  name: string;
  original: boolean;
}

interface TreatmentPlanMigrationStats {
  totalSourceRecords: number;
  totalTargetRecords: number;
  missingRecords: number;
  migratedRecords: number;
  skippedRecords: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
}

class TreatmentPlansDifferentialMigration {
  private sourcePool: Pool;
  private targetPool: Pool;
  private stats: TreatmentPlanMigrationStats;
  private batchSize: number = 1000;

  constructor() {
    this.sourcePool = new Pool({
      host: process.env.SOURCE_DB_HOST,
      port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
      database: process.env.SOURCE_DB_NAME,
      user: process.env.SOURCE_DB_USER,
      password: process.env.SOURCE_DB_PASSWORD,
      ssl: { rejectUnauthorized: false }
    });

    this.targetPool = new Pool({
      host: process.env.TARGET_DB_HOST,
      port: parseInt(process.env.TARGET_DB_PORT || '5432'),
      database: process.env.TARGET_DB_NAME,
      user: process.env.TARGET_DB_USER,
      password: process.env.TARGET_DB_PASSWORD,
    });

    this.stats = {
      totalSourceRecords: 0,
      totalTargetRecords: 0,
      missingRecords: 0,
      migratedRecords: 0,
      skippedRecords: 0,
      errors: 0,
      startTime: new Date(),
    };
  }

  /**
   * Get existing treatment plan IDs in target database
   */
  private async getExistingTreatmentPlanIds(): Promise<Set<number>> {
    const query = `
      SELECT legacy_plan_id
      FROM treatment_plans
      WHERE legacy_plan_id IS NOT NULL
    `;

    try {
      const result = await this.targetPool.query(query);
      const existingIds = new Set<number>();

      result.rows.forEach(row => {
        if (row.legacy_plan_id) {
          existingIds.add(row.legacy_plan_id);
        }
      });

      console.log(`✓ Found ${existingIds.size} existing treatment plan IDs in target`);
      return existingIds;
    } catch (error) {
      console.error('❌ Error fetching existing treatment plan IDs:', error);
      throw error;
    }
  }

  /**
   * Get missing treatment plans from source database
   */
  private async getMissingTreatmentPlans(existingIds: Set<number>): Promise<TreatmentPlan[]> {
    const query = `
      SELECT
        id,
        instruction_id,
        project_id,
        notes,
        number,
        name,
        original
      FROM dispatch_plan
      ORDER BY id
    `;

    try {
      const result = await this.sourcePool.query(query);
      this.stats.totalSourceRecords = result.rows.length;

      // Filter to only missing plans
      const missingPlans = result.rows.filter((plan: any) => !existingIds.has(plan.id));
      this.stats.missingRecords = missingPlans.length;

      console.log(`✓ Found ${this.stats.totalSourceRecords} total plans in source`);
      console.log(`✓ Identified ${this.stats.missingRecords} missing plans to migrate`);

      return missingPlans;
    } catch (error) {
      console.error('❌ Error fetching missing treatment plans:', error);
      throw error;
    }
  }

  /**
   * Get required mappings for treatment plan migration
   */
  private async getMappings(): Promise<{
    orderMappings: Map<number, string>,
    projectMappings: Map<number, string>
  }> {
    try {
      const [orderMappingsResult, projectMappingsResult] = await Promise.all([
        // Get order mappings (instruction_id maps to orders)
        this.targetPool.query(`
          SELECT legacy_instruction_id, id
          FROM orders
          WHERE legacy_instruction_id IS NOT NULL
        `),
        // Get project mappings if projects table exists
        this.targetPool.query(`
          SELECT legacy_project_id, id
          FROM projects
          WHERE legacy_project_id IS NOT NULL
        `).catch(() => ({ rows: [] })) // Gracefully handle if projects table doesn't exist
      ]);

      const orderMappings = new Map<number, string>();
      const projectMappings = new Map<number, string>();

      orderMappingsResult.rows.forEach(row => {
        orderMappings.set(row.legacy_instruction_id, row.id);
      });

      projectMappingsResult.rows.forEach(row => {
        projectMappings.set(row.legacy_project_id, row.id);
      });

      console.log(`✓ Found ${orderMappings.size} order mappings`);
      console.log(`✓ Found ${projectMappings.size} project mappings`);

      return { orderMappings, projectMappings };
    } catch (error) {
      console.error('❌ Error fetching mappings:', error);
      throw error;
    }
  }

  /**
   * Migrate treatment plans batch (FIXED version)
   */
  private async migrateTreatmentPlansBatch(
    plans: TreatmentPlan[],
    orderMappings: Map<number, string>,
    projectMappings: Map<number, string>
  ): Promise<void> {
    if (plans.length === 0) return;

    console.log(`📊 Migrating batch of ${plans.length} treatment plans...`);

    // Prepare batch insert with validation
    const planRecords = plans
      .map(plan => {
        const orderId = orderMappings.get(plan.instruction_id);
        const projectId = projectMappings.get(plan.project_id);

        return {
          order_id: orderId,
          project_id: projectId,
          plan_name: plan.name,
          plan_notes: plan.notes,
          plan_number: plan.number,
          is_original: plan.original,
          legacy_plan_id: plan.id,
          legacy_instruction_id: plan.instruction_id,
          legacy_project_id: plan.project_id, // Store for debugging
          metadata: JSON.stringify({
            source_name: plan.name,
            source_original: plan.original,
            source_project_id: plan.project_id,
            migrated_at: new Date().toISOString()
          })
        };
      })
      // 🔧 FIX: Filter out records that would violate NOT NULL constraints
      .filter(record => {
        if (!record.order_id) {
          console.log(`⏭️  Skipping treatment plan ${record.legacy_plan_id} - no matching order for instruction_id ${record.legacy_instruction_id}`);
          return false;
        }

        if (!record.project_id) {
          console.log(`⏭️  Skipping treatment plan ${record.legacy_plan_id} - no matching project for project_id ${record.legacy_project_id} (NOT NULL constraint)`);
          return false;
        }

        return true;
      });

    console.log(`   → ${planRecords.length}/${plans.length} treatment plans have required mappings and pass NOT NULL constraints`);

    if (planRecords.length === 0) {
      this.stats.skippedRecords += plans.length;
      return;
    }

    try {
      // Insert batch (no conflict clause needed since we pre-filtered missing records)
      const insertQuery = `
        INSERT INTO treatment_plans (
          order_id, project_id, plan_name, plan_notes, plan_number, is_original,
          legacy_plan_id, legacy_instruction_id, metadata,
          created_at, updated_at
        ) VALUES ${planRecords.map((_, i) =>
          `($${i * 9 + 1}, $${i * 9 + 2}, $${i * 9 + 3}, $${i * 9 + 4}, $${i * 9 + 5}, $${i * 9 + 6}, $${i * 9 + 7}, $${i * 9 + 8}, $${i * 9 + 9}, NOW(), NOW())`
        ).join(', ')}
        ON CONFLICT (legacy_plan_id) DO NOTHING
      `;

      const values = planRecords.flatMap(plan => [
        plan.order_id,
        plan.project_id,      // ✅ Now guaranteed to be non-null
        plan.plan_name,
        plan.plan_notes,
        plan.plan_number,
        plan.is_original,
        plan.legacy_plan_id,
        plan.legacy_instruction_id,
        plan.metadata
      ]);

      const result = await this.targetPool.query(insertQuery, values);
      const insertedCount = result.rowCount || 0;

      this.stats.migratedRecords += insertedCount;
      this.stats.skippedRecords += (plans.length - insertedCount);

      console.log(`✅ Successfully migrated ${insertedCount} treatment plans (${plans.length - planRecords.length} filtered out for constraint violations)`);

    } catch (error) {
      this.stats.errors++;
      console.error(`❌ Error migrating treatment plans batch:`, error);
    }
  }

  /**
   * Main differential migration function
   */
  public async executeDifferentialMigration(): Promise<TreatmentPlanMigrationStats> {
    console.log('🚀 Starting Treatment Plans Differential Migration (FIXED version)...\n');

    try {
      // Get existing IDs and missing plans
      const existingIds = await this.getExistingTreatmentPlanIds();
      const missingPlans = await this.getMissingTreatmentPlans(existingIds);

      if (missingPlans.length === 0) {
        console.log('🎉 All treatment plans are already migrated!');
        this.stats.endTime = new Date();
        return this.stats;
      }

      // Get required mappings
      const { orderMappings, projectMappings } = await this.getMappings();

      console.log('\n🔄 Starting batch migration...');

      // Process in batches
      for (let i = 0; i < missingPlans.length; i += this.batchSize) {
        const batchStartTime = Date.now();
        const batch = missingPlans.slice(i, i + this.batchSize);

        await this.migrateTreatmentPlansBatch(batch, orderMappings, projectMappings);

        const batchDuration = Date.now() - batchStartTime;
        const recordsPerSecond = (batch.length / batchDuration * 1000).toFixed(0);
        console.log(`   ⚡ Batch ${Math.floor(i / this.batchSize) + 1} completed in ${batchDuration}ms (${recordsPerSecond} records/sec)`);

        if (this.stats.migratedRecords % 5000 === 0 && this.stats.migratedRecords > 0) {
          console.log(`✅ Progress: ${this.stats.migratedRecords} treatment plans migrated...`);
        }
      }

      this.stats.endTime = new Date();

      // Final summary
      console.log('\n📋 Treatment Plans Differential Migration Summary:');
      console.log(`⏱️  Duration: ${this.stats.endTime.getTime() - this.stats.startTime.getTime()}ms`);
      console.log(`📊 Source Records: ${this.stats.totalSourceRecords}`);
      console.log(`📊 Missing Records: ${this.stats.missingRecords}`);
      console.log(`✅ Successfully Migrated: ${this.stats.migratedRecords}`);
      console.log(`⏭️  Skipped: ${this.stats.skippedRecords}`);
      console.log(`❌ Errors: ${this.stats.errors}`);

      const successRate = this.stats.missingRecords > 0
        ? ((this.stats.migratedRecords / this.stats.missingRecords) * 100).toFixed(2)
        : 100;
      console.log(`📈 Success Rate: ${successRate}%`);

      if (this.stats.skippedRecords > 0) {
        console.log(`\n⚠️  Note: ${this.stats.skippedRecords} records were skipped due to missing required relationships (project_id or order_id mapping failures)`);
        console.log('   This is expected for orphaned data where related entities were not migrated');
      }

      return this.stats;

    } catch (error) {
      console.error('💥 Treatment plans differential migration failed:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Validate the migration results
   */
  public async validateMigration(): Promise<void> {
    console.log('\n🔍 Validating treatment plans migration...');

    try {
      const validationStats = await this.targetPool.query(`
        SELECT
          COUNT(*) as total_treatment_plans,
          COUNT(CASE WHEN legacy_plan_id IS NOT NULL THEN 1 END) as migrated_plans,
          COUNT(DISTINCT order_id) as unique_orders,
          COUNT(DISTINCT project_id) as unique_projects,
          COUNT(CASE WHEN project_id IS NULL THEN 1 END) as null_project_ids,
          MIN(created_at) as earliest_plan,
          MAX(created_at) as latest_plan
        FROM treatment_plans
      `);

      const stats = validationStats.rows[0];
      console.log('📊 Treatment Plans Validation:');
      console.log(`   Total Treatment Plans: ${stats.total_treatment_plans}`);
      console.log(`   Migrated Plans (with legacy_plan_id): ${stats.migrated_plans}`);
      console.log(`   Unique Orders: ${stats.unique_orders}`);
      console.log(`   Unique Projects: ${stats.unique_projects}`);
      console.log(`   NULL project_id count: ${stats.null_project_ids} (should be 0 after fix)`);
      console.log(`   Date Range: ${stats.earliest_plan} to ${stats.latest_plan}`);

      // Check for any gaps
      const sourceTotal = await this.sourcePool.query('SELECT COUNT(*) FROM dispatch_plan');
      const targetMigrated = parseInt(stats.migrated_plans);
      const sourceCount = parseInt(sourceTotal.rows[0].count);

      console.log(`\n📊 Migration Coverage:`);
      console.log(`   Source Plans: ${sourceCount}`);
      console.log(`   Target Migrated: ${targetMigrated}`);
      console.log(`   Coverage: ${((targetMigrated / sourceCount) * 100).toFixed(2)}%`);

      if (sourceCount === targetMigrated) {
        console.log('🎉 PERFECT MIGRATION: All treatment plans successfully migrated!');
      } else {
        console.log(`⚠️  ${sourceCount - targetMigrated} treatment plans still missing (likely due to missing project/order relationships)`);
      }

      // Constraint validation
      if (parseInt(stats.null_project_ids) === 0) {
        console.log('✅ NOT NULL constraint validation: All migrated records have valid project_id');
      } else {
        console.log(`❌ NOT NULL constraint validation: Found ${stats.null_project_ids} records with NULL project_id`);
      }

      console.log('\n✅ Validation completed');

    } catch (error) {
      console.error('❌ Validation failed:', error);
    }
  }

  /**
   * Cleanup connections
   */
  private async cleanup(): Promise<void> {
    try {
      await Promise.all([
        this.sourcePool.end(),
        this.targetPool.end()
      ]);
      console.log('🧹 Database connections closed');
    } catch (error) {
      console.error('⚠️  Error during cleanup:', error);
    }
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'migrate';

  const migration = new TreatmentPlansDifferentialMigration();

  try {
    switch (command) {
      case 'migrate':
        await migration.executeDifferentialMigration();
        await migration.validateMigration();
        break;

      case 'validate':
        await migration.validateMigration();
        break;

      default:
        console.log('Usage: npx ts-node migrate-treatment-plans-differential-fixed.ts [migrate|validate]');
        process.exit(1);
    }

    process.exit(0);

  } catch (error) {
    console.error('💥 Operation failed:', error);
    process.exit(1);
  }
}

// Export for use as module
export { TreatmentPlansDifferentialMigration };

// Run if called directly
if (require.main === module) {
  main();
}