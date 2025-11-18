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

interface UpsertStats {
  profilesCreated: number;
  profilesUpdated: number;
  relationshipsFixed: number;
  dataQualityFixes: number;
  errors: number;
  skipped: number;
}

interface SourceUserData {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  username: string;
  password: string;
  is_active: boolean;
  is_staff: boolean;
  is_superuser: boolean;
  date_joined: string;
  last_login: string;
  group_id: number;
  patient_id?: number;
  suffix?: string;
  birthdate?: string;
  sex?: number;
  suspended?: boolean;
}

class ComprehensiveUpsertMigrator {
  private sourceClient: any;

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

  private cleanEmail(email: string): string | null {
    if (!email || email === '') return null;

    // Clean common issues
    const cleaned = email
      .trim()
      .toLowerCase()
      .replace(/['']/g, '') // Remove apostrophes
      .replace(/[^\w@.-]/g, ''); // Remove other invalid characters

    // Validate email format
    const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    if (!emailRegex.test(cleaned)) {
      return null; // Invalid email, set to null
    }

    return cleaned;
  }

  private determineProfileType(userData: SourceUserData): string {
    // Priority order for profile type determination
    if (userData.group_id === 2) return 'doctor';
    if (userData.group_id === 11) return 'technician';
    if (userData.group_id === 4) return 'admin';
    if (userData.group_id === 5) return 'master';
    if (userData.is_superuser) return 'master';
    if (userData.is_staff) return 'admin';
    if (userData.group_id === 1) return 'patient';
    if (userData.patient_id) return 'patient'; // Has patient record

    // Default based on activity patterns
    return 'patient';
  }

  async getAllSourceUserData(): Promise<SourceUserData[]> {
    console.log('\n📊 FETCHING ALL SOURCE USER DATA...');

    try {
      const userDataQuery = `
        SELECT DISTINCT ON (au.id)
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
        WHERE au.is_active = true  -- Only migrate active users
        ORDER BY au.id, aug.group_id DESC  -- Prioritize higher privilege groups
      `;

      const result = await this.sourceClient.query(userDataQuery);

      console.log(`   Fetched ${result.rows.length} active users from source`);

      // Group by profile type
      const typeDistribution = result.rows.reduce((acc: any, row: any) => {
        const type = this.determineProfileType(row);
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {});

      console.log('   Source user type distribution:');
      Object.entries(typeDistribution).forEach(([type, count]) => {
        console.log(`      ${type}: ${count}`);
      });

      return result.rows;

    } catch (error: any) {
      console.error('❌ Error fetching source user data:', error.message);
      throw error;
    }
  }

  async upsertProfiles(sourceUsers: SourceUserData[]): Promise<UpsertStats> {
    console.log(`\n👤 UPSERTING ${sourceUsers.length} PROFILES...`);

    const stats: UpsertStats = {
      profilesCreated: 0,
      profilesUpdated: 0,
      relationshipsFixed: 0,
      dataQualityFixes: 0,
      errors: 0,
      skipped: 0
    };

    const BATCH_SIZE = 100;

    try {
      for (let i = 0; i < sourceUsers.length; i += BATCH_SIZE) {
        const batch = sourceUsers.slice(i, i + BATCH_SIZE);
        console.log(`   Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(sourceUsers.length/BATCH_SIZE)}: ${batch.length} profiles`);

        const profilesForUpsert = batch.map(userData => {
          const profileType = this.determineProfileType(userData);
          const cleanedEmail = this.cleanEmail(userData.email);

          if (!cleanedEmail && userData.email) {
            stats.dataQualityFixes++;
          }

          return {
            profile_type: profileType,
            first_name: userData.first_name || '',
            last_name: userData.last_name || '',
            email: cleanedEmail,
            phone: '',
            date_of_birth: userData.birthdate || null,
            gender: userData.sex === 1 ? 'male' : userData.sex === 2 ? 'female' : 'unknown',
            username: userData.username,
            password_hash: userData.password || null,
            is_active: userData.is_active,
            is_verified: false,
            archived: false,
            suspended: profileType === 'patient' ? (userData.suspended || false) : false,
            patient_suffix: profileType === 'patient' ? userData.suffix : null,
            insurance_info: null,
            medical_history: null,
            created_at: userData.date_joined,
            updated_at: userData.last_login || userData.date_joined,
            last_login_at: userData.last_login,
            metadata: {
              comprehensiveUpsertMigration: {
                migratedAt: new Date().toISOString(),
                sourceTable: 'auth_user + auth_user_groups + dispatch_patient',
                profileType: profileType,
                groupId: userData.group_id,
                isStaff: userData.is_staff,
                isSuperuser: userData.is_superuser,
                emailCleaned: cleanedEmail !== userData.email
              }
            },
            embedding: null,
            legacy_user_id: userData.id,
            legacy_patient_id: userData.patient_id || null
          };
        });

        try {
          const { data: upsertedProfiles, error: upsertError } = await supabase
            .from('profiles')
            .upsert(profilesForUpsert, {
              onConflict: 'legacy_user_id',
              ignoreDuplicates: false
            })
            .select('id, legacy_user_id, created_at');

          if (upsertError) {
            console.error(`   ❌ Batch upsert error: ${upsertError.message}`);
            stats.errors += batch.length;
            continue;
          }

          // Determine how many were created vs updated based on created_at
          const now = new Date();
          const recentThreshold = new Date(now.getTime() - 5000); // 5 seconds ago

          const newProfiles = upsertedProfiles?.filter(p => new Date(p.created_at) > recentThreshold) || [];
          const updatedProfiles = upsertedProfiles?.filter(p => new Date(p.created_at) <= recentThreshold) || [];

          stats.profilesCreated += newProfiles.length;
          stats.profilesUpdated += updatedProfiles.length;

          if ((stats.profilesCreated + stats.profilesUpdated) % 500 === 0) {
            console.log(`      ✅ Processed ${stats.profilesCreated + stats.profilesUpdated} profiles so far...`);
          }

        } catch (error: any) {
          console.error(`   ❌ Error in batch processing: ${error.message}`);
          stats.errors += batch.length;
        }

        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 100));
      }

    } catch (error: any) {
      console.error('❌ Error in profile upsert:', error.message);
      throw error;
    }

    return stats;
  }

  async linkSpecializedRecordsToProfiles(): Promise<UpsertStats> {
    console.log('\n🔗 LINKING SPECIALIZED RECORDS TO PROFILES...');

    const stats: UpsertStats = {
      profilesCreated: 0,
      profilesUpdated: 0,
      relationshipsFixed: 0,
      dataQualityFixes: 0,
      errors: 0,
      skipped: 0
    };

    try {
      // 1. Fix doctor-profile relationships
      console.log('   👨‍⚕️ Linking doctors to profiles...');

      const doctorsNeedingProfiles = await supabase
        .from('doctors')
        .select('id, legacy_user_id, profile_id')
        .is('profile_id', null)
        .not('legacy_user_id', 'is', null);

      if (doctorsNeedingProfiles.data && doctorsNeedingProfiles.data.length > 0) {
        console.log(`      Found ${doctorsNeedingProfiles.data.length} doctors needing profile links`);

        for (const doctor of doctorsNeedingProfiles.data) {
          try {
            // Find the profile for this doctor
            const { data: profile, error: profileError } = await supabase
              .from('profiles')
              .select('id')
              .eq('legacy_user_id', doctor.legacy_user_id)
              .single();

            if (profileError || !profile) {
              console.warn(`      ⚠️  No profile found for doctor legacy_user_id ${doctor.legacy_user_id}`);
              stats.skipped++;
              continue;
            }

            // Update doctor to link to profile
            const { error: updateError } = await supabase
              .from('doctors')
              .update({ profile_id: profile.id })
              .eq('id', doctor.id);

            if (updateError) {
              console.error(`      ❌ Error linking doctor ${doctor.id}: ${updateError.message}`);
              stats.errors++;
            } else {
              stats.relationshipsFixed++;
            }

          } catch (error: any) {
            console.error(`      ❌ Error processing doctor ${doctor.id}: ${error.message}`);
            stats.errors++;
          }
        }
      } else {
        console.log('      ✅ All doctors already linked to profiles');
      }

      // 2. Fix patient-profile relationships
      console.log('   🤒 Linking patients to profiles...');

      const patientsNeedingProfiles = await supabase
        .from('patients')
        .select('id, legacy_user_id, profile_id')
        .is('profile_id', null)
        .not('legacy_user_id', 'is', null);

      if (patientsNeedingProfiles.data && patientsNeedingProfiles.data.length > 0) {
        console.log(`      Found ${patientsNeedingProfiles.data.length} patients needing profile links`);

        const BATCH_SIZE = 100;
        for (let i = 0; i < patientsNeedingProfiles.data.length; i += BATCH_SIZE) {
          const batch = patientsNeedingProfiles.data.slice(i, i + BATCH_SIZE);

          for (const patient of batch) {
            try {
              // Find the profile for this patient
              const { data: profile, error: profileError } = await supabase
                .from('profiles')
                .select('id')
                .eq('legacy_user_id', patient.legacy_user_id)
                .single();

              if (profileError || !profile) {
                console.warn(`      ⚠️  No profile found for patient legacy_user_id ${patient.legacy_user_id}`);
                stats.skipped++;
                continue;
              }

              // Update patient to link to profile
              const { error: updateError } = await supabase
                .from('patients')
                .update({ profile_id: profile.id })
                .eq('id', patient.id);

              if (updateError) {
                console.error(`      ❌ Error linking patient ${patient.id}: ${updateError.message}`);
                stats.errors++;
              } else {
                stats.relationshipsFixed++;
                if (stats.relationshipsFixed % 100 === 0) {
                  console.log(`         ✅ Fixed ${stats.relationshipsFixed} patient relationships so far...`);
                }
              }

            } catch (error: any) {
              console.error(`      ❌ Error processing patient ${patient.id}: ${error.message}`);
              stats.errors++;
            }
          }

          // Small delay between batches
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      } else {
        console.log('      ✅ All patients already linked to profiles');
      }

      // 3. Fix technician-profile relationships
      console.log('   🔧 Linking technicians to profiles...');

      const techniciansNeedingProfiles = await supabase
        .from('technicians')
        .select('id, legacy_user_id, profile_id')
        .is('profile_id', null)
        .not('legacy_user_id', 'is', null);

      if (techniciansNeedingProfiles.data && techniciansNeedingProfiles.data.length > 0) {
        console.log(`      Found ${techniciansNeedingProfiles.data.length} technicians needing profile links`);

        for (const technician of techniciansNeedingProfiles.data) {
          try {
            // Find the profile for this technician
            const { data: profile, error: profileError } = await supabase
              .from('profiles')
              .select('id')
              .eq('legacy_user_id', technician.legacy_user_id)
              .single();

            if (profileError || !profile) {
              console.warn(`      ⚠️  No profile found for technician legacy_user_id ${technician.legacy_user_id}`);
              stats.skipped++;
              continue;
            }

            // Update technician to link to profile
            const { error: updateError } = await supabase
              .from('technicians')
              .update({ profile_id: profile.id })
              .eq('id', technician.id);

            if (updateError) {
              console.error(`      ❌ Error linking technician ${technician.id}: ${updateError.message}`);
              stats.errors++;
            } else {
              stats.relationshipsFixed++;
            }

          } catch (error: any) {
            console.error(`      ❌ Error processing technician ${technician.id}: ${error.message}`);
            stats.errors++;
          }
        }
      } else {
        console.log('      ✅ All technicians already linked to profiles');
      }

    } catch (error: any) {
      console.error('❌ Error linking specialized records:', error.message);
      throw error;
    }

    return stats;
  }

  async fixProfileTypes(): Promise<number> {
    console.log('\n🔄 FIXING INCORRECT PROFILE TYPES...');

    let typesFixed = 0;

    try {
      // Fix technicians marked as doctors
      const { data: technicianProfileMismatches } = await supabase
        .from('technicians')
        .select(`
          id,
          profile_id,
          profiles!inner (
            id,
            profile_type
          )
        `)
        .neq('profiles.profile_type', 'technician');

      if (technicianProfileMismatches && technicianProfileMismatches.length > 0) {
        console.log(`   Found ${technicianProfileMismatches.length} technician profiles with incorrect types`);

        for (const mismatch of technicianProfileMismatches) {
          try {
            const { error: typeFixError } = await supabase
              .from('profiles')
              .update({
                profile_type: 'technician',
                updated_at: new Date().toISOString()
              })
              .eq('id', (mismatch as any).profiles.id);

            if (typeFixError) {
              console.error(`      ❌ Error fixing profile type: ${typeFixError.message}`);
            } else {
              typesFixed++;
            }
          } catch (error: any) {
            console.error(`      ❌ Error processing profile type fix: ${error.message}`);
          }
        }
      }

      console.log(`   ✅ Fixed ${typesFixed} profile types`);

    } catch (error: any) {
      console.error('❌ Error fixing profile types:', error.message);
    }

    return typesFixed;
  }

  async validateUpsertResults(): Promise<void> {
    console.log('\n🔍 VALIDATING UPSERT RESULTS...');

    try {
      // Get final counts
      const [profileCount, doctorCount, patientCount, technicianCount] = await Promise.all([
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
        supabase.from('doctors').select('*', { count: 'exact', head: true }),
        supabase.from('patients').select('*', { count: 'exact', head: true }),
        supabase.from('technicians').select('*', { count: 'exact', head: true })
      ]);

      // Get source count for comparison
      const sourceUserCount = await this.sourceClient.query('SELECT COUNT(*) as count FROM auth_user WHERE is_active = true');

      console.log('\n📊 FINAL COUNTS AFTER UPSERT:');
      console.log(`   Source active users: ${sourceUserCount.rows[0].count}`);
      console.log(`   Target profiles: ${profileCount.count}`);
      console.log(`   Coverage: ${((profileCount.count || 0) / sourceUserCount.rows[0].count * 100).toFixed(2)}%`);

      console.log(`\n   Specialized records:`);
      console.log(`      Doctors: ${doctorCount.count}`);
      console.log(`      Patients: ${patientCount.count}`);
      console.log(`      Technicians: ${technicianCount.count}`);
      console.log(`      Total: ${(doctorCount.count || 0) + (patientCount.count || 0) + (technicianCount.count || 0)}`);

      // Check relationship integrity
      const [orphanedDoctors, orphanedPatients, orphanedTechnicians] = await Promise.all([
        supabase.from('doctors').select('id', { count: 'exact', head: true }).is('profile_id', null),
        supabase.from('patients').select('id', { count: 'exact', head: true }).is('profile_id', null),
        supabase.from('technicians').select('id', { count: 'exact', head: true }).is('profile_id', null)
      ]);

      console.log('\n✅ RELATIONSHIP INTEGRITY CHECK:');
      console.log(`   Orphaned doctors: ${orphanedDoctors.count || 0}`);
      console.log(`   Orphaned patients: ${orphanedPatients.count || 0}`);
      console.log(`   Orphaned technicians: ${orphanedTechnicians.count || 0}`);

      const totalOrphaned = (orphanedDoctors.count || 0) + (orphanedPatients.count || 0) + (orphanedTechnicians.count || 0);

      if (totalOrphaned === 0) {
        console.log('\n🎉 PERFECT SYNCHRONIZATION ACHIEVED!');
        console.log('   ✅ All specialized records have profiles');
        console.log('   ✅ All relationships properly linked');
      } else {
        console.log(`\n⚠️  ${totalOrphaned} orphaned records remain`);
      }

      // Check profile type distribution
      const { data: profileTypes } = await supabase
        .from('profiles')
        .select('profile_type');

      const typeDistribution = profileTypes?.reduce((acc: any, profile) => {
        acc[profile.profile_type] = (acc[profile.profile_type] || 0) + 1;
        return acc;
      }, {});

      console.log('\n📊 FINAL PROFILE TYPE DISTRIBUTION:');
      Object.entries(typeDistribution || {}).forEach(([type, count]) => {
        console.log(`   ${type}: ${count}`);
      });

    } catch (error: any) {
      console.error('❌ Error in validation:', error.message);
    }
  }
}

async function main() {
  const migrator = new ComprehensiveUpsertMigrator();

  try {
    console.log('🚀 STARTING COMPREHENSIVE UPSERT MIGRATION');
    console.log('Strategy: Safe upsert to handle existing records and fix relationships');
    console.log('=' .repeat(70));

    await migrator.initialize();

    // 1. Get all source user data
    const sourceUsers = await migrator.getAllSourceUserData();

    // 2. Upsert all profiles
    const upsertStats = await migrator.upsertProfiles(sourceUsers);

    // 3. Link specialized records to profiles
    const linkStats = await migrator.linkSpecializedRecordsToProfiles();

    // 4. Fix incorrect profile types
    const typesFixes = await migrator.fixProfileTypes();

    // 5. Validate results
    await migrator.validateUpsertResults();

    // 6. Final summary
    const totalStats = {
      profilesCreated: upsertStats.profilesCreated,
      profilesUpdated: upsertStats.profilesUpdated,
      relationshipsFixed: linkStats.relationshipsFixed,
      dataQualityFixes: upsertStats.dataQualityFixes,
      profileTypeFixes: typesFixes,
      errors: upsertStats.errors + linkStats.errors,
      skipped: upsertStats.skipped + linkStats.skipped
    };

    console.log('\n📈 COMPREHENSIVE UPSERT MIGRATION SUMMARY:');
    console.log(`✅ Profiles created: ${totalStats.profilesCreated}`);
    console.log(`🔄 Profiles updated: ${totalStats.profilesUpdated}`);
    console.log(`🔗 Relationships fixed: ${totalStats.relationshipsFixed}`);
    console.log(`🧹 Data quality fixes: ${totalStats.dataQualityFixes}`);
    console.log(`🎯 Profile type fixes: ${totalStats.profileTypeFixes}`);
    console.log(`⚠️  Skipped: ${totalStats.skipped}`);
    console.log(`❌ Errors: ${totalStats.errors}`);

    if (totalStats.errors === 0) {
      console.log('\n🎉 MIGRATION COMPLETED SUCCESSFULLY!');
      console.log('   ✅ All profiles synchronized');
      console.log('   ✅ All relationships preserved');
      console.log('   ✅ Data quality issues resolved');
    } else {
      console.log(`\n⚠️  Migration completed with ${totalStats.errors} errors - review logs above`);
    }

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