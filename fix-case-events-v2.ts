import * as dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function fixCaseEventsV2() {
  console.log('🔍 Investigating orders -> patients -> profiles relationship...\n');
  
  // Check the relationship: orders -> patients -> profiles
  const { data: sampleOrders, error: sampleError } = await supabase
    .from('orders')
    .select(`
      id, 
      patient_id, 
      legacy_instruction_id,
      order_number,
      created_at,
      patients!inner(
        id,
        profile_id,
        profiles!inner(id, profile_type)
      )
    `)
    .eq('patients.profiles.profile_type', 'patient')
    .limit(5);

  if (sampleError) {
    console.error('❌ Error checking relationship:', sampleError);
    return;
  }

  console.log(`✅ Found ${sampleOrders?.length || 0} orders with valid patient->profile chain (sample)`);
  
  // Get full count
  const { count: validOrdersCount } = await supabase
    .from('orders')
    .select('*, patients!inner(profiles!inner(*))', { count: 'exact', head: true })
    .eq('patients.profiles.profile_type', 'patient')
    .not('legacy_instruction_id', 'is', null);

  console.log(`📊 Total valid orders for case events: ${validOrdersCount}`);

  // Now migrate case events in batches
  if (validOrdersCount && validOrdersCount > 0) {
    console.log('\n🔄 Creating case opened events for valid orders...');
    
    let offset = 0;
    const batchSize = 500;
    let totalMigrated = 0;
    let batchNum = 1;

    while (offset < validOrdersCount) {
      console.log(`\n📦 Processing batch ${batchNum} (offset: ${offset})...`);
      
      const { data: orders, error: fetchError } = await supabase
        .from('orders')
        .select(`
          id, 
          patient_id, 
          created_at,
          legacy_instruction_id, 
          order_number,
          patients!inner(
            id,
            profile_id,
            profiles!inner(id, profile_type)
          )
        `)
        .eq('patients.profiles.profile_type', 'patient')
        .not('legacy_instruction_id', 'is', null)
        .range(offset, offset + batchSize - 1);

      if (fetchError) {
        console.error(`❌ Error fetching batch ${batchNum}:`, fetchError);
        break;
      }

      if (!orders || orders.length === 0) {
        console.log(`✅ No more orders to process`);
        break;
      }

      console.log(`  📋 Fetched ${orders.length} orders`);

      // Create patient events - use profile_id for patient_id in events
      const caseEvents = orders.map((order: any, index: number) => ({
        patient_id: order.patients.profile_id, // This is the profiles.id
        order_id: order.id,
        event_type: 'case_opened',
        description: `New treatment case opened - Order #${order.order_number || order.legacy_instruction_id}`,
        scheduled_at: order.created_at,
        status: 'completed' as const,
        metadata: {
          source: 'order_creation_v2',
          legacy_instruction_id: order.legacy_instruction_id,
          order_number: order.order_number,
          patient_uuid: order.patient_id // Store the patients.id for reference
        },
        legacy_event_id: 6000000 + offset + index // Use 6M range to avoid conflicts
      }));

      // Insert the batch
      const { error: insertError } = await supabase
        .from('patient_events')
        .upsert(caseEvents, { 
          onConflict: 'legacy_event_id',
          ignoreDuplicates: true
        });

      if (insertError) {
        console.error(`❌ Error inserting batch ${batchNum}:`, insertError.message);
      } else {
        console.log(`  ✅ Inserted ${caseEvents.length} case events`);
        totalMigrated += caseEvents.length;
      }

      offset += batchSize;
      batchNum++;

      // Limit to prevent runaway
      if (batchNum > 50) {
        console.log('⚠️ Reached batch limit, stopping migration');
        break;
      }
    }

    console.log(`\n📊 Case events migration completed: ${totalMigrated} events migrated`);
  }
}

fixCaseEventsV2().catch(console.error);
