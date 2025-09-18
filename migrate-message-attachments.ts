import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

const sourceClient = new Client({
  host: 'test.brius.com',
  port: 5432,
  database: 'mdw_db',
  user: 'mdw_ai',
  password: 'xGXmckHY',
});

const supabase = createClient(
  'http://localhost:8000', 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
);

async function migrateMessageAttachments() {
  const startTime = Date.now();
  let totalProcessed = 0;
  let totalMigrated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  try {
    await sourceClient.connect();
    
    console.log('=== Starting Message Attachments Migration ===\n');
    
    // First, let's understand what we're working with
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
    
    console.log('Migration Overview:');
    console.log(`  📁 Total files to migrate: ${parseInt(stats.total_files).toLocaleString()}`);
    console.log(`  💬 Unique messages involved: ${parseInt(stats.unique_messages).toLocaleString()}`);
    console.log(`  🔢 Record ID range: ${stats.min_record_id} - ${stats.max_record_id}`);
    
    // Check current state
    const { count: currentAttachments } = await supabase
      .from('message_attachments')
      .select('*', { count: 'exact', head: true });
    
    console.log(`  📎 Current message_attachments: ${currentAttachments || 0}\n`);
    
    // Get the data to migrate in batches
    const batchSize = 100;
    let offset = 0;
    let hasMore = true;
    
    console.log('Starting migration in batches...\n');
    
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
      
      // For each file in the batch, create message attachment
      const attachmentsToInsert = [];
      
      for (const file of batch) {
        totalProcessed++;
        
        try {
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
          
          // Prepare attachment record
          attachmentsToInsert.push({
            message_id: message.id,
            file_id: targetFile.id,
            attachment_type: 'file',
            metadata: {},
            created_at: file.file_created_at,
            legacy_record_id: file.source_record_id,
            legacy_file_id: file.source_file_id
          });
          
        } catch (error) {
          console.error(`  ❌ Error processing file ${file.source_file_id}:`, error.message);
          totalErrors++;
        }
      }
      
      // Insert the batch
      if (attachmentsToInsert.length > 0) {
        try {
          const { data, error } = await supabase
            .from('message_attachments')
            .insert(attachmentsToInsert)
            .select('id');
          
          if (error) {
            console.error(`  ❌ Batch insert error:`, error.message);
            totalErrors += attachmentsToInsert.length;
          } else {
            totalMigrated += attachmentsToInsert.length;
            console.log(`  ✅ Migrated ${attachmentsToInsert.length} attachments`);
          }
        } catch (insertError) {
          console.error(`  ❌ Batch insert exception:`, insertError.message);
          totalErrors += attachmentsToInsert.length;
        }
      }
      
      offset += batchSize;
      
      // Show progress every 10 batches
      if ((offset / batchSize) % 10 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = totalProcessed / elapsed;
        console.log(`\n📊 Progress: ${totalProcessed} processed, ${totalMigrated} migrated, ${totalSkipped} skipped, ${totalErrors} errors`);
        console.log(`⏱️  Rate: ${rate.toFixed(1)} files/second\n`);
      }
    }
    
    // Final results
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    
    console.log('\n=== Migration Complete ===');
    console.log(`⏱️  Duration: ${duration.toFixed(1)} seconds`);
    console.log(`📊 Results:`);
    console.log(`   Processed: ${totalProcessed.toLocaleString()}`);
    console.log(`   Migrated: ${totalMigrated.toLocaleString()}`);
    console.log(`   Skipped: ${totalSkipped.toLocaleString()}`);
    console.log(`   Errors: ${totalErrors.toLocaleString()}`);
    
    // Verify final counts
    const { count: finalAttachments } = await supabase
      .from('message_attachments')
      .select('*', { count: 'exact', head: true });
    
    console.log(`\n📎 Final message_attachments count: ${finalAttachments?.toLocaleString() || 0}`);
    
    // Sample verification
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
      console.log('\n📋 Sample migrated attachments:');
      sampleAttachments.forEach((attachment, i) => {
        console.log(`  ${i + 1}. Message: ${attachment.message_id}, File: ${attachment.file_id}`);
        console.log(`     Legacy: record_id=${attachment.legacy_record_id}, file_id=${attachment.legacy_file_id}`);
        console.log(`     Created: ${attachment.created_at}`);
      });
    }
    
    if (totalMigrated > 0) {
      console.log('\n✅ Message attachments migration completed successfully!');
      console.log('🔗 Files are now properly linked to messages via message_attachments table');
    } else {
      console.log('\n⚠️  No attachments were migrated - check logs for issues');
    }
    
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await sourceClient.end();
  }
}

// Run the migration
if (require.main === module) {
  migrateMessageAttachments().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default migrateMessageAttachments;
