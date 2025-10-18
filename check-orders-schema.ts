import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function checkOrdersSchema() {
  console.log('🔍 Checking orders table schema...');

  // Get a sample order to see actual structure
  const { data: sampleOrder, error } = await supabase
    .from('orders')
    .select('*')
    .limit(1)
    .single();

  if (error) {
    console.error('❌ Error fetching sample order:', error);
    return;
  }

  if (sampleOrder) {
    console.log('\n📋 Sample order structure:');
    console.log(JSON.stringify(sampleOrder, null, 2));

    console.log('\n🔑 Available columns:');
    Object.keys(sampleOrder).forEach(key => {
      console.log(`   • ${key}: ${typeof sampleOrder[key]} ${sampleOrder[key] === null ? '(null)' : ''}`);
    });
  }

  // Also check files table structure
  const { data: sampleFile, error: fileError } = await supabase
    .from('files')
    .select('*')
    .not('order_id', 'is', null)
    .limit(1)
    .single();

  if (sampleFile && !fileError) {
    console.log('\n📁 Sample file structure (with order_id):');
    console.log(JSON.stringify(sampleFile, null, 2));
  }

  // Check if files have relationships to cases through orders
  const { data: fileOrderRelation, error: relationError } = await supabase
    .from('files')
    .select(`
      id,
      order_id,
      filename
    `)
    .not('order_id', 'is', null)
    .limit(5);

  if (fileOrderRelation && !relationError) {
    console.log('\n🔗 Files with order relationships:');
    fileOrderRelation.forEach((file, i) => {
      console.log(`   ${i + 1}. File: ${file.filename}, Order ID: ${file.order_id}`);
    });
  }
}

checkOrdersSchema().catch(console.error);