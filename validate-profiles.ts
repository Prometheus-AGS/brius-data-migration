import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function validateProfiles() {
  const sourcePool = new Pool({
    host: process.env.SOURCE_DB_HOST,
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME,
    user: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false }
  });

  const targetPool = new Pool({
    host: process.env.TARGET_DB_HOST,
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    database: process.env.TARGET_DB_NAME,
    user: process.env.TARGET_DB_USER,
    password: process.env.TARGET_DB_PASSWORD
  });

  try {
    console.log('🔍 PHASE 1: PROFILE MIGRATION VALIDATION');
    console.log('='.repeat(50));

    // 1. Check if profiles table exists and has doctor records
    console.log('\n1️⃣ Checking profiles table...');
    const profilesExistResult = await targetPool.query(`
      SELECT 
        COUNT(*) as total_profiles,
        COUNT(CASE WHEN profile_type = 'doctor' THEN 1 END) as doctor_profiles
      FROM profiles
    `);
    
    const profileStats = profilesExistResult.rows[0];
    console.log(`   Total profiles: ${profileStats.total_profiles}`);
    console.log(`   Doctor profiles: ${profileStats.doctor_profiles}`);

    if (profileStats.total_profiles === '0') {
      console.log('   ❌ CRITICAL: No profiles found - profiles migration must be run first');
      return false;
    }

    if (profileStats.doctor_profiles === '0') {
      console.log('   ❌ CRITICAL: No doctor profiles found');
      return false;
    }

    // 2. Extract our 399 target doctor IDs
    console.log('\n2️⃣ Extracting clean doctor dataset...');
    const cleanDoctorsQuery = `
      WITH clean_doctors AS (
        SELECT DISTINCT ON (
          CASE 
            WHEN au.email IS NOT NULL AND au.email != '' 
            THEN TRIM(LOWER(au.email))
            ELSE CONCAT(TRIM(LOWER(COALESCE(au.first_name, ''))), '_', TRIM(LOWER(COALESCE(au.last_name, ''))))
          END
        ) au.id as user_id
        FROM auth_user au
        LEFT JOIN dispatch_usersetting dus ON au.id = dus.user_id
        LEFT JOIN dispatch_office_doctors dod ON au.id = dod.user_id
        LEFT JOIN (
          SELECT doctor_id, COUNT(*) as patient_count
          FROM dispatch_patient
          WHERE archived = false OR archived IS NULL
          GROUP BY doctor_id
        ) patient_stats ON au.id = patient_stats.doctor_id
        WHERE (dus.user_id IS NOT NULL OR dod.user_id IS NOT NULL)
        AND au.is_active = true
        AND COALESCE(patient_stats.patient_count, 0) > 0
        AND NOT (
          LOWER(au.email) LIKE '%test%' OR
          LOWER(au.email) LIKE '%demo%' OR
          LOWER(au.first_name) LIKE '%test%' OR
          LOWER(au.last_name) LIKE '%test%' OR
          au.email LIKE '%brius.com' OR
          au.email LIKE '%mechanodontics.com'
        )
        ORDER BY 
          CASE 
            WHEN au.email IS NOT NULL AND au.email != '' 
            THEN TRIM(LOWER(au.email))
            ELSE CONCAT(TRIM(LOWER(COALESCE(au.first_name, ''))), '_', TRIM(LOWER(COALESCE(au.last_name, ''))))
          END,
          COALESCE(patient_stats.patient_count, 0) DESC,
          au.last_login DESC NULLS LAST,
          au.id ASC
      )
      SELECT COUNT(*) as clean_doctors FROM clean_doctors
    `;

    const cleanDoctorsResult = await sourcePool.query(cleanDoctorsQuery);
    const cleanDoctorCount = parseInt(cleanDoctorsResult.rows[0].clean_doctors);
    console.log(`   Clean doctors identified: ${cleanDoctorCount}`);

    if (cleanDoctorCount !== 399) {
      console.log(`   ⚠️ WARNING: Expected 399 doctors, found ${cleanDoctorCount}`);
    }

    // 3. Check profile coverage for our target doctors
    console.log('\n3️⃣ Checking profile coverage...');
    const coverageQuery = `
      WITH clean_doctors AS (
        SELECT DISTINCT ON (
          CASE 
            WHEN au.email IS NOT NULL AND au.email != '' 
            THEN TRIM(LOWER(au.email))
            ELSE CONCAT(TRIM(LOWER(COALESCE(au.first_name, ''))), '_', TRIM(LOWER(COALESCE(au.last_name, ''))))
          END
        ) au.id as user_id
        FROM auth_user au
        LEFT JOIN dispatch_usersetting dus ON au.id = dus.user_id
        LEFT JOIN dispatch_office_doctors dod ON au.id = dod.user_id
        LEFT JOIN (
          SELECT doctor_id, COUNT(*) as patient_count
          FROM dispatch_patient
          WHERE archived = false OR archived IS NULL
          GROUP BY doctor_id
        ) patient_stats ON au.id = patient_stats.doctor_id
        WHERE (dus.user_id IS NOT NULL OR dod.user_id IS NOT NULL)
        AND au.is_active = true
        AND COALESCE(patient_stats.patient_count, 0) > 0
        AND NOT (
          LOWER(au.email) LIKE '%test%' OR
          LOWER(au.email) LIKE '%demo%' OR
          LOWER(au.first_name) LIKE '%test%' OR
          LOWER(au.last_name) LIKE '%test%' OR
          au.email LIKE '%brius.com' OR
          au.email LIKE '%mechanodontics.com'
        )
        ORDER BY 
          CASE 
            WHEN au.email IS NOT NULL AND au.email != '' 
            THEN TRIM(LOWER(au.email))
            ELSE CONCAT(TRIM(LOWER(COALESCE(au.first_name, ''))), '_', TRIM(LOWER(COALESCE(au.last_name, ''))))
          END,
          COALESCE(patient_stats.patient_count, 0) DESC,
          au.last_login DESC NULLS LAST,
          au.id ASC
      )
      SELECT 
        COUNT(*) as total_doctors,
        COUNT(CASE WHEN p.id IS NOT NULL THEN 1 END) as doctors_with_profiles,
        COUNT(CASE WHEN p.id IS NULL THEN 1 END) as doctors_without_profiles
      FROM clean_doctors cd
      LEFT JOIN profiles p ON p.legacy_user_id = cd.user_id AND p.profile_type = 'doctor'
    `;

    const coverageResult = await targetPool.query(coverageQuery);
    const coverage = coverageResult.rows[0];
    
    console.log(`   Doctors needing profiles: ${coverage.total_doctors}`);
    console.log(`   Doctors with existing profiles: ${coverage.doctors_with_profiles}`);
    console.log(`   Doctors missing profiles: ${coverage.doctors_without_profiles}`);

    const coveragePercentage = (coverage.doctors_with_profiles / coverage.total_doctors * 100).toFixed(1);
    console.log(`   Profile coverage: ${coveragePercentage}%`);

    // 4. Decision point
    console.log('\n4️⃣ Validation Decision:');
    if (coverage.doctors_without_profiles > 0) {
      console.log(`   ❌ BLOCKING ISSUE: ${coverage.doctors_without_profiles} doctors missing profiles`);
      console.log('   🛑 MIGRATION CANNOT PROCEED - profile migration incomplete');
      return false;
    }

    if (coverage.doctors_with_profiles === coverage.total_doctors) {
      console.log('   ✅ SUCCESS: All target doctors have corresponding profiles');
      console.log('   ✅ MIGRATION CAN PROCEED to Step 1');
      return true;
    }

    return false;

  } catch (error: any) {
    console.error('❌ Profile validation error:', error.message);
    return false;
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

validateProfiles().then(canProceed => {
  if (canProceed) {
    console.log('\n🎯 READY FOR MIGRATION EXECUTION');
  } else {
    console.log('\n🛑 MIGRATION BLOCKED - resolve profile issues first');
  }
});
