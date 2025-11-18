import { createClient } from '@supabase/supabase-js';
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

async function deepProfileInvestigation() {
  console.log('🔍 DEEP PROFILE INVESTIGATION');
  console.log('=' .repeat(50));

  try {
    // 1. Get ACTUAL profile type distribution with counts
    const { data: allProfiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, profile_type, legacy_user_id, first_name, last_name, email')
      .order('profile_type');

    if (profileError) {
      throw new Error(`Error fetching profiles: ${profileError.message}`);
    }

    const profileTypeDistribution = allProfiles?.reduce((acc, profile) => {
      acc[profile.profile_type] = (acc[profile.profile_type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log(`\n📊 ACTUAL PROFILE TYPE DISTRIBUTION:`);
    console.log(`Total profiles: ${allProfiles?.length || 0}`);
    Object.entries(profileTypeDistribution || {}).forEach(([type, count]) => {
      console.log(`   ${type}: ${count} profiles`);
    });

    // 2. Check how many specialized records have profile_id set
    const [doctorsWithProfiles, patientsWithProfiles, techniciansWithProfiles] = await Promise.all([
      supabase.from('doctors').select('id, profile_id').not('profile_id', 'is', null),
      supabase.from('patients').select('id, profile_id').not('profile_id', 'is', null),
      supabase.from('technicians').select('id, profile_id').not('profile_id', 'is', null)
    ]);

    const [doctorsWithoutProfiles, patientsWithoutProfiles, techniciansWithoutProfiles] = await Promise.all([
      supabase.from('doctors').select('id, profile_id').is('profile_id', null),
      supabase.from('patients').select('id, profile_id').is('profile_id', null),
      supabase.from('technicians').select('id, profile_id').is('profile_id', null)
    ]);

    console.log(`\n🔗 SPECIALIZED RECORDS WITH PROFILE LINKS:`);
    console.log(`   Doctors with profile_id: ${doctorsWithProfiles.data?.length || 0}`);
    console.log(`   Doctors without profile_id: ${doctorsWithoutProfiles.data?.length || 0}`);
    console.log(`   Patients with profile_id: ${patientsWithProfiles.data?.length || 0}`);
    console.log(`   Patients without profile_id: ${patientsWithoutProfiles.data?.length || 0}`);
    console.log(`   Technicians with profile_id: ${techniciansWithProfiles.data?.length || 0}`);
    console.log(`   Technicians without profile_id: ${techniciansWithoutProfiles.data?.length || 0}`);

    // 3. Check the profile type of linked profiles
    if (doctorsWithProfiles.data && doctorsWithProfiles.data.length > 0) {
      const doctorProfileIds = doctorsWithProfiles.data.map(d => d.profile_id);
      const { data: doctorProfiles } = await supabase
        .from('profiles')
        .select('id, profile_type')
        .in('id', doctorProfileIds.slice(0, 100)); // Sample

      const doctorProfileTypes = doctorProfiles?.reduce((acc, profile) => {
        acc[profile.profile_type] = (acc[profile.profile_type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      console.log(`\n👨‍⚕️ Profile types of first 100 doctor-linked profiles:`);
      Object.entries(doctorProfileTypes || {}).forEach(([type, count]) => {
        console.log(`   ${type}: ${count}`);
      });
    }

    if (patientsWithProfiles.data && patientsWithProfiles.data.length > 0) {
      const patientProfileIds = patientsWithProfiles.data.map(p => p.profile_id);
      const { data: patientProfiles } = await supabase
        .from('profiles')
        .select('id, profile_type')
        .in('id', patientProfileIds.slice(0, 100)); // Sample

      const patientProfileTypes = patientProfiles?.reduce((acc, profile) => {
        acc[profile.profile_type] = (acc[profile.profile_type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      console.log(`\n🤒 Profile types of first 100 patient-linked profiles:`);
      Object.entries(patientProfileTypes || {}).forEach(([type, count]) => {
        console.log(`   ${type}: ${count}`);
      });
    }

    if (techniciansWithProfiles.data && techniciansWithProfiles.data.length > 0) {
      const technicianProfileIds = techniciansWithProfiles.data.map(t => t.profile_id);
      const { data: technicianProfiles } = await supabase
        .from('profiles')
        .select('id, profile_type')
        .in('id', technicianProfileIds);

      const technicianProfileTypes = technicianProfiles?.reduce((acc, profile) => {
        acc[profile.profile_type] = (acc[profile.profile_type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      console.log(`\n🔧 Profile types of technician-linked profiles:`);
      Object.entries(technicianProfileTypes || {}).forEach(([type, count]) => {
        console.log(`   ${type}: ${count}`);
      });
    }

    // 4. Sample some unlinked specialized records to understand the problem
    if (patientsWithoutProfiles.data && patientsWithoutProfiles.data.length > 0) {
      console.log(`\n🔍 Sample patients without profile links:`);
      patientsWithoutProfiles.data.slice(0, 10).forEach((patient: any) => {
        console.log(`   Patient ${patient.id}: profile_id = ${patient.profile_id || 'NULL'}`);
      });

      // Check if these patients have legacy_user_id values
      const { data: samplePatientDetails } = await supabase
        .from('patients')
        .select('id, profile_id, legacy_user_id, legacy_patient_id')
        .is('profile_id', null)
        .limit(5);

      console.log(`\n🔍 Sample unlinked patients with legacy IDs:`);
      samplePatientDetails?.forEach(patient => {
        console.log(`   Patient ${patient.id}: legacy_user_id=${patient.legacy_user_id}, legacy_patient_id=${patient.legacy_patient_id}`);
      });
    }

    if (doctorsWithoutProfiles.data && doctorsWithoutProfiles.data.length > 0) {
      console.log(`\n🔍 Sample doctors without profile links:`);
      const { data: sampleDoctorDetails } = await supabase
        .from('doctors')
        .select('id, profile_id, legacy_user_id')
        .is('profile_id', null)
        .limit(5);

      sampleDoctorDetails?.forEach(doctor => {
        console.log(`   Doctor ${doctor.id}: legacy_user_id=${doctor.legacy_user_id}`);
      });
    }

    // 5. Check the total counts one more time
    const [totalDoctors, totalPatients, totalTechnicians, totalProfiles] = await Promise.all([
      supabase.from('doctors').select('id', { count: 'exact', head: true }),
      supabase.from('patients').select('id', { count: 'exact', head: true }),
      supabase.from('technicians').select('id', { count: 'exact', head: true }),
      supabase.from('profiles').select('id', { count: 'exact', head: true })
    ]);

    console.log(`\n📈 FINAL COUNTS VERIFICATION:`);
    console.log(`   Total profiles: ${totalProfiles.count}`);
    console.log(`   Total doctors: ${totalDoctors.count}`);
    console.log(`   Total patients: ${totalPatients.count}`);
    console.log(`   Total technicians: ${totalTechnicians.count}`);
    console.log(`   Total specialized records: ${(totalDoctors.count || 0) + (totalPatients.count || 0) + (totalTechnicians.count || 0)}`);

    const profileDeficit = ((totalDoctors.count || 0) + (totalPatients.count || 0) + (totalTechnicians.count || 0)) - (totalProfiles.count || 0);
    console.log(`   Profile deficit: ${profileDeficit} (negative means extra profiles)`);

  } catch (error: any) {
    console.error('❌ Investigation failed:', error.message);
  }
}

if (require.main === module) {
  deepProfileInvestigation();
}