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

interface MigrationStats {
  profilesCreated: number;
  patientsCreated: number;
  errors: number;
  skipped: number;
}

class FinalDifferentialMigrator {
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

  async findMissingProfiles(): Promise<number[]> {
    console.log('\n🔍 FINDING MISSING PROFILES...');

    try {
      // Get all legacy_user_ids that exist in target profiles
      const { data: existingProfiles, error: profileError } = await supabase
        .from('profiles')
        .select('legacy_user_id')
        .not('legacy_user_id', 'is', null);

      if (profileError) {
        throw new Error(`Error fetching existing profiles: ${profileError.message}`);
      }

      const existingLegacyUserIds = new Set(existingProfiles?.map(p => p.legacy_user_id) || []);

      // Get all auth_user IDs from source
      const sourceUsersResult = await this.sourceClient.query('SELECT id FROM auth_user ORDER BY id');
      const allSourceUserIds = sourceUsersResult.rows.map((row: any) => row.id);

      // Find missing IDs
      const missingUserIds = allSourceUserIds.filter((id: any) => !existingLegacyUserIds.has(id));

      console.log(`   Source auth_user records: ${allSourceUserIds.length}`);
      console.log(`   Existing target profiles: ${existingLegacyUserIds.size}`);
      console.log(`   Missing profiles: ${missingUserIds.length}`);

      if (missingUserIds.length > 0) {
        console.log(`   Missing legacy_user_ids: ${missingUserIds.slice(0, 10).join(', ')}${missingUserIds.length > 10 ? '...' : ''}`);
      }

      return missingUserIds;

    } catch (error: any) {
      console.error('❌ Error finding missing profiles:', error.message);
      throw error;
    }
  }

  async findMissingPatients(): Promise<number[]> {
    console.log('\n🔍 FINDING MISSING PATIENTS...');

    try {
      // Get all legacy_patient_ids that exist in target patients
      const { data: existingPatients, error: patientError } = await supabase
        .from('patients')
        .select('legacy_patient_id')
        .not('legacy_patient_id', 'is', null);

      if (patientError) {
        throw new Error(`Error fetching existing patients: ${patientError.message}`);
      }

      const existingLegacyPatientIds = new Set(existingPatients?.map(p => p.legacy_patient_id) || []);

      // Get all dispatch_patient IDs from source
      const sourcePatientsResult = await this.sourceClient.query('SELECT id FROM dispatch_patient ORDER BY id');
      const allSourcePatientIds = sourcePatientsResult.rows.map((row: any) => row.id);

      // Find missing IDs
      const missingPatientIds = allSourcePatientIds.filter((id: any) => !existingLegacyPatientIds.has(id));

      console.log(`   Source dispatch_patient records: ${allSourcePatientIds.length}`);
      console.log(`   Existing target patients: ${existingLegacyPatientIds.size}`);
      console.log(`   Missing patients: ${missingPatientIds.length}`);

      if (missingPatientIds.length > 0) {
        console.log(`   Missing legacy_patient_ids: ${missingPatientIds.slice(0, 10).join(', ')}${missingPatientIds.length > 10 ? '...' : ''}`);
      }

      return missingPatientIds;

    } catch (error: any) {
      console.error('❌ Error finding missing patients:', error.message);
      throw error;
    }
  }

  async migrateMissingProfiles(missingUserIds: number[]): Promise<MigrationStats> {
    console.log(`\n👤 MIGRATING ${missingUserIds.length} MISSING PROFILES...`);

    const stats: MigrationStats = { profilesCreated: 0, patientsCreated: 0, errors: 0, skipped: 0 };

    if (missingUserIds.length === 0) {
      console.log('   No missing profiles to migrate');
      return stats;
    }

    try {
      // Get detailed user information with group membership
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

      const userDataResult = await this.sourceClient.query(userDataQuery, [missingUserIds]);

      console.log(`   Found ${userDataResult.rows.length} source user records to migrate`);

      for (const userData of userDataResult.rows) {
        try {
          // Determine profile type based on group membership and flags
          let profileType = 'patient'; // Default
          if (userData.group_id === 2) profileType = 'doctor';
          else if (userData.group_id === 11) profileType = 'technician';
          else if (userData.group_id === 4) profileType = 'admin';
          else if (userData.group_id === 5) profileType = 'master';
          else if (userData.is_superuser) profileType = 'master';
          else if (userData.is_staff) profileType = 'admin';

          // Create profile
          const profileData = {
            profile_type: profileType,
            first_name: userData.first_name || '',
            last_name: userData.last_name || '',
            email: userData.email || null,
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
              finalDifferentialMigration: {
                migratedAt: new Date().toISOString(),
                sourceTable: 'auth_user + auth_user_groups + dispatch_patient',
                profileType: profileType,
                groupId: userData.group_id,
                isStaff: userData.is_staff,
                isSuperuser: userData.is_superuser
              }
            },
            embedding: null,
            legacy_user_id: userData.id,
            legacy_patient_id: userData.patient_id || null
          };

          const { data: newProfile, error: profileError } = await supabase
            .from('profiles')
            .insert(profileData)
            .select('id')
            .single();

          if (profileError) {
            console.error(`   ❌ Error creating profile for user ${userData.id}: ${profileError.message}`);
            stats.errors++;
            continue;
          }

          stats.profilesCreated++;
          console.log(`   ✅ Created ${profileType} profile for ${userData.first_name} ${userData.last_name} (${userData.username})`);

        } catch (error: any) {
          console.error(`   ❌ Error processing user ${userData.id}: ${error.message}`);
          stats.errors++;
        }
      }

    } catch (error: any) {
      console.error('❌ Error in profile migration:', error.message);
      throw error;
    }

    return stats;
  }

  async migrateMissingPatients(missingPatientIds: number[]): Promise<MigrationStats> {
    console.log(`\n🤒 MIGRATING ${missingPatientIds.length} MISSING PATIENTS...`);

    const stats: MigrationStats = { profilesCreated: 0, patientsCreated: 0, errors: 0, skipped: 0 };

    if (missingPatientIds.length === 0) {
      console.log('   No missing patients to migrate');
      return stats;
    }

    try {
      // Get detailed patient information
      const patientDataQuery = `
        SELECT
          dp.id as patient_id,
          dp.user_id,
          dp.doctor_id,
          dp.office_id,
          dp.birthdate,
          dp.sex,
          dp.archived,
          dp.suspended,
          dp.status,
          dp.suffix,
          dp.submitted_at,
          dp.updated_at,
          dp.schemes,
          au.first_name,
          au.last_name,
          au.email,
          au.username
        FROM dispatch_patient dp
        INNER JOIN auth_user au ON dp.user_id = au.id
        WHERE dp.id = ANY($1::int[])
        ORDER BY dp.id
      `;

      const patientDataResult = await this.sourceClient.query(patientDataQuery, [missingPatientIds]);

      console.log(`   Found ${patientDataResult.rows.length} source patient records to migrate`);

      for (const patientData of patientDataResult.rows) {
        try {
          // Find the profile for this patient
          const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('id')
            .eq('legacy_user_id', patientData.user_id)
            .single();

          if (profileError || !profile) {
            console.warn(`   ⚠️  No profile found for patient ${patientData.patient_id} (user_id: ${patientData.user_id})`);
            stats.skipped++;
            continue;
          }

          // Find the doctor
          const { data: doctor, error: doctorError } = await supabase
            .from('doctors')
            .select('id')
            .eq('legacy_user_id', patientData.doctor_id)
            .single();

          if (doctorError || !doctor) {
            console.warn(`   ⚠️  No doctor found for doctor_id ${patientData.doctor_id}`);
          }

          // Find the office
          const { data: office, error: officeError } = await supabase
            .from('offices')
            .select('id')
            .eq('legacy_office_id', patientData.office_id)
            .single();

          if (officeError || !office) {
            console.warn(`   ⚠️  No office found for office_id ${patientData.office_id}`);
          }

          // Create patient record
          const patientRecord = {
            profile_id: profile.id,
            patient_number: `PAT-${patientData.patient_id}`,
            suffix: patientData.suffix,
            sex: patientData.sex === 1 ? 'male' : patientData.sex === 2 ? 'female' : 'unknown',
            date_of_birth: patientData.birthdate,
            primary_doctor_id: doctor?.id || null,
            assigned_office_id: office?.id || null,
            status: patientData.archived ? 'archived' : 'active',
            archived: patientData.archived,
            suspended: patientData.suspended,
            medical_history: {},
            insurance_info: {},
            schemes: patientData.schemes ? JSON.parse(patientData.schemes) : null,
            enrolled_at: patientData.submitted_at,
            updated_at: patientData.updated_at,
            legacy_patient_id: patientData.patient_id,
            legacy_user_id: patientData.user_id,
            metadata: {
              finalDifferentialMigration: {
                migratedAt: new Date().toISOString(),
                sourceTable: 'dispatch_patient + auth_user',
                originalStatus: patientData.status
              }
            },
            legacy_doctor_id: patientData.doctor_id
          };

          const { error: insertError } = await supabase
            .from('patients')
            .insert(patientRecord);

          if (insertError) {
            console.error(`   ❌ Error creating patient ${patientData.patient_id}: ${insertError.message}`);
            stats.errors++;
            continue;
          }

          stats.patientsCreated++;
          console.log(`   ✅ Created patient ${patientData.suffix} for ${patientData.first_name} ${patientData.last_name}`);

        } catch (error: any) {
          console.error(`   ❌ Error processing patient ${patientData.patient_id}: ${error.message}`);
          stats.errors++;
        }
      }

    } catch (error: any) {
      console.error('❌ Error in patient migration:', error.message);
      throw error;
    }

    return stats;
  }

  async validateMigrationCompleteness(): Promise<void> {
    console.log('\n🔍 VALIDATING MIGRATION COMPLETENESS...');

    try {
      // Check final counts
      const [profileCount, patientCount, doctorCount, technicianCount] = await Promise.all([
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
        supabase.from('patients').select('*', { count: 'exact', head: true }),
        supabase.from('doctors').select('*', { count: 'exact', head: true }),
        supabase.from('technicians').select('*', { count: 'exact', head: true })
      ]);

      // Get source counts
      const sourceUserCount = await this.sourceClient.query('SELECT COUNT(*) as count FROM auth_user');
      const sourcePatientCount = await this.sourceClient.query('SELECT COUNT(*) as count FROM dispatch_patient');

      console.log('\n📊 FINAL MIGRATION STATUS:');
      console.log(`   Source auth_user: ${sourceUserCount.rows[0].count}`);
      console.log(`   Target profiles: ${profileCount.count}`);
      console.log(`   Profile coverage: ${((profileCount.count || 0) / sourceUserCount.rows[0].count * 100).toFixed(2)}%`);

      console.log(`\n   Source dispatch_patient: ${sourcePatientCount.rows[0].count}`);
      console.log(`   Target patients: ${patientCount.count}`);
      console.log(`   Patient coverage: ${((patientCount.count || 0) / sourcePatientCount.rows[0].count * 100).toFixed(2)}%`);

      console.log(`\n   Doctors: ${doctorCount.count}`);
      console.log(`   Technicians: ${technicianCount.count}`);

      // Check for orphaned records
      const [orphanedDoctors, orphanedPatients, orphanedTechnicians] = await Promise.all([
        supabase.from('doctors').select('id', { count: 'exact', head: true }).is('profile_id', null),
        supabase.from('patients').select('id', { count: 'exact', head: true }).is('profile_id', null),
        supabase.from('technicians').select('id', { count: 'exact', head: true }).is('profile_id', null)
      ]);

      console.log('\n✅ RELATIONSHIP INTEGRITY:');
      console.log(`   Orphaned doctors: ${orphanedDoctors.count || 0}`);
      console.log(`   Orphaned patients: ${orphanedPatients.count || 0}`);
      console.log(`   Orphaned technicians: ${orphanedTechnicians.count || 0}`);

      const totalOrphaned = (orphanedDoctors.count || 0) + (orphanedPatients.count || 0) + (orphanedTechnicians.count || 0);
      if (totalOrphaned === 0) {
        console.log('   🎉 ALL SPECIALIZED RECORDS HAVE PROFILES!');
      } else {
        console.log(`   ⚠️  ${totalOrphaned} orphaned records found`);
      }

    } catch (error: any) {
      console.error('❌ Error in validation:', error.message);
    }
  }
}

async function main() {
  const migrator = new FinalDifferentialMigrator();

  try {
    console.log('🚀 STARTING FINAL DIFFERENTIAL MIGRATION');
    console.log('Based on comprehensive schema investigation');
    console.log('Target: Complete remaining profiles and patients');
    console.log('=' .repeat(60));

    await migrator.initialize();

    // 1. Find missing records
    const missingUserIds = await migrator.findMissingProfiles();
    const missingPatientIds = await migrator.findMissingPatients();

    if (missingUserIds.length === 0 && missingPatientIds.length === 0) {
      console.log('\n✅ NO MISSING RECORDS FOUND!');
      console.log('   Migration appears to be 100% complete');
      await migrator.validateMigrationCompleteness();
      return;
    }

    // 2. Migrate missing records
    const profileStats = await migrator.migrateMissingProfiles(missingUserIds);
    const patientStats = await migrator.migrateMissingPatients(missingPatientIds);

    // 3. Summary and validation
    const totalStats = {
      profilesCreated: profileStats.profilesCreated,
      patientsCreated: patientStats.patientsCreated,
      errors: profileStats.errors + patientStats.errors,
      skipped: profileStats.skipped + patientStats.skipped
    };

    console.log('\n📈 FINAL DIFFERENTIAL MIGRATION SUMMARY:');
    console.log(`✅ Profiles created: ${totalStats.profilesCreated}`);
    console.log(`✅ Patients created: ${totalStats.patientsCreated}`);
    console.log(`⚠️  Skipped: ${totalStats.skipped}`);
    console.log(`❌ Errors: ${totalStats.errors}`);

    // Final validation
    await migrator.validateMigrationCompleteness();

    if (totalStats.errors === 0) {
      console.log('\n🎉 MIGRATION COMPLETED SUCCESSFULLY!');
    } else {
      console.log(`\n⚠️  Migration completed with ${totalStats.errors} errors`);
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