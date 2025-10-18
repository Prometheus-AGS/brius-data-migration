import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function validateNewCriteria() {
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
    console.log('🔍 VALIDATING NEW MIGRATION CRITERIA');
    console.log('='.repeat(50));

    // 1. Count doctors with patients (NO deduplication, INCLUDE test accounts)
    console.log('\n📊 1. Source Database Analysis');
    const allDoctorsWithPatientsQuery = `
      SELECT 
        au.id as user_id,
        au.first_name,
        au.last_name,
        au.email,
        au.is_active,
        COALESCE(patient_stats.patient_count, 0) as patient_count,
        CASE WHEN dod.user_id IS NOT NULL THEN true ELSE false END as has_office_assignment,
        CASE WHEN dus.user_id IS NOT NULL THEN true ELSE false END as has_settings,
        CASE WHEN (
          LOWER(au.email) LIKE '%test%' OR
          LOWER(au.email) LIKE '%demo%' OR
          LOWER(au.first_name) LIKE '%test%' OR
          LOWER(au.last_name) LIKE '%test%' OR
          au.email LIKE '%brius.com' OR
          au.email LIKE '%mechanodontics.com'
        ) THEN true ELSE false END as is_test_account
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
      AND COALESCE(patient_stats.patient_count, 0) > 0
      ORDER BY patient_count DESC, au.id ASC
    `;

    const allDoctorsResult = await sourcePool.query(allDoctorsWithPatientsQuery);
    const allDoctors = allDoctorsResult.rows;

    console.log(`   Total doctors with patients (NO deduplication): ${allDoctors.length}`);

    // 2. Break down by categories
    const activeCount = allDoctors.filter(d => d.is_active).length;
    const inactiveCount = allDoctors.filter(d => !d.is_active).length;
    const testCount = allDoctors.filter(d => d.is_test_account).length;
    const productionCount = allDoctors.filter(d => !d.is_test_account).length;

    console.log(`   Active doctors: ${activeCount}`);
    console.log(`   Inactive doctors: ${inactiveCount}`);
    console.log(`   Test accounts: ${testCount}`);
    console.log(`   Production accounts: ${productionCount}`);

    // 3. Show top doctors by patient count
    console.log('\n📋 Top 10 doctors by patient count:');
    allDoctors.slice(0, 10).forEach((doctor, i) => {
      const testFlag = doctor.is_test_account ? ' [TEST]' : '';
      const activeFlag = doctor.is_active ? ' [ACTIVE]' : ' [INACTIVE]';
      console.log(`   ${i + 1}. ${doctor.first_name} ${doctor.last_name} (${doctor.patient_count} patients)${testFlag}${activeFlag}`);
    });

    // 4. Show test accounts
    const testAccounts = allDoctors.filter(d => d.is_test_account);
    console.log(`\n🧪 Test accounts (${testAccounts.length} total):`);
    testAccounts.slice(0, 10).forEach((doctor, i) => {
      console.log(`   ${i + 1}. ${doctor.first_name} ${doctor.last_name} (${doctor.email}) - ${doctor.patient_count} patients`);
    });

    // 5. Check for duplicate emails to understand the impact of no deduplication
    const duplicateEmailsQuery = `
      WITH doctors_with_patients AS (
        SELECT 
          au.id,
          au.email,
          COALESCE(patient_stats.patient_count, 0) as patient_count
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
        AND COALESCE(patient_stats.patient_count, 0) > 0
      )
      SELECT 
        email,
        COUNT(*) as record_count,
        ARRAY_AGG(id ORDER BY patient_count DESC) as user_ids,
        ARRAY_AGG(patient_count ORDER BY patient_count DESC) as patient_counts
      FROM doctors_with_patients
      WHERE email IS NOT NULL AND email != ''
      GROUP BY email
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC, email
      LIMIT 10
    `;

    const duplicateEmailsResult = await sourcePool.query(duplicateEmailsQuery);
    console.log(`\n📧 Duplicate emails that will create multiple records (${duplicateEmailsResult.rows.length} email groups):`);
    duplicateEmailsResult.rows.forEach((row, i) => {
      console.log(`   ${i + 1}. "${row.email}": ${row.record_count} records (IDs: ${row.user_ids.slice(0, 3).join(', ')}, patients: ${row.patient_counts.slice(0, 3).join(', ')})`);
    });

    // 6. Check profile availability for all these doctors
    console.log('\n👤 Profile Coverage Analysis:');
    const doctorIds = allDoctors.map(d => d.user_id);
    const profileCoverageQuery = `
      SELECT 
        COUNT(CASE WHEN $1::int[] @> ARRAY[legacy_user_id] THEN 1 END) as doctors_with_profiles
      FROM profiles 
      WHERE profile_type = 'doctor'
    `;

    const profileCoverageResult = await targetPool.query(profileCoverageQuery, [doctorIds]);
    const doctorsWithProfiles = parseInt(profileCoverageResult.rows[0].doctors_with_profiles);
    const doctorsWithoutProfiles = allDoctors.length - doctorsWithProfiles;

    console.log(`   Doctors needing profiles: ${allDoctors.length}`);
    console.log(`   Doctors with existing profiles: ${doctorsWithProfiles}`);
    console.log(`   Doctors missing profiles: ${doctorsWithoutProfiles}`);

    if (doctorsWithoutProfiles > 0) {
      console.log('   ⚠️ WARNING: Some doctors are missing profiles');
      
      // Sample missing profiles
      const missingProfilesQuery = `
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
      
      const missingProfilesResult = await sourcePool.query(missingProfilesQuery, [doctorIds]);
      console.log('\n   📋 Sample doctors missing profiles:');
      missingProfilesResult.rows.forEach((row, i) => {
        console.log(`     ${i + 1}. ${row.first_name} ${row.last_name} (ID: ${row.id}, Email: ${row.email})`);
      });
    }

    // 7. Current target database state
    console.log('\n🎯 Current Target Database:');
    const currentDoctorsResult = await targetPool.query('SELECT COUNT(*) as count FROM doctors');
    const currentProfilesResult = await targetPool.query(`SELECT COUNT(*) as count FROM profiles WHERE profile_type = 'doctor'`);
    console.log(`   Current doctors: ${currentDoctorsResult.rows[0].count}`);
    console.log(`   Current doctor profiles: ${currentProfilesResult.rows[0].count}`);

    // 8. Migration impact summary
    console.log('\n' + '='.repeat(60));
    console.log('📈 NEW MIGRATION CRITERIA IMPACT:');
    console.log(`   🔄 CHANGE: No deduplication (was: 399 → now: ${allDoctors.length})`);
    console.log(`   🧪 CHANGE: Include test accounts (${testCount} test accounts will be migrated)`);
    console.log(`   📊 TOTAL: ${allDoctors.length} doctor records will be migrated`);
    console.log(`   ⚠️  RISK: ${duplicateEmailsResult.rows.length} email groups will create duplicate records`);
    console.log(`   👤 DEPENDENCY: ${doctorsWithProfiles}/${allDoctors.length} profiles available`);

    return {
      totalDoctors: allDoctors.length,
      activeDoctors: activeCount,
      inactiveDoctors: inactiveCount,
      testAccounts: testCount,
      productionAccounts: productionCount,
      duplicateEmails: duplicateEmailsResult.rows.length,
      profilesAvailable: doctorsWithProfiles,
      profilesMissing: doctorsWithoutProfiles,
      canProceed: doctorsWithoutProfiles === 0
    };

  } catch (error: any) {
    console.error('❌ Validation error:', error.message);
    return null;
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

validateNewCriteria().then(result => {
  if (result) {
    console.log('\n🎯 VALIDATION COMPLETE');
    if (result.canProceed) {
      console.log('✅ Ready to proceed with migration');
    } else {
      console.log('🛑 Profile issues must be resolved first');
    }
  }
});
