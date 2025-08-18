import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function populateOrderCasesJunction() {
  console.log('🔄 Populating order_cases junction table...\n');
  
  // Since we have orders with legacy_instruction_id and cases that belong to patients,
  // let's create relationships based on patient_id matching
  
  console.log('📊 Step 1: Analyzing current data for relationships...');
  
  // Get all orders with their patient info
  const { data: ordersData, error: ordersError } = await supabase
    .from('orders')
    .select('id, patient_id, legacy_instruction_id, order_number')
    .not('legacy_instruction_id', 'is', null)
    .limit(10); // Start with a small batch for testing
    
  console.log(`Found ${ordersData?.length || 0} orders with legacy_instruction_id`);
  
  if (ordersData && ordersData.length > 0) {
    console.log('Sample order:', ordersData[0]);
    
    let relationshipsCreated = 0;
    
    for (const order of ordersData) {
      // Find cases for the same patient
      const { data: casesForPatient, error: casesError } = await supabase
        .from('cases')
        .select('id, case_number, patient_id')
        .eq('patient_id', order.patient_id);
        
      if (casesForPatient && casesForPatient.length > 0) {
        console.log(`Order ${order.order_number} (patient: ${order.patient_id}) -> ${casesForPatient.length} cases`);
        
        for (const case_ of casesForPatient) {
          // Create the relationship
          const { data: insertData, error: insertError } = await supabase
            .from('order_cases')
            .insert({
              order_id: order.id,
              case_id: case_.id,
              relationship_type: 'primary'
            })
            .select();
            
          if (insertError) {
            if (insertError.code === '23505') {
              console.log(`  - Relationship already exists (order: ${order.order_number} ↔ case: ${case_.case_number})`);
            } else {
              console.error(`  - Error creating relationship:`, insertError);
            }
          } else {
            console.log(`  ✅ Created relationship: ${order.order_number} ↔ ${case_.case_number}`);
            relationshipsCreated++;
          }
        }
      } else {
        console.log(`Order ${order.order_number} -> No cases found for patient ${order.patient_id}`);
      }
    }
    
    console.log(`\n🎉 Created ${relationshipsCreated} order-case relationships`);
  }
  
  // Now let's expand to all orders if the test batch worked
  console.log('\n🔄 Step 2: Processing all orders...');
  
  const { count: totalOrders } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .not('legacy_instruction_id', 'is', null);
    
  console.log(`Total orders to process: ${totalOrders}`);
  
  if (totalOrders && totalOrders > 0) {
    console.log('Processing in batches...');
    
    const batchSize = 100;
    let totalProcessed = 0;
    let totalRelationships = 0;
    
    for (let offset = 0; offset < totalOrders; offset += batchSize) {
      const { data: ordersBatch } = await supabase
        .from('orders')
        .select('id, patient_id, order_number')
        .not('legacy_instruction_id', 'is', null)
        .range(offset, offset + batchSize - 1);
        
      if (!ordersBatch) continue;
      
      for (const order of ordersBatch) {
        const { data: casesForPatient } = await supabase
          .from('cases')
          .select('id')
          .eq('patient_id', order.patient_id);
          
        if (casesForPatient && casesForPatient.length > 0) {
          // Create relationships for all cases of this patient
          const relationships = casesForPatient.map(case_ => ({
            order_id: order.id,
            case_id: case_.id,
            relationship_type: 'primary'
          }));
          
          const { error: batchInsertError } = await supabase
            .from('order_cases')
            .insert(relationships);
            
          if (!batchInsertError) {
            totalRelationships += relationships.length;
          }
        }
        
        totalProcessed++;
      }
      
      console.log(`Processed ${totalProcessed}/${totalOrders} orders, created ${totalRelationships} relationships`);
    }
    
    console.log(`\n🎉 Final result: ${totalRelationships} total order-case relationships created`);
  }
  
  // Validate final results
  console.log('\n✅ Final validation:');
  
  const { count: finalRelationshipCount } = await supabase
    .from('order_cases')
    .select('*', { count: 'exact', head: true });
    
  console.log(`Total relationships in order_cases: ${finalRelationshipCount}`);
  
  // Sample the relationships
  const { data: sampleRelationships } = await supabase
    .from('order_cases')
    .select(`
      id,
      orders!inner(order_number, patient_id),
      cases!inner(case_number, patient_id)
    `)
    .limit(5);
    
  if (sampleRelationships) {
    console.log('\n📋 Sample relationships:');
    sampleRelationships.forEach((rel, index) => {
      const orderPatient = rel.orders?.patient_id;
      const casePatient = rel.cases?.patient_id;
      const match = orderPatient === casePatient ? '✅' : '❌';
      console.log(`${index + 1}. ${match} Order: ${rel.orders?.order_number} ↔ Case: ${rel.cases?.case_number}`);
      console.log(`   Patient match: ${orderPatient} = ${casePatient}`);
    });
  }
}

populateOrderCasesJunction().catch(console.error);
