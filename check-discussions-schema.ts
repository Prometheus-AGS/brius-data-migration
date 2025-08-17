import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function checkDiscussions() {
  const targetDb = new Client({
    host: process.env.TARGET_DB_HOST || 'localhost',
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    user: process.env.TARGET_DB_USER || 'postgres',
    password: process.env.TARGET_DB_PASSWORD!,
    database: process.env.TARGET_DB_NAME || 'postgres'
  });

  try {
    await targetDb.connect();
    
    const result = await targetDb.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'treatment_discussions'
      ORDER BY ordinal_position;
    `);
    
    console.log('treatment_discussions table schema:');
    result.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
    });
    
  } finally {
    await targetDb.end();
  }
}

checkDiscussions().catch(console.error);
