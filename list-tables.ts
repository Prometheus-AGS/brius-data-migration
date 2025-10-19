import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function listTables() {
  const sourcePool = new Pool({
    host: process.env.SOURCE_DB_HOST,
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME,
    user: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('📋 Source database tables:');
    const result = await sourcePool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE '%doctor%' ORDER BY table_name`);
    result.rows.forEach(row => console.log(`  - ${row.table_name}`));
    
    console.log('\n📋 All source tables:');
    const allResult = await sourcePool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name LIMIT 20`);
    allResult.rows.forEach(row => console.log(`  - ${row.table_name}`));
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await sourcePool.end();
  }
}

listTables();