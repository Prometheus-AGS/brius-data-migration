import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE!;

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  global: {
    headers: {
      'Authorization': `Bearer ${supabaseServiceKey}`
    }
  }
});

async function execSQL(sql: string): Promise<any> {
  const { data, error } = await supabase.rpc('exec_sql', { sql });
  if (error) throw error;
  return data;
}

async function removeLegacyPlanIdConstraint() {
  console.log('🔧 Removing unique constraint from treatment_plans.legacy_plan_id...\n');

  try {
    // First, check what constraints exist
    const constraintsResult = await execSQL(`
      SELECT constraint_name, constraint_type
      FROM information_schema.table_constraints 
      WHERE table_name = 'treatment_plans'
      AND constraint_type = 'UNIQUE';
    `);

    console.log('Current unique constraints:');
    if (Array.isArray(constraintsResult)) {
      constraintsResult.forEach((row: any) => {
        console.log(`   🔒 ${row.constraint_name} (${row.constraint_type})`);
      });
    }

    // Drop the unique constraint on legacy_plan_id
    const dropConstraintSQL = `
      ALTER TABLE treatment_plans 
      DROP CONSTRAINT IF EXISTS treatment_plans_legacy_plan_id_key;
    `;
    
    await execSQL(dropConstraintSQL);
    console.log('   ✅ Unique constraint on legacy_plan_id removed');

    // Also try alternative constraint names
    const altConstraints = [
      'uk_treatment_plans_legacy_plan_id',
      'treatment_plans_legacy_plan_id_unique'
    ];
    
    for (const constraintName of altConstraints) {
      const dropSQL = `ALTER TABLE treatment_plans DROP CONSTRAINT IF EXISTS ${constraintName};`;
      try {
        await execSQL(dropSQL);
      } catch (error) {
        // Ignore errors for non-existent constraints
      }
    }

    // Verify constraints after removal
    const finalConstraintsResult = await execSQL(`
      SELECT constraint_name, constraint_type
      FROM information_schema.table_constraints 
      WHERE table_name = 'treatment_plans'
      AND constraint_type IN ('UNIQUE', 'PRIMARY KEY', 'FOREIGN KEY');
    `);

    console.log('\nRemaining constraints:');
    if (Array.isArray(finalConstraintsResult)) {
      finalConstraintsResult.forEach((row: any) => {
        console.log(`   🔒 ${row.constraint_name} (${row.constraint_type})`);
      });
    }

    console.log('\n🎉 Legacy plan ID constraint removal completed!');
    console.log('✅ treatment_plans table is now ready for migration without legacy_plan_id duplicates');

  } catch (error) {
    console.error('❌ Error removing constraint:', error);
  }
}

removeLegacyPlanIdConstraint().catch(console.error);
