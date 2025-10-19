import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function executeDoctorMigration() {
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
    console.log('🚀 DOCTOR MIGRATION EXECUTION (FIXED)');
    console.log('='.repeat(50));
    
    // STEP 1: PRE-MIGRATION ANALYSIS
    console.log('\n📊 STEP 1: PRE-MIGRATION ANALYSIS');
    console.log('-'.repeat(40));

    console.log('\n1.1 Extract Clean Doctor Dataset');
    const cleanDoctorsQuery = `
      WITH clean_doctors AS (
        SELECT DISTINCT ON (
          CASE 
            WHEN au.email IS NOT NULL AND au.email != '' 
            THEN TRIM(LOWER(au.email))
            ELSE CONCAT(TRIM(LOWER(COALESCE(au.first_name, ''))), '_', TRIM(LOWER(COALESCE(au.last_name, ''))))
          END
        )
        au.id as user_id,
        au.first_name,
        au.last_name,
        au.email,
        au.username,
        au.is_active,
        au.date_joined,
        au.last_login,
        COALESCE(patient_stats.patient_count, 0) as patient_count,
        CASE WHEN dod.user_id IS NOT NULL THEN true ELSE false END as has_office_assignment,
        CASE WHEN dus.user_id IS NOT NULL THEN true ELSE false END as has_settings
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
      SELECT * FROM clean_doctors ORDER BY patient_count DESC
    `;

    const cleanDoctorsResult = await sourcePool.query(cleanDoctorsQuery);
    const cleanDoctors = cleanDoctorsResult.rows;
    console.log(`   ✅ Extracted ${cleanDoctors.length} clean doctors`);

    console.log('\n1.2 Profile Mapping Validation');
    const profileMappingQuery = `
      SELECT legacy_user_id, id as profile_id
      FROM profiles 
      WHERE legacy_user_id = ANY($1::int[]) AND profile_type = 'doctor'
    `;
    
    const doctorIds = cleanDoctors.map(d => d.user_id);
    const profileMappingResult = await targetPool.query(profileMappingQuery, [doctorIds]);
    const profileMap = new Map(profileMappingResult.rows.map(row => [row.legacy_user_id, row.profile_id]));
    console.log(`   ✅ Found ${profileMappingResult.rows.length} profile mappings`);

    // Show top 5 doctors to migrate
    console.log('\n   📋 Top 5 doctors by patient count:');
    cleanDoctors.slice(0, 5).forEach((doctor, i) => {
      const profileId = profileMap.get(doctor.user_id);
      console.log(`     ${i + 1}. ${doctor.first_name} ${doctor.last_name} (${doctor.patient_count} patients) → Profile: ${profileId ? 'MAPPED' : 'MISSING'}`);
    });

    // STEP 2: MIGRATION EXECUTION
    console.log('\n🔄 STEP 2: MIGRATION EXECUTION');
    console.log('-'.repeat(40));

    console.log('\n2.1 Clear Existing Doctors');
    const deleteResult = await targetPool.query('DELETE FROM doctors');
    console.log(`   ✅ Cleared ${deleteResult.rowCount} existing doctor records`);

    console.log('\n2.2 Doctor Record Migration');
    let migrated = 0;
    let errors = 0;

    // Process in smaller batches for better error handling
    const BATCH_SIZE = 50;
    for (let i = 0; i < cleanDoctors.length; i += BATCH_SIZE) {
      const batch = cleanDoctors.slice(i, i + BATCH_SIZE);
      console.log(`   📦 Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(cleanDoctors.length/BATCH_SIZE)} (${batch.length} doctors)`);

      for (const doctor of batch) {
        try {
          const profileId = profileMap.get(doctor.user_id);
          if (!profileId) {
            console.error(`   ❌ No profile found for doctor ${doctor.user_id}`);
            errors++;
            continue;
          }

          // CORRECTED INSERT QUERY - using actual table schema
          const insertQuery = `
            INSERT INTO doctors (
              profile_id,
              doctor_number,
              license_number,
              npi_number,
              specialty,
              board_certifications,
              education,
              years_experience,
              primary_office_id,
              practice_type,
              status,
              is_accepting_patients,
              max_patient_load,
              bio,
              specialties,
              languages_spoken,
              professional_memberships,
              consultation_duration_minutes,
              follow_up_duration_minutes,
              working_hours,
              consultation_fee,
              accepts_insurance,
              payment_terms,
              licensed_since,
              joined_practice_at,
              updated_at,
              legacy_doctor_id,
              legacy_user_id
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
              $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
              $21, $22, $23, $24, $25, NOW(), $26, $27
            )
          `;

          const yearsExperience = doctor.date_joined ? 
            Math.max(1, new Date().getFullYear() - new Date(doctor.date_joined).getFullYear()) : 5;

          await targetPool.query(insertQuery, [
            profileId,                          // profile_id (uuid) - CRITICAL FK
            `DOC-${doctor.user_id}`,            // doctor_number
            null,                               // license_number
            null,                               // npi_number
            'orthodontics',                     // specialty (default from schema)
            '[]',                               // board_certifications (jsonb)
            '{}',                               // education (jsonb)
            yearsExperience,                    // years_experience
            null,                               // primary_office_id
            'Private Practice',                 // practice_type
            'active',                           // status (enum)
            true,                               // is_accepting_patients
            500,                                // max_patient_load (default from schema)
            'Migrated doctor profile',          // bio
            '["orthodontics"]',                 // specialties (jsonb)
            '["English"]',                      // languages_spoken (jsonb)
            '[]',                               // professional_memberships (jsonb)
            60,                                 // consultation_duration_minutes (default)
            30,                                 // follow_up_duration_minutes (default)
            '{}',                               // working_hours (jsonb)
            null,                               // consultation_fee
            true,                               // accepts_insurance
            '{}',                               // payment_terms (jsonb)
            doctor.date_joined ? new Date(doctor.date_joined).toISOString().split('T')[0] : null, // licensed_since
            doctor.date_joined,                 // joined_practice_at
            doctor.user_id,                     // legacy_doctor_id
            doctor.user_id                      // legacy_user_id
          ]);

          migrated++;

        } catch (error: any) {
          console.error(`   ❌ Error migrating doctor ${doctor.user_id}: ${error.message}`);
          errors++;
        }
      }

      const progress = ((i + batch.length) / cleanDoctors.length * 100).toFixed(1);
      console.log(`   📈 Progress: ${progress}% (${migrated} migrated, ${errors} errors)`);
    }

    // STEP 3: POST-MIGRATION VALIDATION
    console.log('\n✅ STEP 3: POST-MIGRATION VALIDATION');
    console.log('-'.repeat(40));

    console.log('\n3.1 Count Validation');
    const finalCountResult = await targetPool.query('SELECT COUNT(*) as count FROM doctors');
    const finalCount = parseInt(finalCountResult.rows[0].count);
    console.log(`   Migrated doctors: ${finalCount}`);
    console.log(`   Expected: ${cleanDoctors.length}`);
    console.log(`   Success rate: ${((migrated / cleanDoctors.length) * 100).toFixed(2)}%`);

    console.log('\n3.2 Profile Relationship Validation');
    const orphanedResult = await targetPool.query(`
      SELECT COUNT(*) as count 
      FROM doctors d 
      LEFT JOIN profiles p ON d.profile_id = p.id 
      WHERE p.id IS NULL
    `);
    console.log(`   Orphaned doctors (no profile): ${orphanedResult.rows[0].count}`);

    console.log('\n3.3 Sample Migrated Records');
    if (finalCount > 0) {
      const sampleResult = await targetPool.query(`
        SELECT 
          d.id,
          d.doctor_number,
          d.specialty,
          d.legacy_user_id,
          p.first_name,
          p.last_name,
          p.email
        FROM doctors d
        JOIN profiles p ON d.profile_id = p.id
        ORDER BY d.joined_practice_at DESC
        LIMIT 5
      `);
      
      console.log('   Sample records:');
      sampleResult.rows.forEach((row, i) => {
        console.log(`     ${i + 1}. ${row.first_name} ${row.last_name} (${row.doctor_number}) - ${row.specialty} - Legacy ID: ${row.legacy_user_id}`);
      });
    }

    console.log('\n3.4 Legacy ID Mapping Validation');
    const legacyIdResult = await targetPool.query(`
      SELECT 
        COUNT(*) as total_doctors,
        COUNT(CASE WHEN legacy_user_id IS NOT NULL THEN 1 END) as with_legacy_id,
        COUNT(DISTINCT legacy_user_id) as unique_legacy_ids
      FROM doctors
    `);
    const legacyStats = legacyIdResult.rows[0];
    console.log(`   Total doctors: ${legacyStats.total_doctors}`);
    console.log(`   With legacy IDs: ${legacyStats.with_legacy_id}`);
    console.log(`   Unique legacy IDs: ${legacyStats.unique_legacy_ids}`);

    // FINAL SUMMARY
    console.log('\n' + '='.repeat(60));
    console.log('🎯 MIGRATION COMPLETE!');
    console.log(`   Source doctors: ${cleanDoctors.length}`);
    console.log(`   Successfully migrated: ${migrated}`);
    console.log(`   Errors: ${errors}`);
    console.log(`   Final database count: ${finalCount}`);
    console.log(`   Profile relationships: ${finalCount - orphanedResult.rows[0].count}/${finalCount}`);

    if (finalCount === migrated && errors === 0 && orphanedResult.rows[0].count === 0) {
      console.log('\n   🎉 PERFECT MIGRATION SUCCESS!');
      console.log('       ✅ All doctors migrated');
      console.log('       ✅ All profiles linked');
      console.log('       ✅ Zero errors');
      return true;
    } else {
      console.log('\n   ⚠️ Migration completed with issues - review above');
      return false;
    }

  } catch (error: any) {
    console.error('❌ Migration execution error:', error.message);
    return false;
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

executeDoctorMigration().then(success => {
  process.exit(success ? 0 : 1);
});
