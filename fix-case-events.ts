import * as dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function fixCaseEvents() {
  console.log('🔍 Investigating case opened events issues...\n');
  
  // Check how many orders have valid patient references
  const { data: ordersWithValidPatients, error: validError } = await supabase
    .from('orders')
    .select(`
      id, 
      patient_id, 
      legacy_instruction_id, 
      profiles!inner(id, profile_type)
    `)
    .eq('profiles.profile_type', 'patient')
    .limit(10);

  if (validError) {
    console.error('❌ Error checking valid patient references:', validError);
    return;
  }

  console.log(`✅ Found ${ordersWithValidPatients?.length || 0} orders with valid patient references (sample)`);

  // Let's get a full count of valid orders
  const { count: validOrdersCount } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .not('patient_id', 'is', null);

  console.log(`📊 Total orders with patient_id: ${validOrdersCount}`);

  // Count orders with both patient_id and legacy_instruction_id
  const { count: completeOrdersCount } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .not('patient_id', 'is', null)
    .not('legacy_instruction_id', 'is', null);

  console.log(`📊 Orders with both patient_id and legacy_instruction_id: ${completeOrdersCount}`);

  // Now let's try to create case events for just the valid orders
  if (ordersWithValidPatients && ordersWithValidPatients.length > 0) {
    console.log('\n🔄 Creating case events for valid orders...');
    
    // Get more valid orders (limited batch)
    const { data: validOrders, error: fetchError } = await supabase
      .from('orders')
      .select(`
        id, 
        patient_id, 
        created_at,
        legacy_instruction_id, 
        order_number,
        profiles!inner(id, profile_type)
      `)
      .eq('profiles.profile_type', 'patient')
      .not('legacy_instruction_id', 'is', null)
      .limit(1000); // Limit for this fix

    if (fetchError) {
      console.error('❌ Error fetching valid orders:', fetchError);
      return;
    }

    console.log(`✅ Found ${validOrders?.length || 0} valid orders to migrate`);

    if (validOrders && validOrders.length > 0) {
      const caseEvents = validOrders.map((order: any, index: number) => ({
        patient_id: order.patient_id,
        order_id: order.id,
        event_type: 'case_opened',
        description: `New treatment case opened - Order #${order.order_number || order.legacy_instruction_id}`,
        scheduled_at: order.created_at,
        status: 'completed' as const,
        metadata: {
          source: 'order_creation_fixed',
          legacy_instruction_id: order.legacy_instruction_id,
          order_number: order.order_number
        },
        legacy_event_id: 5000000 + index // Use 5M range to avoid conflicts
      }));

      // Insert in smaller batches
      const batchSize = 100;
      const batches = Math.ceil(caseEvents.length / batchSize);
      let successCount = 0;

      for (let i = 0; i < batches; i++) {
        const start = i * batchSize;
        const end = Math.min(start + batchSize, caseEvents.length);
        const batch = caseEvents.slice(start, end);

        const { error } = await supabase
          .from('patient_events')
          .upsert(batch, { 
            onConflict: 'legacy_event_id',
            ignoreDuplicates: true
          });

        if (error) {
          console.error(`❌ Error inserting batch ${i + 1}/${batches}:`, error.message);
        } else {
          console.log(`✅ Batch ${i + 1}/${batches} completed (${batch.length} events)`);
          successCount += batch.length;
        }
      }

      console.log(`\n📊 Case events migration completed: ${successCount}/${caseEvents.length} successful`);
    }
  }
}

fixCaseEvents().catch(console.error);
