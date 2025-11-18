import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'https://gyyottknjakkagswebwh.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5eW90dGtuamFra2Fnc3dlYndoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDY5MjUzMCwiZXhwIjoyMDc2MjY4NTMwfQ.dwE7xSnkC0n6hmb28aYgTBB8DGD7Pa6DaAp9eHZDWT8';

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

interface ProfileRelationshipAnalysis {
  totalProfiles: number;
  profilesByType: Record<string, number>;
  profilesWithLegacyIds: Record<string, number>;
  specializedTableCounts: {
    doctors: number;
    patients: number;
    technicians: number;
  };
  orphanedProfiles: {
    doctorProfilesWithoutDoctorRecord: number;
    patientProfilesWithoutPatientRecord: number;
    technicianProfilesWithoutTechnicianRecord: number;
  };
  orphanedSpecializedRecords: {
    doctorRecordsWithoutProfile: number;
    patientRecordsWithoutProfile: number;
    technicianRecordsWithoutProfile: number;
  };
  legacyIdMismatches: {
    doctorsWithMismatchedLegacyIds: number;
    patientsWithMismatchedLegacyIds: number;
    techniciansWithMismatchedLegacyIds: number;
  };
}

async function analyzeProfileRelationships(): Promise<ProfileRelationshipAnalysis> {
  console.log('🔍 Starting comprehensive profile relationship analysis...\n');

  // 1. Get total profile counts by type
  const { data: profileCounts, error: profileError } = await supabase
    .from('profiles')
    .select('profile_type, legacy_user_id, legacy_patient_id');

  if (profileError) {
    throw new Error(`Failed to fetch profiles: ${profileError.message}`);
  }

  const totalProfiles = profileCounts?.length || 0;
  const profilesByType: Record<string, number> = {};
  const profilesWithLegacyIds: Record<string, number> = {
    doctor: 0,
    patient: 0,
    technician: 0
  };

  profileCounts?.forEach(profile => {
    profilesByType[profile.profile_type] = (profilesByType[profile.profile_type] || 0) + 1;

    if (profile.legacy_user_id) {
      profilesWithLegacyIds[profile.profile_type] = (profilesWithLegacyIds[profile.profile_type] || 0) + 1;
    }
  });

  console.log('📊 Profile counts by type:');
  Object.entries(profilesByType).forEach(([type, count]) => {
    console.log(`   ${type}: ${count} (${profilesWithLegacyIds[type] || 0} with legacy_user_id)`);
  });

  // 2. Get specialized table counts
  const [doctorsResult, patientsResult, techniciansResult] = await Promise.all([
    supabase.from('doctors').select('id, profile_id', { count: 'exact', head: true }),
    supabase.from('patients').select('id, profile_id', { count: 'exact', head: true }),
    supabase.from('technicians').select('id, profile_id', { count: 'exact', head: true })
  ]);

  const specializedTableCounts = {
    doctors: doctorsResult.count || 0,
    patients: patientsResult.count || 0,
    technicians: techniciansResult.count || 0
  };

  console.log('\n🏥 Specialized table counts:');
  Object.entries(specializedTableCounts).forEach(([table, count]) => {
    console.log(`   ${table}: ${count}`);
  });

  // 3. Find orphaned profiles (profiles without corresponding specialized records)
  const { data: doctorProfiles } = await supabase
    .from('profiles')
    .select('id')
    .eq('profile_type', 'doctor');

  const { data: doctorRecords } = await supabase
    .from('doctors')
    .select('profile_id');

  const doctorProfileIds = new Set(doctorProfiles?.map(p => p.id) || []);
  const doctorRecordProfileIds = new Set(doctorRecords?.map(d => d.profile_id) || []);

  const { data: patientProfiles } = await supabase
    .from('profiles')
    .select('id')
    .eq('profile_type', 'patient');

  const { data: patientRecords } = await supabase
    .from('patients')
    .select('profile_id');

  const patientProfileIds = new Set(patientProfiles?.map(p => p.id) || []);
  const patientRecordProfileIds = new Set(patientRecords?.map(p => p.profile_id) || []);

  const { data: technicianProfiles } = await supabase
    .from('profiles')
    .select('id')
    .eq('profile_type', 'technician');

  const { data: technicianRecords } = await supabase
    .from('technicians')
    .select('profile_id');

  const technicianProfileIds = new Set(technicianProfiles?.map(p => p.id) || []);
  const technicianRecordProfileIds = new Set(technicianRecords?.map(t => t.profile_id) || []);

  const orphanedProfiles = {
    doctorProfilesWithoutDoctorRecord: doctorProfileIds.size - [...doctorProfileIds].filter(id => doctorRecordProfileIds.has(id)).length,
    patientProfilesWithoutPatientRecord: patientProfileIds.size - [...patientProfileIds].filter(id => patientRecordProfileIds.has(id)).length,
    technicianProfilesWithoutTechnicianRecord: technicianProfileIds.size - [...technicianProfileIds].filter(id => technicianRecordProfileIds.has(id)).length
  };

  const orphanedSpecializedRecords = {
    doctorRecordsWithoutProfile: doctorRecordProfileIds.size - [...doctorRecordProfileIds].filter(id => doctorProfileIds.has(id)).length,
    patientRecordsWithoutProfile: patientRecordProfileIds.size - [...patientRecordProfileIds].filter(id => patientProfileIds.has(id)).length,
    technicianRecordsWithoutProfile: technicianRecordProfileIds.size - [...technicianRecordProfileIds].filter(id => technicianProfileIds.has(id)).length
  };

  console.log('\n⚠️  Orphaned profiles (profiles without specialized records):');
  Object.entries(orphanedProfiles).forEach(([type, count]) => {
    if (count > 0) {
      console.log(`   ${type}: ${count}`);
    }
  });

  console.log('\n🔴 Orphaned specialized records (records without profiles):');
  Object.entries(orphanedSpecializedRecords).forEach(([type, count]) => {
    if (count > 0) {
      console.log(`   ${type}: ${count}`);
    }
  });

  // 4. Check for legacy ID mismatches
  const { data: doctorsWithProfiles } = await supabase
    .from('doctors')
    .select(`
      id,
      profile_id,
      legacy_doctor_id,
      profiles!inner (
        id,
        legacy_user_id,
        profile_type
      )
    `);

  const { data: patientsWithProfiles } = await supabase
    .from('patients')
    .select(`
      id,
      profile_id,
      legacy_patient_id,
      profiles!inner (
        id,
        legacy_user_id,
        legacy_patient_id,
        profile_type
      )
    `);

  const { data: techniciansWithProfiles } = await supabase
    .from('technicians')
    .select(`
      id,
      profile_id,
      legacy_technician_id,
      profiles!inner (
        id,
        legacy_user_id,
        profile_type
      )
    `);

  const legacyIdMismatches = {
    doctorsWithMismatchedLegacyIds: 0,
    patientsWithMismatchedLegacyIds: 0,
    techniciansWithMismatchedLegacyIds: 0
  };

  // Check doctor legacy ID consistency
  doctorsWithProfiles?.forEach((doctor: any) => {
    if (doctor.legacy_doctor_id && doctor.profiles?.legacy_user_id) {
      // Note: We'd need to check if legacy_doctor_id should match legacy_user_id
      // This depends on source database structure
    }
  });

  // Check patient legacy ID consistency
  patientsWithProfiles?.forEach((patient: any) => {
    if (patient.legacy_patient_id && patient.profiles?.legacy_patient_id) {
      if (patient.legacy_patient_id !== patient.profiles.legacy_patient_id) {
        legacyIdMismatches.patientsWithMismatchedLegacyIds++;
      }
    }
  });

  console.log('\n🔄 Legacy ID mismatches:');
  Object.entries(legacyIdMismatches).forEach(([type, count]) => {
    if (count > 0) {
      console.log(`   ${type}: ${count}`);
    }
  });

  return {
    totalProfiles,
    profilesByType,
    profilesWithLegacyIds,
    specializedTableCounts,
    orphanedProfiles,
    orphanedSpecializedRecords,
    legacyIdMismatches
  };
}

async function examineSpecificProfileIssues() {
  console.log('\n🔍 Examining specific profile relationship issues...\n');

  // Get all profile IDs for each type
  const { data: doctorProfiles } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, email, legacy_user_id')
    .eq('profile_type', 'doctor');

  const { data: patientProfiles } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, email, legacy_user_id, legacy_patient_id, patient_suffix')
    .eq('profile_type', 'patient');

  const { data: technicianProfiles } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, email, legacy_user_id')
    .eq('profile_type', 'technician');

  // Get all specialized record profile IDs
  const { data: doctorRecords } = await supabase
    .from('doctors')
    .select('profile_id');

  const { data: patientRecords } = await supabase
    .from('patients')
    .select('profile_id');

  const { data: technicianRecords } = await supabase
    .from('technicians')
    .select('profile_id');

  // Find orphaned profiles
  const doctorRecordProfileIds = new Set(doctorRecords?.map((d: any) => d.profile_id) || []);
  const patientRecordProfileIds = new Set(patientRecords?.map((p: any) => p.profile_id) || []);
  const technicianRecordProfileIds = new Set(technicianRecords?.map((t: any) => t.profile_id) || []);

  const orphanedDoctorProfiles = doctorProfiles?.filter((profile: any) => !doctorRecordProfileIds.has(profile.id)).slice(0, 10);
  const orphanedPatientProfiles = patientProfiles?.filter((profile: any) => !patientRecordProfileIds.has(profile.id)).slice(0, 10);
  const orphanedTechnicianProfiles = technicianProfiles?.filter((profile: any) => !technicianRecordProfileIds.has(profile.id)).slice(0, 10);

  if (orphanedDoctorProfiles && orphanedDoctorProfiles.length > 0) {
    console.log('👨‍⚕️ Sample orphaned doctor profiles:');
    orphanedDoctorProfiles.forEach((profile: any) => {
      console.log(`   ${profile.first_name} ${profile.last_name} (${profile.email}) - legacy_user_id: ${profile.legacy_user_id}`);
    });
  }

  if (orphanedPatientProfiles && orphanedPatientProfiles.length > 0) {
    console.log('\n🤒 Sample orphaned patient profiles:');
    orphanedPatientProfiles.forEach((profile: any) => {
      console.log(`   ${profile.first_name} ${profile.last_name} (${profile.email}) - legacy_user_id: ${profile.legacy_user_id}, legacy_patient_id: ${profile.legacy_patient_id}, suffix: ${profile.patient_suffix}`);
    });
  }

  if (orphanedTechnicianProfiles && orphanedTechnicianProfiles.length > 0) {
    console.log('\n🔧 Sample orphaned technician profiles:');
    orphanedTechnicianProfiles.forEach((profile: any) => {
      console.log(`   ${profile.first_name} ${profile.last_name} (${profile.email}) - legacy_user_id: ${profile.legacy_user_id}`);
    });
  }
}

async function main() {
  try {
    console.log('🚀 Starting Profile Relationship Analysis');
    console.log('=' .repeat(50));

    const analysis = await analyzeProfileRelationships();

    await examineSpecificProfileIssues();

    console.log('\n📋 SUMMARY ANALYSIS');
    console.log('=' .repeat(50));
    console.log(`Total profiles: ${analysis.totalProfiles}`);
    console.log(`Total specialized records: ${Object.values(analysis.specializedTableCounts).reduce((a, b) => a + b, 0)}`);

    const totalOrphanedProfiles = Object.values(analysis.orphanedProfiles).reduce((a, b) => a + b, 0);
    const totalOrphanedRecords = Object.values(analysis.orphanedSpecializedRecords).reduce((a, b) => a + b, 0);

    console.log(`\n❌ Issues found:`);
    console.log(`   Orphaned profiles: ${totalOrphanedProfiles}`);
    console.log(`   Orphaned specialized records: ${totalOrphanedRecords}`);

    if (totalOrphanedProfiles > 0 || totalOrphanedRecords > 0) {
      console.log('\n🔧 Remediation needed: Profile-specialized record relationships are out of sync');
      console.log('   Next steps: Create scripts to fix these relationships using source database');
    } else {
      console.log('\n✅ All profile relationships are properly synchronized');
    }

  } catch (error) {
    console.error('❌ Analysis failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}