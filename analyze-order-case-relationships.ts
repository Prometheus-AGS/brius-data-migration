import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function analyzeRelationships() {
  console.log('🔍 Analyzing orders-cases relationships for optimal design...\n');
  
  // 1. Check how orders and cases relate via legacy_instruction_id
  console.log('📊 Analyzing orders-cases relationship via legacy_instruction_id:');
  
  const { data: orderCaseRelations } = await supabase
    .from('orders')
    .select(`
      id,
      legacy_instruction_id,
      order_number
    `)
    .not('legacy_instruction_id', 'is', null)
    .limit(5);
    
  if (orderCaseRelations) {
    console.log(`Orders with legacy_instruction_id: ${orderCaseRelations.length} (sample)`);
    
    for (const order of orderCaseRelations.slice(0, 2)) {
      const { data: relatedCases } = await supabase
        .from('cases')
        .select('id, case_number, legacy_instruction_id')
        .eq('legacy_instruction_id', order.legacy_instruction_id);
        
      console.log(`Order ${order.order_number} (instruction_id: ${order.legacy_instruction_id}) -> Cases: ${relatedCases?.length || 0}`);
      if (relatedCases && relatedCases.length > 0) {
        relatedCases.forEach(c => console.log(`  - Case: ${c.case_number}`));
      }
    }
  }
  
  // 2. Count total relationships
  const { count: ordersWithInstructionId } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .not('legacy_instruction_id', 'is', null);
    
  const { count: casesWithInstructionId } = await supabase
    .from('cases')
    .select('*', { count: 'exact', head: true })
    .not('legacy_instruction_id', 'is', null);
    
  console.log(`\n📊 Relationship statistics:`);
  console.log(`- Orders with legacy_instruction_id: ${ordersWithInstructionId}`);
  console.log(`- Cases with legacy_instruction_id: ${casesWithInstructionId}`);
  
  // 3. Check if relationship is 1:1 or 1:many
  const { data: instructionIdStats } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT 
        legacy_instruction_id,
        COUNT(*) as order_count
      FROM orders 
      WHERE legacy_instruction_id IS NOT NULL
      GROUP BY legacy_instruction_id
      HAVING COUNT(*) > 1
      ORDER BY order_count DESC
      LIMIT 5;
    `
  });
  
  console.log('\n📊 Instructions with multiple orders:');
  console.log(instructionIdStats);
  
  // 4. Analyze files relationships
  console.log('\n📊 Files relationship analysis:');
  
  const { count: filesWithOrders } = await supabase
    .from('files')
    .select('*', { count: 'exact', head: true })
    .not('order_id', 'is', null);
    
  const { count: filesWithoutOrders } = await supabase
    .from('files')
    .select('*', { count: 'exact', head: true })
    .is('order_id', null);
    
  console.log(`- Files linked to orders: ${filesWithOrders}`);
  console.log(`- Files NOT linked to orders: ${filesWithoutOrders}`);
  
  // 5. Architectural recommendations
  console.log('\n🏗️  ARCHITECTURAL RECOMMENDATIONS:');
  console.log(`
  Option 1: Create explicit orders_cases junction table
  - Pros: Clear, explicit relationships; supports many-to-many if needed
  - Cons: Additional table to maintain
  
  Option 2: Add case_id column directly to orders table  
  - Pros: Simple foreign key relationship; standard pattern
  - Cons: Assumes 1:many orders-to-case relationship
  
  Option 3: Create view for orders-cases relationship
  - Pros: No schema changes; flexible querying
  - Cons: Cannot index the relationship; performance implications
  
  Option 4: case_files as materialized view
  - Pros: Always up-to-date; no maintenance; can include complex logic
  - Cons: Refresh overhead; cannot have additional metadata (notes, display_order)
  `);
  
  // 6. Test potential view query
  console.log('\n🧪 Testing potential view query performance:');
  
  const startTime = Date.now();
  const { data: viewTest, error: viewError } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT 
        c.id as case_id,
        f.id as file_id,
        f.filename,
        f.file_type,
        f.uploaded_at,
        o.order_number
      FROM files f
      JOIN orders o ON f.order_id = o.id
      JOIN cases c ON o.legacy_instruction_id = c.legacy_instruction_id
      WHERE f.order_id IS NOT NULL 
        AND o.legacy_instruction_id IS NOT NULL
        AND c.legacy_instruction_id IS NOT NULL
      LIMIT 10;
    `
  });
  const queryTime = Date.now() - startTime;
  
  console.log(`Query executed in ${queryTime}ms`);
  console.log(`Results: ${Array.isArray(viewTest) ? viewTest.length : 'Error'}`);
  if (viewError) {
    console.log('Query error:', viewError);
  }
}

analyzeRelationships().catch(console.error);
