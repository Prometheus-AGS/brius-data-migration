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

    // 2. Extract our target doctor IDs from source
    console.log('\n2️⃣ Extracting clean doctor dataset...');
    const cleanDoctorsQuery = `
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
    `;

    const cleanDoctorsResult = await sourcePool.query(cleanDoctorsQuery);
    const cleanDoctorIds = cleanDoctorsResult.rows.map(row => row.user_id);
    console.log(`   Clean doctors identified: ${cleanDoctorIds.length}`);

    if (cleanDoctorIds.length !== 399) {
      console.log(`   ⚠️ WARNING: Expected 399 doctors, found ${cleanDoctorIds.length}`);
    }

    // 3. Check profile coverage for our target doctors in target database
    console.log('\n3️⃣ Checking profile coverage...');
    const coverageQuery = `
      SELECT 
        COUNT(CASE WHEN $1::int[] @> ARRAY[legacy_user_id] THEN 1 END) as doctors_with_profiles,
        $2 as total_doctors
      FROM profiles 
      WHERE profile_type = 'doctor'
    `;

    const coverageResult = await targetPool.query(coverageQuery, [cleanDoctorIds, cleanDoctorIds.length]);
    const coverage = coverageResult.rows[0];
    
    const doctorsWithProfiles = parseInt(coverage.doctors_with_profiles);
    const totalDoctors = parseInt(coverage.total_doctors);
    const doctorsWithoutProfiles = totalDoctors - doctorsWithProfiles;
    
    console.log(`   Doctors needing profiles: ${totalDoctors}`);
    console.log(`   Doctors with existing profiles: ${doctorsWithProfiles}`);
    console.log(`   Doctors missing profiles: ${doctorsWithoutProfiles}`);

    const coveragePercentage = (doctorsWithProfiles / totalDoctors * 100).toFixed(1);
    console.log(`   Profile coverage: ${coveragePercentage}%`);

    // 4. Decision point
    console.log('\n4️⃣ Validation Decision:');
    if (doctorsWithoutProfiles > 0) {
      console.log(`   ❌ BLOCKING ISSUE: ${doctorsWithoutProfiles} doctors missing profiles`);
      console.log('   🛑 MIGRATION CANNOT PROCEED - profile migration incomplete');
      
      // Show sample missing doctors
      const missingQuery = `
        SELECT au.id, au.first_name, au.last_name, au.email
        FROM auth_user au
        WHERE au.id = ANY($1::int[])
        AND au.id NOT IN (
          SELECT legacy_user_id 
          FROM profiles 
          WHERE profile_type = 'doctor' 
          AND legacy_user_id = ANY($1::int[])
        )
        LIMIT 5
      `;
      
      const missingResult = await sourcePool.query(missingQuery, [cleanDoctorIds]);
      console.log('\n   📋 Sample missing doctor profiles:');
      missingResult.rows.forEach(row => {
        console.log(`     - ${row.first_name} ${row.last_name} (ID: ${row.id}, ${row.email})`);
      });
      
      return false;
    }

    if (doctorsWithProfiles === totalDoctors) {
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
  process.exit(canProceed ? 0 : 1);
});
