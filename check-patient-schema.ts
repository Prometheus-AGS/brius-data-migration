import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function checkPatientSchema() {
  const targetPool = new Pool({
    host: process.env.TARGET_DB_HOST,
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    database: process.env.TARGET_DB_NAME,
    user: process.env.TARGET_DB_USER,
    password: process.env.TARGET_DB_PASSWORD
  });

  try {
    console.log('📋 Target patients table structure:');
    const result = await targetPool.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'patients' ORDER BY ordinal_position`);
    result.rows.forEach(row => console.log(`  - ${row.column_name}: ${row.data_type} (${row.is_nullable === 'YES' ? 'nullable' : 'required'})`));
    
    console.log('\n📋 Sample patient data:');
    const sampleResult = await targetPool.query(`SELECT * FROM patients LIMIT 2`);
    console.log(JSON.stringify(sampleResult.rows, null, 2));
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await targetPool.end();
  }
}

checkPatientSchema();