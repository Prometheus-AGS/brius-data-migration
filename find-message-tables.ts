import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function findMessageTables() {
  const targetDb = new Client({
    host: process.env.TARGET_DB_HOST || 'localhost',
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    user: process.env.TARGET_DB_USER || 'postgres',
    password: process.env.TARGET_DB_PASSWORD!,
    database: process.env.TARGET_DB_NAME || 'postgres'
  });

  try {
    await targetDb.connect();
    
    console.log('🔍 Finding message-related tables in target database...\n');
    
    // Find all tables with message/communication/notification in name
    const messageRelatedTables = await targetDb.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND (
        table_name LIKE '%message%' OR 
        table_name LIKE '%communication%' OR 
        table_name LIKE '%notification%' OR
        table_name LIKE '%chat%' OR
        table_name LIKE '%conversation%'
      )
      ORDER BY table_name;
    `);
    
    if (messageRelatedTables.rows.length > 0) {
      console.log('📋 Message-related tables found:');
      
      for (const table of messageRelatedTables.rows) {
        console.log(`\n--- ${table.table_name} ---`);
        
        // Get schema for each table
        const schema = await targetDb.query(`
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns 
          WHERE table_name = $1
          ORDER BY ordinal_position;
        `, [table.table_name]);
        
        schema.rows.forEach(row => {
          console.log(`   ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
        });
        
        // Try to get record count safely
        try {
          const count = await targetDb.query(`SELECT COUNT(*) as count FROM "${table.table_name}"`);
          console.log(`   Records: ${count.rows[0].count}`);
        } catch (error) {
          console.log(`   Records: Could not query (${(error as any).message})`);
        }
      }
    } else {
      console.log('❌ No message-related tables found');
    }
    
    // Also check for any table that might be suitable for messages
    console.log('\n🔍 Checking for other potential message tables...');
    
    const allTables = await targetDb.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    
    console.log(`\n📊 Total tables in target database: ${allTables.rows.length}`);
    console.log('Sample of available tables:');
    allTables.rows.slice(0, 20).forEach(row => {
      console.log(`   - ${row.table_name}`);
    });
    
  } finally {
    await targetDb.end();
  }
}

findMessageTables().catch(console.error);
