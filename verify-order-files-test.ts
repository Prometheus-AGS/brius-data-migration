import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'http://localhost:8000', 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
);

async function verifyOrderFilesTest() {
  console.log('Verifying order_files test migration...');
  
  // Get count
  const { count, error: countError } = await supabase
    .from('order_files')
    .select('*', { count: 'exact', head: true });
    
  if (countError) {
    console.log('Error getting count:', countError);
    return;
  }
  
  console.log(`Total order_files entries: ${count}`);
  
  // Get sample order_files with related data
  const { data: orderFiles, error: orderFilesError } = await supabase
    .from('order_files')
    .select(`
      id, category, file_type, status, uploaded_at, metadata, parameters,
      legacy_file_id, legacy_instruction_id,
      orders!inner(id, legacy_instruction_id),
      files!inner(id, filename, file_size_bytes, legacy_file_id)
    `)
    .limit(3);
    
  if (orderFilesError) {
    console.log('Error getting order files:', orderFilesError);
    return;
  }
  
  console.log('\nSample order_files with relationships:');
  orderFiles?.forEach((of, i) => {
    console.log(`\n--- Order File ${i + 1} ---`);
    console.log(`ID: ${of.id}`);
    console.log(`Category: ${of.category}`);
    console.log(`File Type: ${of.file_type}`);
    console.log(`Status: ${of.status}`);
    console.log(`Legacy File ID: ${of.legacy_file_id}`);
    console.log(`Legacy Order ID: ${of.legacy_instruction_id}`);
    console.log(`Uploaded: ${of.uploaded_at}`);
    console.log(`File: ${of.files.filename} (${of.files.file_size_bytes} bytes)`);
    console.log(`Order: ${of.orders.legacy_instruction_id}`);
    console.log(`Metadata:`, JSON.stringify(of.metadata, null, 2));
    console.log(`Parameters:`, JSON.stringify(of.parameters, null, 2));
  });
  
  // Check category distribution
  const { data: categoryStats } = await supabase
    .from('order_files')
    .select('category')
    .then(({ data, error }) => {
      if (error) return { data: null, error };
      
      const stats: { [key: string]: number } = {};
      data?.forEach((of: any) => {
        stats[of.category] = (stats[of.category] || 0) + 1;
      });
      
      return { data: stats, error: null };
    });
    
  console.log('\nFile category distribution:');
  Object.entries(categoryStats || {}).forEach(([category, count]) => {
    console.log(`  ${category}: ${count}`);
  });
  
  // Check file type distribution
  const { data: typeStats } = await supabase
    .from('order_files')
    .select('file_type')
    .then(({ data, error }) => {
      if (error) return { data: null, error };
      
      const stats: { [key: string]: number } = {};
      data?.forEach((of: any) => {
        stats[of.file_type] = (stats[of.file_type] || 0) + 1;
      });
      
      return { data: stats, error: null };
    });
    
  console.log('\nFile type distribution:');
  Object.entries(typeStats || {}).forEach(([type, count]) => {
    console.log(`  Type ${type}: ${count}`);
  });
}

verifyOrderFilesTest().catch(console.error);
