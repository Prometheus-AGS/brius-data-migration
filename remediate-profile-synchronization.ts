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

interface RemediationStats {
  profilesCreated: number;
  specializedRecordsCreated: number;
  errors: number;
  skipped: number;
}

interface MissingProfileData {
  legacy_user_id: number;
  first_name: string;
  last_name: string;
  email: string;
  username: string;
  is_active: boolean;
  date_joined: string;
  last_login?: string;
  profile_type: 'doctor' | 'patient' | 'technician';
  specialized_record_id: string;
}

class ProfileSynchronizationRemediator {
  private sourceClient: any;

  constructor() {
    this.sourceClient = null;
  }

  async initialize() {
    this.sourceClient = await sourcePool.connect();
    console.log('✅ Connected to source database');
  }

  async cleanup() {
    if (this.sourceClient) {
      this.sourceClient.release();
    }
    await sourcePool.end();
  }

  // PHASE 1: Create missing profiles for existing specialized records
  async createMissingTechnicianProfiles(): Promise<RemediationStats> {
    console.log('\n🔧 PHASE 1A: Creating missing technician profiles...');

    const stats: RemediationStats = { profilesCreated: 0, specializedRecordsCreated: 0, errors: 0, skipped: 0 };

    try {
      // Get technician records that don't have profiles
      const { data: orphanedTechnicians, error: techError } = await supabase
        .from('technicians')
        .select(`
          id,
          legacy_user_id,
          legacy_technician_id,
          employee_id,
          status,
          hire_date
        `);

      if (techError) {
        throw new Error(`Failed to fetch technicians: ${techError.message}`);
      }

      console.log(`Found ${orphanedTechnicians?.length || 0} technician records to check`);

      if (!orphanedTechnicians || orphanedTechnicians.length === 0) {
        console.log('No technician records found');
        return stats;
      }

      // Check which ones don't have profiles
      const technicianIds = orphanedTechnicians.map(t => t.legacy_user_id).filter(id => id);

      if (technicianIds.length === 0) {
        console.log('No technicians with legacy_user_id found');
        return stats;
      }

      // Get existing profiles for these technicians
      const { data: existingProfiles } = await supabase
        .from('profiles')
        .select('legacy_user_id')
        .in('legacy_user_id', technicianIds)
        .eq('profile_type', 'technician');

      const existingProfileUserIds = new Set(existingProfiles?.map(p => p.legacy_user_id) || []);
      const missingProfileTechnicians = orphanedTechnicians.filter(t =>
        t.legacy_user_id && !existingProfileUserIds.has(t.legacy_user_id)
      );

      console.log(`${missingProfileTechnicians.length} technicians need profiles created`);

      if (missingProfileTechnicians.length === 0) {
        console.log('All technicians already have profiles');
        return stats;
      }

      // Get auth_user data for these technicians
      const authUserQuery = `
        SELECT
          au.id as user_id,
          au.first_name,
          au.last_name,
          au.email,
          au.username,
          au.is_active,
          au.date_joined,
          au.last_login
        FROM auth_user au
        WHERE au.id = ANY($1::int[])
      `;

      const authUserResult = await this.sourceClient.query(authUserQuery, [
        missingProfileTechnicians.map(t => t.legacy_user_id)
      ]);

      console.log(`Found ${authUserResult.rows.length} auth_user records for technicians`);

      // Create profiles for each technician
      for (const authUser of authUserResult.rows) {
        try {
          const { data: newProfile, error: profileError } = await supabase
            .from('profiles')
            .insert({
              profile_type: 'technician',
              first_name: authUser.first_name || '',
              last_name: authUser.last_name || '',
              email: authUser.email || null,
              username: authUser.username,
              is_active: authUser.is_active,
              legacy_user_id: authUser.user_id,
              created_at: authUser.date_joined,
              updated_at: authUser.last_login || authUser.date_joined,
              metadata: {
                remediationDate: new Date().toISOString(),
                sourceTable: 'auth_user',
                remediationType: 'missing_technician_profile',
                originalUsername: authUser.username
              }
            })
            .select('id')
            .single();

          if (profileError) {
            console.error(`❌ Error creating profile for technician user ${authUser.user_id}:`, profileError.message);
            stats.errors++;
            continue;
          }

          // Update the technician record to link to the new profile
          const technician = missingProfileTechnicians.find(t => t.legacy_user_id === authUser.user_id);
          if (technician && newProfile) {
            const { error: updateError } = await supabase
              .from('technicians')
              .update({ profile_id: newProfile.id })
              .eq('id', technician.id);

            if (updateError) {
              console.error(`❌ Error linking technician ${technician.id} to profile:`, updateError.message);
              stats.errors++;
            } else {
              console.log(`   ✅ Created profile and linked technician: ${authUser.first_name} ${authUser.last_name} (${authUser.username})`);
              stats.profilesCreated++;
            }
          }

        } catch (error: any) {
          console.error(`❌ Error processing technician user ${authUser.user_id}:`, error.message);
          stats.errors++;
        }
      }

    } catch (error: any) {
      console.error('❌ Error in technician profile creation:', error.message);
      throw error;
    }

    return stats;
  }

  async createMissingPatientProfiles(): Promise<RemediationStats> {
    console.log('\n🤒 PHASE 1B: Creating missing patient profiles...');

    const stats: RemediationStats = { profilesCreated: 0, specializedRecordsCreated: 0, errors: 0, skipped: 0 };
    const BATCH_SIZE = 100;

    try {
      // Get patient records that don't have profiles
      const { data: allPatients, error: patientError } = await supabase
        .from('patients')
        .select(`
          id,
          legacy_user_id,
          legacy_patient_id,
          profile_id
        `);

      if (patientError) {
        throw new Error(`Failed to fetch patients: ${patientError.message}`);
      }

      console.log(`Found ${allPatients?.length || 0} patient records to check`);

      // Filter patients that don't have profile_id set
      const orphanedPatients = allPatients?.filter(p => !p.profile_id && p.legacy_user_id) || [];
      console.log(`${orphanedPatients.length} patients need profiles created`);

      if (orphanedPatients.length === 0) {
        console.log('All patients already have profiles');
        return stats;
      }

      // Process in batches
      for (let i = 0; i < orphanedPatients.length; i += BATCH_SIZE) {
        const batch = orphanedPatients.slice(i, i + BATCH_SIZE);
        console.log(`Processing patient batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(orphanedPatients.length/BATCH_SIZE)}: ${batch.length} patients`);

        // Get auth_user and dispatch_patient data for this batch
        const patientUserIds = batch.map(p => p.legacy_user_id);
        const patientIds = batch.map(p => p.legacy_patient_id);

        const patientDataQuery = `
          SELECT
            au.id as user_id,
            au.first_name,
            au.last_name,
            au.email,
            au.username,
            au.is_active,
            au.date_joined,
            au.last_login,
            dp.id as patient_id,
            dp.suffix,
            dp.birthdate,
            dp.sex
          FROM auth_user au
          INNER JOIN dispatch_patient dp ON au.id = dp.user_id
          WHERE au.id = ANY($1::int[]) OR dp.id = ANY($2::int[])
        `;

        const patientDataResult = await this.sourceClient.query(patientDataQuery, [patientUserIds, patientIds]);

        // Create profiles for each patient in the batch
        for (const patientData of patientDataResult.rows) {
          try {
            const { data: newProfile, error: profileError } = await supabase
              .from('profiles')
              .insert({
                profile_type: 'patient',
                first_name: patientData.first_name || '',
                last_name: patientData.last_name || '',
                email: patientData.email || null,
                username: patientData.username,
                is_active: patientData.is_active,
                legacy_user_id: patientData.user_id,
                legacy_patient_id: patientData.patient_id,
                patient_suffix: patientData.suffix,
                date_of_birth: patientData.birthdate,
                gender: patientData.sex === 1 ? 'male' : patientData.sex === 2 ? 'female' : 'unknown',
                created_at: patientData.date_joined,
                updated_at: patientData.last_login || patientData.date_joined,
                metadata: {
                  remediationDate: new Date().toISOString(),
                  sourceTable: 'auth_user + dispatch_patient',
                  remediationType: 'missing_patient_profile',
                  originalSuffix: patientData.suffix
                }
              })
              .select('id')
              .single();

            if (profileError) {
              console.error(`❌ Error creating profile for patient user ${patientData.user_id}:`, profileError.message);
              stats.errors++;
              continue;
            }

            // Update the patient record to link to the new profile
            const patient = batch.find(p => p.legacy_user_id === patientData.user_id);
            if (patient && newProfile) {
              const { error: updateError } = await supabase
                .from('patients')
                .update({ profile_id: newProfile.id })
                .eq('id', patient.id);

              if (updateError) {
                console.error(`❌ Error linking patient ${patient.id} to profile:`, updateError.message);
                stats.errors++;
              } else {
                stats.profilesCreated++;
                if (stats.profilesCreated % 50 === 0) {
                  console.log(`   ✅ Created ${stats.profilesCreated} patient profiles so far...`);
                }
              }
            }

          } catch (error: any) {
            console.error(`❌ Error processing patient user ${patientData.user_id}:`, error.message);
            stats.errors++;
          }
        }

        // Small delay between batches to avoid overwhelming the database
        await new Promise(resolve => setTimeout(resolve, 100));
      }

    } catch (error: any) {
      console.error('❌ Error in patient profile creation:', error.message);
      throw error;
    }

    return stats;
  }

  async createMissingDoctorProfiles(): Promise<RemediationStats> {
    console.log('\n👨‍⚕️ PHASE 1C: Creating missing doctor profiles...');

    const stats: RemediationStats = { profilesCreated: 0, specializedRecordsCreated: 0, errors: 0, skipped: 0 };
    const BATCH_SIZE = 50;

    try {
      // Get doctor records that don't have profiles
      const { data: allDoctors, error: doctorError } = await supabase
        .from('doctors')
        .select(`
          id,
          legacy_user_id,
          profile_id
        `);

      if (doctorError) {
        throw new Error(`Failed to fetch doctors: ${doctorError.message}`);
      }

      console.log(`Found ${allDoctors?.length || 0} doctor records to check`);

      // Filter doctors that don't have profile_id set
      const orphanedDoctors = allDoctors?.filter(d => !d.profile_id && d.legacy_user_id) || [];
      console.log(`${orphanedDoctors.length} doctors need profiles created`);

      if (orphanedDoctors.length === 0) {
        console.log('All doctors already have profiles');
        return stats;
      }

      // Process in batches
      for (let i = 0; i < orphanedDoctors.length; i += BATCH_SIZE) {
        const batch = orphanedDoctors.slice(i, i + BATCH_SIZE);
        console.log(`Processing doctor batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(orphanedDoctors.length/BATCH_SIZE)}: ${batch.length} doctors`);

        // Get auth_user data for this batch
        const doctorUserIds = batch.map(d => d.legacy_user_id);

        const doctorDataQuery = `
          SELECT
            au.id as user_id,
            au.first_name,
            au.last_name,
            au.email,
            au.username,
            au.is_active,
            au.date_joined,
            au.last_login
          FROM auth_user au
          WHERE au.id = ANY($1::int[])
        `;

        const doctorDataResult = await this.sourceClient.query(doctorDataQuery, [doctorUserIds]);

        // Create profiles for each doctor in the batch
        for (const doctorData of doctorDataResult.rows) {
          try {
            const { data: newProfile, error: profileError } = await supabase
              .from('profiles')
              .insert({
                profile_type: 'doctor',
                first_name: doctorData.first_name || '',
                last_name: doctorData.last_name || '',
                email: doctorData.email || null,
                username: doctorData.username,
                is_active: doctorData.is_active,
                legacy_user_id: doctorData.user_id,
                created_at: doctorData.date_joined,
                updated_at: doctorData.last_login || doctorData.date_joined,
                metadata: {
                  remediationDate: new Date().toISOString(),
                  sourceTable: 'auth_user',
                  remediationType: 'missing_doctor_profile',
                  originalUsername: doctorData.username
                }
              })
              .select('id')
              .single();

            if (profileError) {
              console.error(`❌ Error creating profile for doctor user ${doctorData.user_id}:`, profileError.message);
              stats.errors++;
              continue;
            }

            // Update the doctor record to link to the new profile
            const doctor = batch.find(d => d.legacy_user_id === doctorData.user_id);
            if (doctor && newProfile) {
              const { error: updateError } = await supabase
                .from('doctors')
                .update({ profile_id: newProfile.id })
                .eq('id', doctor.id);

              if (updateError) {
                console.error(`❌ Error linking doctor ${doctor.id} to profile:`, updateError.message);
                stats.errors++;
              } else {
                stats.profilesCreated++;
                if (stats.profilesCreated % 25 === 0) {
                  console.log(`   ✅ Created ${stats.profilesCreated} doctor profiles so far...`);
                }
              }
            }

          } catch (error: any) {
            console.error(`❌ Error processing doctor user ${doctorData.user_id}:`, error.message);
            stats.errors++;
          }
        }

        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 200));
      }

    } catch (error: any) {
      console.error('❌ Error in doctor profile creation:', error.message);
      throw error;
    }

    return stats;
  }

  async validateSynchronization(): Promise<void> {
    console.log('\n🔍 FINAL VALIDATION: Checking profile synchronization...');

    try {
      // Get current counts
      const [profileCounts, doctorCount, patientCount, technicianCount] = await Promise.all([
        supabase.from('profiles').select('profile_type'),
        supabase.from('doctors').select('id', { count: 'exact', head: true }),
        supabase.from('patients').select('id', { count: 'exact', head: true }),
        supabase.from('technicians').select('id', { count: 'exact', head: true })
      ]);

      const profiles = profileCounts.data || [];
      const profilesByType = profiles.reduce((acc: any, profile) => {
        acc[profile.profile_type] = (acc[profile.profile_type] || 0) + 1;
        return acc;
      }, {});

      console.log('\n📊 POST-REMEDIATION COUNTS:');
      console.log(`Total profiles: ${profiles.length}`);
      Object.entries(profilesByType).forEach(([type, count]) => {
        console.log(`   ${type} profiles: ${count}`);
      });

      console.log('\nSpecialized record counts:');
      console.log(`   doctors: ${doctorCount.count || 0}`);
      console.log(`   patients: ${patientCount.count || 0}`);
      console.log(`   technicians: ${technicianCount.count || 0}`);

      // Check for remaining orphaned records
      const orphanedChecks = await Promise.all([
        supabase.rpc('count_orphaned_doctors'),
        supabase.rpc('count_orphaned_patients'),
        supabase.rpc('count_orphaned_technicians')
      ]);

      console.log('\n⚠️  Remaining orphaned records:');
      console.log(`   orphaned doctors: ${orphanedChecks[0]?.data || 'N/A'}`);
      console.log(`   orphaned patients: ${orphanedChecks[1]?.data || 'N/A'}`);
      console.log(`   orphaned technicians: ${orphanedChecks[2]?.data || 'N/A'}`);

    } catch (error: any) {
      console.error('❌ Error during validation:', error.message);
    }
  }
}

async function main() {
  const remediator = new ProfileSynchronizationRemediator();

  try {
    console.log('🚀 STARTING PROFILE SYNCHRONIZATION REMEDIATION');
    console.log('=' .repeat(60));

    await remediator.initialize();

    // Phase 1: Create missing profiles for existing specialized records
    console.log('\n📋 PHASE 1: Creating missing profiles for existing specialized records');

    const technicianStats = await remediator.createMissingTechnicianProfiles();
    const patientStats = await remediator.createMissingPatientProfiles();
    const doctorStats = await remediator.createMissingDoctorProfiles();

    // Summary
    const totalStats = {
      profilesCreated: technicianStats.profilesCreated + patientStats.profilesCreated + doctorStats.profilesCreated,
      errors: technicianStats.errors + patientStats.errors + doctorStats.errors
    };

    console.log('\n📈 REMEDIATION SUMMARY:');
    console.log(`✅ Total profiles created: ${totalStats.profilesCreated}`);
    console.log(`   • Technician profiles: ${technicianStats.profilesCreated}`);
    console.log(`   • Patient profiles: ${patientStats.profilesCreated}`);
    console.log(`   • Doctor profiles: ${doctorStats.profilesCreated}`);
    console.log(`❌ Total errors: ${totalStats.errors}`);

    // Validation
    await remediator.validateSynchronization();

    console.log('\n🎉 Profile synchronization remediation completed!');

  } catch (error: any) {
    console.error('💥 Remediation failed:', error.message);
    process.exit(1);
  } finally {
    await remediator.cleanup();
  }
}

if (require.main === module) {
  main();
}