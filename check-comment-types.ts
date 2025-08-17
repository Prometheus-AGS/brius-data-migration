import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function checkCommentTypes() {
  const targetDb = new Client({
    host: process.env.TARGET_DB_HOST || 'localhost',
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    user: process.env.TARGET_DB_USER || 'postgres',
    password: process.env.TARGET_DB_PASSWORD!,
    database: process.env.TARGET_DB_NAME || 'postgres'
  });

  try {
    await targetDb.connect();
    
    // Check what comment types are currently in use
    const existingTypes = await targetDb.query(`
      SELECT DISTINCT comment_type, COUNT(*) as count
      FROM comments 
      GROUP BY comment_type;
    `);
    
    console.log('📋 Existing comment types in use:');
    existingTypes.rows.forEach(row => {
      console.log(`   ${row.comment_type}: ${row.count} records`);
    });
    
    // Try inserting a test doctor_note type to see if it's allowed
    console.log('\n🧪 Testing if "doctor_note" is a valid comment_type...');
    try {
      await targetDb.query('BEGIN');
      await targetDb.query(`
        INSERT INTO comments (id, content, comment_type, created_at, updated_at) 
        VALUES (gen_random_uuid(), 'test', 'doctor_note', NOW(), NOW())
      `);
      await targetDb.query('ROLLBACK');
      console.log('✅ "doctor_note" is a valid comment_type');
    } catch (error) {
      await targetDb.query('ROLLBACK');
      console.log(`❌ "doctor_note" test failed: ${(error as any).message}`);
    }
    
  } finally {
    await targetDb.end();
  }
}

checkCommentTypes().catch(console.error);
