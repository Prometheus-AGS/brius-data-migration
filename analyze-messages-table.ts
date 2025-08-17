import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'http://localhost:8000', 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
);

async function analyzeMessagesTable() {
  console.log('Connecting to Supabase...');
  
  // Get count first
  const { count, error: countError } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true });
    
  if (countError) {
    console.log('Error getting count:', countError);
    return;
  } else {
    console.log('Current messages table count:', count);
  }
  
  // Try to get a sample if any exist
  const { data: sample, error: sampleError } = await supabase
    .from('messages')
    .select('*')
    .limit(1);
    
  if (sampleError) {
    console.log('Error getting sample:', sampleError);
  } else if (sample && sample.length > 0) {
    console.log('\nSample message:');
    console.log(JSON.stringify(sample[0], null, 2));
    
    // Show all columns
    console.log('\nMessage table columns:', Object.keys(sample[0]));
  } else {
    console.log('\nNo messages exist yet');
  }
}

analyzeMessagesTable().catch(console.error);
