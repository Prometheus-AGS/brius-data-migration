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

interface SourceState {
  id: number;
  instruction_id: number;
  status: number;
  on: boolean;
  actor_id: number | null;
  changed_at: Date;
}

async function buildLookupMappings() {
  console.log('Building lookup mappings...');

  // Build order mapping (legacy_instruction_id -> target order UUID)
  const orderResult = await targetClient.query(`
    SELECT id, legacy_instruction_id
    FROM orders
    WHERE legacy_instruction_id IS NOT NULL
  `);
  const orderMapping = new Map<number, string>();
  for (const row of orderResult.rows) {
    orderMapping.set(row.legacy_instruction_id, row.id);
  }
  console.log(`  Built ${orderMapping.size} order mappings`);

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

  return { orderMapping, profileMapping };
}

function mapStatusName(statusCode: number): string {
  // Map legacy status codes to human-readable names
  switch (statusCode) {
    case 11: return 'review_approval';
    case 12: return 'processing';
    case 13: return 'manufacturing';
    case 14: return 'shipped';
    case 15: return 'delivered';
    case 16: return 'completed';
    case 17: return 'cancelled';
    case 18: return 'on_hold';
    case 19: return 'returned';
    case 20: return 'refunded';
    default: return `unknown_${statusCode}`;
  }
}

async function migrateOrderStatesBatch(
  states: SourceState[],
  orderMapping: Map<number, string>,
  profileMapping: Map<number, string>
): Promise<{ success: number; skipped: number; errors: number }> {

  const insertData: any[] = [];
  let skipped = 0;

  for (const state of states) {
    const orderId = orderMapping.get(state.instruction_id);
    const changedBy = state.actor_id ? profileMapping.get(state.actor_id) : null;

    if (!orderId) {
      console.log(`    Skipping state ${state.id}: No mapping for order ${state.instruction_id}`);
      skipped++;
      continue;
    }

    insertData.push({
      order_id: orderId,
      status_code: state.status,
      status_name: mapStatusName(state.status),
      is_active: state.on,
      changed_by: changedBy,
      changed_at: state.changed_at,
      legacy_state_id: state.id,
      legacy_instruction_id: state.instruction_id,
      legacy_actor_id: state.actor_id,
      metadata: JSON.stringify({
        source_state_id: state.id,
        source_status: state.status,
        source_on: state.on,
        source_actor_id: state.actor_id,
        source_instruction_id: state.instruction_id,
        migration_source: 'dispatch_state'
      })
    });
  }

  if (insertData.length === 0) {
    return { success: 0, skipped, errors: 0 };
  }

  try {
    // Build the insert query
    const fields = [
      'order_id', 'status_code', 'status_name', 'is_active', 'changed_by',
      'changed_at', 'legacy_state_id', 'legacy_instruction_id',
      'legacy_actor_id', 'metadata'
    ];

    const values = insertData.map((_, index) => {
      const base = index * fields.length;
      return `(${fields.map((_, i) => `$${base + i + 1}`).join(', ')})`;
    }).join(', ');

    const query = `
      INSERT INTO order_states (${fields.join(', ')})
      VALUES ${values}
      ON CONFLICT (legacy_state_id) DO NOTHING
    `;

    const queryParams: any[] = [];
    for (const data of insertData) {
      queryParams.push(
        data.order_id,
        data.status_code,
        data.status_name,
        data.is_active,
        data.changed_by,
        data.changed_at,
        data.legacy_state_id,
        data.legacy_instruction_id,
        data.legacy_actor_id,
        data.metadata
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

async function migrateOrderStates() {
  try {
    await sourceClient.connect();
    await targetClient.connect();
    console.log('Connected to both databases');

    const { orderMapping, profileMapping } = await buildLookupMappings();

    // Get total count from dispatch_state where instruction_id is present
    const countResult = await sourceClient.query(`
      SELECT COUNT(*) as total FROM dispatch_state
      WHERE instruction_id IS NOT NULL
    `);
    const totalRecords = parseInt(countResult.rows[0].total);
    console.log(`Total order states to migrate: ${totalRecords}\n`);

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

      // Fetch batch from dispatch_state
      const batchResult = await sourceClient.query(`
        SELECT id, instruction_id, status, "on", actor_id, changed_at
        FROM dispatch_state
        WHERE instruction_id IS NOT NULL
        ORDER BY id
        LIMIT $1 OFFSET $2
      `, [currentBatchSize, offset]);

      const states: SourceState[] = batchResult.rows;

      if (states.length === 0) {
        break;
      }

      // Migrate batch
      const result = await migrateOrderStatesBatch(
        states,
        orderMapping,
        profileMapping
      );

      totalSuccess += result.success;
      totalSkipped += result.skipped;
      totalErrors += result.errors;

      if (result.errors === 0) {
        console.log(`    Successfully inserted ${result.success} order states`);
      }

      processed += states.length;

      const progressPercent = ((processed / totalRecords) * 100).toFixed(1);
      console.log(`Progress: ${progressPercent}% (${processed}/${totalRecords}) - Success: ${totalSuccess}, Skipped: ${totalSkipped}, Errors: ${totalErrors}\n`);
    }

    console.log('=== Migration Complete ===');
    console.log(`Total processed: ${processed}`);
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
migrateOrderStates();