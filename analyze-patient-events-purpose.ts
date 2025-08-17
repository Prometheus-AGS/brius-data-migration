import * as dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function analyzePatientEventsPurpose() {
  console.log('🔍 Analyzing Patient Events Table Purpose and Usage\n');
  
  // 1. Check event types to understand what kinds of events are tracked
  const { data: events, error } = await supabase
    .from('patient_events')
    .select('event_type, status, description, metadata')
    .limit(10);
    
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  // Group by event type
  const eventTypes = new Set();
  const statusTypes = new Set();
  
  events?.forEach((event: any) => {
    eventTypes.add(event.event_type);
    statusTypes.add(event.status);
  });
  
  console.log('📋 Event Types Found:');
  Array.from(eventTypes).forEach(type => console.log(`  - ${type}`));
  
  console.log('\n📊 Status Types:');
  Array.from(statusTypes).forEach(status => console.log(`  - ${status}`));
  
  // 2. Show sample events with full context
  console.log('\n🔎 Sample Events with Context:');
  events?.slice(0, 3).forEach((event: any, i: number) => {
    console.log(`\n${i + 1}. Event Type: ${event.event_type}`);
    console.log(`   Status: ${event.status}`);
    console.log(`   Description: ${event.description}`);
    console.log(`   Metadata: ${JSON.stringify(event.metadata, null, 2)}`);
  });
  
  // 3. Check temporal distribution
  const { data: timelineData, error: timeError } = await supabase
    .from('patient_events')
    .select('scheduled_at, event_type')
    .order('scheduled_at')
    .limit(5);
    
  const { data: futureData, error: futureError } = await supabase
    .from('patient_events')
    .select('scheduled_at, event_type, status')
    .gte('scheduled_at', new Date().toISOString())
    .limit(5);
    
  console.log('\n📅 Temporal Analysis:');
  if (!timeError && timelineData) {
    console.log('Earliest events:', timelineData.slice(0, 2));
  }
  
  if (!futureError && futureData) {
    console.log(`Future/scheduled events: ${futureData.length} found`);
    if (futureData.length > 0) {
      console.log('Sample future events:', futureData.slice(0, 2));
    }
  }
  
  // 4. Check patient association patterns
  const { data: patientSample, error: patientError } = await supabase
    .from('patient_events')
    .select(`
      patient_id,
      event_type,
      order_id,
      profiles!inner(first_name, last_name, profile_type)
    `)
    .limit(3);
    
  if (!patientError && patientSample) {
    console.log('\n👥 Patient Association Examples:');
    patientSample.forEach((event: any, i: number) => {
      console.log(`${i + 1}. Patient: ${event.profiles.first_name} ${event.profiles.last_name}`);
      console.log(`   Event: ${event.event_type}`);
      console.log(`   Has Order: ${event.order_id ? 'Yes' : 'No'}`);
    });
  }
}

analyzePatientEventsPurpose().catch(console.error);
