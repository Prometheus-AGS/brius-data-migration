import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

function createTargetPool(): Pool {
  return new Pool({
    host: process.env.TARGET_DB_HOST!,
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    database: process.env.TARGET_DB_NAME!,
    user: process.env.TARGET_DB_USER!,
    password: process.env.TARGET_DB_PASSWORD!,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
}

async function main() {
  const pool = createTargetPool();
  
  try {
    console.log('🚀 Creating patient profiles with same IDs as patients...');
    
    // Insert patient profiles with the same ID as patients, using existing profile data
    const result = await pool.query(`
      INSERT INTO profiles (
        id, profile_type, first_name, last_name, email, phone, date_of_birth, gender,
        patient_suffix, is_active, is_verified, archived, suspended, 
        created_at, updated_at, metadata, legacy_user_id
      )
      SELECT 
        p.id,  -- Use patient.id, not profile.id
        'patient' as profile_type,
        pr.first_name,
        pr.last_name,
        pr.email,
        pr.phone,
        pr.date_of_birth,
        pr.gender,
        pr.patient_suffix,
        pr.is_active,
        pr.is_verified,
        pr.archived,
        pr.suspended,
        NOW() as created_at,
        NOW() as updated_at,
        pr.metadata,
        pr.legacy_user_id
      FROM patients p
      JOIN migration_mappings mm ON mm.legacy_id = p.legacy_user_id AND mm.entity_type = 'profile'
      JOIN profiles pr ON pr.id = mm.new_id AND pr.profile_type = 'patient'
      WHERE NOT EXISTS (
        SELECT 1 FROM profiles existing WHERE existing.id = p.id
      )
    `);
    
    console.log(`✅ Created ${result.rowCount} patient profiles with patient IDs`);
    
  } catch (error) {
    console.error('❌ Error creating patient profiles:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
