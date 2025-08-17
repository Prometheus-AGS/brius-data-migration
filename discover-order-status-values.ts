import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'http://localhost:8000', 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
);

async function discoverOrderStatusValues() {
  console.log('Discovering valid order_status enum values...\n');
  
  // Test common status values by trying to insert them
  const testStatuses = [
    'draft',
    'submitted', 
    'pending',
    'approved',
    'rejected', 
    'in_progress',
    'in_review',
    'processing',
    'production',
    'completed',
    'shipped',
    'delivered',
    'cancelled',
    'hold',
    'waiting'
  ];
  
  const validStatuses: string[] = [];
  
  console.log('Testing possible status values...');
  
  for (const status of testStatuses) {
    try {
      // Try to insert with this status to see if it's valid
      const { error } = await supabase
        .from('order_states')
        .insert({
          order_id: '00000000-0000-0000-0000-000000000000', // This will fail on FK but enum will be validated first
          to_status: status
        });
        
      if (error) {
        if (error.message.includes('invalid input value for enum')) {
          // Status is invalid
        } else if (error.message.includes('violates foreign key constraint')) {
          // Status is valid but FK failed (which we expect)
          validStatuses.push(status);
        } else {
          // Other error, assume status might be valid
          console.log(`  ${status}: ${error.message}`);
        }
      } else {
        // Shouldn't happen with dummy UUID, but if it does, status is valid
        validStatuses.push(status);
      }
    } catch (e) {
      console.log(`  ${status}: Error - ${e}`);
    }
  }
  
  console.log('\nValid order_status values found:');
  validStatuses.forEach(status => {
    console.log(`  ✅ ${status}`);
  });
  
  // Also check if orders table has any existing statuses we can see
  const { data: existingOrders } = await supabase
    .from('orders')
    .select('status')
    .limit(10);
    
  if (existingOrders && existingOrders.length > 0) {
    console.log('\nExisting order statuses in orders table:');
    const uniqueStatuses = [...new Set(existingOrders.map(o => o.status).filter(s => s))];
    uniqueStatuses.forEach(status => {
      console.log(`  📋 ${status}`);
    });
  }
  
  return validStatuses;
}

discoverOrderStatusValues().catch(console.error);
