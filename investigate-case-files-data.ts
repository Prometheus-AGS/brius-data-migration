import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function investigateCaseFilesData() {
  console.log('🔍 Investigating case_files data relationships...\n');

  // Check files table
  const { count: filesCount } = await supabase
    .from('files')
    .select('*', { count: 'exact', head: true });

  console.log(`📁 Total files in files table: ${filesCount || 0}`);

  // Check files with order_id
  const { count: filesWithOrdersCount } = await supabase
    .from('files')
    .select('*', { count: 'exact', head: true })
    .not('order_id', 'is', null);

  console.log(`📁 Files with order_id: ${filesWithOrdersCount || 0}`);

  // Check orders table
  const { count: ordersCount } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true });

  console.log(`📋 Total orders: ${ordersCount || 0}`);

  // Check cases table
  const { count: casesCount } = await supabase
    .from('cases')
    .select('*', { count: 'exact', head: true });

  console.log(`📄 Total cases: ${casesCount || 0}`);

  // Sample files with order_id
  const { data: sampleFiles } = await supabase
    .from('files')
    .select('id, filename, order_id')
    .not('order_id', 'is', null)
    .limit(5);

  if (sampleFiles && sampleFiles.length > 0) {
    console.log('\n📋 Sample files with order_id:');
    sampleFiles.forEach((file, i) => {
      console.log(`   ${i + 1}. ${file.filename} (order_id: ${file.order_id})`);
    });
  }

  // Sample orders with patient_id
  const { data: sampleOrders } = await supabase
    .from('orders')
    .select('id, patient_id')
    .not('patient_id', 'is', null)
    .limit(5);

  if (sampleOrders && sampleOrders.length > 0) {
    console.log('\n📋 Sample orders with patient_id:');
    sampleOrders.forEach((order, i) => {
      console.log(`   ${i + 1}. Order ${order.id} (patient_id: ${order.patient_id})`);
    });
  }

  // Sample cases with patient_id
  const { data: sampleCases } = await supabase
    .from('cases')
    .select('id, patient_id')
    .not('patient_id', 'is', null)
    .limit(5);

  if (sampleCases && sampleCases.length > 0) {
    console.log('\n📋 Sample cases with patient_id:');
    sampleCases.forEach((caseItem, i) => {
      console.log(`   ${i + 1}. Case ${caseItem.id} (patient_id: ${caseItem.patient_id})`);
    });
  }

  // Test the relationship query directly
  console.log('\n🔗 Testing file → order → case relationship query...');
  const { data: relationshipTest, error: relationError } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT COUNT(*) as relationship_count
      FROM files f
      JOIN orders o ON f.order_id = o.id
      JOIN cases c ON o.patient_id = c.patient_id
      WHERE f.order_id IS NOT NULL
    `
  });

  if (relationError) {
    console.error('❌ Error testing relationship:', relationError);
  } else {
    console.log('Relationship test result:', relationshipTest);
  }

  // Try a simpler approach - check if the join works step by step
  console.log('\n🔗 Step-by-step relationship analysis...');

  // Step 1: Files → Orders
  const { data: filesOrdersJoin, error: foError } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT COUNT(*) as files_orders_count
      FROM files f
      JOIN orders o ON f.order_id = o.id
      WHERE f.order_id IS NOT NULL
    `
  });

  if (!foError && filesOrdersJoin) {
    console.log('Files → Orders join result:', filesOrdersJoin);
  }

  // Step 2: Orders → Cases
  const { data: ordersCasesJoin, error: ocError } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT COUNT(*) as orders_cases_count
      FROM orders o
      JOIN cases c ON o.patient_id = c.patient_id
      WHERE o.patient_id IS NOT NULL
    `
  });

  if (!ocError && ordersCasesJoin) {
    console.log('Orders → Cases join result:', ordersCasesJoin);
  }
}

investigateCaseFilesData().catch(console.error);