import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function analyzeSchemas() {
  console.log('🔍 Analyzing current schemas for case_files refactor...\n');
  
  // Get sample files data to understand the structure
  console.log('📋 Current files table structure:');
  const { data: filesData, error: filesError } = await supabase
    .from('files')
    .select('*')
    .limit(1);
    
  if (filesData && filesData[0]) {
    console.log('Files table columns:', Object.keys(filesData[0]).join(', '));
    console.log('\nSample files record:');
    Object.entries(filesData[0]).forEach(([key, value]) => {
      console.log(`  ${key}: ${typeof value} = ${JSON.stringify(value)}`);
    });
  }
  
  // Try to understand case_files current schema by attempting different inserts
  console.log('\n📋 Discovering case_files table schema...');
  
  // Get a sample case ID for testing
  const { data: caseData } = await supabase
    .from('cases')
    .select('id')
    .limit(1);
    
  const testCaseId = caseData?.[0]?.id;
  
  if (testCaseId) {
    console.log(`Using test case ID: ${testCaseId}`);
    
    // Try different column combinations to discover the schema
    const testFields = [
      { case_id: testCaseId },
      { case_id: testCaseId, file_id: 'test-file-id' },
      { case_id: testCaseId, file_path: 'test-path' },
      { case_id: testCaseId, file_name: 'test-name' },
      { case_id: testCaseId, uploaded_by: 'test-user' },
      { case_id: testCaseId, created_at: new Date().toISOString() },
    ];
    
    for (const fields of testFields) {
      const { error } = await supabase
        .from('case_files')
        .insert(fields)
        .select();
        
      console.log(`Test ${Object.keys(fields).join(', ')}: ${error?.message || 'Success (cleaned up)'}`);
      
      // Clean up any successful inserts
      if (!error) {
        await supabase
          .from('case_files')
          .delete()
          .eq('case_id', testCaseId);
      }
    }
  }
  
  // Check what source data we need to map
  console.log('\n🔗 Understanding source file relationships we need to preserve...');
  
  // Check how many files have instruction_id relationships
  const { data: filesWithOrders } = await supabase
    .from('files')
    .select('id, order_id')
    .not('order_id', 'is', null)
    .limit(5);
    
  console.log(`\nFiles already linked to orders: ${filesWithOrders?.length || 0}`);
  if (filesWithOrders && filesWithOrders.length > 0) {
    console.log('Sample file-order links:', filesWithOrders);
  }
  
  // Count total files that need case relationships
  const { count: totalFilesCount } = await supabase
    .from('files')
    .select('*', { count: 'exact', head: true });
    
  console.log(`\nTotal files in database: ${totalFilesCount}`);
  
  // Check orders to cases relationships
  const { data: ordersWithCases } = await supabase
    .from('orders')
    .select('id, case_id')
    .not('case_id', 'is', null)
    .limit(5);
    
  console.log(`\nOrders with case relationships: ${ordersWithCases?.length || 0}`);
  if (ordersWithCases && ordersWithCases.length > 0) {
    console.log('Sample order-case links:', ordersWithCases);
  }
}

analyzeSchemas().catch(console.error);
