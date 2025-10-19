import { createClient } from '@supabase/supabase-js';
import { Client as PgClient } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

// Source database configuration
const sourceDb = new PgClient({
  host: process.env.SOURCE_DB_HOST!,
  port: parseInt(process.env.SOURCE_DB_PORT!),
  user: process.env.SOURCE_DB_USER!,
  password: process.env.SOURCE_DB_PASSWORD!,
  database: process.env.SOURCE_DB_NAME!,
});

// Supabase client configuration
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE!
);

interface SourcePlan {
  id: number;
  instruction_id: number;
  project_id: number;
  notes: string | null;
  number: number | null;
  name: string;
  original: boolean;
}

interface TargetTreatmentPlan {
  project_id: string;
  order_id: string | null;
  patient_id: string | null;
  doctor_id: string | null;
  plan_number: number | null;
  plan_name: string;
  plan_notes: string | null;
  is_original: boolean;
  treatment_type: string | null;
  revision_count: number;
  legacy_plan_id: number;
  legacy_instruction_id: number;
  metadata: any;
}

class TreatmentPlansMigration {
  private processed = 0;
  private errors = 0;
  private skipped = 0;
  private projectLookupMap = new Map<number, string>();
  private targetClient!: PgClient;
  private orderLookupMap = new Map<number, string>();
  private batchSize = 500;

  async migrate() {
    const isValidation = process.argv.includes('validate');
    const isRollback = process.argv.includes('rollback');

    if (isValidation) {
      return this.validate();
    }
    
    if (isRollback) {
      return this.rollback();
    }

    console.log('🏥 Starting treatment plans migration...\n');

    try {
      await sourceDb.connect();
      this.targetClient = new PgClient({ host: process.env.TARGET_DB_HOST, port: parseInt(process.env.TARGET_DB_PORT || "5432"), user: process.env.TARGET_DB_USER, password: process.env.TARGET_DB_PASSWORD, database: process.env.TARGET_DB_NAME });
      await this.targetClient.connect();
      await this.buildLookupMaps();
      await this.migrateTreatmentPlans();
      console.log('\n✅ Treatment plans migration completed successfully!');
      console.log(`📊 Summary: ${this.processed} processed, ${this.errors} errors, ${this.skipped} skipped`);
    } catch (error) {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    } finally {
      await sourceDb.end();
    }
  }

  private async buildLookupMaps() {
    console.log('🔍 Building lookup maps...');

    // Build project lookup map (only treatment_plan type projects)
    const projectResult = await this.targetClient.query(`SELECT id, legacy_project_id FROM projects WHERE legacy_project_id IS NOT NULL`);
    projectResult.rows.forEach(row => {
      this.projectLookupMap.set(row.legacy_project_id, row.id);
    });

    // Build order lookup map
    console.log('  📋 Building order lookup map...');
    const orderResult = await this.targetClient.query(`SELECT id, legacy_instruction_id FROM orders WHERE legacy_instruction_id IS NOT NULL`);
    orderResult.rows.forEach(row => {
      this.orderLookupMap.set(row.legacy_instruction_id, row.id);
    });
    console.log(`    ✅ Built order lookup map: ${this.orderLookupMap.size} orders\n`);
  }

  private async migrateTreatmentPlans() {
    // Fetch all plans from source with their relationships
    const query = `
      SELECT 
        dp.id,
        dp.instruction_id,
        dp.project_id,
        dp.notes,
        dp.number,
        dp.name,
        dp.original
      FROM dispatch_plan dp
      ORDER BY dp.id;
    `;

    const result = await sourceDb.query(query);
    const sourcePlans: SourcePlan[] = result.rows;

    console.log(`🏥 Found ${sourcePlans.length} treatment plans to migrate`);

    // Process in batches
    for (let i = 0; i < sourcePlans.length; i += this.batchSize) {
      const batch = sourcePlans.slice(i, i + this.batchSize);
      await this.processBatch(batch);
      
      if (this.processed % 5000 === 0 || i + this.batchSize >= sourcePlans.length) {
        console.log(`⏳ Processed ${this.processed}/${sourcePlans.length} treatment plans (${Math.round(this.processed/sourcePlans.length * 100)}%)`);
      }
    }
  }

  private async processBatch(batch: SourcePlan[]) {
    const targetPlans: TargetTreatmentPlan[] = [];

    for (const sourcePlan of batch) {
      try {
        const targetPlan = this.transformTreatmentPlan(sourcePlan);
        if (targetPlan) {
          targetPlans.push(targetPlan);
        }
      } catch (error) {
        console.error(`❌ Error transforming treatment plan ${sourcePlan.id}:`, error);
        this.errors++;
      }
    }

    if (targetPlans.length > 0) {
      try {
        // Try bulk insert first
        const { error } = await supabase
          .from('treatment_plans')
          .insert(targetPlans);

        if (error) {
          console.warn(`⚠️  Bulk insert failed, trying individual inserts: ${error.message}`);
          await this.insertIndividually(targetPlans);
        } else {
          this.processed += targetPlans.length;
        }
      } catch (error) {
        console.error(`❌ Batch insert failed:`, error);
        await this.insertIndividually(targetPlans);
      }
    }
  }

  private async insertIndividually(targetPlans: TargetTreatmentPlan[]) {
    for (const plan of targetPlans) {
      try {
        const { error } = await supabase
          .from('treatment_plans')
          .insert(plan);

        if (error) {
          console.error(`❌ Error inserting treatment plan ${plan.legacy_plan_id}:`, error.message);
          this.errors++;
        } else {
          this.processed++;
        }
      } catch (error) {
        console.error(`❌ Error inserting treatment plan ${plan.legacy_plan_id}:`, error);
        this.errors++;
      }
    }
  }

  private transformTreatmentPlan(source: SourcePlan): TargetTreatmentPlan | null {
    // Map project_id to project UUID
    const projectId = this.projectLookupMap.get(source.project_id);
    if (!projectId) {
      console.warn(`⚠️  Skipping treatment plan ${source.id}: project not found for project_id ${source.project_id}`);
      this.skipped++;
      return null;
    }

    // Map instruction_id to order UUID (optional - some plans may not have orders)
    const orderId = this.orderLookupMap.get(source.instruction_id) || null;
    if (!orderId) {
      // This is common and expected - not all plans have orders
      // console.warn(`⚠️  Warning: Order not found for instruction ${source.instruction_id} in treatment plan ${source.id}`);
    }

    // For now, leave patient_id and doctor_id as null
    // We can populate these later via a separate script once order relationships are stable
    const patientId: string | null = null;
    const doctorId: string | null = null;

    // Determine treatment type based on plan characteristics
    let treatmentType: string | null = null;
    if (source.original) {
      treatmentType = 'initial_treatment';
    } else {
      treatmentType = 'revision';
    }

    // Calculate revision count (for non-original plans)
    const revisionCount = source.original ? 0 : Math.max(0, (source.number || 1) - 1);

    const metadata = {
      legacy_plan_id: source.id,
      legacy_project_id: source.project_id,
      legacy_instruction_id: source.instruction_id,
      has_order_relationship: orderId !== null,
      source_name: source.name,
      original_number: source.number,
    };

    return {
      project_id: projectId,
      order_id: orderId,
      patient_id: patientId,
      doctor_id: doctorId,
      plan_number: source.number,
      plan_name: source.name || `Treatment Plan ${source.id}`,
      plan_notes: source.notes,
      is_original: source.original,
      treatment_type: treatmentType,
      revision_count: revisionCount,
      legacy_plan_id: source.id,
      legacy_instruction_id: source.instruction_id,
      metadata,
    };
  }

  private async validate() {
    console.log('🔍 Validating treatment plans migration...\n');

    try {
      await sourceDb.connect();
      this.targetClient = new PgClient({ host: process.env.TARGET_DB_HOST, port: parseInt(process.env.TARGET_DB_PORT || "5432"), user: process.env.TARGET_DB_USER, password: process.env.TARGET_DB_PASSWORD, database: process.env.TARGET_DB_NAME });
      await this.targetClient.connect();

      // Count source plans
      const sourceResult = await sourceDb.query('SELECT COUNT(*) FROM dispatch_plan');
      const sourceCount = parseInt(sourceResult.rows[0].count);

      // Count target treatment plans
      const { count: targetCount, error } = await supabase
        .from('treatment_plans')
        .select('*', { count: 'exact', head: true });

      if (error) {
        throw new Error(`Error counting target treatment plans: ${error.message}`);
      }

      console.log('📊 Migration Validation Results:');
      console.log(`Source treatment plans: ${sourceCount}`);
      console.log(`Target treatment plans: ${targetCount}`);
      console.log(`Match: ${sourceCount === targetCount ? '✅ Yes' : '❌ No'}`);

      // Validate original vs revision distribution
      const originalDistQuery = `
        SELECT original, COUNT(*) as count 
        FROM dispatch_plan 
        GROUP BY original 
        ORDER BY original;
      `;
      
      const originalResult = await sourceDb.query(originalDistQuery);

      console.log('\n📈 Original vs Revision Distribution:');
      for (const row of originalResult.rows) {
        const planType = row.original ? 'Original' : 'Revision';
        console.log(`${planType}: ${row.count} plans`);
      }

      // Validate project relationships
      const { data: projectRelations, error: projectError } = await supabase
        .from('treatment_plans')
        .select('project_id')
        .not('project_id', 'is', null);

      if (!projectError && projectRelations) {
        console.log(`\n🔗 Project Relationships: ${projectRelations.length} treatment plans linked to projects`);
      }

      // Validate order relationships
      const { data: orderRelations, error: orderError } = await supabase
        .from('treatment_plans')
        .select('order_id')
        .not('order_id', 'is', null);

      if (!orderError && orderRelations) {
        console.log(`📋 Order Relationships: ${orderRelations.length} treatment plans linked to orders`);
      }

    } catch (error) {
      console.error('❌ Validation failed:', error);
      process.exit(1);
    } finally {
      await sourceDb.end();
    }
  }

  private async rollback() {
    console.log('🔄 Rolling back treatment plans migration...\n');

    try {
      const { error } = await supabase
        .from('treatment_plans')
        .delete()
        .not('legacy_plan_id', 'is', null);

      if (error) {
        throw new Error(`Rollback error: ${error.message}`);
      }

      console.log('✅ Treatment plans migration rolled back successfully');

    } catch (error) {
      console.error('❌ Rollback failed:', error);
      process.exit(1);
    }
  }
}

const migration = new TreatmentPlansMigration();
migration.migrate().catch(console.error);
