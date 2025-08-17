import { Client as PgClient } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function analyzeDispatchRecord() {
  console.log('🔍 Analyzing dispatch_record table and Django content types...\n');

  const sourceDb = new PgClient({
    host: process.env.SOURCE_DB_HOST!,
    port: parseInt(process.env.SOURCE_DB_PORT!),
    user: process.env.SOURCE_DB_USER!,
    password: process.env.SOURCE_DB_PASSWORD!,
    database: process.env.SOURCE_DB_NAME!,
  });

  try {
    await sourceDb.connect();
    
    // 1. First, examine the dispatch_record table schema
    console.log('📋 dispatch_record table schema:');
    const schema = await sourceDb.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'dispatch_record'
      ORDER BY ordinal_position;
    `);
    
    schema.rows.forEach(row => {
      console.log(`   ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
    });
    
    // 2. Get total count
    const totalCount = await sourceDb.query('SELECT COUNT(*) as count FROM dispatch_record');
    console.log(`\n📈 Total dispatch_record entries: ${totalCount.rows[0].count}`);
    
    // 3. Get all unique content types used in dispatch_record
    console.log('\n🏷️  Content types used in dispatch_record:');
    const contentTypes = await sourceDb.query(`
      SELECT 
        dr.content_type_id,
        ct.app_label,
        ct.model,
        COUNT(*) as record_count
      FROM dispatch_record dr
      LEFT JOIN django_content_type ct ON dr.content_type_id = ct.id
      GROUP BY dr.content_type_id, ct.app_label, ct.model
      ORDER BY record_count DESC;
    `);
    
    let totalRecordsWithContentType = 0;
    contentTypes.rows.forEach((row, index) => {
      console.log(`   ${index + 1}. Content Type ID: ${row.content_type_id || 'NULL'}`);
      console.log(`      App: ${row.app_label || 'N/A'}, Model: ${row.model || 'N/A'}`);
      console.log(`      Records: ${row.record_count}`);
      console.log('');
      totalRecordsWithContentType += parseInt(row.record_count);
    });
    
    console.log(`📊 Total records with content type info: ${totalRecordsWithContentType}`);
    
    // 4. Show sample data for each content type
    console.log('\n🔍 Sample data for each content type:');
    
    for (const contentType of contentTypes.rows.slice(0, 5)) { // Limit to top 5 to avoid too much output
      if (contentType.content_type_id) {
        console.log(`\n--- Content Type: ${contentType.app_label}.${contentType.model} (ID: ${contentType.content_type_id}) ---`);
        
        const samples = await sourceDb.query(`
          SELECT *
          FROM dispatch_record 
          WHERE content_type_id = $1
          ORDER BY created_at
          LIMIT 2;
        `, [contentType.content_type_id]);
        
        samples.rows.forEach((row, index) => {
          console.log(`   Sample ${index + 1}:`);
          console.log(`     ID: ${row.id}, Object ID: ${row.object_id}`);
          console.log(`     Created: ${row.created_at}`);
          console.log(`     Status: ${row.status || 'N/A'}, Action: ${row.action || 'N/A'}`);
          if (row.data) {
            const dataPreview = JSON.stringify(row.data).substring(0, 100);
            console.log(`     Data: ${dataPreview}${JSON.stringify(row.data).length > 100 ? '...' : ''}`);
          }
          // Show all available fields
          console.log(`     Available fields: ${Object.keys(row).join(', ')}`);
        });
      }
    }
    
    // 5. Check if there are records without content_type_id
    const noContentType = await sourceDb.query(`
      SELECT COUNT(*) as count 
      FROM dispatch_record 
      WHERE content_type_id IS NULL;
    `);
    
    if (parseInt(noContentType.rows[0].count) > 0) {
      console.log(`\n⚠️  Records without content_type_id: ${noContentType.rows[0].count}`);
    }
    
    // 6. Show the django_content_type table for the content types actually used
    console.log('\n📚 Django content types used in dispatch_record:');
    const usedContentTypes = await sourceDb.query(`
      SELECT DISTINCT ct.id, ct.app_label, ct.model
      FROM dispatch_record dr
      JOIN django_content_type ct ON dr.content_type_id = ct.id
      ORDER BY ct.app_label, ct.model;
    `);
    
    usedContentTypes.rows.forEach(row => {
      console.log(`   ID ${row.id}: ${row.app_label}.${row.model}`);
    });
    
  } catch (error) {
    console.error('❌ Analysis failed:', error);
  } finally {
    await sourceDb.end();
  }
}

analyzeDispatchRecord().catch(console.error);
