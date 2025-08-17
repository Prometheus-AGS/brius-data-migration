import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'http://localhost:8000', 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
);

async function checkOrderStatusEnum() {
  console.log('Checking order_status enum values...\n');
  
  try {
    // Query to get enum values
    const response = await fetch('http://localhost:8000/rest/v1/rpc/exec_sql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
      },
      body: JSON.stringify({ 
        sql: `
          SELECT enumlabel 
          FROM pg_enum 
          JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
          WHERE pg_type.typname = 'order_status' 
          ORDER BY enumsortorder;
        ` 
      })
    });
    
    const result = await response.text();
    console.log('Enum query result:', result);
    
    // Also check if we can query the table structure
    const structureResponse = await fetch('http://localhost:8000/rest/v1/rpc/exec_sql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
      },
      body: JSON.stringify({ 
        sql: `
          SELECT column_name, data_type, udt_name, is_nullable 
          FROM information_schema.columns 
          WHERE table_name = 'order_states' 
          AND table_schema = 'public'
          ORDER BY ordinal_position;
        ` 
      })
    });
    
    const structureResult = await structureResponse.text();
    console.log('\nTable structure result:', structureResult);
    
  } catch (error) {
    console.error('Error checking enum:', error);
  }
}

checkOrderStatusEnum().catch(console.error);
