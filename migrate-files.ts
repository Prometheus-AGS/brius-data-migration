import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

async function migrateFiles() {
  const sourceDb = new Pool({ host: process.env.SOURCE_DB_HOST, port: parseInt(process.env.SOURCE_DB_PORT || '5432'), database: process.env.SOURCE_DB_NAME, user: process.env.SOURCE_DB_USER, password: process.env.SOURCE_DB_PASSWORD });
  const targetDb = new Pool({ host: process.env.TARGET_DB_HOST, port: parseInt(process.env.TARGET_DB_PORT || '5432'), database: process.env.TARGET_DB_NAME, user: process.env.TARGET_DB_USER, password: process.env.TARGET_DB_PASSWORD });
  try {
    console.log('🔄 Starting optimized files migration...');
    console.log('📊 Building order lookup map...');
    const orderMap = new Map();
    const orders = await targetDb.query('SELECT legacy_instruction_id, id FROM orders WHERE legacy_instruction_id IS NOT NULL');
    orders.rows.forEach(r => orderMap.set(r.legacy_instruction_id, r.id));
    console.log(`✅ Order map: ${orderMap.size} entries`);
    console.log('📊 Extracting source files...');
    const sourceFiles = await sourceDb.query('SELECT id, uid, name, ext, size, type, instruction_id, created_at, description, product_id, parameters, record_id, status FROM dispatch_file ORDER BY id');
    console.log(`✅ Extracted ${sourceFiles.rows.length} files`);
    console.log('📊 Building existing files set...');
    const existing = await targetDb.query('SELECT legacy_file_id FROM files WHERE legacy_file_id IS NOT NULL');
    const existingSet = new Set(existing.rows.map(r => r.legacy_file_id));
    console.log(`✅ Found ${existingSet.size} existing files`);
    console.log('🚀 Starting batch insert...');
    const batchSize = 1000;
    let inserted = 0, skipped = 0;
    for (let i = 0; i < sourceFiles.rows.length; i += batchSize) {
      const batch = sourceFiles.rows.slice(i, i + batchSize);
      const values = [];
      const params = [];
      let paramIdx = 1;
      for (const file of batch) {
        if (existingSet.has(file.id)) { skipped++; continue; }
        const orderId = file.instruction_id ? orderMap.get(file.instruction_id) : null;
        const filename = file.name + (file.ext || '');
        const metadata = JSON.stringify({ product_id: file.product_id, record_id: file.record_id, status: file.status, parameters: file.parameters, description: file.description });
        values.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
        params.push(file.uid, orderId, filename, file.type, file.size, metadata, file.id);
      }
      if (values.length > 0) {
        await targetDb.query(`INSERT INTO files (file_uid, order_id, filename, file_type, file_size_bytes, metadata, legacy_file_id) VALUES ${values.join(', ')} ON CONFLICT (legacy_file_id) DO NOTHING`, params);
        inserted += values.length;
        console.log(`Progress: ${inserted + skipped}/${sourceFiles.rows.length} (${inserted} inserted, ${skipped} skipped)`);
      }
    }
    const final = await targetDb.query('SELECT COUNT(*) as total FROM files');
    console.log(`\\n✅ Migration complete! Inserted: ${inserted}, Skipped: ${skipped}, Total: ${final.rows[0].total}`);
  } finally { await sourceDb.end(); await targetDb.end(); }
}
migrateFiles();
