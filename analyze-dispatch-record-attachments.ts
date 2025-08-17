import { Client } from 'pg';

const sourceClient = new Client({
  host: 'test.brius.com',
  port: 5432,
  database: 'mdw_db',
  user: 'mdw_ai',
  password: 'xGXmckHY',
});

async function analyzeDispatchRecordAttachments() {
  try {
    await sourceClient.connect();
    console.log('Connected to source database');
    
    // Get table schema
    const schemaResult = await sourceClient.query(`
      SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'dispatch_record_attachments' 
      ORDER BY ordinal_position;
    `);
    
    console.log('\n=== dispatch_record_attachments Schema ===');
    schemaResult.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
    });
    
    // Get total count
    const countResult = await sourceClient.query('SELECT COUNT(*) as total FROM dispatch_record_attachments');
    console.log(`\nTotal dispatch_record_attachments: ${countResult.rows[0].total}`);
    
    // Get sample records
    const sampleResult = await sourceClient.query(`
      SELECT * FROM dispatch_record_attachments 
      ORDER BY RANDOM() 
      LIMIT 5;
    `);
    
    console.log('\n=== Sample Records ===');
    sampleResult.rows.forEach((row, i) => {
      console.log(`\nSample ${i + 1}:`);
      Object.keys(row).forEach(key => {
        console.log(`  ${key}: ${row[key]}`);
      });
    });
    
    // Check relationships
    console.log('\n=== Relationship Analysis ===');
    
    // Check dispatch_record relationships
    const recordRelation = await sourceClient.query(`
      SELECT 
        COUNT(*) as total_attachments,
        COUNT(DISTINCT dispatchrecord_id) as unique_records,
        MIN(dispatchrecord_id) as min_record_id,
        MAX(dispatchrecord_id) as max_record_id
      FROM dispatch_record_attachments;
    `);
    
    console.log('Record relationships:');
    console.log(`  Total attachments: ${recordRelation.rows[0].total_attachments}`);
    console.log(`  Unique records with attachments: ${recordRelation.rows[0].unique_records}`);
    console.log(`  Record ID range: ${recordRelation.rows[0].min_record_id} - ${recordRelation.rows[0].max_record_id}`);
    
    // Check file relationships  
    const fileRelation = await sourceClient.query(`
      SELECT 
        COUNT(*) as total_attachments,
        COUNT(DISTINCT file_id) as unique_files,
        MIN(file_id) as min_file_id,
        MAX(file_id) as max_file_id
      FROM dispatch_record_attachments;
    `);
    
    console.log('File relationships:');
    console.log(`  Total attachments: ${fileRelation.rows[0].total_attachments}`);
    console.log(`  Unique files attached: ${fileRelation.rows[0].unique_files}`);
    console.log(`  File ID range: ${fileRelation.rows[0].min_file_id} - ${fileRelation.rows[0].max_file_id}`);
    
    // Check for files with multiple attachments
    const duplicateFiles = await sourceClient.query(`
      SELECT file_id, COUNT(*) as attachment_count
      FROM dispatch_record_attachments
      GROUP BY file_id
      HAVING COUNT(*) > 1
      ORDER BY attachment_count DESC
      LIMIT 5;
    `);
    
    if (duplicateFiles.rows.length > 0) {
      console.log('\nFiles with multiple attachments:');
      duplicateFiles.rows.forEach(row => {
        console.log(`  File ${row.file_id}: ${row.attachment_count} attachments`);
      });
    }
    
    // Check date patterns
    const dateAnalysis = await sourceClient.query(`
      SELECT 
        MIN(created_at) as earliest,
        MAX(created_at) as latest,
        COUNT(*) as total
      FROM dispatch_record_attachments;
    `);
    
    console.log('\nDate range:');
    console.log(`  Earliest: ${dateAnalysis.rows[0].earliest}`);
    console.log(`  Latest: ${dateAnalysis.rows[0].latest}`);
    
  } catch (error) {
    console.error('Error analyzing dispatch_record_attachments:', error);
  } finally {
    await sourceClient.end();
  }
}

analyzeDispatchRecordAttachments().catch(console.error);
