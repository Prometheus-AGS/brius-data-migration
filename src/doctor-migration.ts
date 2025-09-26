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

interface DoctorOfficeRecord {
  doctor_id: string;
  office_id: string;
  is_primary: boolean;
  is_active: boolean;
}

interface LegacyDoctorData {
  // From auth_user
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
  
  // From dispatch_doctorsetting
  doctorsetting_id?: number;
  clinical_preferences?: string;
  sq_customer_id?: string;
  promised_payment?: boolean;
  credit?: number;
  tier_finish?: string;
  tier_type?: string;
  installment_payments?: number;
  baa_agreed_at?: string;
  eula_agreed_at?: string;
  company_account?: boolean;
  
  // Office relationships (array of office IDs)
  office_ids?: number[];
}

interface MigrationStats {
  totalProcessed: number;
  doctorProfilesCreated: number;
  doctorProfilesSkipped: number;
  officeRelationshipsCreated: number;
  officeRelationshipsSkipped: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
}

class DoctorMigrationService {
  private sourcePool: Pool;
  private targetPool: Pool;
  private batchSize: number = 1000;
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
      doctorProfilesCreated: 0,
      doctorProfilesSkipped: 0,
      officeRelationshipsCreated: 0,
      officeRelationshipsSkipped: 0,
      errors: 0,
      startTime: new Date(),
    };
  }

  /**
   * Extract doctor data from legacy database
   */
  private async extractLegacyDoctorData(): Promise<LegacyDoctorData[]> {
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
        
        ds.id as doctorsetting_id,
        ds.clinical_preferences,
        ds.sq_customer_id,
        ds.promised_payment,
        ds.credit,
        ds.tier_finish,
        ds.tier_type,
        ds.installment_payments,
        ds.baa_agreed_at,
        ds.eula_agreed_at,
        ds.company_account,
        
        ARRAY_AGG(DISTINCT od.office_id) FILTER (WHERE od.office_id IS NOT NULL) as office_ids
      FROM auth_user u
      INNER JOIN dispatch_doctorsetting ds ON u.id = ds.user_id
      LEFT JOIN dispatch_office_doctors od ON u.id = od.user_id
      WHERE NOT EXISTS (
        SELECT 1 FROM dispatch_patient p WHERE p.user_id = u.id
      )
      GROUP BY 
        u.id, u.username, u.first_name, u.last_name, u.email, u.password,
        u.is_superuser, u.is_staff, u.is_active, u.date_joined, u.last_login,
        ds.id, ds.clinical_preferences, ds.sq_customer_id, ds.promised_payment,
        ds.credit, ds.tier_finish, ds.tier_type, ds.installment_payments,
        ds.baa_agreed_at, ds.eula_agreed_at, ds.company_account
      ORDER BY u.id
    `;

    try {
      const result = await this.sourcePool.query(query);
      console.log(`✓ Extracted ${result.rows.length} doctor records from source database`);
      return result.rows;
    } catch (error) {
      console.error('❌ Error extracting legacy doctor data:', error);
      throw error;
    }
  }

  /**
   * Check if doctor profile already exists in target database
   */
  private async getDoctorProfileId(legacyUserId: number): Promise<string | null> {
    const query = `
      SELECT id 
      FROM profiles 
      WHERE legacy_user_id = $1 AND profile_type = 'doctor'
    `;

    try {
      const result = await this.targetPool.query(query, [legacyUserId]);
      return result.rows.length > 0 ? result.rows[0].id : null;
    } catch (error) {
      console.error('❌ Error checking existing doctor profile:', error);
      return null;
    }
  }

  /**
   * Create doctor profile if it doesn't exist
   */
  private async ensureDoctorProfile(doctorData: LegacyDoctorData): Promise<string | null> {
    // First check if profile already exists
    let doctorId = await this.getDoctorProfileId(doctorData.user_id);
    
    if (doctorId) {
      this.stats.doctorProfilesSkipped++;
      return doctorId;
    }

    // Create new doctor profile
    const insertQuery = `
      INSERT INTO profiles (
        profile_type, first_name, last_name, email, username, password_hash,
        is_active, is_verified, archived, suspended, 
        metadata, legacy_user_id, created_at, updated_at
      ) VALUES (
        'doctor', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW()
      ) 
      RETURNING id
    `;

    const cleanName = (name: string): string => {
      const cleaned = name?.trim() || '';
      return cleaned === '' ? 'Unknown' : cleaned;
    };

    const cleanEmail = (email: string): string | undefined => {
      if (!email || email.trim() === '' || !email.includes('@')) {
        return undefined;
      }
      return email.trim().toLowerCase();
    };

    const metadata = {
      migration: {
        source_table: 'auth_user + dispatch_doctorsetting',
        migrated_at: new Date().toISOString(),
        doctor_settings: {
          clinical_preferences: doctorData.clinical_preferences,
          sq_customer_id: doctorData.sq_customer_id,
          promised_payment: doctorData.promised_payment,
          credit: doctorData.credit,
          tier_finish: doctorData.tier_finish,
          tier_type: doctorData.tier_type,
          installment_payments: doctorData.installment_payments,
          baa_agreed_at: doctorData.baa_agreed_at,
          eula_agreed_at: doctorData.eula_agreed_at,
          company_account: doctorData.company_account
        },
        original_user_flags: {
          is_superuser: doctorData.is_superuser,
          is_staff: doctorData.is_staff,
          is_active: doctorData.is_active
        }
      }
    };

    const values = [
      cleanName(doctorData.first_name),
      cleanName(doctorData.last_name),
      cleanEmail(doctorData.email),
      doctorData.username,
      doctorData.password,
      doctorData.is_active,
      false, // is_verified
      false, // archived
      false, // suspended
      JSON.stringify(metadata),
      doctorData.user_id
    ];

    try {
      const result = await this.targetPool.query(insertQuery, values);
      this.stats.doctorProfilesCreated++;
      return result.rows[0].id;
    } catch (error) {
      console.error(`❌ Error creating doctor profile for user ${doctorData.user_id}:`, error);
      return null;
    }
  }

  /**
   * Get office UUID from legacy office ID
   */
  private async getOfficeId(legacyOfficeId: number): Promise<string | null> {
    const query = `
      SELECT id 
      FROM offices 
      WHERE legacy_office_id = $1
    `;

    try {
      const result = await this.targetPool.query(query, [legacyOfficeId]);
      return result.rows.length > 0 ? result.rows[0].id : null;
    } catch (error) {
      console.error(`❌ Error getting office ID for legacy office ${legacyOfficeId}:`, error);
      return null;
    }
  }

  /**
   * Check if doctor-office relationship already exists
   */
  private async checkDoctorOfficeExists(doctorId: string, officeId: string): Promise<boolean> {
    const query = `
      SELECT 1 
      FROM doctor_offices 
      WHERE doctor_id = $1 AND office_id = $2
    `;

    try {
      const result = await this.targetPool.query(query, [doctorId, officeId]);
      return result.rows.length > 0;
    } catch (error) {
      console.error('❌ Error checking doctor-office relationship:', error);
      return false;
    }
  }

  /**
   * Create doctor-office relationships
   */
  private async createDoctorOfficeRelationships(doctorId: string, legacyOfficeIds: number[]): Promise<void> {
    if (!legacyOfficeIds || legacyOfficeIds.length === 0) {
      return;
    }

    for (let i = 0; i < legacyOfficeIds.length; i++) {
      const legacyOfficeId = legacyOfficeIds[i];
      const officeId = await this.getOfficeId(legacyOfficeId);
      
      if (!officeId) {
        console.warn(`⚠️  Warning: Could not find office with legacy ID ${legacyOfficeId}`);
        continue;
      }

      // Check if relationship already exists
      if (await this.checkDoctorOfficeExists(doctorId, officeId)) {
        this.stats.officeRelationshipsSkipped++;
        continue;
      }

      // Create relationship
      const insertQuery = `
        INSERT INTO doctor_offices (doctor_id, office_id, is_primary, is_active, created_at)
        VALUES ($1, $2, $3, true, NOW())
      `;

      const isPrimary = i === 0; // First office is considered primary

      try {
        await this.targetPool.query(insertQuery, [doctorId, officeId, isPrimary]);
        this.stats.officeRelationshipsCreated++;
      } catch (error) {
        console.error(`❌ Error creating doctor-office relationship:`, error);
        this.stats.errors++;
      }
    }
  }

  /**
   * Record lineage mapping
   */
  private async recordLineage(legacyUserId: number, doctorId: string): Promise<void> {
    const lineageQuery = `
      INSERT INTO migration_mappings (
        entity_type, legacy_id, new_id, migrated_at, migration_batch
      ) VALUES (
        'doctor', $1, $2, NOW(), 'doctor_migration_' || TO_CHAR(NOW(), 'YYYYMMDD_HH24MISS')
      ) 
      ON CONFLICT (entity_type, legacy_id) DO NOTHING
    `;

    try {
      await this.targetPool.query(lineageQuery, [legacyUserId, doctorId]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`⚠️  Warning: Could not record lineage for doctor ${legacyUserId}:`, errorMessage);
    }
  }

  /**
   * Process doctors in batches
   */
  private async processBatch(doctors: LegacyDoctorData[]): Promise<void> {
    console.log(`📦 Processing batch of ${doctors.length} doctors...`);

    for (const doctor of doctors) {
      try {
        this.stats.totalProcessed++;

        // Ensure doctor profile exists
        const doctorId = await this.ensureDoctorProfile(doctor);
        
        if (!doctorId) {
          this.stats.errors++;
          console.error(`❌ Failed to create/find doctor profile for user ${doctor.user_id}`);
          continue;
        }

        // Create office relationships
        await this.createDoctorOfficeRelationships(doctorId, doctor.office_ids || []);

        // Record lineage
        await this.recordLineage(doctor.user_id, doctorId);

        console.log(`✅ Processed doctor: ${doctor.first_name} ${doctor.last_name} (User ID: ${doctor.user_id} → ${doctorId})`);
        if (doctor.office_ids && doctor.office_ids.length > 0) {
          console.log(`   📍 Associated with ${doctor.office_ids.length} office(s): ${doctor.office_ids.join(', ')}`);
        }

      } catch (error) {
        this.stats.errors++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`❌ Error processing doctor ${doctor.user_id}:`, errorMessage);
      }
    }
  }

  /**
   * Main migration function
   */
  public async migrate(): Promise<MigrationStats> {
    console.log('🚀 Starting doctor migration...');
    console.log(`📊 Batch size: ${this.batchSize}`);

    try {
      // Extract legacy doctor data
      const legacyDoctors = await this.extractLegacyDoctorData();
      
      if (legacyDoctors.length === 0) {
        console.log('ℹ️  No doctors found to migrate');
        return this.stats;
      }

      // Process in batches
      for (let i = 0; i < legacyDoctors.length; i += this.batchSize) {
        const batch = legacyDoctors.slice(i, i + this.batchSize);
        await this.processBatch(batch);
        
        // Progress update
        const progress = Math.round(((i + batch.length) / legacyDoctors.length) * 100);
        console.log(`📈 Progress: ${progress}% (${i + batch.length}/${legacyDoctors.length})`);
      }

      this.stats.endTime = new Date();
      
      // Final summary
      console.log('\n📋 Doctor Migration Summary:');
      console.log(`⏱️  Duration: ${this.stats.endTime.getTime() - this.stats.startTime.getTime()}ms`);
      console.log(`📊 Total Processed: ${this.stats.totalProcessed}`);
      console.log(`👨‍⚕️ Doctor Profiles Created: ${this.stats.doctorProfilesCreated}`);
      console.log(`⏭️  Doctor Profiles Skipped (already exist): ${this.stats.doctorProfilesSkipped}`);
      console.log(`🏢 Office Relationships Created: ${this.stats.officeRelationshipsCreated}`);
      console.log(`⏭️  Office Relationships Skipped: ${this.stats.officeRelationshipsSkipped}`);
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
    console.log('🔍 Validating doctor migration results...');

    try {
      // Count source records
      const sourceDoctorCount = await this.sourcePool.query(`
        SELECT COUNT(*) as count 
        FROM dispatch_doctorsetting ds
        JOIN auth_user u ON ds.user_id = u.id
        WHERE NOT EXISTS (SELECT 1 FROM dispatch_patient p WHERE p.user_id = u.id)
      `);

      const sourceOfficeRelations = await this.sourcePool.query(`
        SELECT COUNT(*) as count 
        FROM dispatch_office_doctors od
        JOIN dispatch_doctorsetting ds ON od.user_id = ds.user_id
      `);

      // Count target records
      const targetDoctorCount = await this.targetPool.query(`
        SELECT COUNT(*) as count 
        FROM profiles 
        WHERE profile_type = 'doctor' AND legacy_user_id IS NOT NULL
      `);

      const targetOfficeRelations = await this.targetPool.query(`
        SELECT COUNT(*) as count
        FROM doctor_offices doc_off
        JOIN profiles p ON doc_off.doctor_id = p.id
        WHERE p.legacy_user_id IS NOT NULL
      `);

      // Check lineage mappings
      const lineageCount = await this.targetPool.query(
        "SELECT COUNT(*) as count FROM migration_mappings WHERE entity_type = 'doctor'"
      );

      // Check for doctors without offices
      const doctorsWithoutOffices = await this.targetPool.query(`
        SELECT COUNT(*) as count
        FROM profiles p
        WHERE p.profile_type = 'doctor'
          AND p.legacy_user_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM doctor_offices doc_off WHERE doc_off.doctor_id = p.id
          )
      `);

      // Check for invalid office references
      const invalidOfficeRefs = await this.targetPool.query(`
        SELECT COUNT(*) as count
        FROM doctor_offices doc_off
        WHERE NOT EXISTS (SELECT 1 FROM offices o WHERE o.id = doc_off.office_id)
           OR NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = doc_off.doctor_id)
      `);

      const validation = {
        source_doctor_count: parseInt(sourceDoctorCount.rows[0].count),
        source_office_relations: parseInt(sourceOfficeRelations.rows[0].count),
        target_doctor_count: parseInt(targetDoctorCount.rows[0].count),
        target_office_relations: parseInt(targetOfficeRelations.rows[0].count),
        lineage_count: parseInt(lineageCount.rows[0].count),
        doctors_without_offices: parseInt(doctorsWithoutOffices.rows[0].count),
        invalid_office_refs: parseInt(invalidOfficeRefs.rows[0].count),
        success: true
      };

      // Validation checks
      if (validation.target_doctor_count !== validation.lineage_count) {
        validation.success = false;
        console.log('⚠️  Warning: Target doctor count does not match lineage mapping count');
      }

      if (validation.invalid_office_refs > 0) {
        validation.success = false;
        console.log(`❌ Error: Found ${validation.invalid_office_refs} invalid office references`);
      }

      if (validation.doctors_without_offices > 0) {
        console.log(`ℹ️  Info: ${validation.doctors_without_offices} doctors have no office associations`);
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
    console.log('🔄 Rolling back doctor migration...');
    
    try {
      await this.targetPool.query('BEGIN');
      
      // Delete doctor-office relationships for migrated doctors
      await this.targetPool.query(`
        DELETE FROM doctor_offices 
        WHERE doctor_id IN (
          SELECT id FROM profiles 
          WHERE profile_type = 'doctor' AND legacy_user_id IS NOT NULL
        )
      `);
      
      // Delete lineage mappings
      await this.targetPool.query(
        "DELETE FROM migration_mappings WHERE entity_type = 'doctor'"
      );
      
      // Delete migrated doctor profiles
      await this.targetPool.query(
        "DELETE FROM profiles WHERE profile_type = 'doctor' AND legacy_user_id IS NOT NULL"
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

  const migrationService = new DoctorMigrationService(sourceConfig, targetConfig);

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
        console.log('Usage: npm run migrate:doctors [migrate|validate|rollback]');
        process.exit(1);
    }
    
    process.exit(0);
    
  } catch (error) {
    console.error('💥 Operation failed:', error);
    process.exit(1);
  }
}

// Export for use as module
export { DoctorMigrationService, LegacyDoctorData, MigrationStats };

// Run if called directly
if (require.main === module) {
  main();
}
