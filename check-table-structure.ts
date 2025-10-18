import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function checkTableStructure() {
  const sourcePool = new Pool({
    host: process.env.SOURCE_DB_HOST,
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME,
    user: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('📋 Checking dispatch_office_doctors structure:');
    const result = await sourcePool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'dispatch_office_doctors' ORDER BY ordinal_position`);
    result.rows.forEach(row => console.log(`  - ${row.column_name}: ${row.data_type}`));
    
    console.log('\n📋 Sample data from dispatch_office_doctors:');
    const sampleResult = await sourcePool.query(`SELECT * FROM dispatch_office_doctors LIMIT 3`);
    console.log(sampleResult.rows);
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await sourcePool.end();
  }
}

checkTableStructure();