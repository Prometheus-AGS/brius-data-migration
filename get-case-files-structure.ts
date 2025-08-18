import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function getCaseFilesStructure() {
  console.log('🔍 Getting case_files table structure...\n');
  
  // Get the table structure
  const { data, error } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT 
        column_name, 
        data_type, 
        is_nullable, 
        column_default
      FROM information_schema.columns 
      WHERE table_name = 'case_files' 
      AND table_schema = 'public'
      ORDER BY ordinal_position;
    `
  });
  
  console.log('📋 case_files table structure:');
  console.log(data);
  
  // Get foreign key relationships
  const { data: fkData, error: fkError } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = 'case_files';
    `
  });
  
  if (fkData) {
    console.log('\n🔗 Foreign key relationships:');
    console.log(fkData);
  }
  
  // Test insert to see what columns are required
  console.log('\n🧪 Testing required columns by attempting empty insert...');
  const { data: insertData, error: insertError } = await supabase
    .from('case_files')
    .insert({})
    .select();
    
  if (insertError) {
    console.log('Insert error (shows required fields):');
    console.log(insertError.message);
  }
}

getCaseFilesStructure().catch(console.error);
