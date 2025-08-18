import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function investigateBracketsTable() {
  console.log('🔍 Investigating brackets table in target database...\n');
  
  // 1. Check if brackets table exists and get structure
  console.log('📋 Step 1: Checking brackets table existence and structure...');
  
  const { data: bracketsTest, error: bracketsError } = await supabase
    .from('brackets')
    .select('*')
    .limit(1);
    
  if (bracketsError) {
    if (bracketsError.code === '42P01') {
      console.log('❌ brackets table does not exist');
      return;
    } else {
      console.error('Error checking brackets table:', bracketsError);
      return;
    }
  }
  
  console.log('✅ brackets table exists');
  
  // 2. Get current record count
  const { count: currentCount } = await supabase
    .from('brackets')
    .select('*', { count: 'exact', head: true });
    
  console.log(`📊 Current records in brackets: ${currentCount || 0}`);
  
  // 3. Get table structure
  if (bracketsTest && bracketsTest.length > 0) {
    console.log('\n📋 brackets table structure:');
    console.log('Columns:', Object.keys(bracketsTest[0]).join(', '));
    console.log('\nSample record:');
    console.log(JSON.stringify(bracketsTest[0], null, 2));
  } else {
    console.log('\n📋 brackets table is empty');
    
    // Try to understand structure by attempting insert
    const { error: insertError } = await supabase
      .from('brackets')
      .insert({});
      
    if (insertError) {
      console.log('Structure info from insert error:');
      console.log(insertError.message);
    }
  }
  
  // 4. Check foreign key relationships
  console.log('\n🔗 Checking brackets table relationships...');
  
  const { data: fkData, error: fkError } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = 'brackets';
    `
  });
  
  if (fkData && Array.isArray(fkData) && fkData.length > 0) {
    console.log('Foreign key relationships found:');
    fkData.forEach(fk => {
      console.log(`  ${fk.column_name} -> ${fk.foreign_table_name}.${fk.foreign_column_name}`);
    });
  } else {
    console.log('No foreign key relationships found or error retrieving them');
  }
  
  // 5. Check related tables that might contain bracket data
  console.log('\n📊 Checking related tables...');
  
  // Check if there are any case-related tables
  const { count: casesCount } = await supabase
    .from('cases')
    .select('*', { count: 'exact', head: true });
    
  console.log(`Cases available: ${casesCount}`);
  
  // Check orders
  const { count: ordersCount } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true });
    
  console.log(`Orders available: ${ordersCount}`);
  
  // Check if there are any existing bracket-related references
  const { data: sampleCases } = await supabase
    .from('cases')
    .select('*')
    .limit(3);
    
  if (sampleCases && sampleCases.length > 0) {
    console.log('\n📋 Sample case data (looking for bracket-related fields):');
    Object.keys(sampleCases[0]).forEach(key => {
      if (key.toLowerCase().includes('bracket') || key.toLowerCase().includes('appliance')) {
        console.log(`  Found bracket-related field: ${key}`);
      }
    });
  }
}

investigateBracketsTable().catch(console.error);
