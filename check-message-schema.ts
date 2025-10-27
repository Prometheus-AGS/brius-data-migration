/**
 * Check Message Table Schema for Differential Migration
 * Verifies source and target message table structures
 */

import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function checkMessageSchema() {
  console.log('🔍 Checking message table schemas for differential migration...');

  // Initialize connections
  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE!;

  const supabase = createClient(supabaseUrl, supabaseServiceRole, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const targetPool = new Pool({
    host: process.env.TARGET_DB_HOST,
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    database: process.env.TARGET_DB_NAME,
    user: process.env.TARGET_DB_USER,
    password: process.env.TARGET_DB_PASSWORD,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

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
    console.log('\n📊 Checking source database (dispatch_message)...');

    // Check source dispatch_message table
    const sourceSchemaResult = await sourcePool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'dispatch_message'
      ORDER BY ordinal_position;
    `);

    if (sourceSchemaResult.rows.length > 0) {
      console.log('✅ dispatch_message table found in source:');
      sourceSchemaResult.rows.forEach(row => {
        console.log(`   ${row.column_name}: ${row.data_type} ${row.is_nullable === 'NO' ? 'NOT NULL' : 'NULLABLE'}`);
      });

      // Get count
      const sourceCountResult = await sourcePool.query('SELECT COUNT(*) as count FROM dispatch_message');
      console.log(`   Total records: ${sourceCountResult.rows[0].count}`);
    } else {
      console.log('❌ dispatch_message table not found in source');
    }

    console.log('\n📊 Checking target database (messages)...');

    // Check target messages table
    const targetSchemaResult = await targetPool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'messages'
      ORDER BY ordinal_position;
    `);

    if (targetSchemaResult.rows.length > 0) {
      console.log('✅ messages table found in target:');
      targetSchemaResult.rows.forEach(row => {
        console.log(`   ${row.column_name}: ${row.data_type} ${row.is_nullable === 'NO' ? 'NOT NULL' : 'NULLABLE'}`);
      });

      // Get count and migrated count
      const targetCountResult = await targetPool.query('SELECT COUNT(*) as count FROM messages');
      console.log(`   Total records: ${targetCountResult.rows[0].count}`);

      const migratedCountResult = await targetPool.query('SELECT COUNT(*) as count FROM messages WHERE legacy_message_id IS NOT NULL');
      console.log(`   Migrated records: ${migratedCountResult.rows[0].count}`);
    } else {
      console.log('❌ messages table not found in target');
    }

    console.log('\n📊 Calculating differential gap...');

    // Calculate the gap
    const sourceTotal = await sourcePool.query('SELECT COUNT(*) as count FROM dispatch_message');
    const targetMigrated = await targetPool.query('SELECT COUNT(*) as count FROM messages WHERE legacy_message_id IS NOT NULL');

    const sourceCount = parseInt(sourceTotal.rows[0].count);
    const migratedCount = parseInt(targetMigrated.rows[0].count);
    const gap = sourceCount - migratedCount;

    console.log(`📊 Migration Gap Analysis:`);
    console.log(`   Source messages: ${sourceCount.toLocaleString()}`);
    console.log(`   Already migrated: ${migratedCount.toLocaleString()}`);
    console.log(`   Gap to migrate: ${gap.toLocaleString()}`);

    if (gap > 0) {
      console.log(`🎯 Ready to migrate ${gap} new message records`);
    } else {
      console.log(`✅ All messages are up to date`);
    }

    // Check for any related tables
    console.log('\n📊 Checking related message tables...');

    // Check for system_messages
    try {
      const sysMessageTarget = await targetPool.query('SELECT COUNT(*) as count FROM system_messages');
      console.log(`   system_messages (target): ${sysMessageTarget.rows[0].count}`);
    } catch (error) {
      console.log('   system_messages: table not found');
    }

    // Check for message_attachments
    try {
      const attachTarget = await targetPool.query('SELECT COUNT(*) as count FROM message_attachments');
      console.log(`   message_attachments (target): ${attachTarget.rows[0].count}`);
    } catch (error) {
      console.log('   message_attachments: table not found');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

if (require.main === module) {
  checkMessageSchema().catch(error => {
    console.error('❌ Script execution failed:', error);
    process.exit(1);
  });
}

export { checkMessageSchema };