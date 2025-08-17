import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

// Environment setup
const supabaseUrl = process.env.SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE!;

console.log('Environment check:');
console.log('SUPABASE_URL:', supabaseUrl);
console.log('SUPABASE_SERVICE_ROLE:', serviceRoleKey ? '[PRESENT]' : '[MISSING]');

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function testPatientEvents() {
  console.log('🧪 Testing patient events creation with first 3 patients...');

  // Get first 3 patient profiles
  const { data: patients, error: patientsError } = await supabase
    .from('profiles')
    .select('id, legacy_patient_id, created_at')
    .eq('profile_type', 'patient')
    .not('legacy_patient_id', 'is', null)
    .order('legacy_patient_id')
    .limit(3);

  if (patientsError) {
    console.error('❌ Error fetching patients:', patientsError);
    process.exit(1);
  }

  console.log(`✅ Found ${patients?.length || 0} test patients`);

  let totalEvents = 0;

  for (const patient of patients || []) {
    console.log(`🔄 Processing test patient: ${patient.id} (Legacy: ${patient.legacy_patient_id})`);

    const events = [];

    // Registration event
    events.push({
      patient_id: patient.id,
      event_type: 'patient_registered',
      description: `Patient registered in system - Legacy ID: ${patient.legacy_patient_id}`,
      scheduled_at: patient.created_at,
      status: 'completed',
      metadata: {
        source: 'profile_creation',
        legacy_patient_id: patient.legacy_patient_id,
        test: true
      },
      legacy_event_id: patient.legacy_patient_id
    });

    // Get one order for this patient
    const { data: orders } = await supabase
      .from('orders')
      .select('id, created_at, legacy_instruction_id')
      .eq('patient_id', patient.id)
      .limit(1);

    if (orders && orders.length > 0) {
      const order = orders[0];
      events.push({
        patient_id: patient.id,
        order_id: order.id,
        event_type: 'case_opened',
        description: `New treatment order created - Order #${order.legacy_instruction_id}`,
        scheduled_at: order.created_at,
        status: 'completed',
        metadata: {
          source: 'order_creation',
          legacy_instruction_id: order.legacy_instruction_id,
          test: true
        },
        legacy_event_id: order.legacy_instruction_id
      });
    }

    // Insert events for this patient
    if (events.length > 0) {
      const { data, error } = await supabase
        .from('patient_events')
        .insert(events)
        .select('id, event_type');

      if (error) {
        console.error(`❌ Error inserting events for patient ${patient.id}:`, error);
      } else {
        console.log(`✅ Inserted ${events.length} events for patient ${patient.id}`);
        totalEvents += events.length;
      }
    }
  }

  console.log(`🎉 Test completed! Total events created: ${totalEvents}`);
}

// Run the test
testPatientEvents()
  .then(() => {
    console.log('🏁 Test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Test failed:', error);
    process.exit(1);
  });
