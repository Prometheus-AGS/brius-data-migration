import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

// Environment setup
const supabaseUrl = process.env.SUPABASE_URL!;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

interface PatientProfile {
  id: string;
  legacy_patient_id: number;
  created_at: string;
}

interface OrderData {
  id: string;
  patient_id: string;
  created_at: string;
  updated_at: string;
  status: string;
  legacy_instruction_id: number;
}

interface PaymentData {
  id: string;
  order_id: string;
  created_at: string;
  amount: number;
  status: string;
}

interface TaskData {
  id: string;
  order_id: string;
  completed_at: string;
  task_type: string;
  status: string;
}

interface PatientEvent {
  patient_id: string;
  order_id?: string;
  event_type: string;
  description: string;
  scheduled_at: string;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  duration_minutes?: number;
  metadata: any;
  legacy_event_id?: number;
}

async function createPatientEvents() {
  console.log('🚀 Starting patient events creation...');
  let totalEvents = 0;
  const batchSize = 100;
  let eventsBatch: PatientEvent[] = [];

  // Get all patient profiles
  console.log('📋 Fetching patient profiles...');
  const { data: patients, error: patientsError } = await supabase
    .from('profiles')
    .select('id, legacy_patient_id, created_at')
    .eq('profile_type', 'patient')
    .not('legacy_patient_id', 'is', null)
    .order('legacy_patient_id');

  if (patientsError) {
    console.error('❌ Error fetching patients:', patientsError);
    process.exit(1);
  }

  console.log(`✅ Found ${patients?.length || 0} patients with legacy IDs`);

  // Process each patient
  for (let i = 0; i < (patients?.length || 0); i++) {
    const patient = patients![i];
    console.log(`🔄 Processing patient ${i + 1}/${patients!.length}: ${patient.id} (Legacy: ${patient.legacy_patient_id})`);

    // 1. Patient registration event
    const registrationEvent: PatientEvent = {
      patient_id: patient.id,
      event_type: 'patient_registered',
      description: `Patient registered in system - Legacy ID: ${patient.legacy_patient_id}`,
      scheduled_at: patient.created_at,
      status: 'completed',
      metadata: {
        source: 'profile_creation',
        legacy_patient_id: patient.legacy_patient_id
      },
      legacy_event_id: patient.legacy_patient_id
    };
    eventsBatch.push(registrationEvent);

    // 2. Get orders for this patient
    const { data: orders } = await supabase
      .from('orders')
      .select('id, created_at, updated_at, status, legacy_instruction_id')
      .eq('patient_id', patient.id)
      .order('created_at');

    if (orders && orders.length > 0) {
      // Order creation events
      for (const order of orders) {
        const orderEvent: PatientEvent = {
          patient_id: patient.id,
          order_id: order.id,
          event_type: 'case_opened',
          description: `New treatment order created - Order #${order.legacy_instruction_id}`,
          scheduled_at: order.created_at,
          status: 'completed',
          metadata: {
            source: 'order_creation',
            legacy_instruction_id: order.legacy_instruction_id,
            order_status: order.status
          },
          legacy_event_id: order.legacy_instruction_id
        };
        eventsBatch.push(orderEvent);

        // 3. Get payments for this order
        const { data: payments } = await supabase
          .from('payments')
          .select('id, created_at, amount, status')
          .eq('order_id', order.id);

        if (payments && payments.length > 0) {
          for (const payment of payments) {
            const paymentEvent: PatientEvent = {
              patient_id: patient.id,
              order_id: order.id,
              event_type: 'payment_received',
              description: `Payment received: $${payment.amount}`,
              scheduled_at: payment.created_at,
              status: payment.status === 'completed' ? 'completed' : 'in_progress',
              metadata: {
                source: 'payment_processing',
                amount: payment.amount,
                payment_id: payment.id,
                payment_status: payment.status
              }
            };
            eventsBatch.push(paymentEvent);
          }
        }

        // 4. Get completed tasks for this order
        const { data: tasks } = await supabase
          .from('tasks')
          .select('id, completed_at, task_type, status')
          .eq('order_id', order.id)
          .not('completed_at', 'is', null)
          .order('completed_at');

        if (tasks && tasks.length > 0) {
          for (const task of tasks) {
            const taskEvent: PatientEvent = {
              patient_id: patient.id,
              order_id: order.id,
              event_type: 'task_completed',
              description: `Task completed: ${task.task_type}`,
              scheduled_at: task.completed_at!,
              status: 'completed',
              metadata: {
                source: 'task_completion',
                task_type: task.task_type,
                task_id: task.id
              }
            };
            eventsBatch.push(taskEvent);
          }
        }
    }

    // Batch insert when we have enough events
    if (eventsBatch.length >= batchSize) {
      await insertEventsBatch(eventsBatch);
      totalEvents += eventsBatch.length;
      eventsBatch = [];
    }

    // Process in smaller chunks to avoid overwhelming the API
    if ((i + 1) % 10 === 0) {
      console.log(`✅ Processed ${i + 1} patients, generated ${totalEvents} events so far`);
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second pause
    }
  }

  // Insert remaining events
  if (eventsBatch.length > 0) {
    await insertEventsBatch(eventsBatch);
    totalEvents += eventsBatch.length;
  }

  console.log(`🎉 Patient events creation completed! Total events created: ${totalEvents}`);
}

async function insertEventsBatch(events: PatientEvent[]) {
  const { data, error } = await supabase
    .from('patient_events')
    .insert(events)
    .select('id');

  if (error) {
    console.error('❌ Error inserting events batch:', error);
    console.log('Sample event causing error:', JSON.stringify(events[0], null, 2));
    throw error;
  }

  console.log(`✅ Inserted ${events.length} events, IDs: ${data?.slice(0, 3).map(e => e.id).join(', ')}${data && data.length > 3 ? '...' : ''}`);
}

// Run the migration
if (require.main === module) {
  createPatientEvents()
    .then(() => {
      console.log('🏁 Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Migration failed:', error);
      process.exit(1);
    });
}
