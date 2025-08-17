import { Client as PgClient } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function investigateContentTypes() {
  console.log('🔍 Investigating Django content types in dispatch_record...\n');

  const sourceDb = new PgClient({
    host: process.env.SOURCE_DB_HOST!,
    port: parseInt(process.env.SOURCE_DB_PORT!),
    user: process.env.SOURCE_DB_USER!,
    password: process.env.SOURCE_DB_PASSWORD!,
    database: process.env.SOURCE_DB_NAME!,
  });

  try {
    await sourceDb.connect();
    
    // 1. Get ALL content types used in dispatch_record with detailed breakdown
    console.log('📋 ALL content types referenced by target_type_id in dispatch_record:');
    const allContentTypes = await sourceDb.query(`
      SELECT 
        dr.target_type_id,
        ct.app_label,
        ct.model,
        COUNT(*) as record_count,
        MIN(dr.created_at) as first_record,
        MAX(dr.created_at) as last_record
      FROM dispatch_record dr
      LEFT JOIN django_content_type ct ON dr.target_type_id = ct.id
      GROUP BY dr.target_type_id, ct.app_label, ct.model
      ORDER BY record_count DESC;
    `);
    
    allContentTypes.rows.forEach((row, index) => {
      console.log(`   ${index + 1}. Content Type ID: ${row.target_type_id || 'NULL'}`);
      console.log(`      App.Model: ${row.app_label || 'N/A'}.${row.model || 'N/A'}`);
      console.log(`      Records: ${row.record_count}`);
      console.log(`      Date Range: ${row.first_record?.toISOString()?.split('T')[0]} to ${row.last_record?.toISOString()?.split('T')[0]}`);
      console.log('');
    });
    
    // 2. Show ALL available Django content types for reference
    console.log('📚 ALL Django content types in the system:');
    const allDjangoTypes = await sourceDb.query(`
      SELECT id, app_label, model
      FROM django_content_type
      ORDER BY app_label, model;
    `);
    
    allDjangoTypes.rows.forEach(row => {
      console.log(`   ID ${row.id}: ${row.app_label}.${row.model}`);
    });
    
    // 3. Cross-reference - which content types exist but are NOT used in dispatch_record?
    console.log('\n❌ Content types that exist but are NOT used in dispatch_record:');
    const unusedTypes = await sourceDb.query(`
      SELECT ct.id, ct.app_label, ct.model
      FROM django_content_type ct
      LEFT JOIN dispatch_record dr ON ct.id = dr.target_type_id
      WHERE dr.target_type_id IS NULL
      ORDER BY ct.app_label, ct.model;
    `);
    
    unusedTypes.rows.forEach(row => {
      console.log(`   ID ${row.id}: ${row.app_label}.${row.model}`);
    });
    
    // 4. Detailed analysis of each content type with samples
    console.log('\n🔍 Detailed analysis of each content type used in dispatch_record:');
    
    for (const contentType of allContentTypes.rows) {
      if (contentType.target_type_id) {
        console.log(`\n=== ${contentType.app_label}.${contentType.model} (ID: ${contentType.target_type_id}) ===`);
        console.log(`Records: ${contentType.record_count}`);
        
        // Show breakdown by 'type' field for this content type
        const typeBreakdown = await sourceDb.query(`
          SELECT type, COUNT(*) as count
          FROM dispatch_record 
          WHERE target_type_id = $1
          GROUP BY type
          ORDER BY count DESC;
        `, [contentType.target_type_id]);
        
        console.log('Type field breakdown:');
        typeBreakdown.rows.forEach(row => {
          console.log(`   Type ${row.type || 'NULL'}: ${row.count} records`);
        });
        
        // Show sample records
        const samples = await sourceDb.query(`
          SELECT id, target_id, type, author_id, text, created_at, public, group_id
          FROM dispatch_record 
          WHERE target_type_id = $1
          ORDER BY created_at
          LIMIT 3;
        `, [contentType.target_type_id]);
        
        console.log('Sample records:');
        samples.rows.forEach((row, index) => {
          console.log(`   ${index + 1}. ID: ${row.id} | Target: ${row.target_id} | Type: ${row.type} | Author: ${row.author_id}`);
          console.log(`      Text: "${row.text.substring(0, 60)}${row.text.length > 60 ? '...' : ''}"`);
          console.log(`      Created: ${row.created_at} | Public: ${row.public} | Group: ${row.group_id}`);
        });
      }
    }
    
  } catch (error) {
    console.error('❌ Investigation failed:', error);
  } finally {
    await sourceDb.end();
  }
}

investigateContentTypes().catch(console.error);
