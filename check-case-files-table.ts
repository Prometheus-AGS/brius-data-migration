import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function checkCaseFilesTable() {
  console.log('Checking case_files table structure in target database...');
  
  // Check if case_files table exists and get its structure
  const { data: testData, error: testError } = await supabase
    .from('case_files')
    .select('*')
    .limit(1);
    
  if (testError) {
    if (testError.code === '42P01') {
      console.log('❌ case_files table does not exist');
      return;
    } else {
      console.error('Error checking table:', testError);
      return;
    }
  }
  
  console.log('✅ case_files table exists');
  
  // Check current record count
  const { count, error: countError } = await supabase
    .from('case_files')
    .select('*', { count: 'exact', head: true });
    
  if (!countError) {
    console.log(`📊 Current records in case_files: ${count}`);
  }
  
  // Get sample records to understand structure
  const { data: sampleData, error: sampleError } = await supabase
    .from('case_files')
    .select('*')
    .limit(3);
    
  if (sampleData && sampleData.length > 0) {
    console.log('\n📋 case_files table structure:');
    console.log('Columns:', Object.keys(sampleData[0]).join(', '));
    console.log('\nFirst record example:');
    console.log(JSON.stringify(sampleData[0], null, 2));
  } else {
    console.log('\n📋 No records found in case_files table (empty table)');
    
    // Try to get column info by attempting insert with empty data
    const { error: insertError } = await supabase
      .from('case_files')
      .insert({});
      
    if (insertError && insertError.message) {
      console.log('\n📋 Table structure info from insert error:');
      console.log(insertError.message);
    }
  }
}

checkCaseFilesTable().catch(console.error);
