import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function analyzeTargetMessageOptions() {
  const targetDb = new Client({
    host: process.env.TARGET_DB_HOST || 'localhost',
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    user: process.env.TARGET_DB_USER || 'postgres',
    password: process.env.TARGET_DB_PASSWORD!,
    database: process.env.TARGET_DB_NAME || 'postgres'
  });

  try {
    await targetDb.connect();
    
    console.log('🔍 Analyzing target message table options for central migration...\n');
    
    // The messages table we found earlier has this schema:
    console.log('📋 "messages" table schema:');
    console.log('   topic: text (nullable: NO)');
    console.log('   extension: text (nullable: NO)'); 
    console.log('   payload: jsonb (nullable: YES)');
    console.log('   event: text (nullable: YES)');
    console.log('   private: boolean (nullable: YES)');
    console.log('   updated_at: timestamp without time zone (nullable: NO)');
    console.log('   inserted_at: timestamp without time zone (nullable: NO)');
    console.log('   id: uuid (nullable: NO)');
    console.log('   → This looks like system/event messages, not user messages\n');
    
    // Check if we should use comments table instead (which follows our established pattern)
    console.log('📋 "comments" table schema (our established pattern):');
    const commentsSchema = await targetDb.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'comments'
      ORDER BY ordinal_position;
    `);
    
    commentsSchema.rows.forEach(row => {
      console.log(`   ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
    });
    
    const commentsCount = await targetDb.query('SELECT COUNT(*) as count FROM comments');
    console.log(`   → Current records: ${commentsCount.rows[0].count}\n`);
    
    // Check comment_type enum values to see if we can add 'message' type
    console.log('🏷️  Testing if we can add "message" as a comment_type...');
    try {
      await targetDb.query('BEGIN');
      await targetDb.query(`
        INSERT INTO comments (id, content, comment_type, created_at, updated_at) 
        VALUES (gen_random_uuid(), 'test', 'message', NOW(), NOW())
      `);
      await targetDb.query('ROLLBACK');
      console.log('✅ "message" is a valid comment_type');
    } catch (error) {
      await targetDb.query('ROLLBACK');
      console.log(`❌ "message" test failed: ${(error as any).message}`);
      console.log('   → May need to add "message" to the comment_type enum\n');
    }
    
    // Check if there are other suitable tables
    console.log('📊 Summary of message-related table options:');
    console.log('   1. messages - System events table (topic/payload based)');
    console.log('   2. comments - User content table (our established pattern)');  
    console.log('   3. clinical_communications - Specialized clinical messages');
    console.log('   4. case_messages - Case-specific messages');
    console.log('   5. team_communications - Team-specific messages');
    
    console.log('\n💡 Recommendation:');
    console.log('   Use COMMENTS table as central repository with comment_type="message"');
    console.log('   Then create associations in specialized tables');
    console.log('   This follows the established pattern from treatment_discussions/doctor_notes');
    
  } finally {
    await targetDb.end();
  }
}

analyzeTargetMessageOptions().catch(console.error);
