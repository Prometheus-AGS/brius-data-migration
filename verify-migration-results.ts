import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function verifyMigrationResults() {
  const targetDb = new Client({
    host: process.env.TARGET_DB_HOST || 'localhost',
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    user: process.env.TARGET_DB_USER || 'postgres',
    password: process.env.TARGET_DB_PASSWORD!,
    database: process.env.TARGET_DB_NAME || 'postgres'
  });

  try {
    await targetDb.connect();
    
    console.log('📊 Migration Results Verification\n');
    
    // Check comments table
    const commentsCount = await targetDb.query(`
      SELECT COUNT(*) as count FROM comments 
      WHERE legacy_table = 'dispatch_comment'
    `);
    console.log(`💬 Comments migrated: ${commentsCount.rows[0].count}`);
    
    // Check treatment_discussions table  
    const discussionsCount = await targetDb.query(`
      SELECT COUNT(*) as count FROM treatment_discussions 
      WHERE comment_id IS NOT NULL
    `);
    console.log(`🔗 Treatment discussions created: ${discussionsCount.rows[0].count}`);
    
    // Check data consistency
    const consistencyCheck = await targetDb.query(`
      SELECT 
        COUNT(CASE WHEN td.comment_id IS NOT NULL THEN 1 END) as linked_discussions,
        COUNT(c.id) as total_migrated_comments
      FROM comments c 
      LEFT JOIN treatment_discussions td ON td.comment_id = c.id
      WHERE c.legacy_table = 'dispatch_comment'
    `);
    
    console.log(`📋 Data consistency check:`);
    console.log(`   - Total migrated comments: ${consistencyCheck.rows[0].total_migrated_comments}`);
    console.log(`   - Linked treatment discussions: ${consistencyCheck.rows[0].linked_discussions}`);
    
    // Check comment types
    const commentTypes = await targetDb.query(`
      SELECT comment_type, COUNT(*) as count 
      FROM comments 
      WHERE legacy_table = 'dispatch_comment'
      GROUP BY comment_type
    `);
    
    console.log(`\n🏷️  Comment types:`);
    commentTypes.rows.forEach(row => {
      console.log(`   - ${row.comment_type}: ${row.count}`);
    });
    
    // Check authors
    const authorStats = await targetDb.query(`
      SELECT 
        COUNT(CASE WHEN author_id IS NOT NULL THEN 1 END) as with_author,
        COUNT(CASE WHEN author_id IS NULL THEN 1 END) as without_author
      FROM comments 
      WHERE legacy_table = 'dispatch_comment'
    `);
    
    console.log(`\n👤 Author mapping results:`);
    console.log(`   - Comments with author: ${authorStats.rows[0].with_author}`);
    console.log(`   - Comments without author: ${authorStats.rows[0].without_author}`);
    
    // Sample of migrated data
    const sample = await targetDb.query(`
      SELECT 
        c.id as comment_id,
        c.content,
        c.author_id,
        c.created_at,
        c.legacy_id,
        td.treatment_id,
        td.is_visible_to_patient
      FROM comments c
      JOIN treatment_discussions td ON td.comment_id = c.id
      WHERE c.legacy_table = 'dispatch_comment'
      ORDER BY c.created_at
      LIMIT 3
    `);
    
    console.log(`\n🔍 Sample migrated data:`);
    sample.rows.forEach((row, index) => {
      console.log(`   ${index + 1}. Comment ID: ${row.comment_id}`);
      console.log(`      Content: "${row.content.substring(0, 50)}${row.content.length > 50 ? '...' : ''}"`);
      console.log(`      Author ID: ${row.author_id || 'null'}`);
      console.log(`      Treatment ID: ${row.treatment_id}`);
      console.log(`      Legacy ID: ${row.legacy_id}`);
      console.log('');
    });
    
  } finally {
    await targetDb.end();
  }
}

verifyMigrationResults().catch(console.error);
