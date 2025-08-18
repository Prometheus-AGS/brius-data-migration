import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function checkCaseFileTable() {
  console.log('Checking for case_file table in target database...');
  
  // Try direct query to see if table exists
  const { data: testData, error: testError } = await supabase
    .from('case_file')
    .select('*')
    .limit(1);
    
  if (testError) {
    if (testError.code === '42P01') {
      console.log('❌ case_file table does not exist');
      return;
    } else {
      console.error('Error checking table:', testError);
      return;
    }
  }
  
  console.log('✅ case_file table exists');
  
  // Check current record count
  const { count, error: countError } = await supabase
    .from('case_file')
    .select('*', { count: 'exact', head: true });
    
  if (!countError) {
    console.log(`📊 Current records in case_file: ${count}`);
  } else {
    console.log('❌ Error getting record count:', countError);
  }
  
  // Get sample records to understand structure
  const { data: sampleData, error: sampleError } = await supabase
    .from('case_file')
    .select('*')
    .limit(3);
    
  if (sampleData && sampleData.length > 0) {
    console.log('\n📋 Sample case_file records:');
    console.log('Columns:', Object.keys(sampleData[0]).join(', '));
    console.log('\nFirst record:');
    console.log(JSON.stringify(sampleData[0], null, 2));
  } else {
    console.log('\n📋 No records found in case_file table');
  }
}

checkCaseFileTable().catch(console.error);
