import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function fixTreatmentDiscussionsSchema() {
  const targetDb = new Client({
    host: process.env.TARGET_DB_HOST || 'localhost',
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    user: process.env.TARGET_DB_USER || 'postgres',
    password: process.env.TARGET_DB_PASSWORD!,
    database: process.env.TARGET_DB_NAME || 'postgres'
  });

  try {
    await targetDb.connect();
    
    console.log('🔧 Fixing treatment_discussions schema...');
    
    // First, check if there's any existing data
    const existingCount = await targetDb.query('SELECT COUNT(*) as count FROM treatment_discussions');
    console.log(`   Current treatment_discussions records: ${existingCount.rows[0].count}`);
    
    if (parseInt(existingCount.rows[0].count) > 0) {
      console.log('⚠️  WARNING: There are existing records in treatment_discussions');
      console.log('   Please backup the data before proceeding with schema changes');
      return;
    }
    
    // Add comment_id column as foreign key to comments table
    console.log('   Adding comment_id column...');
    await targetDb.query(`
      ALTER TABLE treatment_discussions 
      ADD COLUMN comment_id UUID REFERENCES comments(id) ON DELETE CASCADE
    `);
    
    // Since we're now using comments table for content, we can make some fields optional
    // or remove them entirely. Let's make content nullable first
    console.log('   Making content column nullable (will be redundant)...');
    await targetDb.query(`
      ALTER TABLE treatment_discussions 
      ALTER COLUMN content DROP NOT NULL
    `);
    
    // Make author_id nullable since it will come from comments table
    console.log('   Making author_id nullable (will come from comments)...');
    await targetDb.query(`
      ALTER TABLE treatment_discussions 
      ALTER COLUMN author_id DROP NOT NULL
    `);
    
    // Make author_role nullable 
    console.log('   Making author_role nullable...');
    await targetDb.query(`
      ALTER TABLE treatment_discussions 
      ALTER COLUMN author_role DROP NOT NULL
    `);
    
    console.log('✅ Schema changes completed!');
    console.log('   Next steps:');
    console.log('   1. Migrate comments to comments table with comment_type = "treatment_discussion"');
    console.log('   2. Link treatment_discussions to comments via comment_id');
    console.log('   3. Eventually remove redundant fields (content, author_id, author_role) from treatment_discussions');
    
  } catch (error) {
    console.error('❌ Schema fix failed:', error);
  } finally {
    await targetDb.end();
  }
}

fixTreatmentDiscussionsSchema().catch(console.error);
