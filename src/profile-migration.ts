import { Pool } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Configuration
interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

interface ProfileRecord {
  legacy_user_id: number;
  legacy_patient_id?: number;
  profile_type: 'patient' | 'doctor' | 'technician' | 'master' | 'sales_person' | 'agent' | 'client';
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  date_of_birth?: string;
  gender: 'male' | 'female' | 'other' | 'unknown';
  username?: string;
  password_hash?: string;
  is_active: boolean;
  is_verified: boolean;
  archived: boolean;
  suspended: boolean;
  patient_suffix?: string;
  insurance_info?: any;
  medical_history?: any;
  last_login_at?: string;
  metadata: any;
}

interface LegacyUserData {
  // auth_user fields
  user_id: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  is_superuser: boolean;
  is_staff: boolean;
  is_active: boolean;
  date_joined: string;
  last_login?: string;
  
  // dispatch_patient fields (nullable for non-patients)
  patient_id?: number;
  doctor_id?: number;
  birthdate?: string;
  office_id?: number;
  patient_archived?: boolean;
  patient_status?: number;
  submitted_at?: string;
  suffix?: string;
  updated_at?: string;
  sex?: number;
  patient_suspended?: boolean;
  schemes?: string;
}

interface MigrationStats {
  totalProcessed: number;
  inserted: number;
  duplicatesSkipped: number;
  errors: number;
  patientProfiles: number;
  staffProfiles: number;
  doctorProfiles: number;
  otherProfiles: number;
  startTime: Date;
  endTime?: Date;
}

class ProfileMigrationService {
  private sourcePool: Pool;
  private targetPool: Pool;
  private batchSize: number = 5000;
  private stats: MigrationStats;

  constructor(sourceConfig: DatabaseConfig, targetConfig: DatabaseConfig) {
    this.sourcePool = new Pool({
      host: sourceConfig.host,
      port: sourceConfig.port,
      database: sourceConfig.database,
      user: sourceConfig.username,
      password: sourceConfig.password,
    });

    this.targetPool = new Pool({
      host: targetConfig.host,
      port: targetConfig.port,
      database: targetConfig.database,
      user: targetConfig.username,
      password: targetConfig.password,
    });

    this.stats = {
      totalProcessed: 0,
      inserted: 0,
      duplicatesSkipped: 0,
      errors: 0,
      patientProfiles: 0,
      staffProfiles: 0,
      doctorProfiles: 0,
      otherProfiles: 0,
      startTime: new Date(),
    };
  }

  /**
   * Extract user and patient data from legacy database
   */
  private async extractLegacyUserData(): Promise<LegacyUserData[]> {
    const query = `
      SELECT 
        u.id as user_id,
        u.username,
        u.first_name,
        u.last_name,
        u.email,
        u.password,
        u.is_superuser,
        u.is_staff,
        u.is_active,
        u.date_joined,
        u.last_login,
        
        p.id as patient_id,
        p.doctor_id,
        p.birthdate,
        p.office_id,
        p.archived as patient_archived,
        p.status as patient_status,
        p.submitted_at,
        p.suffix,
        p.updated_at,
        p.sex,
        p.suspended as patient_suspended,
        p.schemes
      FROM auth_user u
      LEFT JOIN dispatch_patient p ON u.id = p.user_id
      ORDER BY u.id
    `;

    try {
      const result = await this.sourcePool.query(query);
      console.log(`✓ Extracted ${result.rows.length} user records from source database`);
      return result.rows;
    } catch (error) {
      console.error('❌ Error extracting legacy user data:', error);
      throw error;
    }
  }

  /**
   * Transform legacy user data to target profile format
   */
  private transformProfile(legacyData: LegacyUserData): ProfileRecord {
    // Normalize text fields
    const normalizeText = (text?: string): string => {
      if (!text) return '';
      return text.trim().replace(/\s+/g, ' ');
    };

    const normalizePhone = (phone?: string): string => {
      if (!phone) return '';
      return phone.replace(/[^0-9+\-\s()]/g, '');
    };

    // Determine profile type based on user flags and patient existence
    const determineProfileType = (): ProfileRecord['profile_type'] => {
      if (legacyData.patient_id) {
        return 'patient';
      } else if (legacyData.is_superuser) {
        return 'master'; // Admins/superusers
      } else if (legacyData.is_staff) {
        return 'technician'; // Staff users
      } else {
        return 'doctor'; // Likely doctors or other professionals
      }
    };

    // Convert sex integer to gender enum
    const convertGender = (sex?: number): ProfileRecord['gender'] => {
      switch (sex) {
        case 1: return 'male';
        case 2: return 'female';
        case 0: return 'other';
        default: return 'unknown';
      }
    };

    // Clean email - ensure it's valid or null
    const cleanEmail = (email: string): string | undefined => {
      if (!email || email.trim() === '' || email === 'null' || !email.includes('@')) {
        return undefined;
      }
      return email.trim().toLowerCase();
    };

    // Clean names - handle empty strings
    const cleanName = (name: string): string => {
      const cleaned = normalizeText(name);
      if (!cleaned || cleaned === 'null') {
        return 'Unknown';
      }
      return cleaned;
    };

    return {
      legacy_user_id: legacyData.user_id,
      legacy_patient_id: legacyData.patient_id || undefined,
      profile_type: determineProfileType(),
      first_name: cleanName(legacyData.first_name),
      last_name: cleanName(legacyData.last_name),
      email: cleanEmail(legacyData.email),
      phone: normalizePhone(legacyData.email), // Note: No phone in auth_user, could extract from other tables
      date_of_birth: legacyData.birthdate || undefined,
      gender: convertGender(legacyData.sex),
      username: legacyData.username || undefined,
      password_hash: legacyData.password || undefined,
      is_active: legacyData.is_active || false,
      is_verified: false, // Default to false, would need separate verification logic
      archived: legacyData.patient_archived || false,
      suspended: legacyData.patient_suspended || false,
      patient_suffix: legacyData.suffix || undefined,
      insurance_info: undefined, // Would need to extract from separate tables
      medical_history: legacyData.schemes ? { legacy_schemes: legacyData.schemes } : undefined,
      last_login_at: legacyData.last_login || undefined,
      metadata: {
        migration: {
          source_table: 'auth_user + dispatch_patient',
          migrated_at: new Date().toISOString(),
          original_user_flags: {
            is_superuser: legacyData.is_superuser,
            is_staff: legacyData.is_staff,
            is_active: legacyData.is_active
          },
          patient_data: legacyData.patient_id ? {
            doctor_id: legacyData.doctor_id,
            office_id: legacyData.office_id,
            status: legacyData.patient_status,
            submitted_at: legacyData.submitted_at,
            updated_at: legacyData.updated_at
          } : null
        }
      }
    };
  }

  /**
   * Check if profile already exists in target database
   */
  private async checkExistingProfile(profile: ProfileRecord): Promise<string | null> {
    // Check by legacy_user_id first (most reliable)
    let query = `
      SELECT id 
      FROM profiles 
      WHERE legacy_user_id = $1
    `;

    try {
      let result = await this.targetPool.query(query, [profile.legacy_user_id]);
      if (result.rows.length > 0) {
        return result.rows[0].id;
      }

      // If not found by legacy_user_id, check by email (if available)
      if (profile.email) {
        query = `
          SELECT id 
          FROM profiles 
          WHERE email = $1 AND email IS NOT NULL
        `;
        result = await this.targetPool.query(query, [profile.email]);
        if (result.rows.length > 0) {
          return result.rows[0].id;
        }
      }

      // Check by username (if available)
      if (profile.username) {
        query = `
          SELECT id 
          FROM profiles 
          WHERE username = $1 AND username IS NOT NULL
        `;
        result = await this.targetPool.query(query, [profile.username]);
        if (result.rows.length > 0) {
          return result.rows[0].id;
        }
      }

      return null;
    } catch (error) {
      console.error('❌ Error checking existing profile:', error);
      return null;
    }
  }

  /**
   * Insert profile into target database
   */
  private async insertProfile(profile: ProfileRecord): Promise<{ success: boolean; id?: string; error?: string }> {
    const insertQuery = `
      INSERT INTO profiles (
        profile_type, first_name, last_name, email, phone, date_of_birth, gender,
        username, password_hash, is_active, is_verified, archived, suspended,
        patient_suffix, insurance_info, medical_history, last_login_at, metadata,
        legacy_user_id, legacy_patient_id, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW(), NOW()
      ) 
      RETURNING id
    `;

    const values = [
      profile.profile_type,
      profile.first_name,
      profile.last_name,
      profile.email,
      profile.phone,
      profile.date_of_birth,
      profile.gender,
      profile.username,
      profile.password_hash,
      profile.is_active,
      profile.is_verified,
      profile.archived,
      profile.suspended,
      profile.patient_suffix,
      profile.insurance_info ? JSON.stringify(profile.insurance_info) : null,
      profile.medical_history ? JSON.stringify(profile.medical_history) : null,
      profile.last_login_at,
      JSON.stringify(profile.metadata),
      profile.legacy_user_id,
      profile.legacy_patient_id
    ];

    try {
      const result = await this.targetPool.query(insertQuery, values);
      return { success: true, id: result.rows[0].id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Record lineage mapping
   */
  private async recordLineage(legacyUserId: number, newId: string, legacyPatientId?: number): Promise<void> {
    const lineageQuery = `
      INSERT INTO migration_mappings (
        entity_type, legacy_id, new_id, migrated_at, migration_batch
      ) VALUES (
        'profile', $1, $2, NOW(), 'profile_migration_' || TO_CHAR(NOW(), 'YYYYMMDD_HH24MISS')
      ) 
      ON CONFLICT (entity_type, legacy_id) DO NOTHING
    `;

    try {
      await this.targetPool.query(lineageQuery, [legacyUserId, newId]);
      
      // Also record patient mapping if applicable
      if (legacyPatientId) {
        const patientLineageQuery = `
          INSERT INTO migration_mappings (
            entity_type, legacy_id, new_id, migrated_at, migration_batch
          ) VALUES (
            'patient', $1, $2, NOW(), 'profile_migration_' || TO_CHAR(NOW(), 'YYYYMMDD_HH24MISS')
          ) 
          ON CONFLICT (entity_type, legacy_id) DO NOTHING
        `;
        await this.targetPool.query(patientLineageQuery, [legacyPatientId, newId]);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`⚠️  Warning: Could not record lineage for user ${legacyUserId}:`, errorMessage);
    }
  }

  /**
   * Process profiles in batches
   */
  private async processBatch(profiles: ProfileRecord[]): Promise<void> {
    console.log(`📦 Processing batch of ${profiles.length} profiles...`);

    for (const profile of profiles) {
      try {
        this.stats.totalProcessed++;

        // Check for existing profile (deduplication)
        const existingId = await this.checkExistingProfile(profile);
        
        if (existingId) {
          this.stats.duplicatesSkipped++;
          await this.recordLineage(profile.legacy_user_id, existingId, profile.legacy_patient_id);
          console.log(`⏭️  Skipped duplicate profile: ${profile.first_name} ${profile.last_name} (User ID: ${profile.legacy_user_id})`);
          continue;
        }

        // Insert new profile
        const insertResult = await this.insertProfile(profile);
        
        if (insertResult.success) {
          this.stats.inserted++;
          
          // Track by profile type
          switch (profile.profile_type) {
            case 'patient': this.stats.patientProfiles++; break;
            case 'master': 
            case 'technician': this.stats.staffProfiles++; break;
            case 'doctor': this.stats.doctorProfiles++; break;
            default: this.stats.otherProfiles++; break;
          }
          
          await this.recordLineage(profile.legacy_user_id, insertResult.id!, profile.legacy_patient_id);
          console.log(`✅ Inserted ${profile.profile_type}: ${profile.first_name} ${profile.last_name} (User ID: ${profile.legacy_user_id} → ${insertResult.id})`);
        } else {
          this.stats.errors++;
          console.error(`❌ Failed to insert profile ${profile.legacy_user_id}: ${insertResult.error}`);
        }

      } catch (error) {
        this.stats.errors++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`❌ Error processing profile ${profile.legacy_user_id}:`, errorMessage);
      }
    }
  }

  /**
   * Main migration function
   */
  public async migrate(): Promise<MigrationStats> {
    console.log('🚀 Starting profile migration...');
    console.log(`📊 Batch size: ${this.batchSize}`);

    try {
      // Extract legacy user data
      const legacyUserData = await this.extractLegacyUserData();
      
      if (legacyUserData.length === 0) {
        console.log('ℹ️  No user data found to migrate');
        return this.stats;
      }

      // Transform profiles
      console.log('🔄 Transforming user data to profiles...');
      const transformedProfiles = legacyUserData.map(userData => this.transformProfile(userData));

      // Process in batches
      for (let i = 0; i < transformedProfiles.length; i += this.batchSize) {
        const batch = transformedProfiles.slice(i, i + this.batchSize);
        await this.processBatch(batch);
        
        // Progress update
        const progress = Math.round(((i + batch.length) / transformedProfiles.length) * 100);
        console.log(`📈 Progress: ${progress}% (${i + batch.length}/${transformedProfiles.length})`);
      }

      this.stats.endTime = new Date();
      
      // Final summary
      console.log('\n📋 Profile Migration Summary:');
      console.log(`⏱️  Duration: ${this.stats.endTime.getTime() - this.stats.startTime.getTime()}ms`);
      console.log(`📊 Total Processed: ${this.stats.totalProcessed}`);
      console.log(`✅ Successfully Inserted: ${this.stats.inserted}`);
      console.log(`👥 Patient Profiles: ${this.stats.patientProfiles}`);
      console.log(`👨‍💼 Staff Profiles: ${this.stats.staffProfiles}`);
      console.log(`👨‍⚕️ Doctor Profiles: ${this.stats.doctorProfiles}`);
      console.log(`👤 Other Profiles: ${this.stats.otherProfiles}`);
      console.log(`⏭️  Duplicates Skipped: ${this.stats.duplicatesSkipped}`);
      console.log(`❌ Errors: ${this.stats.errors}`);

      return this.stats;

    } catch (error) {
      console.error('💥 Migration failed:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Validate migration results
   */
  public async validateMigration(): Promise<{ success: boolean; details: any }> {
    console.log('🔍 Validating profile migration results...');

    try {
      // Count source records
      const sourceUserCount = await this.sourcePool.query('SELECT COUNT(*) as count FROM auth_user');
      const sourcePatientCount = await this.sourcePool.query('SELECT COUNT(*) as count FROM dispatch_patient');

      // Count target records by type
      const targetCounts = await this.targetPool.query(`
        SELECT 
          profile_type,
          COUNT(*) as count
        FROM profiles 
        WHERE legacy_user_id IS NOT NULL
        GROUP BY profile_type
        ORDER BY profile_type
      `);

      const totalTargetCount = await this.targetPool.query(
        'SELECT COUNT(*) as count FROM profiles WHERE legacy_user_id IS NOT NULL'
      );

      // Check lineage mappings
      const userLineageCount = await this.targetPool.query(
        "SELECT COUNT(*) as count FROM migration_mappings WHERE entity_type = 'profile'"
      );

      const patientLineageCount = await this.targetPool.query(
        "SELECT COUNT(*) as count FROM migration_mappings WHERE entity_type = 'patient'"
      );

      // Check for missing emails or malformed data
      const dataQualityChecks = await this.targetPool.query(`
        SELECT 
          COUNT(CASE WHEN email IS NULL OR email = '' THEN 1 END) as missing_emails,
          COUNT(CASE WHEN first_name = 'Unknown' OR last_name = 'Unknown' THEN 1 END) as unknown_names,
          COUNT(CASE WHEN profile_type = 'patient' AND legacy_patient_id IS NULL THEN 1 END) as patients_without_legacy_id
        FROM profiles 
        WHERE legacy_user_id IS NOT NULL
      `);

      const validation = {
        source_user_count: parseInt(sourceUserCount.rows[0].count),
        source_patient_count: parseInt(sourcePatientCount.rows[0].count),
        target_total_count: parseInt(totalTargetCount.rows[0].count),
        target_by_type: targetCounts.rows,
        user_lineage_count: parseInt(userLineageCount.rows[0].count),
        patient_lineage_count: parseInt(patientLineageCount.rows[0].count),
        data_quality: dataQualityChecks.rows[0],
        success: true
      };

      // Validation checks
      if (validation.target_total_count !== validation.source_user_count) {
        console.log(`⚠️  Warning: Target count (${validation.target_total_count}) does not match source count (${validation.source_user_count})`);
      }

      if (validation.target_total_count !== validation.user_lineage_count) {
        validation.success = false;
        console.log('⚠️  Warning: Target count does not match user lineage mapping count');
      }

      if (validation.data_quality.missing_emails > 0) {
        console.log(`ℹ️  Info: ${validation.data_quality.missing_emails} profiles missing email addresses`);
      }

      if (validation.data_quality.unknown_names > 0) {
        console.log(`ℹ️  Info: ${validation.data_quality.unknown_names} profiles with unknown names (empty source data)`);
      }

      if (validation.data_quality.patients_without_legacy_id > 0) {
        console.log(`⚠️  Warning: ${validation.data_quality.patients_without_legacy_id} patient profiles missing legacy_patient_id`);
      }

      console.log('✅ Validation completed:', validation);
      return { success: validation.success, details: validation };

    } catch (error) {
      console.error('❌ Validation failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, details: { error: errorMessage } };
    }
  }

  /**
   * Cleanup database connections
   */
  private async cleanup(): Promise<void> {
    try {
      await this.sourcePool.end();
      await this.targetPool.end();
      console.log('🧹 Database connections closed');
    } catch (error) {
      console.error('⚠️  Error during cleanup:', error);
    }
  }

  /**
   * Rollback migration (for testing purposes)
   */
  public async rollback(): Promise<void> {
    console.log('🔄 Rolling back profile migration...');
    
    try {
      await this.targetPool.query('BEGIN');
      
      // Delete lineage mappings
      await this.targetPool.query(
        "DELETE FROM migration_mappings WHERE entity_type IN ('profile', 'patient')"
      );
      
      // Delete migrated profiles
      await this.targetPool.query(
        'DELETE FROM profiles WHERE legacy_user_id IS NOT NULL'
      );
      
      await this.targetPool.query('COMMIT');
      console.log('✅ Rollback completed successfully');
      
    } catch (error) {
      await this.targetPool.query('ROLLBACK');
      console.error('❌ Rollback failed:', error);
      throw error;
    }
  }
}

// Usage example and CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'migrate';

  // Database configuration from environment variables
  const sourceConfig: DatabaseConfig = {
    host: process.env.SOURCE_DB_HOST || 'localhost',
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME || 'brius_legacy',
    username: process.env.SOURCE_DB_USER || 'postgres',
    password: process.env.SOURCE_DB_PASSWORD || 'password'
  };

  const targetConfig: DatabaseConfig = {
    host: process.env.TARGET_DB_HOST || 'localhost',
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    database: process.env.TARGET_DB_NAME || 'brius_target',
    username: process.env.TARGET_DB_USER || 'postgres',
    password: process.env.TARGET_DB_PASSWORD || 'password'
  };

  const migrationService = new ProfileMigrationService(sourceConfig, targetConfig);

  try {
    switch (command) {
      case 'migrate':
        await migrationService.migrate();
        await migrationService.validateMigration();
        break;
        
      case 'validate':
        await migrationService.validateMigration();
        break;
        
      case 'rollback':
        await migrationService.rollback();
        break;
        
      default:
        console.log('Usage: npm run migrate:profiles [migrate|validate|rollback]');
        process.exit(1);
    }
    
    process.exit(0);
    
  } catch (error) {
    console.error('💥 Operation failed:', error);
    process.exit(1);
  }
}

// Export for use as module
export { ProfileMigrationService, ProfileRecord, LegacyUserData, MigrationStats };

// Run if called directly
if (require.main === module) {
  main();
}
