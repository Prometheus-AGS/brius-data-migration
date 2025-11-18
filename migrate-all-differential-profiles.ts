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

interface MissingProfileRecord {
  specializedRecordId: string;
  legacy_user_id: number;
  legacy_patient_id?: number;
  record_type: 'doctor' | 'patient' | 'technician';
}

interface ProfileCreationStats {
  doctorProfilesCreated: number;
  patientProfilesCreated: number;
  technicianProfilesCreated: number;
  errors: number;
  skipped: number;
}

class DifferentialProfileMigrator {
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

  async findAllMissingProfiles(): Promise<MissingProfileRecord[]> {
    console.log('\n🔍 FINDING ALL SPECIALIZED RECORDS WITHOUT PROFILES...');

    const missingProfiles: MissingProfileRecord[] = [];

    try {
      // 1. Find doctors without profiles
      const { data: doctorsWithoutProfiles, error: doctorError } = await supabase
        .from('doctors')
        .select('id, legacy_user_id, profile_id')
        .is('profile_id', null)
        .not('legacy_user_id', 'is', null);

      if (doctorError) {
        throw new Error(`Error fetching doctors: ${doctorError.message}`);
      }

      doctorsWithoutProfiles?.forEach(doctor => {
        missingProfiles.push({
          specializedRecordId: doctor.id,
          legacy_user_id: doctor.legacy_user_id,
          record_type: 'doctor'
        });
      });

      console.log(`   Found ${doctorsWithoutProfiles?.length || 0} doctors without profiles`);

      // 2. Find patients without profiles
      const { data: patientsWithoutProfiles, error: patientError } = await supabase
        .from('patients')
        .select('id, legacy_user_id, legacy_patient_id, profile_id')
        .is('profile_id', null)
        .not('legacy_user_id', 'is', null);

      if (patientError) {
        throw new Error(`Error fetching patients: ${patientError.message}`);
      }

      patientsWithoutProfiles?.forEach(patient => {
        missingProfiles.push({
          specializedRecordId: patient.id,
          legacy_user_id: patient.legacy_user_id,
          legacy_patient_id: patient.legacy_patient_id,
          record_type: 'patient'
        });
      });

      console.log(`   Found ${patientsWithoutProfiles?.length || 0} patients without profiles`);

      // 3. Find technicians without profiles
      const { data: techniciansWithoutProfiles, error: technicianError } = await supabase
        .from('technicians')
        .select('id, legacy_user_id, profile_id')
        .is('profile_id', null)
        .not('legacy_user_id', 'is', null);

      if (technicianError) {
        throw new Error(`Error fetching technicians: ${technicianError.message}`);
      }

      techniciansWithoutProfiles?.forEach(technician => {
        missingProfiles.push({
          specializedRecordId: technician.id,
          legacy_user_id: technician.legacy_user_id,
          record_type: 'technician'
        });
      });

      console.log(`   Found ${techniciansWithoutProfiles?.length || 0} technicians without profiles`);

      console.log(`\n📊 TOTAL MISSING PROFILES: ${missingProfiles.length}`);
      const byType = missingProfiles.reduce((acc, record) => {
        acc[record.record_type] = (acc[record.record_type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      Object.entries(byType).forEach(([type, count]) => {
        console.log(`   ${type}: ${count} records`);
      });

      return missingProfiles;

    } catch (error: any) {
      console.error('❌ Error finding missing profiles:', error.message);
      throw error;
    }
  }

  async createMissingDoctorProfiles(doctorRecords: MissingProfileRecord[]): Promise<ProfileCreationStats> {
    console.log(`\n👨‍⚕️ CREATING ${doctorRecords.length} MISSING DOCTOR PROFILES...`);

    const stats: ProfileCreationStats = { doctorProfilesCreated: 0, patientProfilesCreated: 0, technicianProfilesCreated: 0, errors: 0, skipped: 0 };
    const BATCH_SIZE = 50;

    if (doctorRecords.length === 0) {
      console.log('   No doctor profiles to create');
      return stats;
    }

    try {
      // Get auth_user data for all doctor legacy_user_ids
      const doctorUserIds = doctorRecords.map(d => d.legacy_user_id);

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

      const authUserResult = await this.sourceClient.query(authUserQuery, [doctorUserIds]);
      const authUserMap = new Map(authUserResult.rows.map((row: any) => [row.user_id, row]));

      console.log(`   Found ${authUserResult.rows.length} auth_user records for doctors`);

      // Process in batches
      for (let i = 0; i < doctorRecords.length; i += BATCH_SIZE) {
        const batch = doctorRecords.slice(i, i + BATCH_SIZE);
        console.log(`   Processing doctor batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(doctorRecords.length/BATCH_SIZE)}: ${batch.length} profiles`);

        for (const doctorRecord of batch) {
          try {
            const authUser: any = authUserMap.get(doctorRecord.legacy_user_id);

            if (!authUser) {
              console.warn(`     No auth_user found for legacy_user_id ${doctorRecord.legacy_user_id}`);
              stats.skipped++;
              continue;
            }

            // Create profile
            const { data: newProfile, error: profileError } = await supabase
              .from('profiles')
              .insert({
                profile_type: 'doctor',
                first_name: authUser.first_name || '',
                last_name: authUser.last_name || '',
                email: authUser.email || null,
                username: authUser.username,
                is_active: authUser.is_active,
                legacy_user_id: authUser.user_id,
                created_at: authUser.date_joined,
                updated_at: authUser.last_login || authUser.date_joined,
                metadata: {
                  differentialMigrationDate: new Date().toISOString(),
                  sourceTable: 'auth_user',
                  migrationType: 'missing_doctor_profile',
                  originalUsername: authUser.username
                }
              })
              .select('id')
              .single();

            if (profileError) {
              if (profileError.code === '23505') { // Unique constraint violation
                console.warn(`     Profile already exists for legacy_user_id ${authUser.user_id}, linking existing...`);

                // Get existing profile
                const { data: existingProfile } = await supabase
                  .from('profiles')
                  .select('id')
                  .eq('legacy_user_id', authUser.user_id)
                  .single();

                if (existingProfile) {
                  // Link the doctor to existing profile
                  const { error: linkError } = await supabase
                    .from('doctors')
                    .update({ profile_id: existingProfile.id })
                    .eq('id', doctorRecord.specializedRecordId);

                  if (linkError) {
                    console.error(`     Error linking doctor to existing profile: ${linkError.message}`);
                    stats.errors++;
                  } else {
                    stats.doctorProfilesCreated++; // Count as success even though we didn't create, we linked
                  }
                }
              } else {
                console.error(`     Error creating profile for doctor user ${authUser.user_id}: ${profileError.message}`);
                stats.errors++;
              }
              continue;
            }

            // Link the doctor to the new profile
            const { error: linkError } = await supabase
              .from('doctors')
              .update({ profile_id: newProfile.id })
              .eq('id', doctorRecord.specializedRecordId);

            if (linkError) {
              console.error(`     Error linking doctor to new profile: ${linkError.message}`);
              stats.errors++;
            } else {
              stats.doctorProfilesCreated++;
              if (stats.doctorProfilesCreated % 25 === 0) {
                console.log(`     ✅ Created ${stats.doctorProfilesCreated} doctor profiles so far...`);
              }
            }

          } catch (error: any) {
            console.error(`     Error processing doctor ${doctorRecord.specializedRecordId}: ${error.message}`);
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

  async createMissingPatientProfiles(patientRecords: MissingProfileRecord[]): Promise<ProfileCreationStats> {
    console.log(`\n🤒 CREATING ${patientRecords.length} MISSING PATIENT PROFILES...`);

    const stats: ProfileCreationStats = { doctorProfilesCreated: 0, patientProfilesCreated: 0, technicianProfilesCreated: 0, errors: 0, skipped: 0 };
    const BATCH_SIZE = 100;

    if (patientRecords.length === 0) {
      console.log('   No patient profiles to create');
      return stats;
    }

    try {
      // Get auth_user and dispatch_patient data for all patient legacy_user_ids
      const patientUserIds = patientRecords.map(p => p.legacy_user_id);
      const patientIds = patientRecords.map(p => p.legacy_patient_id).filter(id => id);

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
        WHERE au.id = ANY($1::int[])
        ${patientIds.length > 0 ? 'OR dp.id = ANY($2::int[])' : ''}
      `;

      const queryParams = patientIds.length > 0 ? [patientUserIds, patientIds] : [patientUserIds];
      const patientDataResult = await this.sourceClient.query(patientDataQuery, queryParams);
      const patientDataMap = new Map(patientDataResult.rows.map((row: any) => [row.user_id, row]));

      console.log(`   Found ${patientDataResult.rows.length} auth_user + dispatch_patient records`);

      // Process in batches
      for (let i = 0; i < patientRecords.length; i += BATCH_SIZE) {
        const batch = patientRecords.slice(i, i + BATCH_SIZE);
        console.log(`   Processing patient batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(patientRecords.length/BATCH_SIZE)}: ${batch.length} profiles`);

        for (const patientRecord of batch) {
          try {
            const patientData: any = patientDataMap.get(patientRecord.legacy_user_id);

            if (!patientData) {
              console.warn(`     No patient data found for legacy_user_id ${patientRecord.legacy_user_id}`);
              stats.skipped++;
              continue;
            }

            // Create profile
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
                  differentialMigrationDate: new Date().toISOString(),
                  sourceTable: 'auth_user + dispatch_patient',
                  migrationType: 'missing_patient_profile',
                  originalSuffix: patientData.suffix
                }
              })
              .select('id')
              .single();

            if (profileError) {
              if (profileError.code === '23505') { // Unique constraint violation
                console.warn(`     Profile already exists for legacy_user_id ${patientData.user_id}, linking existing...`);

                // Get existing profile
                const { data: existingProfile } = await supabase
                  .from('profiles')
                  .select('id')
                  .eq('legacy_user_id', patientData.user_id)
                  .single();

                if (existingProfile) {
                  // Link the patient to existing profile
                  const { error: linkError } = await supabase
                    .from('patients')
                    .update({ profile_id: existingProfile.id })
                    .eq('id', patientRecord.specializedRecordId);

                  if (linkError) {
                    console.error(`     Error linking patient to existing profile: ${linkError.message}`);
                    stats.errors++;
                  } else {
                    stats.patientProfilesCreated++; // Count as success
                  }
                }
              } else {
                console.error(`     Error creating profile for patient user ${patientData.user_id}: ${profileError.message}`);
                stats.errors++;
              }
              continue;
            }

            // Link the patient to the new profile
            const { error: linkError } = await supabase
              .from('patients')
              .update({ profile_id: newProfile.id })
              .eq('id', patientRecord.specializedRecordId);

            if (linkError) {
              console.error(`     Error linking patient to new profile: ${linkError.message}`);
              stats.errors++;
            } else {
              stats.patientProfilesCreated++;
              if (stats.patientProfilesCreated % 100 === 0) {
                console.log(`     ✅ Created ${stats.patientProfilesCreated} patient profiles so far...`);
              }
            }

          } catch (error: any) {
            console.error(`     Error processing patient ${patientRecord.specializedRecordId}: ${error.message}`);
            stats.errors++;
          }
        }

        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 100));
      }

    } catch (error: any) {
      console.error('❌ Error in patient profile creation:', error.message);
      throw error;
    }

    return stats;
  }

  async createMissingTechnicianProfiles(technicianRecords: MissingProfileRecord[]): Promise<ProfileCreationStats> {
    console.log(`\n🔧 CREATING ${technicianRecords.length} MISSING TECHNICIAN PROFILES...`);

    const stats: ProfileCreationStats = { doctorProfilesCreated: 0, patientProfilesCreated: 0, technicianProfilesCreated: 0, errors: 0, skipped: 0 };

    if (technicianRecords.length === 0) {
      console.log('   No technician profiles to create');
      return stats;
    }

    try {
      // Get auth_user data for all technician legacy_user_ids
      const technicianUserIds = technicianRecords.map(t => t.legacy_user_id);

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

      const authUserResult = await this.sourceClient.query(authUserQuery, [technicianUserIds]);
      const authUserMap = new Map(authUserResult.rows.map((row: any) => [row.user_id, row]));

      console.log(`   Found ${authUserResult.rows.length} auth_user records for technicians`);

      for (const technicianRecord of technicianRecords) {
        try {
          const authUser: any = authUserMap.get(technicianRecord.legacy_user_id);

          if (!authUser) {
            console.warn(`     No auth_user found for legacy_user_id ${technicianRecord.legacy_user_id}`);
            stats.skipped++;
            continue;
          }

          // Create profile
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
                differentialMigrationDate: new Date().toISOString(),
                sourceTable: 'auth_user',
                migrationType: 'missing_technician_profile',
                originalUsername: authUser.username
              }
            })
            .select('id')
            .single();

          if (profileError) {
            if (profileError.code === '23505') { // Unique constraint violation
              console.warn(`     Profile already exists for legacy_user_id ${authUser.user_id}, linking existing...`);

              // Get existing profile and make sure it's technician type
              const { data: existingProfile } = await supabase
                .from('profiles')
                .select('id, profile_type')
                .eq('legacy_user_id', authUser.user_id)
                .single();

              if (existingProfile) {
                // Update profile type if needed
                if (existingProfile.profile_type !== 'technician') {
                  await supabase
                    .from('profiles')
                    .update({ profile_type: 'technician' })
                    .eq('id', existingProfile.id);
                }

                // Link the technician to existing profile
                const { error: linkError } = await supabase
                  .from('technicians')
                  .update({ profile_id: existingProfile.id })
                  .eq('id', technicianRecord.specializedRecordId);

                if (linkError) {
                  console.error(`     Error linking technician to existing profile: ${linkError.message}`);
                  stats.errors++;
                } else {
                  stats.technicianProfilesCreated++; // Count as success
                }
              }
            } else {
              console.error(`     Error creating profile for technician user ${authUser.user_id}: ${profileError.message}`);
              stats.errors++;
            }
            continue;
          }

          // Link the technician to the new profile
          const { error: linkError } = await supabase
            .from('technicians')
            .update({ profile_id: newProfile.id })
            .eq('id', technicianRecord.specializedRecordId);

          if (linkError) {
            console.error(`     Error linking technician to new profile: ${linkError.message}`);
            stats.errors++;
          } else {
            stats.technicianProfilesCreated++;
            console.log(`     ✅ Created technician profile: ${authUser.first_name} ${authUser.last_name} (${authUser.username})`);
          }

        } catch (error: any) {
          console.error(`     Error processing technician ${technicianRecord.specializedRecordId}: ${error.message}`);
          stats.errors++;
        }
      }

    } catch (error: any) {
      console.error('❌ Error in technician profile creation:', error.message);
      throw error;
    }

    return stats;
  }
}

async function main() {
  const migrator = new DifferentialProfileMigrator();

  try {
    console.log('🚀 STARTING DIFFERENTIAL PROFILE MIGRATION');
    console.log('=' .repeat(60));

    await migrator.initialize();

    // 1. Find all missing profiles
    const missingProfiles = await migrator.findAllMissingProfiles();

    if (missingProfiles.length === 0) {
      console.log('\n✅ No missing profiles found! All specialized records have profiles.');
      return;
    }

    // 2. Group by type
    const doctorRecords = missingProfiles.filter(r => r.record_type === 'doctor');
    const patientRecords = missingProfiles.filter(r => r.record_type === 'patient');
    const technicianRecords = missingProfiles.filter(r => r.record_type === 'technician');

    // 3. Create missing profiles
    const [doctorStats, patientStats, technicianStats] = await Promise.all([
      migrator.createMissingDoctorProfiles(doctorRecords),
      migrator.createMissingPatientProfiles(patientRecords),
      migrator.createMissingTechnicianProfiles(technicianRecords)
    ]);

    // 4. Summary
    const totalStats = {
      profilesCreated: doctorStats.doctorProfilesCreated + patientStats.patientProfilesCreated + technicianStats.technicianProfilesCreated,
      errors: doctorStats.errors + patientStats.errors + technicianStats.errors,
      skipped: doctorStats.skipped + patientStats.skipped + technicianStats.skipped
    };

    console.log('\n📈 DIFFERENTIAL MIGRATION SUMMARY:');
    console.log(`✅ Total profiles created/linked: ${totalStats.profilesCreated}`);
    console.log(`   • Doctor profiles: ${doctorStats.doctorProfilesCreated}`);
    console.log(`   • Patient profiles: ${patientStats.patientProfilesCreated}`);
    console.log(`   • Technician profiles: ${technicianStats.technicianProfilesCreated}`);
    console.log(`⚠️  Skipped: ${totalStats.skipped}`);
    console.log(`❌ Errors: ${totalStats.errors}`);

    console.log('\n🎉 Differential profile migration completed!');

  } catch (error: any) {
    console.error('💥 Migration failed:', error.message);
    process.exit(1);
  } finally {
    await migrator.cleanup();
  }
}

if (require.main === module) {
  main();
}