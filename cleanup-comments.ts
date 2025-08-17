import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function cleanup() {
  const targetDb = new Client({
    host: process.env.TARGET_DB_HOST || 'localhost',
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    user: process.env.TARGET_DB_USER || 'postgres',
    password: process.env.TARGET_DB_PASSWORD!,
    database: process.env.TARGET_DB_NAME || 'postgres'
  });

  try {
    await targetDb.connect();
    
    console.log('🧹 Cleaning up previous migration data...');
    
    // Delete from treatment_discussions first (foreign key dependency)
    const discussionResult = await targetDb.query(`
      DELETE FROM treatment_discussions 
      WHERE comment_id IN (
        SELECT id FROM comments 
        WHERE legacy_table = 'dispatch_comment'
      )
    `);
    console.log(`   Deleted ${discussionResult.rowCount} treatment discussion records`);
    
    // Then delete from comments
    const commentResult = await targetDb.query(`
      DELETE FROM comments 
      WHERE legacy_table = 'dispatch_comment'
    `);
    console.log(`   Deleted ${commentResult.rowCount} comment records`);
    
    console.log('✅ Cleanup completed!');
    
  } finally {
    await targetDb.end();
  }
}

cleanup().catch(console.error);
