import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function investigateMessageTables() {
  console.log('🔍 Comprehensive investigation of message-related tables...\n');

  const sourceClient = new Client({
    host: process.env.SOURCE_DB_HOST!,
    port: parseInt(process.env.SOURCE_DB_PORT!),
    user: process.env.SOURCE_DB_USER!,
    password: process.env.SOURCE_DB_PASSWORD!,
    database: process.env.SOURCE_DB_NAME!,
  });

  try {
    await sourceClient.connect();
    console.log('✅ Connected to source database');

    // Step 1: Get all tables in source database
    console.log('\n📋 1. All tables in source database:');
    const allTablesResult = await sourceClient.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);

    console.log(`📊 Total tables found: ${allTablesResult.rows.length}`);
    allTablesResult.rows.forEach((row: any, index: number) => {
      console.log(`   ${index + 1}. ${row.table_name}`);
    });

    // Step 2: Find tables that might contain messages
    console.log('\n📋 2. Tables potentially containing messages:');
    const messageTablesResult = await sourceClient.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND (
        table_name ILIKE '%message%' OR
        table_name ILIKE '%notification%' OR
        table_name ILIKE '%alert%' OR
        table_name ILIKE '%communication%' OR
        table_name ILIKE '%system%' OR
        table_name ILIKE '%log%' OR
        table_name ILIKE '%event%'
      )
      ORDER BY table_name;
    `);

    if (messageTablesResult.rows.length > 0) {
      console.log('🗂️ Found potentially relevant tables:');
      messageTablesResult.rows.forEach((row: any) => {
        console.log(`   • ${row.table_name}`);
      });

      // Step 3: Investigate each potentially relevant table
      for (const table of messageTablesResult.rows) {
        console.log(`\n📊 Investigating ${table.table_name}:`);

        try {
          // Get structure
          const structureResult = await sourceClient.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = $1 AND table_schema = 'public'
            ORDER BY ordinal_position;
          `, [table.table_name]);

          console.log(`   📋 Structure:`);
          structureResult.rows.forEach((col: any) => {
            console.log(`     • ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'required'})`);
          });

          // Get count
          const countResult = await sourceClient.query(`SELECT COUNT(*) as count FROM ${table.table_name}`);
          console.log(`   📈 Count: ${countResult.rows[0].count} records`);

          // Sample data if not empty
          if (parseInt(countResult.rows[0].count) > 0) {
            const sampleResult = await sourceClient.query(`SELECT * FROM ${table.table_name} LIMIT 2`);
            console.log(`   📋 Sample data:`);
            sampleResult.rows.forEach((row: any, index: number) => {
              console.log(`     ${index + 1}. ${JSON.stringify(row)}`);
            });
          }
        } catch (error: any) {
          console.log(`   ❌ Error accessing table: ${error.message}`);
        }
      }
    } else {
      console.log('❌ No message-related tables found');
    }

    // Step 4: Check target database for system_messages table
    console.log('\n📋 3. Checking target database for system_messages table...');

    try {
      const { data: targetData, error: targetError } = await supabase
        .from('system_messages')
        .select('*')
        .limit(1);

      if (targetError) {
        console.log(`❌ Target system_messages table error: ${targetError.message}`);
      } else {
        console.log(`✅ Target system_messages table exists`);
        if (targetData && targetData.length > 0) {
          console.log(`   📋 Target structure:`, Object.keys(targetData[0]));
          console.log(`   📋 Sample record:`, targetData[0]);
        } else {
          console.log(`   📊 Target table is empty`);
        }
      }
    } catch (error: any) {
      console.log(`❌ Error accessing target table: ${error.message}`);
    }

    // Step 5: Look for any table with message-like content
    console.log('\n📋 4. Searching for tables with message-like columns...');
    const messageColumnsResult = await sourceClient.query(`
      SELECT DISTINCT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND (
        column_name ILIKE '%message%' OR
        column_name ILIKE '%content%' OR
        column_name ILIKE '%text%' OR
        column_name ILIKE '%body%' OR
        column_name ILIKE '%description%' OR
        column_name ILIKE '%note%'
      )
      ORDER BY table_name, column_name;
    `);

    if (messageColumnsResult.rows.length > 0) {
      console.log('📋 Tables with message-like columns:');
      messageColumnsResult.rows.forEach((row: any) => {
        console.log(`   ${row.table_name}.${row.column_name}`);
      });
    }

    console.log('\n📊 INVESTIGATION SUMMARY:');
    console.log(`✅ Total tables in source: ${allTablesResult.rows.length}`);
    console.log(`✅ Message-related tables: ${messageTablesResult.rows.length}`);
    console.log(`✅ Tables with message-like columns: ${messageColumnsResult.rows.length}`);

  } catch (error: any) {
    console.error('❌ Investigation failed:', error);
    throw error;
  } finally {
    await sourceClient.end();
    console.log('🔌 Disconnected from source database');
  }
}

// Run the investigation
if (require.main === module) {
  investigateMessageTables().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default investigateMessageTables;