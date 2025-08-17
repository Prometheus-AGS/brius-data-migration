import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function listCommentTables() {
  const targetDb = new Client({
    host: process.env.TARGET_DB_HOST || 'localhost',
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    user: process.env.TARGET_DB_USER || 'postgres',
    password: process.env.TARGET_DB_PASSWORD!,
    database: process.env.TARGET_DB_NAME || 'postgres'
  });

  try {
    await targetDb.connect();
    
    // Find all tables that might be related to comments
    const tables = await targetDb.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND (table_name LIKE '%comment%' OR table_name LIKE '%discussion%')
      ORDER BY table_name;
    `);
    
    console.log('Comment/Discussion related tables:');
    for (const table of tables.rows) {
      console.log(`\n📋 Table: ${table.table_name}`);
      
      const columns = await targetDb.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_name = $1
        ORDER BY ordinal_position;
      `, [table.table_name]);
      
      columns.rows.forEach(col => {
        console.log(`   ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
      });
    }
    
  } finally {
    await targetDb.end();
  }
}

listCommentTables().catch(console.error);
