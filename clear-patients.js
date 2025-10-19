const { Pool } = require('pg');
require('dotenv').config();

async function clearPatientsTable() {
  const targetDb = new Pool({
    host: process.env.TARGET_DB_HOST,
    port: process.env.TARGET_DB_PORT,
    user: process.env.TARGET_DB_USER,
    password: process.env.TARGET_DB_PASSWORD,
    database: process.env.TARGET_DB_NAME
  });
  
  try {
    console.log('🔄 Clearing patients table...');
    
    // Check current count
    const beforeCount = await targetDb.query('SELECT COUNT(*) as total FROM patients');
    console.log('Current patients count:', beforeCount.rows[0].total);
    
    // Delete all patients (should be 0 anyway)
    const deleteResult = await targetDb.query('DELETE FROM patients');
    console.log('Deleted patients:', deleteResult.rowCount);
    
    // Clear patient migration mappings
    const clearMappings = await targetDb.query("DELETE FROM migration_mappings WHERE entity_type = 'patient'");
    console.log('Cleared patient migration mappings:', clearMappings.rowCount);
    
    console.log('✅ Patients table cleared, ready for re-migration');
    
  } catch (error) {
    console.error('❌ Error clearing patients:', error.message);
  } finally {
    await targetDb.end();
  }
}

clearPatientsTable();
