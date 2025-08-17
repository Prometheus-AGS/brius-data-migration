import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'http://localhost:8000', 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
);

async function clearOrderStates() {
  console.log('Clearing existing order_states records...');
  
  const { count: beforeCount } = await supabase
    .from('order_states')
    .select('*', { count: 'exact', head: true });
    
  console.log(`Records before clearing: ${beforeCount || 0}`);
  
  const { error } = await supabase
    .from('order_states')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all
    
  if (error) {
    console.error('Error clearing order_states:', error);
  } else {
    console.log('✅ Successfully cleared order_states table');
    
    const { count: afterCount } = await supabase
      .from('order_states')
      .select('*', { count: 'exact', head: true });
      
    console.log(`Records after clearing: ${afterCount || 0}`);
  }
}

clearOrderStates().catch(console.error);
