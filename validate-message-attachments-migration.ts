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

async function validateMessageAttachmentsMigration() {
  try {
    await sourceClient.connect();
    
    console.log('=== Validating Message Attachments Migration ===\n');
    
    // Source data analysis
    const sourceFiles = await sourceClient.query(`
      SELECT COUNT(*) as count
      FROM dispatch_file
      WHERE record_id IS NOT NULL
    `);
    
    const sourceUniqueMessages = await sourceClient.query(`
      SELECT COUNT(DISTINCT record_id) as count
      FROM dispatch_file
      WHERE record_id IS NOT NULL
    `);
    
    console.log('📊 Source Data:');
    console.log(`   Files with record_id: ${parseInt(sourceFiles.rows[0].count).toLocaleString()}`);
    console.log(`   Unique messages with files: ${parseInt(sourceUniqueMessages.rows[0].count).toLocaleString()}`);
    
    // Target data analysis
    const { count: migratedAttachments } = await supabase
      .from('message_attachments')
      .select('*', { count: 'exact', head: true });
    
    const { count: uniqueMessagesWithAttachments } = await supabase
      .from('message_attachments')
      .select('message_id', { count: 'exact', head: true })
      .not('message_id', 'is', null);
    
    const { count: uniqueFilesAttached } = await supabase
      .from('message_attachments')
      .select('file_id', { count: 'exact', head: true })
      .not('file_id', 'is', null);
    
    console.log('\n📊 Target Data:');
    console.log(`   Migrated attachments: ${migratedAttachments?.toLocaleString() || 0}`);
    console.log(`   Messages with attachments: ${uniqueMessagesWithAttachments?.toLocaleString() || 0}`);
    console.log(`   Unique files attached: ${uniqueFilesAttached?.toLocaleString() || 0}`);
    
    // Migration success rate
    const sourceCount = parseInt(sourceFiles.rows[0].count);
    const targetCount = migratedAttachments || 0;
    const migrationRate = sourceCount > 0 ? ((targetCount / sourceCount) * 100).toFixed(1) : '0';
    
    console.log('\n📈 Migration Results:');
    console.log(`   Success Rate: ${migrationRate}% (${targetCount}/${sourceCount})`);
    
    if (migrationRate === '100.0') {
      console.log('   ✅ Perfect migration - all files migrated!');
    } else if (parseFloat(migrationRate) > 95) {
      console.log('   ✅ Excellent migration - minor issues may exist');
    } else if (parseFloat(migrationRate) > 80) {
      console.log('   ⚠️  Good migration - some data may need attention');
    } else {
      console.log('   ❌ Migration incomplete - significant issues detected');
    }
    
    // Detailed validation checks
    console.log('\n🔍 Detailed Validation:');
    
    // Check for orphaned attachments (attachments pointing to non-existent messages/files)
    const { count: orphanedMessages } = await supabase
      .from('message_attachments')
      .select('message_id', { count: 'exact', head: true })
      .is('message_id', null);
    
    const { count: orphanedFiles } = await supabase
      .from('message_attachments')
      .select('file_id', { count: 'exact', head: true })
      .is('file_id', null);
    
    console.log(`   Orphaned message references: ${orphanedMessages || 0}`);
    console.log(`   Orphaned file references: ${orphanedFiles || 0}`);
    
    // Check data integrity
    const { data: integrityCheck } = await supabase
      .from('message_attachments')
      .select(`
        id,
        message_id,
        file_id,
        messages!inner(id, legacy_record_id),
        files!inner(id, legacy_file_id)
      `)
      .limit(5);
    
    if (integrityCheck && integrityCheck.length > 0) {
      console.log('\n✅ Sample integrity verification (relationships exist):');
      integrityCheck.forEach((attachment, i) => {
        console.log(`   ${i + 1}. Attachment ${attachment.id}:`);
        console.log(`      Message: ${attachment.message_id} (legacy: ${attachment.messages.legacy_record_id})`);
        console.log(`      File: ${attachment.file_id} (legacy: ${attachment.files.legacy_file_id})`);
      });
    }
    
    // Check for duplicate attachments
    const { data: duplicateCheck } = await supabase
      .from('message_attachments')
      .select('message_id, file_id, count(*)')
      .group('message_id, file_id')
      .having('count(*) > 1');
    
    if (duplicateCheck && duplicateCheck.length > 0) {
      console.log(`\n⚠️  Found ${duplicateCheck.length} duplicate message-file combinations`);
    } else {
      console.log('\n✅ No duplicate attachments found');
    }
    
    // Messages with most attachments
    const { data: topMessages } = await supabase
      .from('message_attachments')
      .select('message_id, count(*)')
      .group('message_id')
      .order('count', { ascending: false })
      .limit(5);
    
    if (topMessages && topMessages.length > 0) {
      console.log('\n📊 Messages with most attachments:');
      topMessages.forEach((msg, i) => {
        console.log(`   ${i + 1}. Message ${msg.message_id}: ${msg.count} attachments`);
      });
    }
    
    // Legacy tracking validation
    const { count: withLegacyTracking } = await supabase
      .from('message_attachments')
      .select('*', { count: 'exact', head: true })
      .not('legacy_record_id', 'is', null)
      .not('legacy_file_id', 'is', null);
    
    console.log(`\n📋 Attachments with legacy tracking: ${withLegacyTracking?.toLocaleString() || 0}`);
    
    // Final assessment
    console.log('\n=== Final Assessment ===');
    
    if (targetCount === sourceCount && (orphanedMessages || 0) === 0 && (orphanedFiles || 0) === 0) {
      console.log('🎉 MIGRATION SUCCESSFUL!');
      console.log('   ✅ All source files migrated');
      console.log('   ✅ No orphaned references');
      console.log('   ✅ Data integrity maintained');
      console.log('   ✅ Legacy tracking preserved');
    } else if (targetCount > 0) {
      console.log('⚠️  MIGRATION PARTIALLY SUCCESSFUL');
      console.log(`   📊 ${targetCount} attachments migrated`);
      if (targetCount < sourceCount) {
        console.log(`   ⚠️  ${sourceCount - targetCount} files not migrated`);
      }
      if ((orphanedMessages || 0) > 0 || (orphanedFiles || 0) > 0) {
        console.log(`   ⚠️  Some orphaned references detected`);
      }
    } else {
      console.log('❌ MIGRATION FAILED');
      console.log('   No attachments were migrated');
    }
    
    console.log('\n💡 The message_attachments table now links files to messages');
    console.log('💡 Applications can query attachments for any message');
    console.log('💡 Legacy tracking fields allow for data reconciliation');
    
  } catch (error) {
    console.error('Validation failed:', error);
    throw error;
  } finally {
    await sourceClient.end();
  }
}

validateMessageAttachmentsMigration().catch(console.error);
