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

interface ProfileTypeFix {
  profileId: string;
  currentType: string;
  correctType: string;
  reason: string;
}

async function analyzeProfileTypeMismatches() {
  console.log('🔍 ANALYZING PROFILE TYPE MISMATCHES');
  console.log('=' .repeat(50));

  const mismatches: ProfileTypeFix[] = [];

  try {
    // 1. Find profiles linked to technicians but typed as 'doctor'
    const { data: technicianProfiles, error: techError } = await supabase
      .from('technicians')
      .select(`
        id,
        profile_id,
        legacy_user_id,
        employee_id,
        profiles!inner (
          id,
          profile_type,
          first_name,
          last_name,
          email
        )
      `);

    if (techError) {
      throw new Error(`Error fetching technician profiles: ${techError.message}`);
    }

    console.log(`\n🔧 Checking ${technicianProfiles?.length || 0} technician profile links...`);

    technicianProfiles?.forEach((tech: any) => {
      if (tech.profiles.profile_type !== 'technician') {
        mismatches.push({
          profileId: tech.profiles.id,
          currentType: tech.profiles.profile_type,
          correctType: 'technician',
          reason: `Profile linked to technician ${tech.id} but typed as '${tech.profiles.profile_type}'`
        });
      }
    });

    // 2. Find profiles linked to patients but typed incorrectly
    const { data: patientProfiles, error: patientError } = await supabase
      .from('patients')
      .select(`
        id,
        profile_id,
        legacy_user_id,
        profiles!inner (
          id,
          profile_type,
          first_name,
          last_name,
          email
        )
      `)
      .limit(100); // Sample to check pattern

    if (patientError) {
      throw new Error(`Error fetching patient profiles: ${patientError.message}`);
    }

    console.log(`\n🤒 Checking ${patientProfiles?.length || 0} patient profile links (sample)...`);

    let patientTypeMismatches = 0;
    patientProfiles?.forEach((patient: any) => {
      if (patient.profiles.profile_type !== 'patient') {
        patientTypeMismatches++;
        if (mismatches.length < 1000) { // Limit to prevent memory issues
          mismatches.push({
            profileId: patient.profiles.id,
            currentType: patient.profiles.profile_type,
            correctType: 'patient',
            reason: `Profile linked to patient ${patient.id} but typed as '${patient.profiles.profile_type}'`
          });
        }
      }
    });

    if (patientTypeMismatches > 0) {
      console.log(`   Found ${patientTypeMismatches} patient profile type mismatches in sample`);
    }

    // 3. Find profiles linked to doctors but typed incorrectly
    const { data: doctorProfiles, error: doctorError } = await supabase
      .from('doctors')
      .select(`
        id,
        profile_id,
        legacy_user_id,
        profiles!inner (
          id,
          profile_type,
          first_name,
          last_name,
          email
        )
      `)
      .limit(100); // Sample to check pattern

    if (doctorError) {
      throw new Error(`Error fetching doctor profiles: ${doctorError.message}`);
    }

    console.log(`\n👨‍⚕️ Checking ${doctorProfiles?.length || 0} doctor profile links (sample)...`);

    let doctorTypeMismatches = 0;
    doctorProfiles?.forEach((doctor: any) => {
      if (doctor.profiles.profile_type !== 'doctor') {
        doctorTypeMismatches++;
        if (mismatches.length < 1000) {
          mismatches.push({
            profileId: doctor.profiles.id,
            currentType: doctor.profiles.profile_type,
            correctType: 'doctor',
            reason: `Profile linked to doctor ${doctor.id} but typed as '${doctor.profiles.profile_type}'`
          });
        }
      }
    });

    if (doctorTypeMismatches > 0) {
      console.log(`   Found ${doctorTypeMismatches} doctor profile type mismatches in sample`);
    }

    // 4. Summary
    console.log(`\n📊 PROFILE TYPE MISMATCH SUMMARY:`);
    console.log(`Total mismatches found: ${mismatches.length}`);

    const mismatchesByType = mismatches.reduce((acc, mismatch) => {
      const key = `${mismatch.currentType} -> ${mismatch.correctType}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    Object.entries(mismatchesByType).forEach(([type, count]) => {
      console.log(`   ${type}: ${count} profiles`);
    });

    // 5. Show some examples
    if (mismatches.length > 0) {
      console.log(`\n🔍 Sample mismatches:`);
      mismatches.slice(0, 10).forEach((mismatch, index) => {
        console.log(`   ${index + 1}. ${mismatch.profileId}: ${mismatch.currentType} -> ${mismatch.correctType}`);
        console.log(`      Reason: ${mismatch.reason}`);
      });
    }

    return mismatches;

  } catch (error: any) {
    console.error('❌ Analysis failed:', error.message);
    throw error;
  }
}

async function fixProfileTypeMismatches(mismatches: ProfileTypeFix[]) {
  console.log(`\n🔧 FIXING ${mismatches.length} PROFILE TYPE MISMATCHES...`);

  let fixed = 0;
  let errors = 0;
  const BATCH_SIZE = 50;

  try {
    for (let i = 0; i < mismatches.length; i += BATCH_SIZE) {
      const batch = mismatches.slice(i, i + BATCH_SIZE);
      console.log(`Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(mismatches.length/BATCH_SIZE)}: ${batch.length} profiles`);

      for (const mismatch of batch) {
        try {
          const { error: updateError } = await supabase
            .from('profiles')
            .update({
              profile_type: mismatch.correctType,
              updated_at: new Date().toISOString(),
              metadata: {
                ...{}, // Preserve existing metadata
                profileTypeFixed: {
                  fixedAt: new Date().toISOString(),
                  previousType: mismatch.currentType,
                  newType: mismatch.correctType,
                  reason: mismatch.reason
                }
              }
            })
            .eq('id', mismatch.profileId);

          if (updateError) {
            console.error(`❌ Error fixing profile ${mismatch.profileId}:`, updateError.message);
            errors++;
          } else {
            fixed++;
            if (fixed % 25 === 0) {
              console.log(`   ✅ Fixed ${fixed} profiles so far...`);
            }
          }

        } catch (error: any) {
          console.error(`❌ Error processing profile ${mismatch.profileId}:`, error.message);
          errors++;
        }
      }

      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`\n📈 PROFILE TYPE FIX RESULTS:`);
    console.log(`✅ Profiles fixed: ${fixed}`);
    console.log(`❌ Errors: ${errors}`);

  } catch (error: any) {
    console.error('❌ Error fixing profile types:', error.message);
    throw error;
  }
}

async function validateProfileTypes() {
  console.log(`\n🔍 VALIDATING PROFILE TYPES AFTER FIX...`);

  try {
    // Get final profile type counts
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('profile_type');

    if (profileError) {
      throw new Error(`Error fetching profiles: ${profileError.message}`);
    }

    const profileCounts = profiles?.reduce((acc, profile) => {
      acc[profile.profile_type] = (acc[profile.profile_type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log(`📊 Final profile type distribution:`);
    Object.entries(profileCounts || {}).forEach(([type, count]) => {
      console.log(`   ${type}: ${count} profiles`);
    });

    // Get specialized record counts
    const [doctorCount, patientCount, technicianCount] = await Promise.all([
      supabase.from('doctors').select('id', { count: 'exact', head: true }),
      supabase.from('patients').select('id', { count: 'exact', head: true }),
      supabase.from('technicians').select('id', { count: 'exact', head: true })
    ]);

    console.log(`\n📋 Specialized record counts:`);
    console.log(`   doctors: ${doctorCount.count || 0}`);
    console.log(`   patients: ${patientCount.count || 0}`);
    console.log(`   technicians: ${technicianCount.count || 0}`);

    // Check for remaining mismatches
    const remainingMismatches = await analyzeProfileTypeMismatches();

    if (remainingMismatches.length === 0) {
      console.log(`\n✅ ALL PROFILE TYPES CORRECTLY SYNCHRONIZED!`);
    } else {
      console.log(`\n⚠️  ${remainingMismatches.length} profile type mismatches still remain`);
    }

  } catch (error: any) {
    console.error('❌ Validation failed:', error.message);
  }
}

async function main() {
  try {
    console.log('🚀 STARTING PROFILE TYPE MISMATCH REMEDIATION');
    console.log('=' .repeat(60));

    // 1. Analyze current mismatches
    const mismatches = await analyzeProfileTypeMismatches();

    if (mismatches.length === 0) {
      console.log('\n✅ No profile type mismatches found!');
      return;
    }

    // 2. Fix the mismatches
    await fixProfileTypeMismatches(mismatches);

    // 3. Validate the fixes
    await validateProfileTypes();

    console.log('\n🎉 Profile type remediation completed!');

  } catch (error: any) {
    console.error('💥 Remediation failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}