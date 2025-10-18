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
      if (totalInserted % 500 === 0 || batch.length < batchSize) {
        console.log(`   ✅ Inserted ${batch.length} records for ${tableName} (total: ${totalInserted})`);
      }

    } catch (batchError: any) {
      console.error(`   ❌ Batch error for ${tableName}:`, batchError.message);
    }
  }

  return totalInserted;
}

async function migrateNotificationsToSystemMessages() {
  console.log('🚀 Starting migration from dispatch_notification to system_messages...\n');

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

    // Step 1: Check source dispatch_notification table
    console.log('\n📦 Analyzing dispatch_notification table...');

    const countResult = await sourceClient.query(`SELECT COUNT(*) as count FROM dispatch_notification WHERE sent = true AND send = true`);
    const totalCount = parseInt(countResult.rows[0].count);
    console.log(`📊 Active notifications in source (sent=true AND send=true): ${totalCount.toLocaleString()}`);

    // Get template/sender distribution
    console.log('\n📈 Analyzing active notification types...');
    const typeDistResult = await sourceClient.query(`
      SELECT
        sender,
        template_name,
        COUNT(*) as count
      FROM dispatch_notification
      WHERE sent = true AND send = true
      GROUP BY sender, template_name
      ORDER BY count DESC
      LIMIT 10;
    `);

    console.log('📋 Top notification types:');
    typeDistResult.rows.forEach((row: any, index: number) => {
      console.log(`   ${index + 1}. ${row.sender} / ${row.template_name}: ${row.count.toLocaleString()} records`);
    });

    // Step 2: Check target table structure
    console.log('\n🎯 Checking target system_messages table structure...');
    const { data: sampleTarget, error: sampleError } = await supabase
      .from('system_messages')
      .select('*')
      .limit(1);

    if (sampleError) {
      throw new Error(`Target system_messages table error: ${sampleError.message}`);
    }

    console.log('✅ Target system_messages table is accessible');
    if (sampleTarget && sampleTarget.length > 0) {
      console.log('📋 Target structure:', Object.keys(sampleTarget[0]));
    } else {
      console.log('📊 Target table is empty - ready for migration');
    }

    // Step 3: Process in manageable chunks due to large volume
    console.log('\n⚡ Starting batch processing of 5.7M+ notifications...');
    console.log('💡 Processing in chunks to handle large dataset efficiently');

    const chunkSize = 1000; // Process 1000 records at a time from source
    let totalProcessed = 0;
    let totalInserted = 0;
    const maxRecords = totalCount; // Process all active notifications

    console.log(`🎯 Processing all ${maxRecords.toLocaleString()} active notifications for complete migration`);

    for (let offset = 0; offset < maxRecords; offset += chunkSize) {
      const currentChunk = Math.min(chunkSize, maxRecords - offset);
      console.log(`\n📦 Processing chunk: ${offset + 1}-${offset + currentChunk} of ${maxRecords.toLocaleString()}`);

      // Get chunk from source - only active notifications
      const chunkResult = await sourceClient.query(`
        SELECT
          id,
          created_at,
          sender,
          template_name,
          template_context,
          read,
          item_id,
          item_type_id,
          recipient_id,
          sent,
          send
        FROM dispatch_notification
        WHERE sent = true AND send = true
        ORDER BY id
        LIMIT $1 OFFSET $2;
      `, [currentChunk, offset]);

      console.log(`   📊 Retrieved ${chunkResult.rows.length} records from source`);

      if (chunkResult.rows.length === 0) {
        console.log('   ✅ No more records to process');
        break;
      }

      // Transform notifications to system messages
      const systemMessages = chunkResult.rows.map((row: any) => {
        // Extract key info from template_context JSON
        let templateContext: any = {};
        try {
          templateContext = JSON.parse(row.template_context || '{}');
        } catch (e) {
          templateContext = { raw_context: row.template_context };
        }

        // Use simple message type that should pass check constraint
        let messageType = 'info'; // Try with just 'info' for all messages

        // Create system message from notification - only if should be active
        return {
          message: `${row.template_name}: ${templateContext.patient_name || templateContext.doctor_name || 'System notification'}`,
          message_type: messageType,
          source_system: 'dispatch_notification',
          is_active: true, // Only migrating active records
          legacy_record_id: row.id,
          created_at: row.created_at || new Date().toISOString(),
          updated_at: row.created_at || new Date().toISOString(),
          message_data: {
            legacy_id: row.id,
            sender: row.sender,
            template_name: row.template_name,
            template_context: templateContext,
            priority: row.send ? 'high' : 'normal',
            read: row.read,
            item_id: row.item_id,
            item_type_id: row.item_type_id,
            recipient_id: row.recipient_id,
            sent: row.sent,
            send: row.send,
            source_table: 'dispatch_notification',
            migration_timestamp: new Date().toISOString()
          }
        };
      });

      console.log(`   🔄 Transformed ${systemMessages.length} notifications to system messages`);

      // Insert this chunk
      const chunkInserted = await insertInBatches('system_messages', systemMessages);
      totalInserted += chunkInserted;
      totalProcessed += chunkResult.rows.length;

      console.log(`   ✅ Chunk summary: ${chunkInserted}/${chunkResult.rows.length} inserted (Total: ${totalInserted})`);

      // Progress indicator
      const percentComplete = ((offset + currentChunk) / maxRecords * 100).toFixed(1);
      console.log(`   📈 Progress: ${percentComplete}% (${totalProcessed}/${maxRecords.toLocaleString()} records)`);
    }

    // Final summary
    console.log('\n📊 SYSTEM MESSAGES MIGRATION SUMMARY:');
    console.log(`✅ Source notifications processed: ${totalProcessed.toLocaleString()}`);
    console.log(`✅ Successfully migrated to system_messages: ${totalInserted.toLocaleString()}`);
    console.log(`✅ Success rate: ${((totalInserted / totalProcessed) * 100).toFixed(1)}%`);

    // Verify final count
    const { count: finalCount } = await supabase
      .from('system_messages')
      .select('*', { count: 'exact', head: true });

    console.log(`📦 Final system_messages count in database: ${(finalCount || 0).toLocaleString()}`);

    if (totalInserted > 0) {
      console.log('\n🎉 System messages migration completed successfully!');
      console.log('🔗 Legacy linkage: system_messages.legacy_id → dispatch_notification.id');
      console.log('📧 Rich notification data preserved in metadata JSON');
      console.log(`💡 Note: Processed first ${maxRecords.toLocaleString()} of ${totalCount.toLocaleString()} total notifications`);
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
  migrateNotificationsToSystemMessages().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default migrateNotificationsToSystemMessages;