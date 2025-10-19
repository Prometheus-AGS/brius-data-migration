import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

// Target database connection
const targetClient = new Client({
  host: process.env.TARGET_DB_HOST,
  port: parseInt(process.env.TARGET_DB_PORT || '5432'),
  database: process.env.TARGET_DB_NAME,
  user: process.env.TARGET_DB_USER,
  password: process.env.TARGET_DB_PASSWORD,
});

async function checkExistingMessagesTable() {
  try {
    await targetClient.connect();
    console.log('Connected to target database');

    // Check if messages table exists and get its structure
    const structureResult = await targetClient.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'messages' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);

    if (structureResult.rows.length === 0) {
      console.log('No messages table found in target database');
      return;
    }

    console.log('\nExisting messages table structure:');
    structureResult.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type} (${row.is_nullable === 'YES' ? 'nullable' : 'not null'}) ${row.column_default ? `default: ${row.column_default}` : ''}`);
    });

    // Check current record count
    const countResult = await targetClient.query(`SELECT COUNT(*) as count FROM messages`);
    console.log(`\nCurrent messages count: ${countResult.rows[0].count}`);

    // Check for any existing records with legacy_record_id
    const legacyCountResult = await targetClient.query(`
      SELECT COUNT(*) as count FROM messages WHERE legacy_record_id IS NOT NULL
    `);
    console.log(`Records with legacy_record_id: ${legacyCountResult.rows[0].count}`);

    // Sample some existing records to understand the current schema
    const sampleResult = await targetClient.query(`
      SELECT * FROM messages
      ORDER BY created_at DESC
      LIMIT 3
    `);

    console.log('\nSample existing records:');
    sampleResult.rows.forEach((row, i) => {
      console.log(`  Record ${i + 1}:`, Object.keys(row).reduce((obj, key) => {
        obj[key] = typeof row[key] === 'string' && row[key].length > 50
          ? row[key].substring(0, 50) + '...'
          : row[key];
        return obj;
      }, {} as any));
    });

  } catch (error) {
    console.error('Error checking messages table:', error);
  } finally {
    await targetClient.end();
  }
}

checkExistingMessagesTable().catch(console.error);