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

interface DispatchRecord {
  id: number;
  target_id: number;
  type: number;
  created_at: Date;
  text: string;
  author_id: number | null;
  target_type_id: number | null;
  group_id: number | null;
  public: boolean | null;
}

interface PatientMapping {
  [legacyPatientId: number]: string; // UUID
}

interface UserMapping {
  [legacyUserId: number]: string; // UUID  
}

// Type mappings based on analysis
const MESSAGE_TYPE_MAP: { [key: number]: string } = {
  3: 'support',           // Support/communication messages
  5: 'clinical_note',     // Medical/clinical notes  
  6: 'notification',      // Thank you messages/notifications
  8: 'status_update'      // Workflow status updates
};

async function buildLookupMappings(): Promise<{ patients: PatientMapping; users: UserMapping }> {
  console.log('Building lookup mappings...');
  
  // Build patient mappings (target_type_id = 11)
  const { data: patients, error: patientsError } = await supabase
    .from('patients')
    .select('id, legacy_patient_id');
    
  if (patientsError) {
    throw new Error(`Failed to fetch patients: ${patientsError.message}`);
  }
  
  const patientMappings: PatientMapping = {};
  patients?.forEach((p: any) => {
    if (p.legacy_patient_id) {
      patientMappings[p.legacy_patient_id] = p.id;
    }
  });
  
  console.log(`  Built ${Object.keys(patientMappings).length} patient mappings`);
  
  // Build user mappings (target_type_id = 58) - author_id maps to profiles
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, legacy_user_id');
    
  if (profilesError) {
    throw new Error(`Failed to fetch profiles: ${profilesError.message}`);
  }
  
  const userMappings: UserMapping = {};
  profiles?.forEach((p: any) => {
    if (p.legacy_user_id) {
      userMappings[p.legacy_user_id] = p.id;
    }
  });
  
  console.log(`  Built ${Object.keys(userMappings).length} user mappings`);
  
  return { patients: patientMappings, users: userMappings };
}

async function migrateDispatchRecords() {
  try {
    await sourceClient.connect();
    console.log('Connected to source database');
    
    // Build lookup mappings
    const { patients: patientMappings, users: userMappings } = await buildLookupMappings();
    
    // Get total count for progress tracking
    const countResult = await sourceClient.query('SELECT COUNT(*) as total FROM dispatch_record');
    const totalRecords = parseInt(countResult.rows[0].total);
    console.log(`Total records to migrate: ${totalRecords}`);
    
    if (TEST_MODE) {
      console.log('TEST MODE: Processing first 10 records only');
    }
    
    let processed = 0;
    let successful = 0;
    let skipped = 0;
    let errors = 0;
    
    // Process in batches
    const limit = TEST_MODE ? 10 : totalRecords;
    
    for (let offset = 0; offset < limit; offset += BATCH_SIZE) {
      console.log(`\nProcessing batch: ${offset + 1} to ${Math.min(offset + BATCH_SIZE, limit)}`);
      
      // Fetch batch from source
      const batchResult = await sourceClient.query(`
        SELECT id, target_id, type, created_at, text, author_id, target_type_id, group_id, public
        FROM dispatch_record 
        ORDER BY id ASC
        LIMIT $1 OFFSET $2
      `, [BATCH_SIZE, offset]);
      
      if (batchResult.rows.length === 0) {
        break;
      }
      
      // Process each record in the batch
      const messagesToInsert = [];
      
      for (const record of batchResult.rows as DispatchRecord[]) {
        processed++;
        
        // Determine recipient type and ID
        let recipientType: string;
        let recipientId: string | null = null;
        
        if (record.target_type_id === 11) {
          // Patient message
          recipientType = 'patient';
          recipientId = patientMappings[record.target_id] || null;
        } else if (record.target_type_id === 58) {
          // User message  
          recipientType = 'user';
          recipientId = userMappings[record.target_id] || null;
        } else {
          // Unknown target type
          console.log(`    Skipping record ${record.id}: Unknown target_type_id ${record.target_type_id}`);
          skipped++;
          continue;
        }
        
        if (!recipientId) {
          console.log(`    Skipping record ${record.id}: No mapping for ${recipientType} ${record.target_id}`);
          skipped++;
          continue;
        }
        
        // Resolve author
        const senderId = record.author_id ? (userMappings[record.author_id] || null) : null;
        
        // Map message type
        const messageType = MESSAGE_TYPE_MAP[record.type] || 'general';
        
        // Prepare message for insertion
        const message = {
          message_type: messageType,
          title: null, // dispatch_record doesn't have titles
          content: record.text,
          sender_id: senderId,
          recipient_type: recipientType,
          recipient_id: recipientId,
          metadata: {
            legacy_type: record.type,
            legacy_target_type_id: record.target_type_id,
            legacy_group_id: record.group_id,
            legacy_public: record.public
          },
          is_read: false,
          created_at: record.created_at.toISOString(),
          updated_at: record.created_at.toISOString(),
          legacy_record_id: record.id
        };
        
        messagesToInsert.push(message);
      }
      
      // Batch insert to target
      if (messagesToInsert.length > 0) {
        const { data, error } = await supabase
          .from('messages')
          .insert(messagesToInsert)
          .select('id');
          
        if (error) {
          console.error(`    Batch insert error:`, error);
          errors += messagesToInsert.length;
        } else {
          successful += messagesToInsert.length;
          console.log(`    Successfully inserted ${messagesToInsert.length} messages`);
        }
      }
      
      // Progress update
      const progressPercent = ((offset + BATCH_SIZE) / limit * 100).toFixed(1);
      console.log(`Progress: ${progressPercent}% (${processed}/${limit}) - Success: ${successful}, Skipped: ${skipped}, Errors: ${errors}`);
    }
    
    console.log(`\n=== Migration Complete ===`);
    console.log(`Total processed: ${processed}`);
    console.log(`Successfully migrated: ${successful}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Errors: ${errors}`);
    
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await sourceClient.end();
  }
}

migrateDispatchRecords().catch(console.error);
