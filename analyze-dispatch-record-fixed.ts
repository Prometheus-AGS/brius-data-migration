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
    
    // Display the schema we found
    console.log('📋 dispatch_record table schema:');
    console.log('   id: integer (nullable: NO)');
    console.log('   target_id: integer (nullable: NO)');
    console.log('   type: integer (nullable: YES)');
    console.log('   created_at: timestamp with time zone (nullable: NO)');
    console.log('   text: text (nullable: NO)');
    console.log('   author_id: integer (nullable: YES)');
    console.log('   target_type_id: integer (nullable: YES) <- Django content type');
    console.log('   group_id: integer (nullable: YES)');
    console.log('   public: boolean (nullable: YES)');
    
    // Get total count
    const totalCount = await sourceDb.query('SELECT COUNT(*) as count FROM dispatch_record');
    console.log(`\n📈 Total dispatch_record entries: ${totalCount.rows[0].count}`);
    
    // Get all unique target_type_id values (Django content types)
    console.log('\n🏷️  Target content types used in dispatch_record:');
    const contentTypes = await sourceDb.query(`
      SELECT 
        dr.target_type_id,
        ct.app_label,
        ct.model,
        COUNT(*) as record_count
      FROM dispatch_record dr
      LEFT JOIN django_content_type ct ON dr.target_type_id = ct.id
      GROUP BY dr.target_type_id, ct.app_label, ct.model
      ORDER BY record_count DESC;
    `);
    
    let totalRecordsWithTargetType = 0;
    contentTypes.rows.forEach((row, index) => {
      console.log(`   ${index + 1}. Target Type ID: ${row.target_type_id || 'NULL'}`);
      console.log(`      App: ${row.app_label || 'N/A'}, Model: ${row.model || 'N/A'}`);
      console.log(`      Records: ${row.record_count}`);
      console.log('');
      totalRecordsWithTargetType += parseInt(row.record_count);
    });
    
    console.log(`📊 Total records with target type info: ${totalRecordsWithTargetType}`);
    
    // Also check the 'type' field which might be relevant
    console.log('\n🔢 Values in the "type" field:');
    const typeValues = await sourceDb.query(`
      SELECT type, COUNT(*) as count
      FROM dispatch_record
      GROUP BY type
      ORDER BY count DESC;
    `);
    
    typeValues.rows.forEach(row => {
      console.log(`   Type ${row.type || 'NULL'}: ${row.count} records`);
    });
    
    // Show sample data for each target content type (top 5)
    console.log('\n🔍 Sample data for each target content type (top 5):');
    
    for (const contentType of contentTypes.rows.slice(0, 5)) {
      if (contentType.target_type_id) {
        console.log(`\n--- Target Type: ${contentType.app_label}.${contentType.model} (ID: ${contentType.target_type_id}) ---`);
        
        const samples = await sourceDb.query(`
          SELECT *
          FROM dispatch_record 
          WHERE target_type_id = $1
          ORDER BY created_at
          LIMIT 2;
        `, [contentType.target_type_id]);
        
        samples.rows.forEach((row, index) => {
          console.log(`   Sample ${index + 1}:`);
          console.log(`     ID: ${row.id}, Target ID: ${row.target_id}, Type: ${row.type}`);
          console.log(`     Created: ${row.created_at}, Author: ${row.author_id || 'N/A'}`);
          console.log(`     Public: ${row.public}, Group ID: ${row.group_id || 'N/A'}`);
          const textPreview = row.text.substring(0, 80);
          console.log(`     Text: "${textPreview}${row.text.length > 80 ? '...' : ''}"`);
        });
      }
    }
    
    // Check if there are records without target_type_id
    const noTargetType = await sourceDb.query(`
      SELECT COUNT(*) as count 
      FROM dispatch_record 
      WHERE target_type_id IS NULL;
    `);
    
    if (parseInt(noTargetType.rows[0].count) > 0) {
      console.log(`\n⚠️  Records without target_type_id: ${noTargetType.rows[0].count}`);
    }
    
    // Show the django_content_type table for the content types actually used
    console.log('\n📚 Django content types used as targets in dispatch_record:');
    const usedContentTypes = await sourceDb.query(`
      SELECT DISTINCT ct.id, ct.app_label, ct.model
      FROM dispatch_record dr
      JOIN django_content_type ct ON dr.target_type_id = ct.id
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
