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
  has_office_assignment: boolean;
  has_settings: boolean;
}

async function migrateAllDoctorsClean() {
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
    console.log('🚀 Starting complete doctor migration...\n');

    // Step 1: Clear existing doctors
    console.log('🧹 1. Clearing existing doctors from target database...');
    await targetPool.query('DELETE FROM doctors');
    const deletedCount = await targetPool.query('SELECT COUNT(*) as count FROM doctors');
    console.log(`   ✅ Cleared all doctors. Current count: ${deletedCount.rows[0].count}`);

    // Step 2: Extract all doctors from source
    console.log('\n📊 2. Extracting all 1,181 doctors from source...');
    const doctorsQuery = `
      SELECT DISTINCT
        au.id as user_id,
        au.first_name,
        au.last_name,
        au.email,
        au.username,
        au.is_active,
        au.date_joined,
        au.last_login,
        CASE WHEN dod.user_id IS NOT NULL THEN true ELSE false END as has_office_assignment,
        CASE WHEN dus.user_id IS NOT NULL THEN true ELSE false END as has_settings
      FROM auth_user au
      LEFT JOIN dispatch_office_doctors dod ON au.id = dod.user_id
      LEFT JOIN dispatch_usersetting dus ON au.id = dus.user_id
      WHERE dus.user_id IS NOT NULL OR dod.user_id IS NOT NULL
      ORDER BY au.id
    `;

    const sourceResult = await sourcePool.query(doctorsQuery);
    const doctors: DoctorData[] = sourceResult.rows;
    console.log(`   ✅ Extracted ${doctors.length} doctors`);

    // Step 3: Check if profiles exist for these doctors
    console.log('\n👤 3. Checking profile availability...');
    const doctorIds = doctors.map(d => d.user_id);
    const profileCheckQuery = `
      SELECT legacy_user_id, id as profile_id
      FROM profiles 
      WHERE legacy_user_id = ANY($1) AND profile_type = 'doctor'
    `;
    const profilesResult = await targetPool.query(profileCheckQuery, [doctorIds]);
    const profileMap = new Map(profilesResult.rows.map(row => [row.legacy_user_id, row.profile_id]));
    console.log(`   ✅ Found ${profilesResult.rows.length} existing doctor profiles`);

    // Step 4: Migrate doctors in batches
    console.log('\n🔄 4. Migrating doctors...');
    const BATCH_SIZE = 100;
    let migrated = 0;
    let errors = 0;

    for (let i = 0; i < doctors.length; i += BATCH_SIZE) {
      const batch = doctors.slice(i, i + BATCH_SIZE);
      console.log(`   📦 Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(doctors.length/BATCH_SIZE)} (${batch.length} doctors)`);

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
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
            )
          `;

          const metadata = {
            source: 'migration',
            has_office_assignment: doctor.has_office_assignment,
            has_settings: doctor.has_settings,
            username: doctor.username,
            date_joined: doctor.date_joined,
            last_login: doctor.last_login
          };

          await targetPool.query(insertQuery, [
            doctor.user_id,                    // legacy_user_id
            profileId || null,                 // profile_id
            doctor.user_id,                    // legacy_doctor_id
            doctor.first_name || '',           // first_name
            doctor.last_name || '',            // last_name
            doctor.email || '',                // email
            null,                              // phone
            'General Practice',                // specialization
            null,                              // license_number
            doctor.is_active || true,          // is_active
            true,                              // is_verified
            false,                             // archived
            false,                             // suspended
            JSON.stringify(metadata),          // metadata
            new Date(),                        // created_at
            new Date()                         // updated_at
          ]);

          migrated++;

        } catch (error) {
          console.error(`   ❌ Error migrating doctor ${doctor.user_id}: ${error.message}`);
          errors++;
        }
      }

      // Progress update
      const progress = ((i + batch.length) / doctors.length * 100).toFixed(1);
      console.log(`   📈 Progress: ${progress}% (${migrated} migrated, ${errors} errors)`);
    }

    // Step 5: Final verification
    console.log('\n✅ 5. Final verification...');
    const finalCountResult = await targetPool.query('SELECT COUNT(*) as count FROM doctors');
    const finalCount = parseInt(finalCountResult.rows[0].count);

    console.log('\n' + '='.repeat(60));
    console.log('🎯 MIGRATION COMPLETE!');
    console.log(`   Source doctors: 1,181`);
    console.log(`   Successfully migrated: ${migrated}`);
    console.log(`   Errors: ${errors}`);
    console.log(`   Target database count: ${finalCount}`);
    console.log(`   Success rate: ${((migrated / 1181) * 100).toFixed(2)}%`);

    if (finalCount === 1181) {
      console.log('   🎉 PERFECT MIGRATION - All 1,181 doctors successfully migrated!');
    } else if (migrated === 1181 && finalCount !== 1181) {
      console.log('   ⚠️  Migration count mismatch - check for duplicates or constraints');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

migrateAllDoctorsClean();
