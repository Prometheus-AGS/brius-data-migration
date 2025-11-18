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

async function investigateConstraintViolations() {
  console.log('🚨 INVESTIGATING CONSTRAINT VIOLATIONS');
  console.log('=' .repeat(50));

  const sourceClient = await sourcePool.connect();

  try {
    // 1. Get ACTUAL profile counts with pagination to avoid limits
    console.log('\n📊 GETTING ACTUAL PROFILE COUNTS...');

    let totalProfiles = 0;
    let hasMore = true;
    let offset = 0;
    const pageSize = 1000;

    while (hasMore) {
      const { data: profilePage, error: profileError } = await supabase
        .from('profiles')
        .select('legacy_user_id, legacy_patient_id')
        .range(offset, offset + pageSize - 1);

      if (profileError) {
        throw new Error(`Error fetching profiles: ${profileError.message}`);
      }

      if (profilePage && profilePage.length > 0) {
        totalProfiles += profilePage.length;
        hasMore = profilePage.length === pageSize;
        offset += pageSize;
      } else {
        hasMore = false;
      }
    }

    console.log(`   ACTUAL total profiles: ${totalProfiles}`);

    // 2. Check for duplicate legacy_user_ids in target
    const { data: duplicateUserIds, error: dupUserError } = await supabase
      .from('profiles')
      .select('legacy_user_id')
      .not('legacy_user_id', 'is', null);

    if (dupUserError) {
      throw new Error(`Error checking duplicate user IDs: ${dupUserError.message}`);
    }

    const userIdCounts = new Map<number, number>();
    duplicateUserIds?.forEach(profile => {
      if (profile.legacy_user_id) {
        userIdCounts.set(profile.legacy_user_id, (userIdCounts.get(profile.legacy_user_id) || 0) + 1);
      }
    });

    const duplicateUserIdEntries = Array.from(userIdCounts.entries()).filter(([id, count]) => count > 1);

    console.log(`\n🔍 DUPLICATE LEGACY_USER_ID CHECK:`);
    console.log(`   Total legacy_user_id entries: ${duplicateUserIds?.length || 0}`);
    console.log(`   Duplicate legacy_user_ids: ${duplicateUserIdEntries.length}`);

    if (duplicateUserIdEntries.length > 0) {
      console.log('   Sample duplicates:');
      duplicateUserIdEntries.slice(0, 10).forEach(([id, count]) => {
        console.log(`      legacy_user_id ${id}: ${count} profiles`);
      });
    }

    // 3. Check for duplicate legacy_patient_ids
    const { data: duplicatePatientIds, error: dupPatientError } = await supabase
      .from('profiles')
      .select('legacy_patient_id')
      .not('legacy_patient_id', 'is', null);

    if (dupPatientError) {
      throw new Error(`Error checking duplicate patient IDs: ${dupPatientError.message}`);
    }

    const patientIdCounts = new Map<number, number>();
    duplicatePatientIds?.forEach(profile => {
      if (profile.legacy_patient_id) {
        patientIdCounts.set(profile.legacy_patient_id, (patientIdCounts.get(profile.legacy_patient_id) || 0) + 1);
      }
    });

    const duplicatePatientIdEntries = Array.from(patientIdCounts.entries()).filter(([id, count]) => count > 1);

    console.log(`\n🔍 DUPLICATE LEGACY_PATIENT_ID CHECK:`);
    console.log(`   Total legacy_patient_id entries: ${duplicatePatientIds?.length || 0}`);
    console.log(`   Duplicate legacy_patient_ids: ${duplicatePatientIdEntries.length}`);

    if (duplicatePatientIdEntries.length > 0) {
      console.log('   Sample duplicates:');
      duplicatePatientIdEntries.slice(0, 10).forEach(([id, count]) => {
        console.log(`      legacy_patient_id ${id}: ${count} profiles`);
      });
    }

    // 4. Sample invalid emails
    console.log(`\n📧 CHECKING FOR INVALID EMAILS IN SOURCE...`);

    const invalidEmailQuery = `
      SELECT id, email, username, first_name, last_name
      FROM auth_user
      WHERE email IS NOT NULL
        AND email != ''
        AND email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$'
      LIMIT 10
    `;

    const invalidEmailResult = await sourceClient.query(invalidEmailQuery);
    console.log(`   Invalid emails in source: ${invalidEmailResult.rows.length} (sample)`);

    invalidEmailResult.rows.forEach((row: any) => {
      console.log(`      User ${row.id} (${row.username}): "${row.email}"`);
    });

    // 5. Check patients without suffixes
    console.log(`\n🏷️  CHECKING FOR PATIENTS WITHOUT SUFFIXES...`);

    const noSuffixQuery = `
      SELECT COUNT(*) as count
      FROM dispatch_patient
      WHERE suffix IS NULL OR suffix = ''
    `;

    const noSuffixResult = await sourceClient.query(noSuffixQuery);
    console.log(`   Patients without suffix: ${noSuffixResult.rows[0].count}`);

    // 6. Real analysis - what records actually need migration
    console.log(`\n🔍 REAL MISSING RECORD ANALYSIS...`);

    // Get all legacy_user_ids from profiles
    const allExistingUserIds = Array.from(userIdCounts.keys());

    // Get source user IDs that don't exist in target
    const sourceUserQuery = `
      SELECT id FROM auth_user
      WHERE id NOT IN (${allExistingUserIds.map(id => `'${id}'`).join(',')})
      LIMIT 50
    `;

    const reallyMissingResult = await sourceClient.query(sourceUserQuery);
    console.log(`   Actually missing auth_user IDs: ${reallyMissingResult.rows.length} (sample)`);

    reallyMissingResult.rows.forEach((row: any) => {
      console.log(`      Missing user ID: ${row.id}`);
    });

    console.log(`\n🚨 CONSTRAINT VIOLATION ROOT CAUSE:`);
    console.log(`   • We're trying to insert profiles that already exist`);
    console.log(`   • Our "missing records" analysis was flawed`);
    console.log(`   • Source contains ${duplicateUserIdEntries.length} potential duplicate mappings`);
    console.log(`   • Source contains data quality issues (invalid emails, missing suffixes)`);

    console.log(`\n✅ RECOMMENDED FIX:`);
    console.log(`   1. STOP current migration immediately`);
    console.log(`   2. Use UPSERT strategy instead of INSERT`);
    console.log(`   3. Handle data quality issues before migration`);
    console.log(`   4. Validate unique constraints before attempting inserts`);

  } catch (error: any) {
    console.error('❌ Investigation failed:', error.message);
    throw error;
  } finally {
    sourceClient.release();
    await sourcePool.end();
  }
}

if (require.main === module) {
  investigateConstraintViolations();
}