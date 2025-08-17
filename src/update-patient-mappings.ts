import { Pool } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

function getTargetConfig(): DatabaseConfig {
  return {
    host: process.env.TARGET_DB_HOST!,
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    database: process.env.TARGET_DB_NAME!,
    username: process.env.TARGET_DB_USER!,
    password: process.env.TARGET_DB_PASSWORD!,
  };
}

function createTargetPool(): Pool {
  const config = getTargetConfig();
  return new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
}

async function main() {
  const pool = createTargetPool();
  
  try {
    console.log('🚀 Starting patient mapping update');
    
    // First, delete existing patient mappings
    console.log('🗑️  Deleting existing patient mappings...');
    const deleteResult = await pool.query(
      "DELETE FROM migration_mappings WHERE entity_type = 'patient'"
    );
    console.log(`✅ Deleted ${deleteResult.rowCount} existing patient mappings`);
    
    // Then insert correct mappings from the patients table
    console.log('📝 Inserting correct patient mappings...');
    const insertResult = await pool.query(`
      INSERT INTO migration_mappings (entity_type, legacy_id, new_id, migrated_at, migration_batch)
      SELECT 
        'patient' as entity_type,
        legacy_patient_id as legacy_id,
        id as new_id,
        NOW() as migrated_at,
        'patient-mapping-fix' as migration_batch
      FROM patients
      WHERE legacy_patient_id IS NOT NULL
    `);
    console.log(`✅ Inserted ${insertResult.rowCount} correct patient mappings`);
    
    // Verify the results
    console.log('🔍 Verifying mappings...');
    const verifyResult = await pool.query(`
      SELECT 
        COUNT(*) as total_mappings,
        COUNT(CASE WHEN EXISTS (
          SELECT 1 FROM patients p 
          WHERE p.id = mm.new_id 
          AND p.legacy_patient_id = mm.legacy_id
        ) THEN 1 END) as correct_mappings
      FROM migration_mappings mm
      WHERE mm.entity_type = 'patient'
    `);
    
    const { total_mappings, correct_mappings } = verifyResult.rows[0];
    console.log(`📊 Total patient mappings: ${total_mappings}`);
    console.log(`✅ Correct mappings: ${correct_mappings}`);
    
    if (total_mappings === correct_mappings) {
      console.log('🎉 All patient mappings are now correct!');
    } else {
      console.error('❌ Some mappings are still incorrect');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
