import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function insertInBatches(tableName: string, data: any[]): Promise<number> {
  const batchSize = 50;
  let totalInserted = 0;

  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);

    try {
      const { error } = await supabase
        .from(tableName)
        .insert(batch);

      if (error) {
        console.error(`   ❌ Error inserting batch for ${tableName}:`, error.message);
        if (batch.length > 0) {
          console.error(`   First item structure:`, JSON.stringify(batch[0], null, 2));
        }
        continue;
      }

      totalInserted += batch.length;
      console.log(`   ✅ Inserted ${batch.length} records for ${tableName} (total: ${totalInserted})`);

    } catch (batchError: any) {
      console.error(`   ❌ Batch error for ${tableName}:`, batchError.message);
    }
  }

  return totalInserted;
}

async function migrateSystemMessages() {
  console.log('🚀 Starting system_messages migration...\n');

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

    // Step 1: Check source table structure
    console.log('\n📦 Investigating source system_messages table...');

    // Find system messages related tables
    const messageTablesResult = await sourceClient.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND (table_name LIKE '%system_message%' OR table_name LIKE '%message%')
      ORDER BY table_name;
    `);

    console.log('🗂️ Found message-related tables in source:');
    messageTablesResult.rows.forEach((row: any) => {
      console.log(`   • ${row.table_name}`);
    });

    // Try different possible table names for system messages
    const possibleTableNames = [
      'system_messages',
      'dispatch_system_message',
      'system_message',
      'dispatch_system_messages'
    ];

    let sourceTableName = '';
    let sourceSchema: any[] = [];
    let sourceCount = 0;

    for (const tableName of possibleTableNames) {
      try {
        console.log(`🔍 Checking table: ${tableName}`);

        const structureResult = await sourceClient.query(`
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_name = $1 AND table_schema = 'public'
          ORDER BY ordinal_position;
        `, [tableName]);

        if (structureResult.rows.length > 0) {
          sourceTableName = tableName;
          sourceSchema = structureResult.rows;

          const countResult = await sourceClient.query(`SELECT COUNT(*) as count FROM ${tableName}`);
          sourceCount = parseInt(countResult.rows[0].count);

          console.log(`✅ Found source table: ${tableName} with ${sourceCount} records`);
          break;
        }
      } catch (error: any) {
        console.log(`   ❌ ${tableName} not found: ${error.message}`);
      }
    }

    if (!sourceTableName) {
      console.log('❌ Could not find system messages table in source database');
      return 0;
    }

    // Display source schema
    console.log(`\n📋 Source table structure (${sourceTableName}):`);
    sourceSchema.forEach((col: any) => {
      console.log(`   • ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'required'})`);
    });

    if (sourceCount === 0) {
      console.log('⚠️  Source table is empty - no data to migrate');
      return 0;
    }

    // Step 2: Check target table structure
    console.log('\n🎯 Checking target system_messages table...');
    const { data: sampleTarget, error: sampleError } = await supabase
      .from('system_messages')
      .select('*')
      .limit(1);

    if (sampleError) {
      console.log(`❌ Error accessing target table: ${sampleError.message}`);
      console.log('💡 Please ensure system_messages table exists in target database');
      return 0;
    }

    console.log('✅ Target system_messages table is accessible');
    if (sampleTarget && sampleTarget.length > 0) {
      console.log('📋 Target table structure:', Object.keys(sampleTarget[0]));
      console.log('📋 Sample target record:', sampleTarget[0]);
    }

    // Step 3: Get source data
    console.log(`\n📦 Fetching ${sourceCount} system messages from ${sourceTableName}...`);
    const sourceResult = await sourceClient.query(`
      SELECT *
      FROM ${sourceTableName}
      ORDER BY id;
    `);

    console.log(`📊 Retrieved ${sourceResult.rows.length} records from source`);

    // Show sample source data
    if (sourceResult.rows.length > 0) {
      console.log('\n📋 Sample source record:');
      console.log(JSON.stringify(sourceResult.rows[0], null, 2));
    }

    // Step 4: Transform data for target schema
    console.log('\n🔄 Transforming data for target schema...');

    const systemMessages = sourceResult.rows.map((row: any) => {
      // Basic transformation - adapt based on actual schema
      return {
        message: row.message || row.content || row.text || '',
        message_type: row.type || row.message_type || 'info',
        priority: row.priority || 'normal',
        is_active: row.is_active !== false, // Default to true unless explicitly false
        expires_at: row.expires_at || row.expiry_date || null,
        legacy_id: row.id,
        created_at: row.created_at || new Date().toISOString(),
        updated_at: row.updated_at || row.modified_at || new Date().toISOString(),
        metadata: {
          legacy_id: row.id,
          source_table: sourceTableName,
          migration_timestamp: new Date().toISOString(),
          original_data: row
        }
      };
    });

    console.log(`📦 Prepared ${systemMessages.length} system messages for insertion`);

    // Show sample transformed record
    if (systemMessages.length > 0) {
      console.log('\n📦 Sample transformed record:');
      console.log(JSON.stringify(systemMessages[0], null, 2));
    }

    // Step 5: Insert in batches
    console.log('\n⚡ Starting batch insertion...');
    const totalInserted = await insertInBatches('system_messages', systemMessages);

    // Summary
    console.log('\n📊 SYSTEM MESSAGES MIGRATION SUMMARY:');
    console.log(`✅ Source records (${sourceTableName}): ${sourceResult.rows.length}`);
    console.log(`✅ Successfully migrated: ${totalInserted}`);
    console.log(`✅ Success rate: ${((totalInserted / sourceResult.rows.length) * 100).toFixed(1)}%`);

    // Verify final count
    const { count: finalCount } = await supabase
      .from('system_messages')
      .select('*', { count: 'exact', head: true });

    console.log(`📦 Final system_messages count in database: ${finalCount || 0}`);

    // Show message type distribution if successful
    if (totalInserted > 0) {
      const messageTypes = systemMessages.slice(0, totalInserted).reduce((acc: any, msg: any) => {
        acc[msg.message_type] = (acc[msg.message_type] || 0) + 1;
        return acc;
      }, {});

      console.log('\n📈 Message type distribution:');
      Object.entries(messageTypes).forEach(([type, count]) => {
        console.log(`   ${type}: ${count} messages`);
      });

      console.log('\n🎉 System messages migration completed successfully!');
      console.log('🔗 Legacy linkage: system_messages.legacy_id → source.id');
    } else {
      console.log('\n⚠️  System messages migration completed with issues - check errors above');
    }

    return totalInserted;

  } catch (error: any) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await sourceClient.end();
    console.log('🔌 Disconnected from source database');
  }
}

// Run the migration
if (require.main === module) {
  migrateSystemMessages().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default migrateSystemMessages;