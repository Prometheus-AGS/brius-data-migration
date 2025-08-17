import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function checkMessagesTable() {
  const targetDb = new Client({
    host: process.env.TARGET_DB_HOST || 'localhost',
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    user: process.env.TARGET_DB_USER || 'postgres',
    password: process.env.TARGET_DB_PASSWORD!,
    database: process.env.TARGET_DB_NAME || 'postgres'
  });

  try {
    await targetDb.connect();
    
    console.log('🔍 Checking messages table in target database...\n');
    
    // Check if messages table exists
    const tableExists = await targetDb.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'messages'
      );
    `);
    
    if (tableExists.rows[0].exists) {
      console.log('✅ Messages table exists!');
      
      // Get schema
      const schema = await targetDb.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_name = 'messages'
        ORDER BY ordinal_position;
      `);
      
      console.log('\n📋 Messages table schema:');
      schema.rows.forEach(row => {
        console.log(`   ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
      });
      
      // Check current record count
      const count = await targetDb.query('SELECT COUNT(*) as count FROM messages');
      console.log(`\n📊 Current messages count: ${count.rows[0].count}`);
      
    } else {
      console.log('❌ Messages table does not exist');
      
      // Check for similar table names
      const similarTables = await targetDb.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND (table_name LIKE '%message%' OR table_name LIKE '%communication%' OR table_name LIKE '%notification%')
        ORDER BY table_name;
      `);
      
      if (similarTables.rows.length > 0) {
        console.log('\n📋 Similar tables found:');
        similarTables.rows.forEach(row => {
          console.log(`   - ${row.table_name}`);
        });
      } else {
        console.log('\n❌ No message-related tables found');
      }
    }
    
  } finally {
    await targetDb.end();
  }
}

checkMessagesTable().catch(console.error);
