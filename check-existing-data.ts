import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function checkExistingData() {
  const targetDb = new Client({
    host: process.env.TARGET_DB_HOST || 'localhost',
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    user: process.env.TARGET_DB_USER || 'postgres',
    password: process.env.TARGET_DB_PASSWORD!,
    database: process.env.TARGET_DB_NAME || 'postgres'
  });

  try {
    await targetDb.connect();
    
    // Check comments table
    const commentsCount = await targetDb.query(`
      SELECT COUNT(*) as count FROM comments 
      WHERE legacy_table = 'dispatch_comment'
    `);
    console.log(`Comments from dispatch_comment: ${commentsCount.rows[0].count}`);
    
    // Check treatment_discussions table
    const discussionsCount = await targetDb.query(`
      SELECT COUNT(*) as count FROM treatment_discussions 
      WHERE legacy_comment_id IS NOT NULL
    `);
    console.log(`Treatment discussions with legacy_comment_id: ${discussionsCount.rows[0].count}`);
    
    // Total counts
    const totalComments = await targetDb.query('SELECT COUNT(*) as count FROM comments');
    const totalDiscussions = await targetDb.query('SELECT COUNT(*) as count FROM treatment_discussions');
    
    console.log(`Total comments: ${totalComments.rows[0].count}`);
    console.log(`Total treatment_discussions: ${totalDiscussions.rows[0].count}`);
    
  } finally {
    await targetDb.end();
  }
}

checkExistingData().catch(console.error);
