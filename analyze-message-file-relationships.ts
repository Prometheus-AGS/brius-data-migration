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

async function analyzeMessageFileRelationships() {
  try {
    await sourceClient.connect();
    
    console.log('=== Analyzing Files with record_id (potential message attachments) ===\n');
    
    // Check files with record_id
    const filesWithRecords = await sourceClient.query(`
      SELECT COUNT(*) as count 
      FROM dispatch_file 
      WHERE record_id IS NOT NULL
    `);
    
    console.log(`📁 Files with record_id: ${parseInt(filesWithRecords.rows[0].count).toLocaleString()}`);
    
    if (parseInt(filesWithRecords.rows[0].count) === 0) {
      console.log('✅ No files have record_id set - no message attachments to migrate');
      return;
    }
    
    // Sample files with record_id
    const sampleFilesWithRecords = await sourceClient.query(`
      SELECT f.id, f.uid, f.name, f.record_id, f.instruction_id, f.created_at,
             r.id as message_exists
      FROM dispatch_file f
      LEFT JOIN dispatch_record r ON f.record_id = r.id
      WHERE f.record_id IS NOT NULL
      ORDER BY f.created_at DESC
      LIMIT 10
    `);
    
    console.log('\nSample files with record_id:');
    sampleFilesWithRecords.rows.forEach((file, i) => {
      console.log(`\n  ${i + 1}. File ID: ${file.id} (${file.name})`);
      console.log(`     record_id: ${file.record_id} ${file.message_exists ? '(message exists)' : '(message missing)'}`);
      console.log(`     instruction_id: ${file.instruction_id || 'null'}`);
      console.log(`     created_at: ${file.created_at}`);
    });
    
    // Check record_id ranges and overlaps
    const recordIdAnalysis = await sourceClient.query(`
      SELECT 
        MIN(record_id) as min_record_id,
        MAX(record_id) as max_record_id,
        COUNT(DISTINCT record_id) as unique_record_ids,
        COUNT(*) as total_files
      FROM dispatch_file 
      WHERE record_id IS NOT NULL
    `);
    
    console.log('\nRecord ID Analysis:');
    const analysis = recordIdAnalysis.rows[0];
    console.log(`  Min record_id: ${analysis.min_record_id}`);
    console.log(`  Max record_id: ${analysis.max_record_id}`);
    console.log(`  Unique record IDs: ${parseInt(analysis.unique_record_ids).toLocaleString()}`);
    console.log(`  Total files with record_id: ${parseInt(analysis.total_files).toLocaleString()}`);
    
    // Check how many of these record_ids exist in dispatch_record
    const recordsExist = await sourceClient.query(`
      SELECT COUNT(DISTINCT f.record_id) as existing_records
      FROM dispatch_file f
      INNER JOIN dispatch_record r ON f.record_id = r.id
      WHERE f.record_id IS NOT NULL
    `);
    
    console.log(`  Record IDs that exist in dispatch_record: ${parseInt(recordsExist.rows[0].existing_records).toLocaleString()}`);
    
    // Check files per record distribution
    const filesPerRecord = await sourceClient.query(`
      SELECT 
        record_id,
        COUNT(*) as file_count
      FROM dispatch_file 
      WHERE record_id IS NOT NULL
      GROUP BY record_id
      ORDER BY file_count DESC
      LIMIT 10
    `);
    
    console.log('\nRecords with most files:');
    filesPerRecord.rows.forEach((record, i) => {
      console.log(`  ${i + 1}. Record ${record.record_id}: ${record.file_count} files`);
    });
    
    // Check if these files also have instruction_id (both message and order attachment)
    const dualAttachments = await sourceClient.query(`
      SELECT COUNT(*) as count
      FROM dispatch_file
      WHERE record_id IS NOT NULL AND instruction_id IS NOT NULL
    `);
    
    console.log(`\nFiles with both record_id AND instruction_id: ${parseInt(dualAttachments.rows[0].count).toLocaleString()}`);
    
    // Check migration potential - files with record_id that map to migrated messages
    console.log('\n=== Migration Potential Analysis ===');
    
    const migrationCheck = await sourceClient.query(`
      SELECT 
        COUNT(*) as total_files_with_record_id,
        COUNT(CASE WHEN r.id IS NOT NULL THEN 1 END) as files_with_valid_records
      FROM dispatch_file f
      LEFT JOIN dispatch_record r ON f.record_id = r.id
      WHERE f.record_id IS NOT NULL
    `);
    
    const migrationData = migrationCheck.rows[0];
    console.log(`Files with record_id: ${parseInt(migrationData.total_files_with_record_id).toLocaleString()}`);
    console.log(`Files with valid dispatch_record: ${parseInt(migrationData.files_with_valid_records).toLocaleString()}`);
    
    // Check how many of these records were migrated to messages
    const { count: migratedMessages } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .not('legacy_record_id', 'is', null);
    
    console.log(`Messages migrated with legacy_record_id: ${migratedMessages?.toLocaleString() || 0}`);
    
    if (parseInt(migrationData.files_with_valid_records) > 0) {
      console.log('\n🚀 MIGRATION NEEDED:');
      console.log(`   - ${migrationData.files_with_valid_records} files need to be linked to messages`);
      console.log(`   - These files have record_id pointing to dispatch_record`);
      console.log(`   - dispatch_record was migrated to messages table`);
      console.log(`   - Need to populate message_attachments table`);
    } else {
      console.log('\n✅ No message attachment migration needed');
    }
    
  } catch (error) {
    console.error('Error analyzing message-file relationships:', error);
  } finally {
    await sourceClient.end();
  }
}

analyzeMessageFileRelationships().catch(console.error);
