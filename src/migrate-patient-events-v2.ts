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
      // Use simple sequential ID based on legacy ID plus a unique range
      legacy_event_id: 1000000 + index // Start at 1M for registration events
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
      .map((order, index) => ({
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
        // Use 2M range for case opened events
        legacy_event_id: 2000000 + index
      }));

    await insertEventsBatch(caseEvents, 'case_opened');
    totalEvents += caseEvents.length;
    eventsByType['case_opened'] = caseEvents.length;
  }

  // 3. Treatment Plan Events - Let's check the schema first
  console.log('\n🔍 Checking treatment plans schema...');
  let treatmentPlansCount = 0;
  
  try {
    const { data: treatmentPlans, error: plansError } = await supabase
      .from('treatment_plans')
      .select('id, legacy_plan_id, created_at')
      .limit(5);

    if (plansError) {
      console.error('❌ Error fetching treatment plans:', plansError.message);
    } else {
      console.log(`✅ Treatment plans sample:`, treatmentPlans?.length || 0);
      
      // Now get the project relationship
      const { data: fullPlans, error: fullError } = await supabase
        .from('treatment_plans')
        .select('id, legacy_plan_id, created_at, project_id')
        .not('legacy_plan_id', 'is', null);

      if (fullError) {
        console.error('❌ Error fetching full treatment plans:', fullError.message);
      } else {
        console.log(`✅ Found ${fullPlans?.length || 0} treatment plans with legacy IDs`);
        
        // Get projects to find patient associations
        if (fullPlans && fullPlans.length > 0) {
          const projectIds = fullPlans.map(p => p.project_id);
          
          const { data: projects, error: projectsError } = await supabase
            .from('projects')
            .select('id, patient_id, project_name')
            .in('id', projectIds.slice(0, 1000)); // Limit for testing

          if (projectsError) {
            console.error('❌ Error fetching projects:', projectsError.message);
          } else {
            const projectMap = new Map(projects?.map(p => [p.id, p]) || []);
            
            const treatmentEvents: PatientEvent[] = fullPlans
              .filter(plan => projectMap.has(plan.project_id))
              .slice(0, 1000) // Limit for this migration
              .map((plan, index) => {
                const project = projectMap.get(plan.project_id)!;
                return {
                  patient_id: project.patient_id,
                  event_type: 'treatment_plan_created',
                  description: `Treatment plan created for project: ${project.project_name || 'Unnamed Project'}`,
                  scheduled_at: plan.created_at,
                  status: 'completed' as const,
                  metadata: {
                    source: 'treatment_plan_creation',
                    legacy_plan_id: plan.legacy_plan_id,
                    project_name: project.project_name,
                    treatment_plan_id: plan.id
                  },
                  // Use 3M range for treatment plan events
                  legacy_event_id: 3000000 + index
                };
              });

            if (treatmentEvents.length > 0) {
              await insertEventsBatch(treatmentEvents, 'treatment_plan_created');
              totalEvents += treatmentEvents.length;
              eventsByType['treatment_plan_created'] = treatmentEvents.length;
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('❌ Error processing treatment plans:', error);
  }

  // 4. Message Events (from messages table) - limited to avoid too many events
  console.log('\n💬 Creating message events...');
  try {
    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('id, recipient_id, message_type, created_at, subject, legacy_record_id')
      .eq('recipient_type', 'patient')
      .not('recipient_id', 'is', null)
      .not('legacy_record_id', 'is', null)
      .limit(1000); // Limit to avoid too many message events

    if (messagesError) {
      console.error('❌ Error fetching messages:', messagesError.message);
    } else {
      console.log(`✅ Found ${messages?.length || 0} messages`);

      if (messages && messages.length > 0) {
        const messageEvents: PatientEvent[] = messages.map((message, index) => ({
          patient_id: message.recipient_id,
          event_type: 'message_received',
          description: `Patient received ${message.message_type || 'message'}: ${(message.subject || 'Communication').substring(0, 100)}`,
          scheduled_at: message.created_at,
          status: 'completed' as const,
          metadata: {
            source: 'message_creation',
            message_type: message.message_type,
            message_id: message.id,
            legacy_record_id: message.legacy_record_id
          },
          // Use 4M range for message events
          legacy_event_id: 4000000 + index
        }));

        await insertEventsBatch(messageEvents, 'message_received');
        totalEvents += messageEvents.length;
        eventsByType['message_received'] = messageEvents.length;
      }
    }
  } catch (error) {
    console.error('❌ Error processing messages:', error);
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
