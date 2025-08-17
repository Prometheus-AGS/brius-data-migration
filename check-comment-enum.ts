import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function checkCommentEnum() {
  const targetDb = new Client({
    host: process.env.TARGET_DB_HOST || 'localhost',
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    user: process.env.TARGET_DB_USER || 'postgres',
    password: process.env.TARGET_DB_PASSWORD!,
    database: process.env.TARGET_DB_NAME || 'postgres'
  });

  try {
    await targetDb.connect();
    
    // Check what enum types exist
    const enumTypes = await targetDb.query(`
      SELECT t.typname as enum_name, 
             array_agg(e.enumlabel ORDER BY e.enumsortorder) as values
      FROM pg_type t 
      JOIN pg_enum e ON t.oid = e.enumtypid  
      WHERE t.typname LIKE '%comment%'
      GROUP BY t.typname;
    `);
    
    console.log('🔍 Comment-related enum types:');
    enumTypes.rows.forEach(row => {
      console.log(`   ${row.enum_name}: [${row.values.join(', ')}]`);
    });
    
    // Check the comments table structure again
    const commentsTable = await targetDb.query(`
      SELECT column_name, data_type, udt_name
      FROM information_schema.columns 
      WHERE table_name = 'comments' AND column_name = 'comment_type'
    `);
    
    console.log('\n📋 Comments table comment_type column:');
    commentsTable.rows.forEach(row => {
      console.log(`   ${row.column_name}: ${row.data_type} (${row.udt_name})`);
    });
    
  } finally {
    await targetDb.end();
  }
}

checkCommentEnum().catch(console.error);
