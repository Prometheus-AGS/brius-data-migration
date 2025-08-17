import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'http://localhost:8000', 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
);

async function listTables() {
  console.log('Fetching table list...');
  
  const { data, error } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `
  });
    
  if (error) {
    console.log('Error fetching tables:', error);
    return;
  }
  
  console.log('Tables response:', data);
  console.log('Type:', typeof data);
  
  if (Array.isArray(data)) {
    console.log('\nAvailable tables:');
    data.forEach((row: any) => {
      console.log('  -', row.table_name);
    });
  } else {
    console.log('Data is not an array:', data);
  }
}

listTables().catch(console.error);
