import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function createOrderCasesJunction() {
  console.log('🚀 Creating order_cases junction table for many-to-many relationship...\n');
  
  // Step 1: Create the junction table
  console.log('📋 Step 1: Creating order_cases junction table...');
  
  const createJunctionSQL = `
    -- Create order_cases junction table
    CREATE TABLE IF NOT EXISTS order_cases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      relationship_type VARCHAR(50) DEFAULT 'primary', -- 'primary', 'secondary', etc.
      created_at TIMESTAMPTZ DEFAULT NOW(),
      
      -- Prevent duplicate relationships
      UNIQUE(order_id, case_id)
    );
    
    -- Create indexes for performance
    CREATE INDEX IF NOT EXISTS idx_order_cases_order_id ON order_cases(order_id);
    CREATE INDEX IF NOT EXISTS idx_order_cases_case_id ON order_cases(case_id);
    CREATE INDEX IF NOT EXISTS idx_order_cases_relationship ON order_cases(relationship_type);
    
    -- Add RLS policy
    ALTER TABLE order_cases ENABLE ROW LEVEL SECURITY;
  `;
  
  const { error: createError } = await supabase.rpc('exec_sql', { sql: createJunctionSQL });
  
  if (createError) {
    console.error('❌ Error creating junction table:', createError);
    return;
  }
  
  console.log('✅ order_cases junction table created successfully');
  
  // Step 2: Populate the junction table using source data
  console.log('\n📊 Step 2: Populating order_cases from source dispatch data...');
  
  const sourceClient = new Client({
    host: process.env.SOURCE_DB_HOST!,
    port: parseInt(process.env.SOURCE_DB_PORT!),
    user: process.env.SOURCE_DB_USER!,
    password: process.env.SOURCE_DB_PASSWORD!,
    database: process.env.SOURCE_DB_NAME!,
  });
  
  try {
    await sourceClient.connect();
    
    // Get instruction to case/order mappings from source
    const sourceInstructionMappings = await sourceClient.query(`
      SELECT DISTINCT
        di.id as instruction_id,
        dc.id as case_id,
        do.id as order_id
      FROM dispatch_instruction di
      LEFT JOIN dispatch_case dc ON di.case_id = dc.id
      LEFT JOIN dispatch_order do ON di.id = do.instruction_id
      WHERE di.case_id IS NOT NULL 
        AND do.instruction_id IS NOT NULL
      ORDER BY di.id
      LIMIT 100;
    `);
    
    console.log(`Found ${sourceInstructionMappings.rows.length} instruction mappings to process`);
    
    if (sourceInstructionMappings.rows.length > 0) {
      console.log('Sample mapping:', sourceInstructionMappings.rows[0]);
      
      // Now map these to target UUIDs
      let totalMapped = 0;
      
      for (const mapping of sourceInstructionMappings.rows) {
        // Find target order by legacy_instruction_id
        const { data: targetOrders } = await supabase
          .from('orders')
          .select('id')
          .eq('legacy_instruction_id', mapping.instruction_id);
          
        // Find target case by legacy case_id (assuming cases have legacy_case_id)
        const { data: targetCases } = await supabase
          .from('cases')
          .select('id')
          .eq('legacy_case_id', mapping.case_id); // This might need adjustment
          
        if (targetOrders && targetOrders.length > 0 && targetCases && targetCases.length > 0) {
          // Create relationships
          for (const order of targetOrders) {
            for (const case_ of targetCases) {
              const { error: insertError } = await supabase
                .from('order_cases')
                .insert({
                  order_id: order.id,
                  case_id: case_.id,
                  relationship_type: 'primary'
                });
                
              if (!insertError) {
                totalMapped++;
              } else if (insertError.code !== '23505') { // Ignore unique constraint violations
                console.log('Insert error:', insertError);
              }
            }
          }
        }
      }
      
      console.log(`✅ Created ${totalMapped} order-case relationships`);
    } else {
      console.log('⚠️  No instruction mappings found in source. Will try alternative approach...');
      
      // Alternative: Create relationships based on patient_id matching
      console.log('🔄 Trying patient-based matching...');
      
      const { data: orders } = await supabase
        .from('orders')
        .select('id, patient_id, legacy_instruction_id')
        .not('legacy_instruction_id', 'is', null)
        .limit(100);
        
      let patientMapped = 0;
      
      if (orders) {
        for (const order of orders) {
          // Find cases with same patient_id
          const { data: cases } = await supabase
            .from('cases')
            .select('id')
            .eq('patient_id', order.patient_id);
            
          if (cases && cases.length > 0) {
            for (const case_ of cases) {
              const { error: insertError } = await supabase
                .from('order_cases')
                .insert({
                  order_id: order.id,
                  case_id: case_.id,
                  relationship_type: 'primary'
                });
                
              if (!insertError) {
                patientMapped++;
              } else if (insertError.code !== '23505') {
                console.log('Patient-based insert error:', insertError);
              }
            }
          }
        }
        
        console.log(`✅ Created ${patientMapped} order-case relationships via patient matching`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error during source data processing:', error);
  } finally {
    await sourceClient.end();
  }
  
  // Step 3: Validate the relationships
  console.log('\n✅ Step 3: Validating order_cases relationships...');
  
  const { count: totalRelationships } = await supabase
    .from('order_cases')
    .select('*', { count: 'exact', head: true });
    
  console.log(`Total order-case relationships created: ${totalRelationships}`);
  
  // Sample relationships
  const { data: sampleRelationships } = await supabase
    .from('order_cases')
    .select(`
      id,
      relationship_type,
      orders!inner(order_number, patient_id),
      cases!inner(case_number, patient_id)
    `)
    .limit(3);
    
  if (sampleRelationships) {
    console.log('\n📋 Sample relationships:');
    sampleRelationships.forEach((rel, index) => {
      console.log(`${index + 1}. Order: ${rel.orders?.order_number} ↔ Case: ${rel.cases?.case_number}`);
    });
  }
  
  // Step 4: Recommend next steps
  console.log('\n📝 Next Steps:');
  console.log('1. Verify the relationships look correct');
  console.log('2. Remove legacy_instruction_id columns from orders and cases tables');
  console.log('3. Create the case_files table using this clean relationship structure');
}

createOrderCasesJunction().catch(console.error);
