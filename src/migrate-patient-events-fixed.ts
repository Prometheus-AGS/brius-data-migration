import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '100', 10);

interface PatientEvent {
  patient_id: string;
  order_id?: string;
  event_type: string;
  description: string;
  scheduled_at: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  metadata: Record<string, any>;
  legacy_event_id?: number;
}

async function migratePatientEvents() {
  console.log('🚀 Starting comprehensive patient events migration...\n');
  
  let totalEvents = 0;
  const eventsByType: Record<string, number> = {};

  // 1. Patient Registration Events (from profiles)
  console.log('📝 Creating patient registration events...');
  const { data: patients, error: patientsError } = await supabase
    .from('profiles')
    .select('id, legacy_patient_id, created_at, first_name, last_name')
    .eq('profile_type', 'patient')
    .not('legacy_patient_id', 'is', null);

  if (patientsError) {
    console.error('❌ Error fetching patients:', patientsError);
    process.exit(1);
  }

  console.log(`✅ Found ${patients?.length || 0} patients`);

  // Create registration events in batches
  if (patients && patients.length > 0) {
    const registrationEvents: PatientEvent[] = patients.map((patient, index) => ({
      patient_id: patient.id,
      event_type: 'patient_registered',
      description: `Patient ${patient.first_name || 'Unknown'} ${patient.last_name || 'Patient'} registered in system`,
      scheduled_at: patient.created_at,
      status: 'completed' as const,
      metadata: {
        source: 'profile_creation',
        legacy_patient_id: patient.legacy_patient_id
      },
      // Use a combination of legacy_patient_id and a multiplier to ensure unique IDs
      legacy_event_id: parseInt(patient.legacy_patient_id) * 1000000 + 1 // Add 1 for registration events
    }));

    await insertEventsBatch(registrationEvents, 'patient_registered');
    totalEvents += registrationEvents.length;
    eventsByType['patient_registered'] = registrationEvents.length;
  }

  // 2. Case Opened Events (from orders)
  console.log('\n📋 Creating case opened events from orders...');
  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('id, patient_id, created_at, legacy_instruction_id, order_number')
    .not('patient_id', 'is', null);

  if (ordersError) {
    console.error('❌ Error fetching orders:', ordersError);
    process.exit(1);
  }

  console.log(`✅ Found ${orders?.length || 0} orders`);

  if (orders && orders.length > 0) {
    const caseEvents: PatientEvent[] = orders
      .filter(order => order.legacy_instruction_id) // Only orders with legacy IDs
      .map(order => ({
        patient_id: order.patient_id,
        order_id: order.id,
        event_type: 'case_opened',
        description: `New treatment case opened - Order #${order.order_number || order.legacy_instruction_id}`,
        scheduled_at: order.created_at,
        status: 'completed' as const,
        metadata: {
          source: 'order_creation',
          legacy_instruction_id: order.legacy_instruction_id,
          order_number: order.order_number
        },
        // Use legacy_instruction_id * 1000000 + 2 for case opened events
        legacy_event_id: order.legacy_instruction_id * 1000000 + 2
      }));

    await insertEventsBatch(caseEvents, 'case_opened');
    totalEvents += caseEvents.length;
    eventsByType['case_opened'] = caseEvents.length;
  }

  // 3. Treatment Plan Events
  console.log('\n🦷 Creating treatment plan events...');
  const { data: treatmentPlans, error: plansError } = await supabase
    .from('treatment_plans')
    .select(`
      id, 
      project_id, 
      legacy_plan_id, 
      created_at,
      projects!inner(id, patient_id, project_name)
    `)
    .not('projects.patient_id', 'is', null);

  if (plansError) {
    console.error('❌ Error fetching treatment plans:', plansError);
    process.exit(1);
  }

  console.log(`✅ Found ${treatmentPlans?.length || 0} treatment plans`);

  if (treatmentPlans && treatmentPlans.length > 0) {
    const treatmentEvents: PatientEvent[] = treatmentPlans
      .filter((plan: any) => plan.legacy_plan_id)
      .map((plan: any) => ({
        patient_id: plan.projects.patient_id,
        event_type: 'treatment_plan_created',
        description: `Treatment plan created for project: ${plan.projects.project_name || 'Unnamed Project'}`,
        scheduled_at: plan.created_at,
        status: 'completed' as const,
        metadata: {
          source: 'treatment_plan_creation',
          legacy_plan_id: plan.legacy_plan_id,
          project_name: plan.projects.project_name,
          treatment_plan_id: plan.id
        },
        // Use legacy_plan_id * 1000000 + 3 for treatment plan events
        legacy_event_id: plan.legacy_plan_id * 1000000 + 3
      }));

    await insertEventsBatch(treatmentEvents, 'treatment_plan_created');
    totalEvents += treatmentEvents.length;
    eventsByType['treatment_plan_created'] = treatmentEvents.length;
  }

  // 4. Message Events (from messages table) - limited to avoid too many events
  console.log('\n💬 Creating message events...');
  const { data: messages, error: messagesError } = await supabase
    .from('messages')
    .select('id, recipient_id, message_type, created_at, subject, legacy_record_id')
    .eq('recipient_type', 'patient')
    .not('recipient_id', 'is', null)
    .not('legacy_record_id', 'is', null)
    .limit(2000); // Limit to avoid too many message events

  if (messagesError) {
    console.error('❌ Error fetching messages:', messagesError);
    process.exit(1);
  }

  console.log(`✅ Found ${messages?.length || 0} messages`);

  if (messages && messages.length > 0) {
    const messageEvents: PatientEvent[] = messages
      .filter(message => message.legacy_record_id)
      .map(message => ({
        patient_id: message.recipient_id,
        event_type: 'message_received',
        description: `Patient received ${message.message_type || 'message'}: ${message.subject || 'Communication'}`,
        scheduled_at: message.created_at,
        status: 'completed' as const,
        metadata: {
          source: 'message_creation',
          message_type: message.message_type,
          message_id: message.id,
          legacy_record_id: message.legacy_record_id
        },
        // Use legacy_record_id * 1000000 + 4 for message events
        legacy_event_id: message.legacy_record_id * 1000000 + 4
      }));

    await insertEventsBatch(messageEvents, 'message_received');
    totalEvents += messageEvents.length;
    eventsByType['message_received'] = messageEvents.length;
  }

  // 5. File Upload Events (from files table) - limited to avoid too many events
  console.log('\n📁 Creating file upload events...');
  const { data: files, error: filesError } = await supabase
    .from('files')
    .select(`
      id, 
      order_id, 
      filename, 
      uploaded_at,
      legacy_file_id,
      orders!inner(id, patient_id)
    `)
    .not('orders.patient_id', 'is', null)
    .not('legacy_file_id', 'is', null)
    .limit(1000); // Limit to avoid too many file events

  if (filesError) {
    console.error('❌ Error fetching files:', filesError);
    process.exit(1);
  }

  console.log(`✅ Found ${files?.length || 0} files`);

  if (files && files.length > 0) {
    const fileEvents: PatientEvent[] = files
      .filter((file: any) => file.legacy_file_id)
      .map((file: any) => ({
        patient_id: file.orders.patient_id,
        order_id: file.order_id,
        event_type: 'file_uploaded',
        description: `File uploaded: ${file.filename}`,
        scheduled_at: file.uploaded_at,
        status: 'completed' as const,
        metadata: {
          source: 'file_upload',
          filename: file.filename,
          file_id: file.id,
          legacy_file_id: file.legacy_file_id
        },
        // Use legacy_file_id * 1000000 + 5 for file events
        legacy_event_id: file.legacy_file_id * 1000000 + 5
      }));

    await insertEventsBatch(fileEvents, 'file_uploaded');
    totalEvents += fileEvents.length;
    eventsByType['file_uploaded'] = fileEvents.length;
  }

  // Summary
  console.log('\n📊 Migration Summary:');
  console.log('====================');
  Object.entries(eventsByType).forEach(([type, count]) => {
    console.log(`${type}: ${count.toLocaleString()} events`);
  });
  console.log('====================');
  console.log(`Total events migrated: ${totalEvents.toLocaleString()}`);
  console.log('\n🎉 Patient events migration completed successfully!');
}

async function insertEventsBatch(events: PatientEvent[], eventType: string) {
  const batches = Math.ceil(events.length / BATCH_SIZE);
  console.log(`  Inserting ${events.length.toLocaleString()} ${eventType} events in ${batches} batches...`);

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < batches; i++) {
    const start = i * BATCH_SIZE;
    const end = Math.min(start + BATCH_SIZE, events.length);
    const batch = events.slice(start, end);

    const { error } = await supabase
      .from('patient_events')
      .upsert(batch, { 
        onConflict: 'legacy_event_id',
        ignoreDuplicates: true
      });

    if (error) {
      console.error(`❌ Error inserting batch ${i + 1}/${batches} for ${eventType}:`, error.message);
      errorCount += batch.length;
    } else {
      console.log(`  ✅ Batch ${i + 1}/${batches} completed (${batch.length} events)`);
      successCount += batch.length;
    }
  }

  console.log(`  📊 ${eventType} summary: ${successCount} successful, ${errorCount} errors`);
}

// Run the migration
migratePatientEvents()
  .then(() => {
    console.log('🏁 Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Migration failed:', error);
    process.exit(1);
  });
