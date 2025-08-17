import { Client as PgClient } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function examineSchemas() {
  console.log('🔍 Examining dispatch_note and doctor_notes schemas...\n');

  // Connect to source database
  const sourceDb = new PgClient({
    host: process.env.SOURCE_DB_HOST!,
    port: parseInt(process.env.SOURCE_DB_PORT!),
    user: process.env.SOURCE_DB_USER!,
    password: process.env.SOURCE_DB_PASSWORD!,
    database: process.env.SOURCE_DB_NAME!,
  });

  // Connect to target database
  const targetDb = new PgClient({
    host: process.env.TARGET_DB_HOST || 'localhost',
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    user: process.env.TARGET_DB_USER || 'postgres',
    password: process.env.TARGET_DB_PASSWORD!,
    database: process.env.TARGET_DB_NAME || 'postgres',
  });

  try {
    await sourceDb.connect();
    await targetDb.connect();
    
    // 1. Examine source dispatch_note table
    console.log('📋 SOURCE: dispatch_note table schema:');
    const sourceSchema = await sourceDb.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'dispatch_note'
      ORDER BY ordinal_position;
    `);
    
    if (sourceSchema.rows.length > 0) {
      sourceSchema.rows.forEach(row => {
        console.log(`   ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
      });
      
      // Get sample data
      const sampleData = await sourceDb.query(`
        SELECT * FROM dispatch_note 
        WHERE text IS NOT NULL AND TRIM(text) != ''
        ORDER BY created_at 
        LIMIT 3
      `);
      
      console.log(`\n📊 Sample dispatch_note data (${sampleData.rows.length} records shown):`);
      sampleData.rows.forEach((row, index) => {
        console.log(`   ${index + 1}. ID: ${row.id}, Patient ID: ${row.patient_id}, Doctor ID: ${row.doctor_id}`);
        console.log(`      Text: "${row.text?.substring(0, 60)}${row.text?.length > 60 ? '...' : ''}"`);
        console.log(`      Created: ${row.created_at}`);
      });
      
      // Count total records
      const totalCount = await sourceDb.query('SELECT COUNT(*) as count FROM dispatch_note WHERE text IS NOT NULL AND TRIM(text) != \'\'');
      console.log(`\n📈 Total dispatch_note records with content: ${totalCount.rows[0].count}`);
    } else {
      console.log('   ❌ dispatch_note table not found');
    }
    
    // 2. Check if doctor_notes table exists in target
    console.log('\n📋 TARGET: doctor_notes table schema:');
    const targetTableCheck = await targetDb.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'doctor_notes'
      );
    `);
    
    if (targetTableCheck.rows[0].exists) {
      const targetSchema = await targetDb.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_name = 'doctor_notes'
        ORDER BY ordinal_position;
      `);
      
      targetSchema.rows.forEach(row => {
        console.log(`   ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
      });
      
      const targetCount = await targetDb.query('SELECT COUNT(*) as count FROM doctor_notes');
      console.log(`\n📈 Current doctor_notes records: ${targetCount.rows[0].count}`);
    } else {
      console.log('   ❌ doctor_notes table does not exist - needs to be created');
    }
    
    // 3. Check comments table enum values
    console.log('\n🏷️  Available comment_type enum values:');
    const enumValues = await targetDb.query(`
      SELECT unnest(enum_range(NULL::comment_type)) as comment_type;
    `);
    
    enumValues.rows.forEach(row => {
      console.log(`   - ${row.comment_type}`);
    });
    
  } catch (error) {
    console.error('❌ Error examining schemas:', error);
  } finally {
    await sourceDb.end();
    await targetDb.end();
  }
}

examineSchemas().catch(console.error);
