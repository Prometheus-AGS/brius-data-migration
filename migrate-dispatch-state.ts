import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

// Source database connection
const sourceClient = new Client({
  host: 'test.brius.com',
  port: 5432,
  database: 'mdw_db',
  user: 'mdw_ai',
  password: 'xGXmckHY',
});

// Target database connection via Supabase
const supabase = createClient(
  'http://localhost:8000', 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
);

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '50');
const TEST_MODE = process.env.TEST_MODE === 'true';

interface DispatchState {
  id: number;
  status: number;
  on: boolean;
  changed_at: Date;
  actor_id: number | null;
  instruction_id: number;
}

interface OrderMapping {
  [legacyOrderId: number]: string; // UUID
}

interface ActorMapping {
  [legacyUserId: number]: string; // UUID
}

// Status code to order_status enum mapping
function mapStatusToOrderStatus(statusCode: number, isActive: boolean): string {
  // Based on analysis: Status 11 seems to be review/approval, Status 12 seems to be processing
  // We'll map these to reasonable enum values - you may need to adjust these
  switch (statusCode) {
    case 11:
      return isActive ? 'in_review' : 'review_completed';
    case 12:
      return isActive ? 'in_production' : 'production_completed';
    default:
      return isActive ? 'in_progress' : 'completed';
  }
}

// Determine from_status based on previous state in the same order
async function getPreviousStatus(instruction_id: number, changed_at: Date, sourceClient: Client): Promise<string | null> {
  try {
    const prevState = await sourceClient.query(`
      SELECT status, "on" FROM dispatch_state 
      WHERE instruction_id = $1 AND changed_at < $2
      ORDER BY changed_at DESC 
      LIMIT 1
    `, [instruction_id, changed_at]);
    
    if (prevState.rows.length > 0) {
      const prev = prevState.rows[0];
      return mapStatusToOrderStatus(prev.status, prev.on);
    }
  } catch (error) {
    // If we can't get previous status, that's ok - it might be the first state
  }
  return null;
}

async function buildLookupMappings(): Promise<{ orders: OrderMapping; actors: ActorMapping }> {
  console.log('Building lookup mappings...');
  
  // Build order mappings (legacy_instruction_id -> order.id)
  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('id, legacy_instruction_id');
    
  if (ordersError) {
    throw new Error(`Failed to fetch orders: ${ordersError.message}`);
  }
  
  const orderMappings: OrderMapping = {};
  orders?.forEach((o: any) => {
    if (o.legacy_instruction_id) {
      orderMappings[o.legacy_instruction_id] = o.id;
    }
  });
  
  console.log(`  Built ${Object.keys(orderMappings).length} order mappings`);
  
  // Build actor mappings (legacy_user_id -> profile.id)
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, legacy_user_id');
    
  if (profilesError) {
    throw new Error(`Failed to fetch profiles: ${profilesError.message}`);
  }
  
  const actorMappings: ActorMapping = {};
  profiles?.forEach((p: any) => {
    if (p.legacy_user_id) {
      actorMappings[p.legacy_user_id] = p.id;
    }
  });
  
  console.log(`  Built ${Object.keys(actorMappings).length} actor mappings`);
  
  return { orders: orderMappings, actors: actorMappings };
}

async function migrateDispatchState() {
  try {
    await sourceClient.connect();
    console.log('Connected to source database');
    
    // Build lookup mappings
    const { orders: orderMappings, actors: actorMappings } = await buildLookupMappings();
    
    // Get total count for progress tracking
    const countResult = await sourceClient.query('SELECT COUNT(*) as total FROM dispatch_state');
    const totalRecords = parseInt(countResult.rows[0].total);
    console.log(`Total dispatch_state records to migrate: ${totalRecords.toLocaleString()}`);
    
    if (TEST_MODE) {
      console.log('TEST MODE: Processing first 10 records only');
    }
    
    let processed = 0;
    let successful = 0;
    let skipped = 0;
    let errors = 0;
    
    // Process in batches, ordered by instruction_id and changed_at to maintain sequence
    const limit = TEST_MODE ? 10 : totalRecords;
    
    for (let offset = 0; offset < limit; offset += BATCH_SIZE) {
      console.log(`\nProcessing batch: ${offset + 1} to ${Math.min(offset + BATCH_SIZE, limit)}`);
      
      // Fetch batch from source, ordered by instruction_id and changed_at
      const batchResult = await sourceClient.query(`
        SELECT id, status, "on", changed_at, actor_id, instruction_id
        FROM dispatch_state 
        ORDER BY instruction_id, changed_at ASC
        LIMIT $1 OFFSET $2
      `, [BATCH_SIZE, offset]);
      
      if (batchResult.rows.length === 0) {
        break;
      }
      
      // Process each state in the batch
      const orderStatesToInsert = [];
      
      for (const state of batchResult.rows as DispatchState[]) {
        processed++;
        
        // Resolve order UUID
        const orderUuid = orderMappings[state.instruction_id];
        if (!orderUuid) {
          console.log(`    Skipping state ${state.id}: No mapping for order ${state.instruction_id}`);
          skipped++;
          continue;
        }
        
        // Resolve actor UUID (can be null)
        const actorUuid = state.actor_id ? (actorMappings[state.actor_id] || null) : null;
        
        // Determine from_status (previous state) and to_status (current state)
        const fromStatus = await getPreviousStatus(state.instruction_id, state.changed_at, sourceClient);
        const toStatus = mapStatusToOrderStatus(state.status, state.on);
        
        // Prepare order_state for insertion
        const orderState = {
          order_id: orderUuid,
          actor_id: actorUuid,
          from_status: fromStatus,
          to_status: toStatus,
          is_active: state.on,
          changed_at: state.changed_at.toISOString(),
          metadata: {
            legacy_status_code: state.status,
            legacy_on: state.on,
            legacy_actor_id: state.actor_id,
            legacy_instruction_id: state.instruction_id
          },
          legacy_state_id: state.id
        };
        
        orderStatesToInsert.push(orderState);
      }
      
      // Batch insert to target
      if (orderStatesToInsert.length > 0) {
        const { data, error } = await supabase
          .from('order_states')
          .insert(orderStatesToInsert)
          .select('id');
          
        if (error) {
          console.error(`    Batch insert error:`, error);
          errors += orderStatesToInsert.length;
        } else {
          successful += orderStatesToInsert.length;
          console.log(`    Successfully inserted ${orderStatesToInsert.length} order states`);
        }
      }
      
      // Progress update
      const progressPercent = ((offset + BATCH_SIZE) / limit * 100).toFixed(1);
      console.log(`Progress: ${progressPercent}% (${processed}/${limit}) - Success: ${successful}, Skipped: ${skipped}, Errors: ${errors}`);
      
      // Small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`\n=== Migration Complete ===`);
    console.log(`Total processed: ${processed.toLocaleString()}`);
    console.log(`Successfully migrated: ${successful.toLocaleString()}`);
    console.log(`Skipped: ${skipped.toLocaleString()}`);
    console.log(`Errors: ${errors.toLocaleString()}`);
    
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await sourceClient.end();
  }
}

migrateDispatchState().catch(console.error);
