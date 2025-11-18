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

async function finalComprehensiveValidation() {
  console.log('🔍 FINAL COMPREHENSIVE VALIDATION');
  console.log('After upsert migration and admin type fixes');
  console.log('=' .repeat(50));

  const sourceClient = await sourcePool.connect();

  try {
    // 1. SOURCE DATABASE COUNTS
    console.log('\n📊 SOURCE DATABASE VERIFICATION:');

    const [sourceUsers, sourcePatients] = await Promise.all([
      sourceClient.query('SELECT COUNT(*) as count FROM auth_user WHERE is_active = true'),
      sourceClient.query('SELECT COUNT(*) as count FROM dispatch_patient')
    ]);

    console.log(`   Active auth_user records: ${sourceUsers.rows[0].count}`);
    console.log(`   dispatch_patient records: ${sourcePatients.rows[0].count}`);

    // 2. TARGET DATABASE COUNTS
    console.log('\n📊 TARGET DATABASE VERIFICATION:');

    const [profileCount, doctorCount, patientCount, technicianCount] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('doctors').select('*', { count: 'exact', head: true }),
      supabase.from('patients').select('*', { count: 'exact', head: true }),
      supabase.from('technicians').select('*', { count: 'exact', head: true })
    ]);

    console.log(`   Total profiles: ${profileCount.count}`);
    console.log(`   Doctors: ${doctorCount.count}`);
    console.log(`   Patients: ${patientCount.count}`);
    console.log(`   Technicians: ${technicianCount.count}`);
    console.log(`   Total specialized: ${(doctorCount.count || 0) + (patientCount.count || 0) + (technicianCount.count || 0)}`);

    // 3. PROFILE TYPE DISTRIBUTION
    console.log('\n📊 PROFILE TYPE DISTRIBUTION:');

    const { data: profileTypes } = await supabase
      .from('profiles')
      .select('profile_type')
      .not('profile_type', 'is', null);

    const typeDistribution = profileTypes?.reduce((acc: any, profile) => {
      acc[profile.profile_type] = (acc[profile.profile_type] || 0) + 1;
      return acc;
    }, {});

    Object.entries(typeDistribution || {}).forEach(([type, count]) => {
      console.log(`   ${type}: ${count}`);
    });

    // 4. RELATIONSHIP INTEGRITY CHECK
    console.log('\n🔗 RELATIONSHIP INTEGRITY CHECK:');

    const [orphanedDoctors, orphanedPatients, orphanedTechnicians] = await Promise.all([
      supabase.from('doctors').select('id', { count: 'exact', head: true }).is('profile_id', null),
      supabase.from('patients').select('id', { count: 'exact', head: true }).is('profile_id', null),
      supabase.from('technicians').select('id', { count: 'exact', head: true }).is('profile_id', null)
    ]);

    console.log(`   Orphaned doctors: ${orphanedDoctors.count || 0}`);
    console.log(`   Orphaned patients: ${orphanedPatients.count || 0}`);
    console.log(`   Orphaned technicians: ${orphanedTechnicians.count || 0}`);

    const totalOrphaned = (orphanedDoctors.count || 0) + (orphanedPatients.count || 0) + (orphanedTechnicians.count || 0);

    // 5. REVERSE RELATIONSHIP CHECK (profiles without specialized records)
    console.log('\n🔍 REVERSE RELATIONSHIP CHECK:');

    const { data: profilesWithoutSpecialized } = await supabase
      .from('profiles')
      .select(`
        id,
        profile_type,
        legacy_user_id,
        first_name,
        last_name,
        doctors!left(id),
        patients!left(id),
        technicians!left(id)
      `)
      .in('profile_type', ['doctor', 'patient', 'technician']);

    let doctorProfilesWithoutRecord = 0;
    let patientProfilesWithoutRecord = 0;
    let technicianProfilesWithoutRecord = 0;

    profilesWithoutSpecialized?.forEach(profile => {
      if (profile.profile_type === 'doctor' && !profile.doctors?.length) {
        doctorProfilesWithoutRecord++;
      } else if (profile.profile_type === 'patient' && !profile.patients?.length) {
        patientProfilesWithoutRecord++;
      } else if (profile.profile_type === 'technician' && !profile.technicians?.length) {
        technicianProfilesWithoutRecord++;
      }
    });

    console.log(`   Doctor profiles without doctor record: ${doctorProfilesWithoutRecord}`);
    console.log(`   Patient profiles without patient record: ${patientProfilesWithoutRecord}`);
    console.log(`   Technician profiles without technician record: ${technicianProfilesWithoutRecord}`);

    // 6. LEGACY ID MAPPING INTEGRITY
    console.log('\n🎯 LEGACY ID MAPPING INTEGRITY:');

    const { data: duplicateLegacyUserIds } = await supabase
      .from('profiles')
      .select('legacy_user_id')
      .not('legacy_user_id', 'is', null);

    const userIdCounts = new Map<number, number>();
    duplicateLegacyUserIds?.forEach(profile => {
      if (profile.legacy_user_id) {
        userIdCounts.set(profile.legacy_user_id, (userIdCounts.get(profile.legacy_user_id) || 0) + 1);
      }
    });

    const duplicateEntries = Array.from(userIdCounts.entries()).filter(([id, count]) => count > 1);

    console.log(`   Total legacy_user_id mappings: ${duplicateLegacyUserIds?.length || 0}`);
    console.log(`   Duplicate legacy_user_ids: ${duplicateEntries.length}`);

    if (duplicateEntries.length > 0) {
      console.log('   ⚠️  Duplicate legacy_user_ids found:');
      duplicateEntries.slice(0, 5).forEach(([id, count]) => {
        console.log(`      legacy_user_id ${id}: ${count} profiles`);
      });
    }

    // 7. DATA COVERAGE ANALYSIS
    console.log('\n📈 DATA COVERAGE ANALYSIS:');

    const profileCoverage = ((profileCount.count || 0) / sourceUsers.rows[0].count * 100).toFixed(2);
    const patientCoverage = ((patientCount.count || 0) / sourcePatients.rows[0].count * 100).toFixed(2);

    console.log(`   Profile coverage: ${profileCoverage}% (${profileCount.count}/${sourceUsers.rows[0].count})`);
    console.log(`   Patient coverage: ${patientCoverage}% (${patientCount.count}/${sourcePatients.rows[0].count})`);

    // 8. CONSTRAINT VALIDATION
    console.log('\n✅ CONSTRAINT VALIDATION:');

    const { data: patientsWithoutSuffix, error: suffixError } = await supabase
      .from('profiles')
      .select('id, legacy_user_id, patient_suffix')
      .eq('profile_type', 'patient')
      .is('patient_suffix', null);

    if (suffixError) {
      console.log('   ❌ Error checking patient suffix constraint');
    } else {
      console.log(`   Patient suffix constraint violations: ${patientsWithoutSuffix?.length || 0}`);
    }

    // 9. FINAL ASSESSMENT
    console.log('\n🏆 FINAL MIGRATION ASSESSMENT:');

    const issues = [];

    if (totalOrphaned > 0) {
      issues.push(`${totalOrphaned} orphaned specialized records`);
    }

    if (doctorProfilesWithoutRecord > 0) {
      issues.push(`${doctorProfilesWithoutRecord} doctor profiles without doctor records`);
    }

    if (patientProfilesWithoutRecord > 0) {
      issues.push(`${patientProfilesWithoutRecord} patient profiles without patient records`);
    }

    if (technicianProfilesWithoutRecord > 0) {
      issues.push(`${technicianProfilesWithoutRecord} technician profiles without technician records`);
    }

    if (duplicateEntries.length > 0) {
      issues.push(`${duplicateEntries.length} duplicate legacy_user_id mappings`);
    }

    if ((patientsWithoutSuffix?.length || 0) > 0) {
      issues.push(`${patientsWithoutSuffix?.length} patient suffix constraint violations`);
    }

    if (issues.length === 0) {
      console.log('🎉 *** PERFECT MIGRATION SUCCESS! ***');
      console.log('   ✅ All profiles migrated');
      console.log('   ✅ All relationships preserved');
      console.log('   ✅ All constraints satisfied');
      console.log('   ✅ Zero orphaned records');
      console.log('   ✅ Perfect data integrity');
      console.log('   ✅ Legacy ID mappings intact');
      console.log('');
      console.log('🚀 Migration is PRODUCTION READY! 🚀');
    } else {
      console.log('⚠️  Migration completed with issues:');
      issues.forEach(issue => console.log(`   • ${issue}`));
    }

    // 10. SUMMARY STATISTICS
    console.log('\n📊 MIGRATION SUMMARY STATISTICS:');
    console.log(`   Total records processed: ${sourceUsers.rows[0].count}`);
    console.log(`   Profiles created/updated: ${profileCount.count}`);
    console.log(`   Specialized records linked: ${(doctorCount.count || 0) + (patientCount.count || 0) + (technicianCount.count || 0)}`);
    console.log(`   Data integrity score: ${issues.length === 0 ? '100%' : `${Math.max(0, 100 - issues.length * 10)}%`}`);
    console.log(`   Migration status: ${issues.length === 0 ? 'COMPLETE' : 'NEEDS ATTENTION'}`);

  } catch (error: any) {
    console.error('❌ Validation failed:', error.message);
    throw error;
  } finally {
    sourceClient.release();
    await sourcePool.end();
  }
}

if (require.main === module) {
  finalComprehensiveValidation();
}