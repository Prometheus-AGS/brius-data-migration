import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function investigateRelationships() {
  console.log('🔍 Investigating actual table relationships...\n');
  
  // Check orders table structure
  console.log('📋 Orders table structure:');
  const { data: orderSample } = await supabase
    .from('orders')
    .select('*')
    .limit(1);
    
  if (orderSample && orderSample[0]) {
    console.log('Orders columns:', Object.keys(orderSample[0]).join(', '));
    console.log('Sample order:', JSON.stringify(orderSample[0], null, 2));
  }
  
  // Check cases table structure  
  console.log('\n📋 Cases table structure:');
  const { data: caseSample } = await supabase
    .from('cases')
    .select('*')
    .limit(1);
    
  if (caseSample && caseSample[0]) {
    console.log('Cases columns:', Object.keys(caseSample[0]).join(', '));
    console.log('Sample case:', JSON.stringify(caseSample[0], null, 2));
  }
  
  // Check files table structure (confirm what we have)
  console.log('\n📋 Files table structure:');
  const { data: fileSample } = await supabase
    .from('files')
    .select('*')
    .limit(1);
    
  if (fileSample && fileSample[0]) {
    console.log('Files columns:', Object.keys(fileSample[0]).join(', '));
  }
  
  // Check how many files have order_id
  const { count: filesWithOrdersCount } = await supabase
    .from('files')
    .select('*', { count: 'exact', head: true })
    .not('order_id', 'is', null);
    
  console.log(`\n📊 Files with order_id: ${filesWithOrdersCount}`);
  
  // Check how many files don't have order_id (these might need different mapping)
  const { count: filesWithoutOrdersCount } = await supabase
    .from('files')
    .select('*', { count: 'exact', head: true })
    .is('order_id', null);
    
  console.log(`📊 Files without order_id: ${filesWithoutOrdersCount}`);
  
  // Look at files metadata to understand original relationships
  const { data: filesWithMetadata } = await supabase
    .from('files')
    .select('id, filename, metadata, order_id')
    .not('metadata', 'is', null)
    .limit(5);
    
  console.log('\n📋 Files with metadata (to understand source relationships):');
  if (filesWithMetadata) {
    filesWithMetadata.forEach((file, index) => {
      console.log(`${index + 1}. ${file.filename}: metadata =`, JSON.stringify(file.metadata, null, 2));
    });
  }
}

investigateRelationships().catch(console.error);
