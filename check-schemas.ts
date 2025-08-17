import * as dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function checkSchemas() {
  // Check patient_events table structure
  const { data, error } = await supabase.rpc('exec_sql', {
    sql: "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'patient_events' ORDER BY ordinal_position"
  });
  
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  console.log('patient_events table schema:');
  data?.forEach((row: any) => console.log(`- ${row.column_name}: ${row.data_type} (${row.is_nullable === 'YES' ? 'nullable' : 'not null'})`));

  // Check orders table structure for relevant columns
  const { data: ordersData, error: ordersError } = await supabase.rpc('exec_sql', {
    sql: "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'orders' AND column_name IN ('order_type', 'order_number', 'legacy_instruction_id') ORDER BY ordinal_position"
  });
  
  if (!ordersError && ordersData) {
    console.log('\norders table relevant columns:');
    ordersData.forEach((row: any) => console.log(`- ${row.column_name}: ${row.data_type}`));
  }
}

checkSchemas().catch(console.error);
