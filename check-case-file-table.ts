import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function checkCaseFileTable() {
  console.log('Checking for case_file table in target database...');
  
  // Check if case_file table exists
  const { data: tables, error: tablesError } = await supabase
    .from('information_schema.tables')
    .select('*')
    .eq('table_name', 'case_file')
    .eq('table_schema', 'public');
    
  if (tablesError) {
    console.error('Error checking tables:', tablesError);
    return;
  }
  
  if (tables && tables.length > 0) {
    console.log('✅ case_file table exists');
    
    // Get table structure
    const { data: columns, error: columnsError } = await supabase
      .from('information_schema.columns')
      .select('column_name, data_type, is_nullable, column_default')
      .eq('table_name', 'case_file')
      .eq('table_schema', 'public')
      .order('ordinal_position');
      
    if (columns) {
      console.log('\n📋 case_file table structure:');
      columns.forEach(col => {
        console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'} ${col.column_default ? 'DEFAULT ' + col.column_default : ''}`);
      });
      
      // Check current record count
      const { count, error: countError } = await supabase
        .from('case_file')
        .select('*', { count: 'exact', head: true });
        
      if (!countError) {
        console.log(`\n📊 Current records in case_file: ${count}`);
      }
    }
  } else {
    console.log('❌ case_file table does not exist');
  }
}

checkCaseFileTable().catch(console.error);
