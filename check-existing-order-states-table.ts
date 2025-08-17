import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'http://localhost:8000', 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
);

async function checkExistingOrderStatesTable() {
  console.log('Checking existing order_states table...\n');
  
  try {
    // Get table schema using direct SQL
    const schemaResponse = await fetch('http://localhost:8000/rest/v1/rpc/exec_sql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
      },
      body: JSON.stringify({ 
        sql: `
          SELECT column_name, data_type, is_nullable, column_default 
          FROM information_schema.columns 
          WHERE table_name = 'order_states' 
          AND table_schema = 'public'
          ORDER BY ordinal_position;
        ` 
      })
    });
    
    const schemaResult = await schemaResponse.text();
    console.log('Schema query response:', schemaResult);
    
    // Get count of existing records
    const { count, error: countError } = await supabase
      .from('order_states')
      .select('*', { count: 'exact', head: true });
      
    if (countError) {
      console.log('Error getting count:', countError.message);
    } else {
      console.log(`Current order_states records: ${count || 0}`);
    }
    
    // Get sample records to understand structure
    const { data: sampleData, error: sampleError } = await supabase
      .from('order_states')
      .select('*')
      .limit(3);
      
    if (sampleError) {
      console.log('Error getting sample data:', sampleError.message);
    } else {
      console.log('\nSample order_states records:');
      if (sampleData && sampleData.length > 0) {
        sampleData.forEach((record, i) => {
          console.log(`\nSample ${i + 1}:`);
          Object.keys(record).forEach(key => {
            console.log(`  ${key}: ${record[key]}`);
          });
        });
        
        console.log('\nTable columns available:');
        Object.keys(sampleData[0]).forEach(col => {
          console.log(`  - ${col}`);
        });
      } else {
        console.log('Table exists but is empty');
        
        // Try to insert a test record to see the structure
        console.log('\nTrying to understand table structure through insertion test...');
        try {
          const { error: insertError } = await supabase
            .from('order_states')
            .insert({
              // This will fail but show us required fields
            })
            .select();
            
          console.log('Insert error (expected):', insertError?.message);
        } catch (e) {
          console.log('Insert test error:', e);
        }
      }
    }
    
  } catch (error) {
    console.error('Error checking order_states table:', error);
  }
}

checkExistingOrderStatesTable().catch(console.error);
