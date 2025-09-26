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

interface PatientRecord {
  legacy_patient_id: number;
  legacy_user_id: number;
  profile_type: 'patient';
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

interface LegacyPatientData {
  // dispatch_patient fields
  patient_id: number;
  doctor_id: number;
  user_id: number;
  birthdate?: string;
  office_id?: number;
  archived: boolean;
  status: number;
  submitted_at?: string;
  suffix: string;
  updated_at?: string;
  sex?: number;
  suspended: boolean;
  schemes: string;
  
  // auth_user fields
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
}

interface PatientRelationship {
  patient_profile_id: string;
  doctor_profile_id: string;
  office_id?: string;
  legacy_patient_id: number;
  legacy_doctor_id: number;
  legacy_office_id?: number;
}

interface MigrationStats {
  totalProcessed: number;
  patientProfilesCreated: number;
  patientProfilesSkipped: number;
  doctorPatientRelationsCreated: number;
  doctorPatientRelationsSkipped: number;
  ordersLinked: number;
  treatmentsLinked: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
}

class PatientMigrationService {
  private sourcePool: Pool;
  private targetPool: Pool;
  private batchSize: number = 2000;
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
      patientProfilesCreated: 0,
      patientProfilesSkipped: 0,
      doctorPatientRelationsCreated: 0,
      doctorPatientRelationsSkipped: 0,
      ordersLinked: 0,
      treatmentsLinked: 0,
      errors: 0,
      startTime: new Date(),
    };
  }

  /**
   * Extract patient data from legacy database
   */
  private async extractLegacyPatientData(): Promise<LegacyPatientData[]> {
    const query = `
      SELECT 
        p.id as patient_id,
        p.doctor_id,
        p.user_id,
        p.birthdate,
        p.office_id,
        p.archived,
        p.status,
        p.submitted_at,
        p.suffix,
        p.updated_at,
        p.sex,
        p.suspended,
        p.schemes,
        
        u.username,
        u.first_name,
        u.last_name,
        u.email,
        u.password,
        u.is_superuser,
        u.is_staff,
        u.is_active,
        u.date_joined,
        u.last_login
      FROM dispatch_patient p
      INNER JOIN auth_user u ON p.user_id = u.id
      ORDER BY p.id
    `;

    try {
      const result = await this.sourcePool.query(query);
      console.log(`✓ Extracted ${result.rows.length} patient records from source database`);
      return result.rows;
    } catch (error) {
      console.error('❌ Error extracting legacy patient data:', error);
      throw error;
    }
  }

  /**
   * Transform legacy patient data to target profile format
   */
  private transformPatientProfile(legacyData: LegacyPatientData): PatientRecord {
    // Normalize text fields
    const normalizeText = (text?: string): string => {
      if (!text) return '';
      return text.trim().replace(/\s+/g, ' ');
    };

    // Convert sex integer to gender enum
    const convertGender = (sex?: number): PatientRecord['gender'] => {
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

    // Parse medical history from schemes field
    const parseMedicalHistory = (schemes: string): any => {
      try {
        const parsed = JSON.parse(schemes || '{}');
        return Object.keys(parsed).length > 0 ? parsed : undefined;
      } catch {
        return schemes ? { legacy_schemes: schemes } : undefined;
      }
    };

    return {
      legacy_patient_id: legacyData.patient_id,
      legacy_user_id: legacyData.user_id,
      profile_type: 'patient',
      first_name: cleanName(legacyData.first_name),
      last_name: cleanName(legacyData.last_name),
      email: cleanEmail(legacyData.email),
      phone: undefined, // No phone in source, would need separate extraction
      date_of_birth: legacyData.birthdate || undefined,
      gender: convertGender(legacyData.sex),
      username: legacyData.username || undefined,
      password_hash: legacyData.password || undefined,
      is_active: legacyData.is_active || false,
      is_verified: false, // Default to false
      archived: legacyData.archived || false,
      suspended: legacyData.suspended || false,
      patient_suffix: legacyData.suffix || undefined,
      insurance_info: undefined, // Would need separate extraction
      medical_history: parseMedicalHistory(legacyData.schemes),
      last_login_at: legacyData.last_login || undefined,
      metadata: {
        migration: {
          source_table: 'dispatch_patient + auth_user',
          migrated_at: new Date().toISOString(),
          patient_data: {
            status: legacyData.status,
            submitted_at: legacyData.submitted_at,
            updated_at: legacyData.updated_at,
            legacy_doctor_id: legacyData.doctor_id,
            legacy_office_id: legacyData.office_id
          },
          original_user_flags: {
            is_superuser: legacyData.is_superuser,
            is_staff: legacyData.is_staff,
            is_active: legacyData.is_active
          }
        }
      }
    };
  }

  /**
   * Check if patient profile already exists in target database
   */
  private async getPatientProfileId(legacyUserId: number): Promise<string | null> {
    const query = `
      SELECT id 
      FROM profiles 
      WHERE legacy_user_id = $1 AND profile_type = 'patient'
    `;

    try {
      const result = await this.targetPool.query(query, [legacyUserId]);
      return result.rows.length > 0 ? result.rows[0].id : null;
    } catch (error) {
      console.error('❌ Error checking existing patient profile:', error);
      return null;
    }
  }

  /**
   * Create patient profile if it doesn't exist
   */
  private async ensurePatientProfile(patientData: PatientRecord): Promise<string | null> {
    // First check if profile already exists
    let patientId = await this.getPatientProfileId(patientData.legacy_user_id);
    
    if (patientId) {
      this.stats.patientProfilesSkipped++;
      return patientId;
    }

    // Create new patient profile
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
      patientData.profile_type,
      patientData.first_name,
      patientData.last_name,
      patientData.email,
      patientData.phone,
      patientData.date_of_birth,
      patientData.gender,
      patientData.username,
      patientData.password_hash,
      patientData.is_active,
      patientData.is_verified,
      patientData.archived,
      patientData.suspended,
      patientData.patient_suffix,
      patientData.insurance_info ? JSON.stringify(patientData.insurance_info) : null,
      patientData.medical_history ? JSON.stringify(patientData.medical_history) : null,
      patientData.last_login_at,
      JSON.stringify(patientData.metadata),
      patientData.legacy_user_id,
      patientData.legacy_patient_id
    ];

    try {
      const result = await this.targetPool.query(insertQuery, values);
      this.stats.patientProfilesCreated++;
      return result.rows[0].id;
    } catch (error) {
      console.error(`❌ Error creating patient profile for user ${patientData.legacy_user_id}:`, error);
      return null;
    }
  }

  /**
   * Get doctor profile ID from legacy doctor ID
   */
  private async getDoctorProfileId(legacyDoctorId: number): Promise<string | null> {
    const query = `
      SELECT id 
      FROM profiles 
      WHERE legacy_user_id = $1 AND profile_type = 'doctor'
    `;

    try {
      const result = await this.targetPool.query(query, [legacyDoctorId]);
      return result.rows.length > 0 ? result.rows[0].id : null;
    } catch (error) {
      console.error(`❌ Error getting doctor profile ID for legacy doctor ${legacyDoctorId}:`, error);
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
   * Update orders to link to patient profile
   */
  private async linkOrdersToPatient(patientProfileId: string, legacyPatientId: number): Promise<number> {
    try {
      // First get instruction IDs from source database
      const instructionResult = await this.sourcePool.query(
        'SELECT id FROM dispatch_instruction WHERE patient_id = $1',
        [legacyPatientId]
      );

      if (instructionResult.rows.length === 0) {
        return 0;
      }

      const instructionIds = instructionResult.rows.map(row => row.id);

      // Update orders in target database using the instruction IDs
      const updateQuery = `
        UPDATE orders
        SET patient_id = $1
        WHERE legacy_instruction_id = ANY($2) AND patient_id IS NULL
      `;

      const updateResult = await this.targetPool.query(updateQuery, [patientProfileId, instructionIds]);
      return updateResult.rowCount || 0;
    } catch (error) {
      console.error(`❌ Error linking orders to patient ${patientProfileId}:`, error);
      return 0;
    }
  }

  /**
   * Update treatment plans to link to patient profile
   */
  private async linkTreatmentsToPatient(patientProfileId: string, legacyPatientId: number): Promise<number> {
    try {
      // First get plan IDs from source database by joining with dispatch_instruction
      const planResult = await this.sourcePool.query(`
        SELECT dp.id
        FROM dispatch_plan dp
        INNER JOIN dispatch_instruction di ON dp.instruction_id = di.id
        WHERE di.patient_id = $1
      `, [legacyPatientId]);

      if (planResult.rows.length === 0) {
        return 0;
      }

      const planIds = planResult.rows.map(row => row.id);

      // Update treatment_plans in target database using the plan IDs
      const updateQuery = `
        UPDATE treatment_plans
        SET patient_id = $1
        WHERE legacy_plan_id = ANY($2) AND patient_id IS NULL
      `;

      const updateResult = await this.targetPool.query(updateQuery, [patientProfileId, planIds]);
      return updateResult.rowCount || 0;
    } catch (error) {
      console.error(`❌ Error linking treatments to patient ${patientProfileId}:`, error);
      return 0;
    }
  }

  /**
   * Record lineage mapping
   */
  private async recordLineage(legacyPatientId: number, legacyUserId: number, patientProfileId: string): Promise<void> {
    const lineageQueries = [
      {
        entity_type: 'patient',
        legacy_id: legacyPatientId,
        new_id: patientProfileId
      },
      {
        entity_type: 'patient_profile',
        legacy_id: legacyUserId,
        new_id: patientProfileId
      }
    ];

    for (const mapping of lineageQueries) {
      const lineageQuery = `
        INSERT INTO migration_mappings (
          entity_type, legacy_id, new_id, migrated_at, migration_batch
        ) VALUES (
          $1, $2, $3, NOW(), 'patient_migration_' || TO_CHAR(NOW(), 'YYYYMMDD_HH24MISS')
        ) 
        ON CONFLICT (entity_type, legacy_id) DO NOTHING
      `;

      try {
        await this.targetPool.query(lineageQuery, [mapping.entity_type, mapping.legacy_id, mapping.new_id]);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`⚠️  Warning: Could not record lineage for ${mapping.entity_type} ${mapping.legacy_id}:`, errorMessage);
      }
    }
  }

  /**
   * Process patients in batches
   */
  private async processBatch(patients: LegacyPatientData[]): Promise<void> {
    console.log(`📦 Processing batch of ${patients.length} patients...`);

    for (const patient of patients) {
      try {
        this.stats.totalProcessed++;

        // Transform to profile record
        const patientProfile = this.transformPatientProfile(patient);

        // Ensure patient profile exists
        const patientProfileId = await this.ensurePatientProfile(patientProfile);
        
        if (!patientProfileId) {
          this.stats.errors++;
          console.error(`❌ Failed to create/find patient profile for user ${patient.user_id}`);
          continue;
        }

        // Link orders and treatments
        const ordersLinked = await this.linkOrdersToPatient(patientProfileId, patient.patient_id);
        const treatmentsLinked = await this.linkTreatmentsToPatient(patientProfileId, patient.patient_id);
        
        this.stats.ordersLinked += ordersLinked;
        this.stats.treatmentsLinked += treatmentsLinked;

        // Record lineage
        await this.recordLineage(patient.patient_id, patient.user_id, patientProfileId);

        console.log(`✅ Processed patient: ${patientProfile.first_name} ${patientProfile.last_name} (Patient ID: ${patient.patient_id} → ${patientProfileId})`);
        
        if (ordersLinked > 0 || treatmentsLinked > 0) {
          console.log(`   🔗 Linked ${ordersLinked} orders, ${treatmentsLinked} treatments`);
        }

      } catch (error) {
        this.stats.errors++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`❌ Error processing patient ${patient.patient_id}:`, errorMessage);
      }
    }
  }

  /**
   * Main migration function
   */
  public async migrate(): Promise<MigrationStats> {
    console.log('🚀 Starting patient migration...');
    console.log(`📊 Batch size: ${this.batchSize}`);

    try {
      // Extract legacy patient data
      const legacyPatients = await this.extractLegacyPatientData();
      
      if (legacyPatients.length === 0) {
        console.log('ℹ️  No patients found to migrate');
        return this.stats;
      }

      // Process in batches
      for (let i = 0; i < legacyPatients.length; i += this.batchSize) {
        const batch = legacyPatients.slice(i, i + this.batchSize);
        await this.processBatch(batch);
        
        // Progress update
        const progress = Math.round(((i + batch.length) / legacyPatients.length) * 100);
        console.log(`📈 Progress: ${progress}% (${i + batch.length}/${legacyPatients.length})`);
      }

      this.stats.endTime = new Date();
      
      // Final summary
      console.log('\n📋 Patient Migration Summary:');
      console.log(`⏱️  Duration: ${this.stats.endTime.getTime() - this.stats.startTime.getTime()}ms`);
      console.log(`📊 Total Processed: ${this.stats.totalProcessed}`);
      console.log(`👥 Patient Profiles Created: ${this.stats.patientProfilesCreated}`);
      console.log(`⏭️  Patient Profiles Skipped (already exist): ${this.stats.patientProfilesSkipped}`);
      console.log(`📋 Orders Linked: ${this.stats.ordersLinked}`);
      console.log(`🦷 Treatments Linked: ${this.stats.treatmentsLinked}`);
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
    console.log('🔍 Validating patient migration results...');

    try {
      // Count source records
      const sourcePatientCount = await this.sourcePool.query(
        'SELECT COUNT(*) as count FROM dispatch_patient'
      );

      // Count target records
      const targetPatientCount = await this.targetPool.query(`
        SELECT COUNT(*) as count 
        FROM profiles 
        WHERE profile_type = 'patient' AND legacy_patient_id IS NOT NULL
      `);

      // Check lineage mappings
      const patientLineageCount = await this.targetPool.query(
        "SELECT COUNT(*) as count FROM migration_mappings WHERE entity_type = 'patient'"
      );

      const profileLineageCount = await this.targetPool.query(
        "SELECT COUNT(*) as count FROM migration_mappings WHERE entity_type = 'patient_profile'"
      );

      // Check profile distribution by status
      const statusDistribution = await this.targetPool.query(`
        SELECT 
          archived,
          suspended,
          is_active,
          COUNT(*) as count
        FROM profiles 
        WHERE profile_type = 'patient' AND legacy_patient_id IS NOT NULL
        GROUP BY archived, suspended, is_active
        ORDER BY count DESC
      `);

      // Check for missing relationships
      const missingDoctorRefs = await this.targetPool.query(`
        SELECT COUNT(*) as count
        FROM profiles p
        WHERE p.profile_type = 'patient' 
          AND p.legacy_patient_id IS NOT NULL
          AND p.metadata->>'migration' IS NOT NULL
          AND (p.metadata->'migration'->'patient_data'->>'legacy_doctor_id')::int NOT IN (
            SELECT DISTINCT legacy_user_id 
            FROM profiles 
            WHERE profile_type = 'doctor' AND legacy_user_id IS NOT NULL
          )
      `);

      // Check data quality
      const dataQualityChecks = await this.targetPool.query(`
        SELECT 
          COUNT(CASE WHEN email IS NULL OR email = '' THEN 1 END) as missing_emails,
          COUNT(CASE WHEN first_name = 'Unknown' OR last_name = 'Unknown' THEN 1 END) as unknown_names,
          COUNT(CASE WHEN date_of_birth IS NULL THEN 1 END) as missing_birthdate,
          COUNT(CASE WHEN patient_suffix IS NULL OR patient_suffix = '' THEN 1 END) as missing_suffix
        FROM profiles 
        WHERE profile_type = 'patient' AND legacy_patient_id IS NOT NULL
      `);

      const validation = {
        source_patient_count: parseInt(sourcePatientCount.rows[0].count),
        target_patient_count: parseInt(targetPatientCount.rows[0].count),
        patient_lineage_count: parseInt(patientLineageCount.rows[0].count),
        profile_lineage_count: parseInt(profileLineageCount.rows[0].count),
        status_distribution: statusDistribution.rows,
        missing_doctor_refs: parseInt(missingDoctorRefs.rows[0].count),
        data_quality: dataQualityChecks.rows[0],
        success: true
      };

      // Validation checks
      if (validation.target_patient_count !== validation.source_patient_count) {
        console.log(`⚠️  Warning: Target count (${validation.target_patient_count}) does not match source count (${validation.source_patient_count})`);
      }

      if (validation.target_patient_count !== validation.patient_lineage_count) {
        validation.success = false;
        console.log('⚠️  Warning: Target count does not match patient lineage mapping count');
      }

      if (validation.missing_doctor_refs > 0) {
        console.log(`⚠️  Warning: ${validation.missing_doctor_refs} patients reference doctors that haven't been migrated`);
      }

      if (validation.data_quality.missing_emails > 0) {
        console.log(`ℹ️  Info: ${validation.data_quality.missing_emails} patients missing email addresses`);
      }

      if (validation.data_quality.unknown_names > 0) {
        console.log(`ℹ️  Info: ${validation.data_quality.unknown_names} patients with unknown names (empty source data)`);
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
    console.log('🔄 Rolling back patient migration...');
    
    try {
      await this.targetPool.query('BEGIN');
      
      // Delete lineage mappings
      await this.targetPool.query(
        "DELETE FROM migration_mappings WHERE entity_type IN ('patient', 'patient_profile')"
      );
      
      // Reset order patient links
      await this.targetPool.query(`
        UPDATE orders 
        SET patient_id = NULL 
        WHERE patient_id IN (
          SELECT id FROM profiles 
          WHERE profile_type = 'patient' AND legacy_patient_id IS NOT NULL
        )
      `);
      
      // Reset treatment patient links
      await this.targetPool.query(`
        UPDATE treatments 
        SET patient_id = NULL 
        WHERE patient_id IN (
          SELECT id FROM profiles 
          WHERE profile_type = 'patient' AND legacy_patient_id IS NOT NULL
        )
      `);
      
      // Delete migrated patient profiles
      await this.targetPool.query(
        "DELETE FROM profiles WHERE profile_type = 'patient' AND legacy_patient_id IS NOT NULL"
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

  const migrationService = new PatientMigrationService(sourceConfig, targetConfig);

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
        console.log('Usage: npm run migrate:patients [migrate|validate|rollback]');
        process.exit(1);
    }
    
    process.exit(0);
    
  } catch (error) {
    console.error('💥 Operation failed:', error);
    process.exit(1);
  }
}

// Export for use as module
export { PatientMigrationService, PatientRecord, LegacyPatientData, MigrationStats };

// Run if called directly
if (require.main === module) {
  main();
}
