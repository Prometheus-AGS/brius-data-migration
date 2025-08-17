import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE!
);

// Reproduce the execSQL function from migrate-comments.ts
async function execSQL(sql: string) {
  const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });
  if (error) {
    console.error('SQL execution error:', error);
    throw error;
  }
  return data;
}

async function testQuery() {
  console.log('🧪 Testing treatment plans query...');
  
  try {
    const result = await execSQL(`
      SELECT id as treatment_plan_id, legacy_plan_id
      FROM treatment_plans
      WHERE legacy_plan_id IS NOT NULL
      LIMIT 10;
    `);
    
    console.log('✅ Query result:', result);
    console.log('📊 Number of results:', Array.isArray(result) ? result.length : 'N/A');
    
    if (Array.isArray(result)) {
      result.forEach((row, i) => {
        console.log(`  ${i + 1}. Treatment Plan ID: ${row.treatment_plan_id}, Legacy Plan ID: ${row.legacy_plan_id}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Query failed:', error);
  }
}

testQuery().catch(console.error);
