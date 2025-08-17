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

async function checkTreatmentPlansSchema() {
  console.log('🔍 Checking treatment_plans table schema...\n');

  try {
    // 1. Check table structure
    const columnsResult = await execSQL(`
      SELECT 
        column_name,
        data_type,
        is_nullable,
        column_default,
        character_maximum_length
      FROM information_schema.columns 
      WHERE table_name = 'treatment_plans'
      ORDER BY ordinal_position;
    `);

    console.log('Treatment Plans Table Structure:');
    if (Array.isArray(columnsResult)) {
      columnsResult.forEach((row: any) => {
        console.log(`  • ${row.column_name}: ${row.data_type}${row.character_maximum_length ? `(${row.character_maximum_length})` : ''} ${row.is_nullable === 'YES' ? '(nullable)' : '(required)'} ${row.column_default ? `default: ${row.column_default}` : ''}`);
      });
    }

    // 2. Check constraints
    const constraintsResult = await execSQL(`
      SELECT 
        tc.constraint_name,
        tc.constraint_type,
        string_agg(kcu.column_name, ', ') as columns
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'treatment_plans'
      GROUP BY tc.constraint_name, tc.constraint_type
      ORDER BY tc.constraint_type, tc.constraint_name;
    `);

    console.log('\nTable Constraints:');
    if (Array.isArray(constraintsResult)) {
      constraintsResult.forEach((row: any) => {
        console.log(`  🔒 ${row.constraint_type}: ${row.columns} (${row.constraint_name})`);
      });
    }

    // 3. Check indexes
    const indexesResult = await execSQL(`
      SELECT 
        indexname,
        indexdef
      FROM pg_indexes 
      WHERE tablename = 'treatment_plans'
      ORDER BY indexname;
    `);

    console.log('\nTable Indexes:');
    if (Array.isArray(indexesResult)) {
      indexesResult.forEach((row: any) => {
        console.log(`  📝 ${row.indexname}: ${row.indexdef}`);
      });
    }

    // 4. Check if table exists and is accessible
    const tableExistsResult = await execSQL(`
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_name = 'treatment_plans'
      ) as table_exists;
    `);

    console.log(`\nTable exists: ${Array.isArray(tableExistsResult) ? tableExistsResult[0]?.table_exists : 'unknown'}`);

  } catch (error) {
    console.error('❌ Error checking schema:', error);
  }
}

checkTreatmentPlansSchema().catch(console.error);
