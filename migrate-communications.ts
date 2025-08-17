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

interface SourceRecord {
  id: number;
  type: number;
  target_id: number;
  author_id: number | null;
  text: string | null;
  created_at: Date;
  
}

async function buildLookupMappings() {
  console.log('Building lookup mappings...');
  
  // Build case mapping (legacy_patient_id -> target case UUID)
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

  // Build profile mapping for authors (legacy_user_id -> target profile UUID)
  const authorResult = await targetClient.query(`
    SELECT id, legacy_user_id 
    FROM profiles 
    WHERE legacy_user_id IS NOT NULL
  `);
  const authorMapping = new Map<number, string>();
  for (const row of authorResult.rows) {
    authorMapping.set(row.legacy_user_id, row.id);
  }
  console.log(`  Built ${authorMapping.size} author profile mappings`);

  return { caseMapping, authorMapping };
}

async function migrateClinicalCommunications(
  records: SourceRecord[],
  caseMapping: Map<number, string>,
  authorMapping: Map<number, string>
): Promise<{ success: number; skipped: number; errors: number }> {
  
  const insertData: any[] = [];
  let skipped = 0;

  for (const record of records) {
    const caseId = caseMapping.get(record.target_id);
    const authorId = record.author_id ? authorMapping.get(record.author_id) : null;

    if (!caseId) {
      skipped++;
      continue;
    }

    const communicationType = record.type === 3 ? 'clinical_note' : 'image';
    
    insertData.push({
      legacy_record_id: record.id,
      case_id: caseId,
      author_profile: authorId,
      communication_type: communicationType,
      payload: JSON.stringify({
        text: record.text,
        extra: null,
        legacy_type: record.type
      }),
      created_at: record.created_at,
      updated_at: record.created_at
    });
  }

  if (insertData.length === 0) {
    return { success: 0, skipped, errors: 0 };
  }

  try {
    const fields = ['legacy_record_id', 'case_id', 'author_profile', 'communication_type', 'payload', 'created_at', 'updated_at'];
    
    const values = insertData.map((_, index) => {
      const base = index * fields.length;
      return `(${fields.map((_, i) => `$${base + i + 1}`).join(', ')})`;
    }).join(', ');

    const query = `
      INSERT INTO clinical_communications (${fields.join(', ')})
      VALUES ${values}
      ON CONFLICT (legacy_record_id) DO NOTHING
    `;

    const queryParams: any[] = [];
    for (const data of insertData) {
      queryParams.push(
        data.legacy_id,
        data.case_id,
        data.author_profile,
        data.communication_type,
        data.payload,
        data.created_at,
        data.updated_at
      );
    }

    const result = await targetClient.query(query, queryParams);
    return { success: result.rowCount || 0, skipped, errors: 0 };

  } catch (error) {
    console.error('    Clinical communications batch error:', error);
    return { success: 0, skipped, errors: insertData.length };
  }
}

async function migrateTeamCommunications(
  records: SourceRecord[],
  caseMapping: Map<number, string>,
  authorMapping: Map<number, string>
): Promise<{ success: number; skipped: number; errors: number }> {
  
  const insertData: any[] = [];
  let skipped = 0;

  for (const record of records) {
    const caseId = caseMapping.get(record.target_id);
    const authorId = record.author_id ? authorMapping.get(record.author_id) : null;

    if (!caseId) {
      skipped++;
      continue;
    }
    
    insertData.push({
      legacy_record_id: record.id,
      case_id: caseId,
      author_profile: authorId,
      message: record.text,
      created_at: record.created_at,
      updated_at: record.created_at
    });
  }

  if (insertData.length === 0) {
    return { success: 0, skipped, errors: 0 };
  }

  try {
    const fields = ['legacy_record_id', 'case_id', 'author_profile', 'message', 'created_at', 'updated_at'];
    
    const values = insertData.map((_, index) => {
      const base = index * fields.length;
      return `(${fields.map((_, i) => `$${base + i + 1}`).join(', ')})`;
    }).join(', ');

    const query = `
      INSERT INTO team_communications (${fields.join(', ')})
      VALUES ${values}
      ON CONFLICT (legacy_record_id) DO NOTHING
    `;

    const queryParams: any[] = [];
    for (const data of insertData) {
      queryParams.push(
        data.legacy_id,
        data.case_id,
        data.author_profile,
        data.message,
        data.created_at,
        data.updated_at
      );
    }

    const result = await targetClient.query(query, queryParams);
    return { success: result.rowCount || 0, skipped, errors: 0 };

  } catch (error) {
    console.error('    Team communications batch error:', error);
    return { success: 0, skipped, errors: insertData.length };
  }
}

async function migrateSystemMessages(
  records: SourceRecord[],
  caseMapping: Map<number, string>
): Promise<{ success: number; skipped: number; errors: number }> {
  
  const insertData: any[] = [];
  let skipped = 0;

  for (const record of records) {
    const caseId = caseMapping.get(record.target_id);

    if (!caseId) {
      skipped++;
      continue;
    }
    
    insertData.push({
      legacy_record_id: record.id,
      case_id: caseId,
      message_code: record.type,
      message_text: record.text,
      created_at: record.created_at,
      updated_at: record.created_at
    });
  }

  if (insertData.length === 0) {
    return { success: 0, skipped, errors: 0 };
  }

  try {
    const fields = ['legacy_record_id', 'case_id', 'message_code', 'message_text', 'created_at', 'updated_at'];
    
    const values = insertData.map((_, index) => {
      const base = index * fields.length;
      return `(${fields.map((_, i) => `$${base + i + 1}`).join(', ')})`;
    }).join(', ');

    const query = `
      INSERT INTO system_messages (${fields.join(', ')})
      VALUES ${values}
      ON CONFLICT (legacy_record_id) DO NOTHING
    `;

    const queryParams: any[] = [];
    for (const data of insertData) {
      queryParams.push(
        data.legacy_id,
        data.case_id,
        data.message_code,
        data.message_text,
        data.created_at,
        data.updated_at
      );
    }

    const result = await targetClient.query(query, queryParams);
    return { success: result.rowCount || 0, skipped, errors: 0 };

  } catch (error) {
    console.error('    System messages batch error:', error);
    return { success: 0, skipped, errors: insertData.length };
  }
}

async function migrateCommunications() {
  try {
    await sourceClient.connect();
    await targetClient.connect();
    console.log('Connected to both databases');

    const { caseMapping, authorMapping } = await buildLookupMappings();

    // Get counts by type
    const countsResult = await sourceClient.query(`
      SELECT 
        type,
        COUNT(*) as count
      FROM dispatch_record 
      WHERE type IN (3,4,5,6,8)
      GROUP BY type
      ORDER BY type
    `);
    
    console.log('\nDispatch record counts by type:');
    for (const row of countsResult.rows) {
      console.log(`  Type ${row.type}: ${row.count.toLocaleString()}`);
    }
    console.log('');

    const totalRecords = countsResult.rows.reduce((sum, row) => sum + parseInt(row.count), 0);

    if (TEST_MODE) {
      console.log('🧪 Running in TEST MODE - processing only first 10 records per type\n');
    }

    let totalSuccess = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    // Migrate each type separately
    const types = [
      { types: [3, 4], name: 'Clinical Communications', migrator: migrateClinicalCommunications },
      { types: [6], name: 'Team Communications', migrator: migrateTeamCommunications },
      { types: [5, 8], name: 'System Messages', migrator: migrateSystemMessages }
    ];

    for (const typeGroup of types) {
      console.log(`\n📨 Migrating ${typeGroup.name}...`);
      
      const typeList = typeGroup.types.join(',');
      let processed = 0;
      
      // Get total count for this type group
      const typeCountResult = await sourceClient.query(`
        SELECT COUNT(*) as total 
        FROM dispatch_record 
        WHERE type IN (${typeList})
      `);
      const typeTotal = parseInt(typeCountResult.rows[0].total);
      
      const limit = TEST_MODE ? Math.min(10, BATCH_SIZE) : BATCH_SIZE;
      const maxRecords = TEST_MODE ? 10 : typeTotal;

      while (processed < maxRecords) {
        const currentBatchSize = Math.min(limit, maxRecords - processed);
        
        console.log(`  Processing batch: ${processed + 1} to ${processed + currentBatchSize}`);

        // Fetch batch
        const batchResult = await sourceClient.query(`
          SELECT id, type, target_id, author_id, text, created_at
          FROM dispatch_record
          WHERE type IN (${typeList})
          ORDER BY id
          LIMIT $1 OFFSET $2
        `, [currentBatchSize, processed]);

        const records: SourceRecord[] = batchResult.rows;

        if (records.length === 0) {
          break;
        }

        // Migrate batch using appropriate migrator
        let result;
        if (typeGroup.types.includes(3) || typeGroup.types.includes(4)) {
          result = await migrateClinicalCommunications(records, caseMapping, authorMapping);
        } else if (typeGroup.types.includes(6)) {
          result = await migrateTeamCommunications(records, caseMapping, authorMapping);
        } else {
          result = await migrateSystemMessages(records, caseMapping);
        }

        totalSuccess += result.success;
        totalSkipped += result.skipped;
        totalErrors += result.errors;

        if (result.errors === 0) {
          console.log(`    Successfully inserted ${result.success} records`);
        }

        processed += records.length;
        
        const progressPercent = ((processed / typeTotal) * 100).toFixed(1);
        console.log(`  Progress: ${progressPercent}% (${processed}/${typeTotal})\n`);
      }
    }

    console.log('=== Communication Migration Complete ===');
    console.log(`Total processed: ${totalRecords}`);
    console.log(`Successfully migrated: ${totalSuccess}`);
    console.log(`Skipped: ${totalSkipped}`);
    console.log(`Errors: ${totalErrors}`);

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await sourceClient.end();
    await targetClient.end();
  }
}

// Run migration
migrateCommunications();
