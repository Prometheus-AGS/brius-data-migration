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

function classifyMessageContent(text: string, type: number): { subject?: string; title?: string } {
  const lowerText = text.toLowerCase();

  // Generate subject and title from content
  let subject = '';
  let title = '';

  if (type === 3) {
    // User communication - look for question patterns
    if (lowerText.includes('?')) {
      subject = 'User Question';
      title = 'Question from User';
    } else if (lowerText.includes('pricing') || lowerText.includes('cost')) {
      subject = 'Pricing Inquiry';
      title = 'Pricing Question';
    } else {
      subject = 'User Communication';
      title = 'User Message';
    }
  } else if (type === 5) {
    // Clinical note - look for treatment patterns
    if (lowerText.includes('treatment plan') || lowerText.includes('stage')) {
      subject = 'Treatment Plan Note';
      title = 'Treatment Planning';
    } else if (lowerText.includes('bracket') || lowerText.includes('idb')) {
      subject = 'Clinical Instruction';
      title = 'Clinical Note';
    } else {
      subject = 'Clinical Note';
      title = 'Clinical Documentation';
    }
  } else if (type === 6) {
    // Patient communication - look for common patterns
    if (lowerText.includes('scan') || lowerText.includes('x-ray')) {
      subject = 'Scan/Imaging Request';
      title = 'Imaging Communication';
    } else if (lowerText.includes('thank')) {
      subject = 'Patient Communication';
      title = 'Patient Message';
    } else {
      subject = 'Case Communication';
      title = 'Case Discussion';
    }
  } else if (type === 8) {
    // Status update - extract status info
    if (lowerText.includes('skip to') || lowerText.includes('contact clinic')) {
      subject = 'Workflow Status Update';
      title = 'Status Update';
    } else {
      subject = 'Status Update';
      title = 'System Update';
    }
  }

  // Truncate if too long
  if (subject && subject.length > 100) {
    subject = subject.substring(0, 97) + '...';
  }
  if (title && title.length > 100) {
    title = title.substring(0, 97) + '...';
  }

  return { subject, title };
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

    let recipientType: string;
    let recipientId: string | null = null;

    // Determine recipient based on target_type_id
    if (record.target_type_id === 11) {
      // Patient-related message
      recipientType = 'patient';
      recipientId = patientMapping.get(record.target_id) || null;

      if (!recipientId) {
        console.log(`    Skipping record ${record.id}: No mapping for patient ${record.target_id}`);
        skipped++;
        continue;
      }
    } else if (record.target_type_id === 58) {
      // User-to-user message
      recipientType = 'user';
      recipientId = profileMapping.get(record.target_id) || null;

      if (!recipientId) {
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
    const { subject, title } = classifyMessageContent(record.text, record.type);

    insertData.push({
      message_type: messageType,
      title: title,
      subject: subject,
      content: record.text || '',
      sender_id: senderId,
      recipient_type: recipientType,
      recipient_id: recipientId,
      metadata: JSON.stringify({
        legacy_type: record.type,
        legacy_target_type_id: record.target_type_id,
        legacy_group_id: record.group_id,
        legacy_public: record.public,
        migration_source: 'dispatch_record'
      }),
      is_read: false,
      created_at: record.created_at,
      updated_at: record.created_at,
      legacy_record_id: record.id
    });
  }

  if (insertData.length === 0) {
    return { success: 0, skipped, errors: 0 };
  }

  try {
    // Build the insert query - using existing table structure
    const fields = [
      'message_type', 'title', 'subject', 'content', 'sender_id',
      'recipient_type', 'recipient_id', 'metadata', 'is_read',
      'created_at', 'updated_at', 'legacy_record_id'
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
        data.title,
        data.subject,
        data.content,
        data.sender_id,
        data.recipient_type,
        data.recipient_id,
        data.metadata,
        data.is_read,
        data.created_at,
        data.updated_at,
        data.legacy_record_id
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
        recipient_type,
        COUNT(*) as count
      FROM messages
      WHERE legacy_record_id IS NOT NULL
      GROUP BY message_type, recipient_type
      ORDER BY count DESC
    `);

    console.log('\n=== Final Message Statistics ===');
    finalStats.rows.forEach(row => {
      console.log(`  ${row.message_type} (${row.recipient_type}): ${row.count} messages`);
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