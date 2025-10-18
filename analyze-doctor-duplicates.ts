import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function analyzeDoctorDuplicates() {
  const sourcePool = new Pool({
    host: process.env.SOURCE_DB_HOST,
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME,
    user: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔍 Analyzing doctor duplicates and data quality...\n');

    // Step 1: Check for duplicate emails
    console.log('📧 1. Checking for duplicate emails:');
    const emailDuplicatesQuery = `
      SELECT 
        au.email,
        COUNT(*) as count,
        ARRAY_AGG(au.id ORDER BY au.id) as user_ids
      FROM auth_user au
      LEFT JOIN dispatch_office_doctors dod ON au.id = dod.user_id
      LEFT JOIN dispatch_usersetting dus ON au.id = dus.user_id
      WHERE (dus.user_id IS NOT NULL OR dod.user_id IS NOT NULL)
      AND au.email IS NOT NULL 
      AND au.email != ''
      GROUP BY au.email
      HAVING COUNT(*) > 1
      ORDER BY count DESC
      LIMIT 10
    `;

    const emailDuplicatesResult = await sourcePool.query(emailDuplicatesQuery);
    if (emailDuplicatesResult.rows.length > 0) {
      console.log(`   Found ${emailDuplicatesResult.rows.length} duplicate email addresses:`);
      emailDuplicatesResult.rows.forEach(row => {
        console.log(`     "${row.email}": ${row.count} doctors (IDs: ${row.user_ids.join(', ')})`);
      });
    } else {
      console.log('   ✅ No duplicate emails found');
    }

    // Step 2: Check for duplicate first/last name combinations
    console.log('\n👥 2. Checking for duplicate name combinations:');
    const nameDuplicatesQuery = `
      SELECT 
        TRIM(LOWER(au.first_name)) as first_name,
        TRIM(LOWER(au.last_name)) as last_name,
        COUNT(*) as count,
        ARRAY_AGG(au.id ORDER BY au.id) as user_ids,
        ARRAY_AGG(au.email ORDER BY au.id) as emails
      FROM auth_user au
      LEFT JOIN dispatch_office_doctors dod ON au.id = dod.user_id
      LEFT JOIN dispatch_usersetting dus ON au.id = dus.user_id
      WHERE (dus.user_id IS NOT NULL OR dod.user_id IS NOT NULL)
      AND au.first_name IS NOT NULL AND au.first_name != ''
      AND au.last_name IS NOT NULL AND au.last_name != ''
      GROUP BY TRIM(LOWER(au.first_name)), TRIM(LOWER(au.last_name))
      HAVING COUNT(*) > 1
      ORDER BY count DESC
      LIMIT 10
    `;

    const nameDuplicatesResult = await sourcePool.query(nameDuplicatesQuery);
    if (nameDuplicatesResult.rows.length > 0) {
      console.log(`   Found ${nameDuplicatesResult.rows.length} duplicate name combinations:`);
      nameDuplicatesResult.rows.forEach(row => {
        console.log(`     "${row.first_name} ${row.last_name}": ${row.count} doctors`);
        console.log(`       IDs: ${row.user_ids.join(', ')}`);
        console.log(`       Emails: ${row.emails.join(', ')}`);
      });
    } else {
      console.log('   ✅ No duplicate name combinations found');
    }

    // Step 3: Check for similar usernames
    console.log('\n📛 3. Checking username patterns:');
    const usernameAnalysisQuery = `
      SELECT 
        COUNT(*) as total_doctors,
        COUNT(CASE WHEN au.username IS NOT NULL AND au.username != '' THEN 1 END) as has_username,
        COUNT(CASE WHEN au.username = au.email THEN 1 END) as username_is_email
      FROM auth_user au
      LEFT JOIN dispatch_office_doctors dod ON au.id = dod.user_id
      LEFT JOIN dispatch_usersetting dus ON au.id = dus.user_id
      WHERE (dus.user_id IS NOT NULL OR dod.user_id IS NOT NULL)
    `;

    const usernameResult = await sourcePool.query(usernameAnalysisQuery);
    const usernameStats = usernameResult.rows[0];
    console.log(`   Total doctors: ${usernameStats.total_doctors}`);
    console.log(`   Has username: ${usernameStats.has_username}`);
    console.log(`   Username = email: ${usernameStats.username_is_email}`);

    // Step 4: Analyze doctors with patients to identify true active doctors
    console.log('\n🏥 4. Analyzing doctors with active patients:');
    const doctorsWithPatientsQuery = `
      SELECT 
        COUNT(DISTINCT dp.doctor_id) as doctors_with_patients,
        COUNT(DISTINCT CASE WHEN dp.archived = false THEN dp.doctor_id END) as doctors_with_active_patients,
        AVG(patient_counts.patient_count) as avg_patients_per_doctor,
        MAX(patient_counts.patient_count) as max_patients_per_doctor
      FROM dispatch_patient dp
      JOIN (
        SELECT doctor_id, COUNT(*) as patient_count
        FROM dispatch_patient
        WHERE archived = false OR archived IS NULL
        GROUP BY doctor_id
      ) patient_counts ON dp.doctor_id = patient_counts.doctor_id
    `;

    const patientsResult = await sourcePool.query(doctorsWithPatientsQuery);
    const patientStats = patientsResult.rows[0];
    console.log(`   Unique doctors with patients: ${patientStats.doctors_with_patients}`);
    console.log(`   Doctors with active patients: ${patientStats.doctors_with_active_patients}`);
    console.log(`   Average patients per doctor: ${Math.round(patientStats.avg_patients_per_doctor)}`);
    console.log(`   Max patients per doctor: ${patientStats.max_patients_per_doctor}`);

    // Step 5: Create deduplication strategy
    console.log('\n🎯 5. Deduplication strategy analysis:');
    const deduplicationQuery = `
      WITH ranked_doctors AS (
        SELECT 
          au.id,
          au.first_name,
          au.last_name,
          au.email,
          au.is_active,
          au.last_login,
          au.date_joined,
          COALESCE(patient_stats.patient_count, 0) as patient_count,
          CASE WHEN dod.user_id IS NOT NULL THEN true ELSE false END as has_office,
          CASE WHEN dus.user_id IS NOT NULL THEN true ELSE false END as has_settings,
          ROW_NUMBER() OVER (
            PARTITION BY TRIM(LOWER(COALESCE(au.email, ''))) 
            ORDER BY 
              au.is_active DESC,
              COALESCE(patient_stats.patient_count, 0) DESC,
              au.last_login DESC NULLS LAST,
              au.id ASC
          ) as email_rank,
          ROW_NUMBER() OVER (
            PARTITION BY TRIM(LOWER(au.first_name)), TRIM(LOWER(au.last_name))
            ORDER BY 
              au.is_active DESC,
              COALESCE(patient_stats.patient_count, 0) DESC,
              au.last_login DESC NULLS LAST,
              au.id ASC
          ) as name_rank
        FROM auth_user au
        LEFT JOIN dispatch_office_doctors dod ON au.id = dod.user_id
        LEFT JOIN dispatch_usersetting dus ON au.id = dus.user_id
        LEFT JOIN (
          SELECT doctor_id, COUNT(*) as patient_count
          FROM dispatch_patient
          WHERE archived = false OR archived IS NULL
          GROUP BY doctor_id
        ) patient_stats ON au.id = patient_stats.doctor_id
        WHERE (dus.user_id IS NOT NULL OR dod.user_id IS NOT NULL)
        AND au.is_active = true
      )
      SELECT 
        COUNT(*) as total_active_doctors,
        COUNT(CASE WHEN email_rank = 1 AND email != '' THEN 1 END) as unique_by_email,
        COUNT(CASE WHEN name_rank = 1 AND first_name != '' AND last_name != '' THEN 1 END) as unique_by_name,
        COUNT(CASE WHEN patient_count > 0 THEN 1 END) as doctors_with_patients
      FROM ranked_doctors
      WHERE email_rank = 1 OR name_rank = 1
    `;

    const dedupResult = await sourcePool.query(deduplicationQuery);
    const dedupStats = dedupResult.rows[0];

    console.log('\n' + '='.repeat(60));
    console.log('📈 DEDUPLICATION ANALYSIS RESULTS:');
    console.log(`   Total active doctors: ${dedupStats.total_active_doctors}`);
    console.log(`   Unique by email: ${dedupStats.unique_by_email}`);
    console.log(`   Unique by name: ${dedupStats.unique_by_name}`);
    console.log(`   With active patients: ${dedupStats.doctors_with_patients}`);
    
    console.log('\n🎯 RECOMMENDED MIGRATION APPROACH:');
    console.log('   1. Filter: is_active = true');
    console.log('   2. Deduplicate by email (prioritize most recent login)');
    console.log('   3. Deduplicate by name (prioritize doctors with patients)');
    console.log('   4. Include only doctors with active patients');
    console.log(`   5. Expected final count: ~${Math.min(dedupStats.doctors_with_patients, dedupStats.unique_by_email)} doctors`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await sourcePool.end();
  }
}

analyzeDoctorDuplicates();
