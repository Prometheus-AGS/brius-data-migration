import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'https://gyyottknjakkagswebwh.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const sourcePool = new Pool({
  host: process.env.SOURCE_DB_HOST,
  port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
  database: process.env.SOURCE_DB_NAME,
  user: process.env.SOURCE_DB_USER,
  password: process.env.SOURCE_DB_PASSWORD,
  ssl: false,
});

async function fixAdminProfileTypes() {
  console.log('🛠️  FIXING ADMIN PROFILE TYPE ISSUES');
  console.log('Strategy: Convert failed "admin" users to "master" profile type');
  console.log('=' .repeat(60));

  const sourceClient = await sourcePool.connect();

  try {
    // The 24 failed user IDs from the previous migration
    const failedUserIds = [
      186, 398, 456, 699, 885, 1082, 1305, 1999, 2593, 4086,
      4177, 4822, 5461, 5462, 5549, 6166, 6180, 7211, 7996,
      8340, 8593, 8689, 9394, 10198
    ];

    console.log(`📋 Processing ${failedUserIds.length} failed admin users...`);

    // Get their source data to understand their proper classification
    const userDataQuery = `
      SELECT DISTINCT
        au.id,
        au.first_name,
        au.last_name,
        au.email,
        au.username,
        au.password,
        au.is_active,
        au.is_staff,
        au.is_superuser,
        au.date_joined,
        au.last_login,
        COALESCE(aug.group_id, 0) as group_id,
        dp.id as patient_id,
        dp.suffix,
        dp.birthdate,
        dp.sex,
        dp.suspended
      FROM auth_user au
      LEFT JOIN auth_user_groups aug ON au.id = aug.user_id
      LEFT JOIN dispatch_patient dp ON au.id = dp.user_id
      WHERE au.id = ANY($1::int[])
      ORDER BY au.id
    `;

    const userDataResult = await sourceClient.query(userDataQuery, [failedUserIds]);

    console.log(`   Found ${userDataResult.rows.length} source user records`);

    let fixed = 0;
    let errors = 0;

    for (const userData of userDataResult.rows) {
      try {
        // Determine correct profile type (avoiding "admin")
        let profileType = 'master'; // Default for admin users
        if (userData.group_id === 2) profileType = 'doctor';
        else if (userData.group_id === 11) profileType = 'technician';
        else if (userData.group_id === 5) profileType = 'master';
        else if (userData.is_superuser) profileType = 'master';
        else if (userData.is_staff) profileType = 'master'; // Changed from 'admin' to 'master'
        else if (userData.group_id === 1) profileType = 'patient';
        else if (userData.patient_id) profileType = 'patient';

        // Clean email
        const cleanEmail = userData.email ? userData.email.trim().toLowerCase().replace(/['']/g, '') : null;
        const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
        const validEmail = cleanEmail && emailRegex.test(cleanEmail) ? cleanEmail : null;

        // Create the profile data with correct type
        const profileData = {
          profile_type: profileType,
          first_name: userData.first_name || '',
          last_name: userData.last_name || '',
          email: validEmail,
          phone: '',
          date_of_birth: userData.birthdate || null,
          gender: userData.sex === 1 ? 'male' : userData.sex === 2 ? 'female' : 'unknown',
          username: userData.username,
          password_hash: userData.password || null,
          is_active: userData.is_active,
          is_verified: false,
          archived: false,
          suspended: false, // Admin users are never suspended
          patient_suffix: null, // Admin users don't need patient suffix
          insurance_info: null,
          medical_history: null,
          created_at: userData.date_joined,
          updated_at: userData.last_login || userData.date_joined,
          last_login_at: userData.last_login,
          metadata: {
            adminProfileTypeFix: {
              migratedAt: new Date().toISOString(),
              originalGroupId: userData.group_id,
              isStaff: userData.is_staff,
              isSuperuser: userData.is_superuser,
              fixedFromAdmin: true
            }
          },
          embedding: null,
          legacy_user_id: userData.id,
          legacy_patient_id: userData.patient_id || null
        };

        // Upsert the profile with correct type
        const { error: upsertError } = await supabase
          .from('profiles')
          .upsert([profileData], {
            onConflict: 'legacy_user_id',
            ignoreDuplicates: false
          });

        if (upsertError) {
          console.error(`   ❌ Error fixing user ${userData.id} (${userData.username}): ${upsertError.message}`);
          errors++;
        } else {
          console.log(`   ✅ Fixed user ${userData.id} (${userData.username}) as ${profileType} type`);
          fixed++;
        }

      } catch (error: any) {
        console.error(`   ❌ Error processing user ${userData.id}: ${error.message}`);
        errors++;
      }
    }

    console.log(`\n📊 ADMIN TYPE FIX RESULTS:`);
    console.log(`✅ Successfully fixed: ${fixed}`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`📈 Success rate: ${((fixed / failedUserIds.length) * 100).toFixed(2)}%`);

    if (fixed === failedUserIds.length) {
      console.log('\n🎉 ALL ADMIN PROFILE TYPE ISSUES RESOLVED!');
    }

  } catch (error: any) {
    console.error('💥 Fix failed:', error.message);
    throw error;
  } finally {
    sourceClient.release();
    await sourcePool.end();
  }
}

if (require.main === module) {
  fixAdminProfileTypes();
}