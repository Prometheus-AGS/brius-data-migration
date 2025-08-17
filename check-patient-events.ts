import * as dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function checkPatientEvents() {
  // Simple count by event_type
  const { data, error } = await supabase
    .from('patient_events')
    .select('event_type');
    
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  // Group by event_type manually
  const eventCounts: Record<string, number> = {};
  data?.forEach(event => {
    eventCounts[event.event_type] = (eventCounts[event.event_type] || 0) + 1;
  });
  
  console.log('Current patient events by type:', eventCounts);
  console.log('Total patient events:', data?.length || 0);
}

checkPatientEvents().catch(console.error);
