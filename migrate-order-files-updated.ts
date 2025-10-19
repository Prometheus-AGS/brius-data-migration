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

interface DispatchFile {
  id: number;
  uid: string;
  name: string;
  ext: string;
  size: number;
  type: number;
  instruction_id: number;
  created_at: Date;
  product_id: number | null;
  parameters: string;
  record_id: number | null;
  status: number;
}

// File categorization function
function categorizeFile(fileName: string, fileType: number): string {
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith('.stl') || lowerName.endsWith('.ply')) {
    return 'scan';
  }
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg') || lowerName.endsWith('.png') || lowerName.endsWith('.gif')) {
    if (lowerName.includes('_full.jpg') || lowerName.includes('package') || lowerName.includes('final')) {
      return 'final_package';
    }
    return 'image';
  }
  if (lowerName.endsWith('.pdf')) {
    return 'document';
  }
  if (lowerName.endsWith('.zip') || lowerName.endsWith('.rar') || lowerName.includes('.tar')) {
    return 'package';
  }

  // Categorize by file type if extension doesn't match
  if (fileType === 7 || fileType === 6) {
    return 'scan';
  }
  if (fileType === 8) {
    return 'image';
  }

  return 'other';
}

async function buildLookupMappings() {
  console.log('Building lookup mappings...');

  // Build order mappings (legacy_instruction_id -> order.id)
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

  // Build file mappings (legacy_file_id -> file.id)
  const fileResult = await targetClient.query(`
    SELECT id, legacy_file_id
    FROM files
    WHERE legacy_file_id IS NOT NULL
  `);
  const fileMapping = new Map<number, string>();
  for (const row of fileResult.rows) {
    fileMapping.set(row.legacy_file_id, row.id);
  }
  console.log(`  Built ${fileMapping.size} file mappings`);

  return { orderMapping, fileMapping };
}

async function migrateOrderFilesBatch(
  files: DispatchFile[],
  orderMapping: Map<number, string>,
  fileMapping: Map<number, string>
): Promise<{ success: number; skipped: number; errors: number }> {

  const insertData: any[] = [];
  let skipped = 0;

  for (const file of files) {
    // Resolve order UUID
    const orderUuid = orderMapping.get(file.instruction_id);
    if (!orderUuid) {
      console.log(`    Skipping file ${file.id}: No mapping for order ${file.instruction_id}`);
      skipped++;
      continue;
    }

    // Resolve file UUID
    const fileUuid = fileMapping.get(file.id);
    if (!fileUuid) {
      console.log(`    Skipping file ${file.id}: No mapping for file ${file.id}`);
      skipped++;
      continue;
    }

    // Categorize file
    const category = categorizeFile(file.name, file.type);

    // Parse parameters JSON
    let parameters = {};
    try {
      parameters = JSON.parse(file.parameters);
    } catch (e) {
      parameters = {};
    }

    insertData.push({
      order_id: orderUuid,
      file_id: fileUuid,
      category: category,
      file_type: file.type,
      status: file.status,
      parameters: JSON.stringify(parameters),
      metadata: JSON.stringify({
        original_name: file.name,
        extension: file.ext,
        size_bytes: file.size
      }),
      product_id: file.product_id,
      record_id: file.record_id,
      uploaded_at: file.created_at,
      legacy_file_id: file.id,
      legacy_instruction_id: file.instruction_id
    });
  }

  if (insertData.length === 0) {
    return { success: 0, skipped, errors: 0 };
  }

  try {
    // Build the insert query
    const fields = [
      'order_id', 'file_id', 'category', 'file_type', 'status',
      'parameters', 'metadata', 'product_id', 'record_id',
      'uploaded_at', 'legacy_file_id', 'legacy_instruction_id'
    ];

    const values = insertData.map((_, index) => {
      const base = index * fields.length;
      return `(${fields.map((_, i) => `$${base + i + 1}`).join(', ')})`;
    }).join(', ');

    const query = `
      INSERT INTO order_files (${fields.join(', ')})
      VALUES ${values}
      ON CONFLICT (order_id, file_id) DO NOTHING
    `;

    const queryParams: any[] = [];
    for (const data of insertData) {
      queryParams.push(
        data.order_id,
        data.file_id,
        data.category,
        data.file_type,
        data.status,
        data.parameters,
        data.metadata,
        data.product_id,
        data.record_id,
        data.uploaded_at,
        data.legacy_file_id,
        data.legacy_instruction_id
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

async function migrateOrderFiles() {
  try {
    await sourceClient.connect();
    await targetClient.connect();
    console.log('Connected to both databases');

    const { orderMapping, fileMapping } = await buildLookupMappings();

    // Get total count for progress tracking
    const countResult = await sourceClient.query(`
      SELECT COUNT(*) as total
      FROM dispatch_file
      WHERE instruction_id IS NOT NULL
    `);
    const totalRecords = parseInt(countResult.rows[0].total);
    console.log(`Total file-order relationships to migrate: ${totalRecords.toLocaleString()}\n`);

    if (TEST_MODE) {
      console.log('🧪 Running in TEST MODE - processing only first 10 records\n');
    }

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

      // Fetch batch from source
      const batchResult = await sourceClient.query(`
        SELECT id, uid, name, ext, size, type, instruction_id, created_at,
               product_id, parameters, record_id, status
        FROM dispatch_file
        WHERE instruction_id IS NOT NULL
        ORDER BY id ASC
        LIMIT $1 OFFSET $2
      `, [currentBatchSize, offset]);

      const files: DispatchFile[] = batchResult.rows;

      if (files.length === 0) {
        break;
      }

      // Migrate batch
      const result = await migrateOrderFilesBatch(
        files,
        orderMapping,
        fileMapping
      );

      totalSuccess += result.success;
      totalSkipped += result.skipped;
      totalErrors += result.errors;

      if (result.errors === 0) {
        console.log(`    Successfully inserted ${result.success} order-file relationships`);
      }

      processed += files.length;

      const progressPercent = ((processed / totalRecords) * 100).toFixed(1);
      console.log(`Progress: ${progressPercent}% (${processed}/${totalRecords}) - Success: ${totalSuccess}, Skipped: ${totalSkipped}, Errors: ${totalErrors}\n`);

      // Small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log('=== Migration Complete ===');
    console.log(`Total processed: ${processed.toLocaleString()}`);
    console.log(`Successfully migrated: ${totalSuccess.toLocaleString()}`);
    console.log(`Skipped: ${totalSkipped.toLocaleString()}`);
    console.log(`Errors: ${totalErrors.toLocaleString()}`);

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await sourceClient.end();
    await targetClient.end();
  }
}

// Run migration
migrateOrderFiles();