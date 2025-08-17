import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

// Target database configuration (Supabase)
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

async function checkTreatmentPlansState() {
  console.log('🔍 Checking treatment_plans table state...\n');

  try {
    // 1. Check current count
    const countResult = await execSQL('SELECT COUNT(*) as count FROM treatment_plans;');
    const count = Array.isArray(countResult) ? countResult[0]?.count || 0 : 0;
    console.log(`   📊 Current treatment_plans records: ${count}`);

    if (count > 0) {
      // 2. Check for duplicates in existing data
      const duplicateCheckResult = await execSQL(`
        SELECT 
          project_id,
          COUNT(*) as count
        FROM treatment_plans
        GROUP BY project_id
        HAVING COUNT(*) > 1
        ORDER BY count DESC
        LIMIT 10;
      `);
      
      console.log('\n   Duplicate project_ids in treatment_plans:');
      if (Array.isArray(duplicateCheckResult) && duplicateCheckResult.length > 0) {
        duplicateCheckResult.forEach((row: any) => {
          console.log(`   🔄 project_id ${row.project_id}: ${row.count} records`);
        });
      } else {
        console.log('   ✅ No duplicates found in existing treatment_plans');
      }

      // 3. Sample existing data
      const sampleResult = await execSQL(`
        SELECT id, project_id, legacy_id, created_at
        FROM treatment_plans
        ORDER BY created_at DESC
        LIMIT 5;
      `);
      
      console.log('\n   Sample existing records:');
      if (Array.isArray(sampleResult)) {
        sampleResult.forEach((row: any, index: number) => {
          console.log(`   ${index + 1}. ID: ${row.id}, Project: ${row.project_id}, Legacy: ${row.legacy_id}, Created: ${row.created_at}`);
        });
      }
    }

    // 4. Check table constraints
    const constraintsResult = await execSQL(`
      SELECT 
        tc.constraint_name,
        tc.constraint_type,
        kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'treatment_plans'
      AND tc.constraint_type IN ('UNIQUE', 'PRIMARY KEY')
      ORDER BY tc.constraint_type, tc.constraint_name;
    `);
    
    console.log('\n   Table constraints:');
    if (Array.isArray(constraintsResult)) {
      constraintsResult.forEach((row: any) => {
        console.log(`   🔒 ${row.constraint_type} on ${row.column_name} (${row.constraint_name})`);
      });
    }

    // 5. Check projects table for potential project_id conflicts
    const projectsResult = await execSQL(`
      SELECT 
        COUNT(*) as total_projects,
        COUNT(DISTINCT legacy_id) as unique_legacy_ids,
        COUNT(legacy_id) as projects_with_legacy_id
      FROM projects;
    `);
    
    if (Array.isArray(projectsResult) && projectsResult.length > 0) {
      const pStats = projectsResult[0];
      console.log('\n   Projects table stats:');
      console.log(`   📊 Total projects: ${pStats.total_projects}`);
      console.log(`   📊 Projects with legacy_id: ${pStats.projects_with_legacy_id}`);
      console.log(`   📊 Unique legacy_ids: ${pStats.unique_legacy_ids}`);
    }

    // 6. Check for orphaned treatment plans (no corresponding project)
    if (count > 0) {
      const orphanedResult = await execSQL(`
        SELECT COUNT(*) as orphaned_count
        FROM treatment_plans tp
        WHERE NOT EXISTS (
          SELECT 1 FROM projects p WHERE p.id = tp.project_id
        );
      `);
      
      if (Array.isArray(orphanedResult)) {
        console.log(`   🔗 Orphaned treatment plans (no project): ${orphanedResult[0]?.orphaned_count || 0}`);
      }
    }

  } catch (error) {
    console.error('❌ Error checking treatment_plans state:', error);
  }
}

checkTreatmentPlansState().catch(console.error);
