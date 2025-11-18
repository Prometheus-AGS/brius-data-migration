/**
 * Check dispatch_instruction table schema
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function checkDispatchInstructionSchema() {
  const sourcePool = new Pool({
    host: process.env.SOURCE_DB_HOST,
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME,
    user: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASSWORD,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  try {
    console.log('🔍 Checking dispatch_instruction table schema...');

    const schemaResult = await sourcePool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'dispatch_instruction'
      ORDER BY ordinal_position;
    `);

    console.log('✅ dispatch_instruction columns:');
    schemaResult.rows.forEach(row => {
      console.log(`   ${row.column_name}: ${row.data_type} ${row.is_nullable === 'NO' ? 'NOT NULL' : 'NULLABLE'}`);
    });

    // Get sample data
    const sampleResult = await sourcePool.query(`
      SELECT *
      FROM dispatch_instruction
      ORDER BY id DESC
      LIMIT 3
    `);

    console.log('\n📋 Sample dispatch_instruction records:');
    sampleResult.rows.forEach((row, i) => {
      console.log(`\n   Record ${i + 1}:`);
      Object.keys(row).forEach(key => {
        console.log(`     ${key}: ${row[key]}`);
      });
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await sourcePool.end();
  }
}

checkDispatchInstructionSchema().catch(console.error);