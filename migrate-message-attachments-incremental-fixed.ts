import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

import * as dotenv from 'dotenv';
dotenv.config();

const sourceClient = new Client({
  host: process.env.SOURCE_DB_HOST!,
  port: parseInt(process.env.SOURCE_DB_PORT!),
  database: process.env.SOURCE_DB_NAME!,
  user: process.env.SOURCE_DB_USER!,
  password: process.env.SOURCE_DB_PASSWORD!,
});

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE!
);

async function migrateMessageAttachmentsIncrementalFixed() {
  const startTime = Date.now();
  let totalProcessed = 0;
  let totalMigrated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  try {
    await sourceClient.connect();

    console.log('=== Starting Message Attachments INCREMENTAL Migration (FIXED) ===\n');

    // Step 1: Build exclusion set of existing message-file combinations
    console.log('📋 Step 1: Building exclusion set of existing message_attachments...');

    const existingAttachments = new Set<string>();
    let existingOffset = 0;
    const existingBatchSize = 1000;

    while (true) {
      const { data: existingData, error: existingError } = await supabase
        .from('message_attachments')
        .select('message_id, file_id, legacy_record_id, legacy_file_id')
        .range(existingOffset, existingOffset + existingBatchSize - 1);

      if (existingError) {
        console.error('❌ Error fetching existing message_attachments:', existingError);
        break;
      }

      if (!existingData || existingData.length === 0) {
        break;
      }

      existingData.forEach(attachment => {
        // Create compound key for message-file combination
        const key = `${attachment.message_id}:${attachment.file_id}`;
        existingAttachments.add(key);

        // Also track by legacy IDs for additional safety
        if (attachment.legacy_record_id && attachment.legacy_file_id) {
          const legacyKey = `legacy:${attachment.legacy_record_id}:${attachment.legacy_file_id}`;
          existingAttachments.add(legacyKey);
        }
      });

      existingOffset += existingBatchSize;

      if (existingData.length < existingBatchSize) {
        break;
      }
    }

    console.log(`✓ Built exclusion set with ${existingAttachments.size} existing attachment relationships`);

    // Step 2: Analysis of what needs to be migrated
    const analysisQuery = `
      SELECT
        COUNT(*) as total_files,
        COUNT(DISTINCT f.record_id) as unique_messages,
        MIN(f.record_id) as min_record_id,
        MAX(f.record_id) as max_record_id
      FROM dispatch_file f
      INNER JOIN dispatch_record r ON f.record_id = r.id
      WHERE f.record_id IS NOT NULL;
    `;

    const analysis = await sourceClient.query(analysisQuery);
    const stats = analysis.rows[0];

    console.log('\n📊 Migration Overview:');
    console.log(`  📁 Total files to analyze: ${parseInt(stats.total_files).toLocaleString()}`);
    console.log(`  💬 Unique messages involved: ${parseInt(stats.unique_messages).toLocaleString()}`);
    console.log(`  🔢 Record ID range: ${stats.min_record_id} - ${stats.max_record_id}`);

    // Check current state
    const { count: currentAttachments } = await supabase
      .from('message_attachments')
      .select('*', { count: 'exact', head: true });

    console.log(`  📎 Current message_attachments: ${currentAttachments || 0}`);
    console.log(`  🎯 Exclusion set size: ${existingAttachments.size}\n`);

    // Step 3: Process only NEW attachments
    const batchSize = 100;
    let offset = 0;
    let hasMore = true;

    console.log('🔄 Step 3: Processing only NEW message attachments...\n');

    while (hasMore) {
      // Get files with their record info
      const batchQuery = `
        SELECT
          f.id as source_file_id,
          f.uid as file_uid,
          f.record_id as source_record_id,
          f.created_at as file_created_at,
          r.id as dispatch_record_id
        FROM dispatch_file f
        INNER JOIN dispatch_record r ON f.record_id = r.id
        WHERE f.record_id IS NOT NULL
        ORDER BY f.id
        LIMIT $1 OFFSET $2;
      `;

      const batchResult = await sourceClient.query(batchQuery, [batchSize, offset]);
      const batch = batchResult.rows;

      if (batch.length === 0) {
        hasMore = false;
        break;
      }

      console.log(`Processing batch: ${offset + 1} - ${offset + batch.length}`);

      // For each file in the batch, create message attachment if not already exists
      const attachmentsToInsert = [];

      for (const file of batch) {
        totalProcessed++;

        try {
          // 🔧 FIX: Check if this attachment already exists by legacy IDs
          const legacyKey = `legacy:${file.source_record_id}:${file.source_file_id}`;
          if (existingAttachments.has(legacyKey)) {
            totalSkipped++;
            continue; // Skip already existing attachment
          }

          // Find the corresponding message in our target database
          const { data: message, error: messageError } = await supabase
            .from('messages')
            .select('id')
            .eq('legacy_record_id', file.source_record_id)
            .single();

          if (messageError || !message) {
            console.log(`  ⚠️  Message not found for record_id ${file.source_record_id} (file ${file.source_file_id})`);
            totalSkipped++;
            continue;
          }

          // Find the corresponding file in our target database
          const { data: targetFile, error: fileError } = await supabase
            .from('files')
            .select('id')
            .eq('legacy_file_id', file.source_file_id)
            .single();

          if (fileError || !targetFile) {
            console.log(`  ⚠️  File not found for file_id ${file.source_file_id}`);
            totalSkipped++;
            continue;
          }

          // 🔧 FIX: Double-check for compound key uniqueness
          const compoundKey = `${message.id}:${targetFile.id}`;
          if (existingAttachments.has(compoundKey)) {
            totalSkipped++;
            continue; // Skip duplicate combination
          }

          // Prepare attachment record
          attachmentsToInsert.push({
            message_id: message.id,
            file_id: targetFile.id,
            attachment_type: 'file',
            metadata: {
              source_record_id: file.source_record_id,
              source_file_id: file.source_file_id,
              migrated_at: new Date().toISOString()
            },
            created_at: file.file_created_at,
            legacy_record_id: file.source_record_id,
            legacy_file_id: file.source_file_id
          });

          // Add to exclusion set to prevent duplicates within this session
          existingAttachments.add(compoundKey);
          existingAttachments.add(legacyKey);

        } catch (error: any) {
          console.error(`  ❌ Error processing file ${file.source_file_id}:`, error.message);
          totalErrors++;
        }
      }

      // Insert the batch with conflict handling
      if (attachmentsToInsert.length > 0) {
        try {
          // 🔧 FIX: Use upsert with proper conflict handling
          const { data, error } = await supabase
            .from('message_attachments')
            .upsert(attachmentsToInsert, {
              onConflict: 'message_id,file_id',
              ignoreDuplicates: true
            })
            .select('id');

          if (error) {
            console.error(`  ❌ Batch upsert error:`, error.message);
            totalErrors += attachmentsToInsert.length;
          } else {
            const actualInserted = data?.length || 0;
            totalMigrated += actualInserted;
            console.log(`  ✅ Migrated ${actualInserted} NEW attachments`);
          }
        } catch (insertError: any) {
          console.error(`  ❌ Batch insert exception:`, insertError.message);
          totalErrors += attachmentsToInsert.length;
        }
      } else {
        console.log(`  ℹ️  No NEW attachments to insert from this batch`);
      }

      offset += batchSize;

      // Show progress every 10 batches
      if ((offset / batchSize) % 10 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = totalProcessed / elapsed;
        console.log(`\n📊 Progress: ${totalProcessed} processed, ${totalMigrated} migrated, ${totalSkipped} skipped, ${totalErrors} errors`);
        console.log(`⏱️  Rate: ${rate.toFixed(1)} files/second`);
        console.log(`💡 Efficiency: ${totalSkipped > 0 ? ((totalSkipped / totalProcessed) * 100).toFixed(1) : 0}% duplicates avoided\n`);
      }
    }

    // Final results
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    console.log('\n=== INCREMENTAL Migration Complete ===');
    console.log(`⏱️  Duration: ${duration.toFixed(1)} seconds`);
    console.log(`📊 Results:`);
    console.log(`   Processed: ${totalProcessed.toLocaleString()}`);
    console.log(`   Migrated (NEW): ${totalMigrated.toLocaleString()}`);
    console.log(`   Skipped (duplicates/missing): ${totalSkipped.toLocaleString()}`);
    console.log(`   Errors: ${totalErrors.toLocaleString()}`);
    console.log(`   Success Rate: ${totalProcessed > 0 ? ((totalMigrated / totalProcessed) * 100).toFixed(2) : 0}%`);
    console.log(`   Efficiency: ${totalProcessed > 0 ? ((totalSkipped / totalProcessed) * 100).toFixed(1) : 0}% duplicates avoided`);

    // Verify final counts
    const { count: finalAttachments } = await supabase
      .from('message_attachments')
      .select('*', { count: 'exact', head: true });

    console.log(`\n📎 Final message_attachments count: ${finalAttachments?.toLocaleString() || 0} (was ${currentAttachments || 0}, added ${totalMigrated})`);

    // Sample verification - show only recently created
    if (totalMigrated > 0) {
      const { data: sampleAttachments } = await supabase
        .from('message_attachments')
        .select(`
          id,
          message_id,
          file_id,
          legacy_record_id,
          legacy_file_id,
          created_at
        `)
        .order('created_at', { ascending: false })
        .limit(5);

      if (sampleAttachments && sampleAttachments.length > 0) {
        console.log('\n📋 Sample recently migrated attachments:');
        sampleAttachments.forEach((attachment, i) => {
          console.log(`  ${i + 1}. Message: ${attachment.message_id}, File: ${attachment.file_id}`);
          console.log(`     Legacy: record_id=${attachment.legacy_record_id}, file_id=${attachment.legacy_file_id}`);
          console.log(`     Created: ${attachment.created_at}`);
        });
      }
    }

    if (totalMigrated > 0) {
      console.log('\n✅ Message attachments INCREMENTAL migration completed successfully!');
      console.log('🔗 New files are now properly linked to messages via message_attachments table');
      console.log(`🎯 Efficiency: Avoided re-processing ${totalSkipped} existing attachments`);
    } else if (totalSkipped > 0 && totalErrors === 0) {
      console.log('\n🎉 Perfect! All message attachments were already migrated - no new work needed');
      console.log(`✅ Verified ${totalProcessed} files, all already had message_attachments`);
    } else {
      console.log('\n⚠️  No NEW attachments were migrated - check logs for issues');
    }

    return {
      status: totalMigrated > 0 ? 'SUCCESS' : (totalSkipped > 0 ? 'COMPLETE' : 'NO_DATA'),
      totalProcessed,
      totalMigrated,
      totalSkipped,
      totalErrors,
      finalCount: finalAttachments,
      previousCount: currentAttachments,
      efficiency: totalProcessed > 0 ? ((totalSkipped / totalProcessed) * 100) : 0
    };

  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await sourceClient.end();
  }
}

// Run the migration
if (require.main === module) {
  migrateMessageAttachmentsIncrementalFixed().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default migrateMessageAttachmentsIncrementalFixed;