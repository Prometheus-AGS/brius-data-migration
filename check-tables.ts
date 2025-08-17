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

async function checkTables() {
  console.log('🔍 Checking existing tables...\n');

  try {
    const tablesResult = await execSQL(`
      SELECT table_name, table_type
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    console.log('Existing Tables:');
    if (Array.isArray(tablesResult)) {
      tablesResult.forEach((row: any) => {
        console.log(`  📋 ${row.table_name}`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkTables().catch(console.error);
