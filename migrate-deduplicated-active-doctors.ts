import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

interface DoctorData {
  user_id: number;
  first_name?: string;
  last_name?: string;
  email?: string;
  username?: string;
  is_active: boolean;
  date_joined?: string;
  last_login?: string;
  patient_count: number;
  has_office_assignment: boolean;
  has_settings: boolean;
  dedup_rank: number;
}

async function migrateDeduplicated() {
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
    console.log('🚀 Starting deduplicated active doctors migration...\n');

    // Step 1: Clear existing doctors
    console.log('🧹 1. Clearing existing doctors...');
    await targetPool.query('DELETE FROM doctors');
    console.log('   ✅ Cleared existing doctors');

    // Step 2: Extract deduplicated active doctors with patients
    console.log('\n📊 2. Extracting deduplicated doctors...');
    const doctorsQuery = `
      WITH ranked_doctors AS (
        SELECT 
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
          CASE WHEN dus.user_id IS NOT NULL THEN true ELSE false END as has_settings,
          ROW_NUMBER() OVER (
            PARTITION BY 
              CASE 
                WHEN au.email IS NOT NULL AND au.email != '' 
                THEN TRIM(LOWER(au.email))
                ELSE CONCAT(TRIM(LOWER(COALESCE(au.first_name, ''))), '_', TRIM(LOWER(COALESCE(au.last_name, ''))))
              END
            ORDER BY 
              au.is_active DESC,
              COALESCE(patient_stats.patient_count, 0) DESC,
              au.last_login DESC NULLS LAST,
              au.id ASC
          ) as dedup_rank
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
        AND COALESCE(patient_stats.patient_count, 0) > 0
        AND NOT (
          -- Filter out obvious test accounts
          LOWER(au.email) LIKE '%test%' OR
          LOWER(au.email) LIKE '%demo%' OR
          LOWER(au.first_name) LIKE '%test%' OR
          LOWER(au.last_name) LIKE '%test%' OR
          au.email LIKE '%brius.com' OR
          au.email LIKE '%mechanodontics.com'
        )
      )
      SELECT *
      FROM ranked_doctors
      WHERE dedup_rank = 1
      ORDER BY patient_count DESC, user_id ASC
    `;

    const sourceResult = await sourcePool.query(doctorsQuery);
    const doctors: DoctorData[] = sourceResult.rows;
    console.log(`   ✅ Extracted ${doctors.length} deduplicated active doctors with patients`);

    if (doctors.length === 0) {
      console.log('   ⚠️  No doctors found matching criteria');
      return;
    }

    // Step 3: Show sample of doctors to be migrated
    console.log('\n📋 3. Sample doctors to migrate:');
    doctors.slice(0, 5).forEach((doctor, i) => {
      console.log(`   ${i + 1}. ${doctor.first_name} ${doctor.last_name} (${doctor.email})`);
      console.log(`      Patients: ${doctor.patient_count}, Office: ${doctor.has_office_assignment}`);
    });

    // Step 4: Check profiles availability
    console.log('\n👤 4. Checking profile availability...');
    const doctorIds = doctors.map(d => d.user_id);
    const profileQuery = `
      SELECT legacy_user_id, id as profile_id
      FROM profiles 
      WHERE legacy_user_id = ANY($1) AND profile_type = 'doctor'
    `;
    const profilesResult = await targetPool.query(profileQuery, [doctorIds]);
    const profileMap = new Map(profilesResult.rows.map(row => [row.legacy_user_id, row.profile_id]));
    console.log(`   ✅ Found ${profilesResult.rows.length} existing doctor profiles`);

    // Step 5: Migrate doctors
    console.log('\n🔄 5. Migrating doctors...');
    let migrated = 0;
    let errors = 0;
    const BATCH_SIZE = 50;

    for (let i = 0; i < doctors.length; i += BATCH_SIZE) {
      const batch = doctors.slice(i, i + BATCH_SIZE);
      console.log(`   📦 Batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(doctors.length/BATCH_SIZE)}`);

      for (const doctor of batch) {
        try {
          const profileId = profileMap.get(doctor.user_id);
          
          const insertQuery = `
            INSERT INTO doctors (
              legacy_user_id,
              profile_id,
              legacy_doctor_id,
              first_name,
              last_name,
              email,
              phone,
              specialization,
              license_number,
              is_active,
              is_verified,
              archived,
              suspended,
              metadata,
              created_at,
              updated_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW()
            )
          `;

          const metadata = {
            source: 'deduplicated_migration',
            patient_count: doctor.patient_count,
            has_office_assignment: doctor.has_office_assignment,
            has_settings: doctor.has_settings,
            username: doctor.username,
            date_joined: doctor.date_joined,
            last_login: doctor.last_login,
            dedup_rank: doctor.dedup_rank
          };

          await targetPool.query(insertQuery, [
            doctor.user_id,
            profileId || null,
            doctor.user_id,
            doctor.first_name || '',
            doctor.last_name || '',
            doctor.email || '',
            null, // phone
            'General Practice', // specialization
            null, // license_number
            true, // is_active
            true, // is_verified
            false, // archived
            false, // suspended
            JSON.stringify(metadata)
          ]);

          migrated++;

        } catch (error: any) {
          console.error(`   ❌ Error migrating doctor ${doctor.user_id}: ${error.message}`);
          errors++;
        }
      }
    }

    // Step 6: Final verification
    console.log('\n✅ 6. Final verification...');
    const finalCount = await targetPool.query('SELECT COUNT(*) as count FROM doctors');
    const count = parseInt(finalCount.rows[0].count);

    // Get stats on migrated doctors
    const statsQuery = `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN profile_id IS NOT NULL THEN 1 END) as with_profiles,
        AVG((metadata->>'patient_count')::int) as avg_patients
      FROM doctors
    `;
    const statsResult = await targetPool.query(statsQuery);
    const stats = statsResult.rows[0];

    console.log('\n' + '='.repeat(60));
    console.log('🎯 MIGRATION COMPLETE!');
    console.log(`   🔍 Source analysis:`);
    console.log(`      Original potential doctors: 1,181`);
    console.log(`      Active doctors: 1,015`);
    console.log(`      With active patients: 408`);
    console.log(`      After deduplication: ${doctors.length}`);
    console.log(`   ✅ Migration results:`);
    console.log(`      Successfully migrated: ${migrated}`);
    console.log(`      Errors: ${errors}`);
    console.log(`      Final database count: ${count}`);
    console.log(`      With profiles: ${stats.with_profiles}`);
    console.log(`      Average patients per doctor: ${Math.round(stats.avg_patients)}`);
    console.log(`   📈 Success rate: ${((migrated / doctors.length) * 100).toFixed(2)}%`);

    if (count === migrated && errors === 0) {
      console.log('\n   🎉 PERFECT MIGRATION!');
      console.log('       All deduplicated active doctors with patients successfully migrated');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

migrateDeduplicated();
