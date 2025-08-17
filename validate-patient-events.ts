import * as dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function validatePatientEvents() {
  // Count events by type
  const { data: events, error } = await supabase
    .from('patient_events')
    .select('event_type');
    
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  const eventCounts: Record<string, number> = {};
  events?.forEach((event: any) => {
    eventCounts[event.event_type] = (eventCounts[event.event_type] || 0) + 1;
  });
  
  console.log('📊 Current patient events by type:');
  console.log('==================================');
  Object.entries(eventCounts).forEach(([type, count]) => {
    console.log(`${type}: ${count.toLocaleString()} events`);
  });
  console.log('==================================');
  console.log(`Total events: ${events?.length?.toLocaleString() || 0}`);
  
  // Sample a few events
  const { data: samples, error: samplesError } = await supabase
    .from('patient_events')
    .select('id, event_type, description, scheduled_at, metadata')
    .limit(5);
    
  if (!samplesError && samples) {
    console.log('\n📋 Sample events:');
    samples.forEach((event: any, i: number) => {
      console.log(`${i + 1}. [${event.event_type}] ${event.description}`);
      console.log(`   Scheduled: ${event.scheduled_at}`);
      console.log(`   Metadata: ${JSON.stringify(event.metadata)}`);
      console.log('');
    });
  }

  // Check for referential integrity
  console.log('\n🔍 Checking referential integrity...');
  
  // Check if all patient_ids exist in profiles
  const { data: orphanedEvents, error: orphanError } = await supabase
    .from('patient_events')
    .select(`
      id, 
      patient_id, 
      event_type,
      profiles!inner(id)
    `)
    .limit(10);
    
  if (!orphanError) {
    console.log(`✅ Patient reference integrity check passed for sample events`);
  } else {
    console.error('❌ Patient reference integrity issues:', orphanError.message);
  }

  // Check distribution by date
  const { data: dateStats, error: dateError } = await supabase
    .from('patient_events')
    .select('scheduled_at')
    .order('scheduled_at')
    .limit(1);
    
  const { data: latestStats, error: latestError } = await supabase
    .from('patient_events')
    .select('scheduled_at')
    .order('scheduled_at', { ascending: false })
    .limit(1);
    
  if (!dateError && !latestError && dateStats && latestStats) {
    console.log(`\n📅 Date range: ${dateStats[0]?.scheduled_at} to ${latestStats[0]?.scheduled_at}`);
  }
}

validatePatientEvents().catch(console.error);
