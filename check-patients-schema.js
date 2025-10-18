const { Pool } = require('pg');
require('dotenv').config();

async function checkPatientsSchema() {
  const targetDb = new Pool({
    host: process.env.TARGET_DB_HOST,
    port: process.env.TARGET_DB_PORT,
    user: process.env.TARGET_DB_USER,
    password: process.env.TARGET_DB_PASSWORD,
    database: process.env.TARGET_DB_NAME
  });
  
  try {
    console.log('🔍 Checking patients table schema...');
    
    const schema = await targetDb.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'patients' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);
    
    console.log('Patients table columns:');
    console.table(schema.rows);
    
  } catch (error) {
    console.error('❌ Error checking schema:', error.message);
  } finally {
    await targetDb.end();
  }
}

checkPatientsSchema();
