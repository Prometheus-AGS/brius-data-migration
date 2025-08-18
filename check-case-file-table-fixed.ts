import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function checkCaseFileTable() {
  console.log('Checking for case_file table in target database...');
  
  // Use raw SQL to check table existence
  const { data: tables, error: tablesError } = await supabase
    .rpc('exec_sql', { 
      sql: `SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'case_file';`
    });
    
  if (tablesError) {
    console.error('Error checking tables:', tablesError);
    // Try alternative approach
    const { data: altCheck, error: altError } = await supabase
      .from('case_file')
      .select('*')
      .limit(1);
      
    if (altError) {
      if (altError.code === '42P01') {
        console.log('❌ case_file table does not exist');
        return;
      } else {
        console.error('Alternative check error:', altError);
        return;
      }
    } else {
      console.log('✅ case_file table exists (detected via query)');
    }
  } else if (tables && tables.length > 0) {
    console.log('✅ case_file table exists');
  } else {
    console.log('❌ case_file table does not exist');
    return;
  }
  
  // Get table structure using raw SQL
  const { data: columns, error: columnsError } = await supabase
    .rpc('exec_sql', {
      sql: `SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'case_file' AND table_schema = 'public'
            ORDER BY ordinal_position;`
    });
    
  if (columns) {
    console.log('\n📋 case_file table structure:');
    columns.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'} ${col.column_default ? 'DEFAULT ' + col.column_default : ''}`);
    });
  }
  
  // Check current record count
  const { count, error: countError } = await supabase
    .from('case_file')
    .select('*', { count: 'exact', head: true });
    
  if (!countError) {
    console.log(`\n📊 Current records in case_file: ${count}`);
  } else {
    console.log('\n❌ Error getting record count:', countError);
  }
}

checkCaseFileTable().catch(console.error);
