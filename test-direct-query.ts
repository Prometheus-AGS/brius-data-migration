import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE!
);

async function testDirectQuery() {
  console.log('🧪 Testing direct Supabase query...');
  
  try {
    const { data, error } = await supabase
      .from('treatment_plans')
      .select('id, legacy_plan_id')
      .not('legacy_plan_id', 'is', null)
      .limit(10);
      
    if (error) {
      console.error('❌ Query error:', error);
      return;
    }
    
    console.log('✅ Query result:', data);
    console.log('📊 Number of results:', data?.length || 0);
    
    data?.forEach((row: any, i: number) => {
      console.log(`  ${i + 1}. Treatment Plan ID: ${row.id}, Legacy Plan ID: ${row.legacy_plan_id}`);
    });
    
  } catch (error) {
    console.error('❌ Query failed:', error);
  }
}

testDirectQuery().catch(console.error);
