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
    const totalCount = parseInt(countResult.rows[0].total);
    console.log(`\nTotal dispatch_record_attachments: ${totalCount}`);
    
    if (totalCount === 0) {
      console.log('\n✅ No dispatch_record_attachments found in source database.');
      console.log('📋 This means no migration is needed for this table.');
      
      // Check if there are any files that might be related to dispatch_record
      const filesCheck = await sourceClient.query(`
        SELECT COUNT(*) as total FROM dispatch_file 
        WHERE instruction_id IS NOT NULL;
      `);
      
      console.log(`\n📁 Files linked to instructions: ${filesCheck.rows[0].total}`);
      
      // Check if dispatch_record table exists and has any data
      try {
        const recordsCheck = await sourceClient.query('SELECT COUNT(*) as total FROM dispatch_record');
        console.log(`📄 Messages in dispatch_record: ${recordsCheck.rows[0].total}`);
      } catch (err) {
        console.log('📄 Could not check dispatch_record table');
      }
      
      return;
    }
    
    // If there are records, analyze them
    const sampleResult = await sourceClient.query(`
      SELECT * FROM dispatch_record_attachments 
      LIMIT 10;
    `);
    
    console.log('\n=== Sample Records ===');
    sampleResult.rows.forEach((row, i) => {
      console.log(`\nSample ${i + 1}:`);
      Object.keys(row).forEach(key => {
        console.log(`  ${key}: ${row[key]}`);
      });
    });
    
    // Check relationships with corrected column name
    const recordRelation = await sourceClient.query(`
      SELECT 
        COUNT(*) as total_attachments,
        COUNT(DISTINCT record_id) as unique_records,
        MIN(record_id) as min_record_id,
        MAX(record_id) as max_record_id
      FROM dispatch_record_attachments;
    `);
    
    console.log('\n=== Record Relationships ===');
    console.log(`  Total attachments: ${recordRelation.rows[0].total_attachments}`);
    console.log(`  Unique records with attachments: ${recordRelation.rows[0].unique_records}`);
    console.log(`  Record ID range: ${recordRelation.rows[0].min_record_id} - ${recordRelation.rows[0].max_record_id}`);
    
  } catch (error) {
    console.error('Error analyzing dispatch_record_attachments:', error);
  } finally {
    await sourceClient.end();
  }
}

analyzeDispatchRecordAttachments().catch(console.error);
