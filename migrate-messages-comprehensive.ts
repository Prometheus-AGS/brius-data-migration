import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

// Source database connection
const sourceClient = new Client({
  host: process.env.SOURCE_DB_HOST,
  port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
  database: process.env.SOURCE_DB_NAME,
  user: process.env.SOURCE_DB_USER,
  password: process.env.SOURCE_DB_PASSWORD,
});

// Target database connection
const targetClient = new Client({
  host: process.env.TARGET_DB_HOST,
  port: parseInt(process.env.TARGET_DB_PORT || '5432'),
  database: process.env.TARGET_DB_NAME,
  user: process.env.TARGET_DB_USER,
  password: process.env.TARGET_DB_PASSWORD,
});

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '500');
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

// Message type classification based on analysis
const MESSAGE_TYPE_MAP: { [key: number]: string } = {
  3: 'user_communication',     // User-to-user messages (support, questions)
  5: 'clinical_note',          // Clinical notes and treatment instructions
  6: 'patient_communication',  // Patient-related communication messages
  8: 'status_update'           // Workflow status updates
};

async function createMessagesTableIfNotExists() {
  console.log('Ensuring messages table exists...');

  try {
    // Check if messages table exists
    const tableCheck = await targetClient.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'messages'
      );
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('  Creating messages table...');

      await targetClient.query(`
        CREATE TABLE messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

          -- Message content
          message_type VARCHAR(50) NOT NULL,
          subject VARCHAR(255),
          content TEXT NOT NULL,

          -- Participants
          sender_id UUID REFERENCES profiles(id),

          -- Target relationships (flexible for different entity types)
          target_type VARCHAR(50), -- 'patient', 'user', 'case', 'order', etc.
          target_id UUID, -- The actual target entity UUID

          -- Patient context (for patient-related messages)
          patient_id UUID REFERENCES patients(id),
          case_id UUID REFERENCES cases(id),

          -- User context (for user-to-user messages)
          recipient_user_id UUID REFERENCES profiles(id),

          -- Message status
          is_read BOOLEAN DEFAULT false,
          is_archived BOOLEAN DEFAULT false,
          priority VARCHAR(20) DEFAULT 'normal', -- 'low', 'normal', 'high', 'urgent'

          -- Metadata
          metadata JSONB DEFAULT '{}',
          group_id INTEGER, -- Legacy group ID for threading
          is_public BOOLEAN DEFAULT false,

          -- Audit
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

          -- Legacy tracking
          legacy_record_id INTEGER UNIQUE NOT NULL,
          legacy_target_id INTEGER,
          legacy_target_type_id INTEGER,
          legacy_author_id INTEGER
        );
      `);

      // Create indexes
      await targetClient.query(`
        CREATE INDEX idx_messages_sender ON messages(sender_id);
        CREATE INDEX idx_messages_target ON messages(target_type, target_id);
        CREATE INDEX idx_messages_patient ON messages(patient_id);
        CREATE INDEX idx_messages_case ON messages(case_id);
        CREATE INDEX idx_messages_recipient ON messages(recipient_user_id);
        CREATE INDEX idx_messages_type ON messages(message_type);
        CREATE INDEX idx_messages_created ON messages(created_at);
        CREATE INDEX idx_messages_legacy_record ON messages(legacy_record_id);
        CREATE INDEX idx_messages_unread ON messages(is_read) WHERE is_read = false;

        -- Composite indexes for common queries
        CREATE INDEX idx_messages_patient_type ON messages(patient_id, message_type);
        CREATE INDEX idx_messages_sender_created ON messages(sender_id, created_at);
        CREATE INDEX idx_messages_target_created ON messages(target_type, target_id, created_at);
      `);

      // Create trigger for updated_at
      await targetClient.query(`
        CREATE OR REPLACE FUNCTION update_messages_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = CURRENT_TIMESTAMP;
          RETURN NEW;
        END;
        $$ language 'plpgsql';

        CREATE TRIGGER trigger_messages_updated_at
          BEFORE UPDATE ON messages
          FOR EACH ROW EXECUTE FUNCTION update_messages_updated_at();
      `);

      console.log('  ✅ Messages table created successfully');
    } else {
      console.log('  ✅ Messages table already exists');
    }

  } catch (error) {
    console.error('Error creating messages table:', error);
    throw error;
  }
}

async function buildLookupMappings() {
  console.log('Building lookup mappings...');

  // Build patient mapping (legacy_patient_id -> target patient UUID)
  const patientResult = await targetClient.query(`
    SELECT id, legacy_patient_id
    FROM patients
    WHERE legacy_patient_id IS NOT NULL
  `);
  const patientMapping = new Map<number, string>();
  for (const row of patientResult.rows) {
    patientMapping.set(row.legacy_patient_id, row.id);
  }
  console.log(`  Built ${patientMapping.size} patient mappings`);

  // Build case mapping via patient (legacy_patient_id -> case UUID)
  const caseResult = await targetClient.query(`
    SELECT id, legacy_patient_id
    FROM cases
    WHERE legacy_patient_id IS NOT NULL
  `);
  const caseMapping = new Map<number, string>();
  for (const row of caseResult.rows) {
    caseMapping.set(row.legacy_patient_id, row.id);
  }
  console.log(`  Built ${caseMapping.size} case mappings`);

  // Build profile mapping (legacy_user_id -> target profile UUID)
  const profileResult = await targetClient.query(`
    SELECT id, legacy_user_id
    FROM profiles
    WHERE legacy_user_id IS NOT NULL
  `);
  const profileMapping = new Map<number, string>();
  for (const row of profileResult.rows) {
    profileMapping.set(row.legacy_user_id, row.id);
  }
  console.log(`  Built ${profileMapping.size} profile mappings`);

  return { patientMapping, caseMapping, profileMapping };
}

function classifyMessageContent(text: string, type: number): { subject?: string; priority: string } {
  const lowerText = text.toLowerCase();

  // Determine priority based on keywords
  let priority = 'normal';
  if (lowerText.includes('urgent') || lowerText.includes('asap') || lowerText.includes('immediately')) {
    priority = 'urgent';
  } else if (lowerText.includes('important') || lowerText.includes('priority')) {
    priority = 'high';
  }

  // Generate subject from content
  let subject = '';
  if (type === 3) {
    // User communication - look for question patterns
    if (lowerText.includes('?')) {
      subject = 'User Question';
    } else if (lowerText.includes('pricing') || lowerText.includes('cost')) {
      subject = 'Pricing Inquiry';
    } else {
      subject = 'User Communication';
    }
  } else if (type === 5) {
    // Clinical note - look for treatment patterns
    if (lowerText.includes('treatment plan') || lowerText.includes('stage')) {
      subject = 'Treatment Plan Note';
    } else if (lowerText.includes('bracket') || lowerText.includes('idb')) {
      subject = 'Clinical Instruction';
    } else {
      subject = 'Clinical Note';
    }
  } else if (type === 6) {
    // Patient communication - look for common patterns
    if (lowerText.includes('scan') || lowerText.includes('x-ray')) {
      subject = 'Scan/Imaging Request';
    } else if (lowerText.includes('thank')) {
      subject = 'Patient Communication';
    } else {
      subject = 'Case Communication';
    }
  } else if (type === 8) {
    // Status update - extract status info
    if (lowerText.includes('skip to') || lowerText.includes('contact clinic')) {
      subject = 'Workflow Status Update';
    } else {
      subject = 'Status Update';
    }
  }

  // Truncate subject if too long
  if (subject.length > 100) {
    subject = subject.substring(0, 97) + '...';
  }

  return { subject, priority };
}

async function migrateMessagesBatch(
  records: DispatchRecord[],
  patientMapping: Map<number, string>,
  caseMapping: Map<number, string>,
  profileMapping: Map<number, string>
): Promise<{ success: number; skipped: number; errors: number }> {

  const insertData: any[] = [];
  let skipped = 0;

  for (const record of records) {
    const messageType = MESSAGE_TYPE_MAP[record.type] || 'general';
    const senderId = record.author_id ? profileMapping.get(record.author_id) : null;

    let targetType: string;
    let targetId: string | null = null;
    let patientId: string | null = null;
    let caseId: string | null = null;
    let recipientUserId: string | null = null;

    // Determine target based on target_type_id
    if (record.target_type_id === 11) {
      // Patient-related message
      targetType = 'patient';
      patientId = patientMapping.get(record.target_id) || null;
      targetId = patientId;
      caseId = caseMapping.get(record.target_id) || null;

      if (!patientId) {
        console.log(`    Skipping record ${record.id}: No mapping for patient ${record.target_id}`);
        skipped++;
        continue;
      }
    } else if (record.target_type_id === 58) {
      // User-to-user message
      targetType = 'user';
      recipientUserId = profileMapping.get(record.target_id) || null;
      targetId = recipientUserId;

      if (!recipientUserId) {
        console.log(`    Skipping record ${record.id}: No mapping for user ${record.target_id}`);
        skipped++;
        continue;
      }
    } else {
      // Unknown target type
      console.log(`    Skipping record ${record.id}: Unknown target_type_id ${record.target_type_id}`);
      skipped++;
      continue;
    }

    // Classify message content
    const { subject, priority } = classifyMessageContent(record.text, record.type);

    insertData.push({
      message_type: messageType,
      subject: subject,
      content: record.text || '',
      sender_id: senderId,
      target_type: targetType,
      target_id: targetId,
      patient_id: patientId,
      case_id: caseId,
      recipient_user_id: recipientUserId,
      is_read: false,
      is_archived: false,
      priority: priority,
      metadata: JSON.stringify({
        legacy_type: record.type,
        legacy_target_type_id: record.target_type_id,
        legacy_group_id: record.group_id,
        legacy_public: record.public,
        migration_source: 'dispatch_record'
      }),
      group_id: record.group_id,
      is_public: record.public || false,
      created_at: record.created_at,
      updated_at: record.created_at,
      legacy_record_id: record.id,
      legacy_target_id: record.target_id,
      legacy_target_type_id: record.target_type_id,
      legacy_author_id: record.author_id
    });
  }

  if (insertData.length === 0) {
    return { success: 0, skipped, errors: 0 };
  }

  try {
    // Build the insert query
    const fields = [
      'message_type', 'subject', 'content', 'sender_id', 'target_type', 'target_id',
      'patient_id', 'case_id', 'recipient_user_id', 'is_read', 'is_archived', 'priority',
      'metadata', 'group_id', 'is_public', 'created_at', 'updated_at',
      'legacy_record_id', 'legacy_target_id', 'legacy_target_type_id', 'legacy_author_id'
    ];

    const values = insertData.map((_, index) => {
      const base = index * fields.length;
      return `(${fields.map((_, i) => `$${base + i + 1}`).join(', ')})`;
    }).join(', ');

    const query = `
      INSERT INTO messages (${fields.join(', ')})
      VALUES ${values}
      ON CONFLICT (legacy_record_id) DO NOTHING
    `;

    const queryParams: any[] = [];
    for (const data of insertData) {
      queryParams.push(
        data.message_type,
        data.subject,
        data.content,
        data.sender_id,
        data.target_type,
        data.target_id,
        data.patient_id,
        data.case_id,
        data.recipient_user_id,
        data.is_read,
        data.is_archived,
        data.priority,
        data.metadata,
        data.group_id,
        data.is_public,
        data.created_at,
        data.updated_at,
        data.legacy_record_id,
        data.legacy_target_id,
        data.legacy_target_type_id,
        data.legacy_author_id
      );
    }

    const result = await targetClient.query(query, queryParams);

    return {
      success: result.rowCount || 0,
      skipped,
      errors: 0
    };

  } catch (error) {
    console.error('    Batch insert error:', error);
    return {
      success: 0,
      skipped,
      errors: insertData.length
    };
  }
}

async function migrateMessages() {
  try {
    await sourceClient.connect();
    await targetClient.connect();
    console.log('Connected to both databases');

    // Ensure messages table exists
    await createMessagesTableIfNotExists();

    const { patientMapping, caseMapping, profileMapping } = await buildLookupMappings();

    // Get total count from dispatch_record
    const countResult = await sourceClient.query(`
      SELECT COUNT(*) as total FROM dispatch_record
    `);
    const totalRecords = parseInt(countResult.rows[0].total);
    console.log(`Total messages to migrate: ${totalRecords}\n`);

    // Get breakdown by type
    const typeBreakdown = await sourceClient.query(`
      SELECT
        type,
        target_type_id,
        COUNT(*) as count
      FROM dispatch_record
      GROUP BY type, target_type_id
      ORDER BY count DESC
    `);

    console.log('Message breakdown by type:');
    typeBreakdown.rows.forEach(row => {
      const messageType = MESSAGE_TYPE_MAP[row.type] || 'unknown';
      const targetType = row.target_type_id === 11 ? 'patient' : row.target_type_id === 58 ? 'user' : 'unknown';
      console.log(`  Type ${row.type} (${messageType}) → ${targetType}: ${row.count} records`);
    });
    console.log('');

    if (TEST_MODE) {
      console.log('🧪 Running in TEST MODE - processing only first 10 records\n');
    }

    // Process in batches
    let processed = 0;
    let totalSuccess = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    const limit = TEST_MODE ? Math.min(10, BATCH_SIZE) : BATCH_SIZE;
    const maxRecords = TEST_MODE ? 10 : totalRecords;

    while (processed < maxRecords) {
      const offset = processed;
      const currentBatchSize = Math.min(limit, maxRecords - processed);

      console.log(`Processing batch: ${offset + 1} to ${offset + currentBatchSize}`);

      // Fetch batch from dispatch_record
      const batchResult = await sourceClient.query(`
        SELECT id, target_id, type, created_at, text, author_id, target_type_id, group_id, public
        FROM dispatch_record
        ORDER BY id
        LIMIT $1 OFFSET $2
      `, [currentBatchSize, offset]);

      const records: DispatchRecord[] = batchResult.rows;

      if (records.length === 0) {
        break;
      }

      // Migrate batch
      const result = await migrateMessagesBatch(
        records,
        patientMapping,
        caseMapping,
        profileMapping
      );

      totalSuccess += result.success;
      totalSkipped += result.skipped;
      totalErrors += result.errors;

      if (result.errors === 0) {
        console.log(`    Successfully inserted ${result.success} messages`);
      }

      processed += records.length;

      const progressPercent = ((processed / totalRecords) * 100).toFixed(1);
      console.log(`Progress: ${progressPercent}% (${processed}/${totalRecords}) - Success: ${totalSuccess}, Skipped: ${totalSkipped}, Errors: ${totalErrors}\n`);
    }

    console.log('=== Messages Migration Complete ===');
    console.log(`Total processed: ${processed}`);
    console.log(`Successfully migrated: ${totalSuccess}`);
    console.log(`Skipped: ${totalSkipped}`);
    console.log(`Errors: ${totalErrors}`);

    // Final statistics by type
    const finalStats = await targetClient.query(`
      SELECT
        message_type,
        target_type,
        COUNT(*) as count
      FROM messages
      WHERE legacy_record_id IS NOT NULL
      GROUP BY message_type, target_type
      ORDER BY count DESC
    `);

    console.log('\n=== Final Message Statistics ===');
    finalStats.rows.forEach(row => {
      console.log(`  ${row.message_type} (${row.target_type}): ${row.count} messages`);
    });

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await sourceClient.end();
    await targetClient.end();
  }
}

// Run migration
migrateMessages();