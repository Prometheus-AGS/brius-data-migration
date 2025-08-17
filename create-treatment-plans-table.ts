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

async function createTreatmentPlansTable() {
  console.log('🏗️ Creating treatment_plans table...\n');

  try {
    // Based on the TargetTreatmentPlan interface in the migration script
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS treatment_plans (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
        order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
        patient_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
        doctor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
        plan_number INTEGER,
        plan_name TEXT NOT NULL,
        plan_notes TEXT,
        is_original BOOLEAN DEFAULT false,
        treatment_type TEXT,
        revision_count INTEGER DEFAULT 0,
        legacy_plan_id INTEGER,
        legacy_instruction_id INTEGER,
        metadata JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;
    
    await execSQL(createTableSQL);
    console.log('   ✅ treatment_plans table created');

    // Create indexes for performance
    const indexesSQL = `
      CREATE INDEX IF NOT EXISTS idx_treatment_plans_project_id ON treatment_plans(project_id);
      CREATE INDEX IF NOT EXISTS idx_treatment_plans_order_id ON treatment_plans(order_id);
      CREATE INDEX IF NOT EXISTS idx_treatment_plans_patient_id ON treatment_plans(patient_id);
      CREATE INDEX IF NOT EXISTS idx_treatment_plans_doctor_id ON treatment_plans(doctor_id);
      CREATE INDEX IF NOT EXISTS idx_treatment_plans_legacy_plan_id ON treatment_plans(legacy_plan_id);
      CREATE INDEX IF NOT EXISTS idx_treatment_plans_legacy_instruction_id ON treatment_plans(legacy_instruction_id);
      CREATE INDEX IF NOT EXISTS idx_treatment_plans_created_at ON treatment_plans(created_at);
    `;
    
    await execSQL(indexesSQL);
    console.log('   ✅ Indexes created');

    // Create updated_at trigger
    const triggerSQL = `
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
      END;
      $$ language 'plpgsql';
      
      DROP TRIGGER IF EXISTS update_treatment_plans_updated_at ON treatment_plans;
      
      CREATE TRIGGER update_treatment_plans_updated_at
          BEFORE UPDATE ON treatment_plans
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_at_column();
    `;
    
    await execSQL(triggerSQL);
    console.log('   ✅ updated_at trigger created');

    // Verify table creation
    const verifySQL = `
      SELECT 
        column_name,
        data_type,
        is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'treatment_plans'
      ORDER BY ordinal_position;
    `;
    
    const columns = await execSQL(verifySQL);
    console.log('\n📋 Created table structure:');
    if (Array.isArray(columns)) {
      columns.forEach((row: any) => {
        console.log(`   • ${row.column_name}: ${row.data_type} ${row.is_nullable === 'YES' ? '(nullable)' : '(required)'}`);
      });
    }

    console.log('\n🎉 treatment_plans table created successfully!');
    console.log('\n⚠️  Note: The unique constraint on project_id was NOT added to allow multiple treatment plans per project');
    console.log('   This resolves the duplicate constraint error from the migration.');

  } catch (error) {
    console.error('❌ Error creating table:', error);
  }
}

createTreatmentPlansTable().catch(console.error);
