import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function checkHostedOrders() {
  console.log('🔍 Checking hosted Supabase instance for order data...\n');

  try {
    // Check orders count
    const { data: ordersData, error: ordersError } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true });

    if (ordersError) {
      console.error('❌ Error checking orders:', ordersError);
    } else {
      console.log(`📦 Orders: ${ordersData?.length || 0} records`);
    }

    // Check cases count
    const { data: casesData, error: casesError } = await supabase
      .from('cases')
      .select('id', { count: 'exact', head: true });

    if (casesError) {
      console.error('❌ Error checking cases:', casesError);
    } else {
      console.log(`🗂️  Cases: ${casesData?.length || 0} records`);
    }

    // Check case_files count
    const { data: filesData, error: filesError } = await supabase
      .from('case_files')
      .select('id', { count: 'exact', head: true });

    if (filesError) {
      console.error('❌ Error checking case_files:', filesError);
    } else {
      console.log(`📁 Case Files: ${filesData?.length || 0} records`);
    }

    // Check purchases count
    const { data: purchasesData, error: purchasesError } = await supabase
      .from('purchases')
      .select('id', { count: 'exact', head: true });

    if (purchasesError) {
      console.error('❌ Error checking purchases:', purchasesError);
    } else {
      console.log(`💰 Purchases: ${purchasesData?.length || 0} records`);
    }

    // Check shipments table structure
    const { data: shipmentsData, error: shipmentsError } = await supabase
      .from('shipments')
      .select('id', { count: 'exact', head: true });

    if (shipmentsError) {
      console.error('❌ Error checking shipments:', shipmentsError);
    } else {
      console.log(`🚢 Shipments: ${shipmentsData?.length || 0} records`);
    }

    // Get sample orders for shipment creation
    if (ordersData && ordersData.length > 0) {
      const { data: sampleOrders, error: sampleError } = await supabase
        .from('orders')
        .select('id, created_at, patient_id')
        .limit(5);

      if (!sampleError && sampleOrders) {
        console.log('\n📋 Sample orders available for shipment creation:');
        sampleOrders.forEach((order, index) => {
          console.log(`  ${index + 1}. Order ID: ${order.id.substring(0, 8)}... (${order.created_at?.substring(0, 10)})`);
        });
      }
    }

  } catch (error: any) {
    console.error('❌ Error checking hosted database:', error);
  }

  console.log('\n✨ Hosted database check completed!');
}

// Run the check
if (require.main === module) {
  checkHostedOrders().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default checkHostedOrders;