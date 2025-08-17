import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

function createSourcePool(): Pool {
  return new Pool({
    host: process.env.SOURCE_DB_HOST!,
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME!,
    user: process.env.SOURCE_DB_USER!,
    password: process.env.SOURCE_DB_PASSWORD!,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
}

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

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

async function main() {
  const sourcePool = createSourcePool();
  const targetPool = createTargetPool();
  
  try {
    console.log('🚀 Starting missing doctors migration...');
    
    // Get the missing doctor IDs we identified from our previous analysis
    const missingDoctorIds = [
      71, 533, 696, 721, 855, 894, 1255, 1276, 1517, 1644,
      1698, 1699, 1846, 1887, 2238, 2296, 2365, 2393, 2498, 2522,
      2557, 2591, 2680, 2716, 2827, 2879, 3011, 3311, 3406, 3495,
      4696, 5158, 5395, 5594, 6173, 6578, 6579, 6722, 9035, 9443
    ];
    
    console.log(`📊 Migrating ${missingDoctorIds.length} missing doctors`);
    
    // Get detailed info for these doctors from auth_user
    const authUserQuery = `
      SELECT id, username, first_name, last_name, email, is_active, date_joined
      FROM auth_user 
      WHERE id = ANY($1)
      ORDER BY id
    `;
    
    const authResult = await sourcePool.query(authUserQuery, [missingDoctorIds]);
    const doctorsToMigrate = authResult.rows;
    
    console.log(`📥 Retrieved ${doctorsToMigrate.length} doctor records from source`);
    
    let migratedCount = 0;
    
    for (const doctor of doctorsToMigrate) {
      const doctorId = generateUUID();
      const profileId = generateUUID();
      const now = new Date().toISOString();
      
      const client = await targetPool.connect();
      try {
        await client.query('BEGIN');
        
        // 1. Insert into profiles table
        await client.query(`
          INSERT INTO profiles (
            id, profile_type, first_name, last_name, email, username, 
            is_active, created_at, updated_at, legacy_user_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
          profileId,
          'doctor',
          doctor.first_name || 'Doctor',
          doctor.last_name || `#${doctor.id}`,
          doctor.email,
          doctor.username,
          doctor.is_active,
          doctor.date_joined || now,
          now,
          doctor.id
        ]);
        
        // 2. Insert into doctors table with the correct structure
        await client.query(`
          INSERT INTO doctors (
            id, profile_id, doctor_number, status, 
            is_accepting_patients, joined_practice_at, updated_at,
            legacy_user_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          doctorId,
          profileId,
          `DR${doctor.id.toString().padStart(6, '0')}`,
          doctor.is_active ? 'active' : 'inactive',
          true,
          doctor.date_joined || now,
          now,
          doctor.id
        ]);
        
        // 3. Insert into migration_mappings for profile
        await client.query(`
          INSERT INTO migration_mappings (entity_type, legacy_id, new_id, migrated_at, migration_batch)
          VALUES ($1, $2, $3, NOW(), $4)
        `, ['profile', doctor.id, profileId, 'missing-doctors-recovery']);
        
        // 4. Insert into migration_mappings for doctor  
        await client.query(`
          INSERT INTO migration_mappings (entity_type, legacy_id, new_id, migrated_at, migration_batch)
          VALUES ($1, $2, $3, NOW(), $4)
        `, ['doctor', doctor.id, doctorId, 'missing-doctors-recovery']);
        
        await client.query('COMMIT');
        migratedCount++;
        
        console.log(`✅ Migrated doctor ${doctor.id}: ${doctor.first_name} ${doctor.last_name} (${doctor.email})`);
        
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`❌ Failed to migrate doctor ${doctor.id}: ${(error as Error).message}`);
      } finally {
        client.release();
      }
    }
    
    console.log(`\n🎉 Migration completed!`);
    console.log(`   Migrated doctors: ${migratedCount}/${doctorsToMigrate.length}`);
    
    // Verify the migration
    const verifyResult = await targetPool.query(`
      SELECT COUNT(*) as doctor_count 
      FROM doctors 
      WHERE legacy_user_id = ANY($1)
    `, [missingDoctorIds]);
    
    console.log(`✅ Verification: ${verifyResult.rows[0].doctor_count} doctors now in target system`);
    
  } catch (error) {
    console.error('❌ Error migrating missing doctors:', error);
    process.exit(1);
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

main().catch(console.error);
