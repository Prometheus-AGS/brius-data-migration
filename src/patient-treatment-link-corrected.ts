import { Pool } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

interface PatientProfileMapping {
  profileId: string;
  legacyUserId: number;
  legacyPatientId: number;
  firstName: string;
  lastName: string;
}

interface MigrationStats {
  totalProfilesProcessed: number;
  treatmentLinksUpdated: number;
  orderLinksUpdated: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
}

class PatientTreatmentLinkService {
  private sourcePool: Pool;
  private targetPool: Pool;
  private stats: MigrationStats;

  constructor(sourceConfig: DatabaseConfig, targetConfig: DatabaseConfig) {
    this.sourcePool = new Pool({
      host: sourceConfig.host,
      port: sourceConfig.port,
      database: sourceConfig.database,
      user: sourceConfig.username,
      password: sourceConfig.password,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    this.targetPool = new Pool({
      host: targetConfig.host,
      port: targetConfig.port,
      database: targetConfig.database,
      user: targetConfig.username,
      password: targetConfig.password,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    this.stats = {
      totalProfilesProcessed: 0,
      treatmentLinksUpdated: 0,
      orderLinksUpdated: 0,
      errors: 0,
      startTime: new Date()
    };
  }

  /**
   * Get all existing patient profiles and their legacy mappings
   */
  private async getPatientProfileMappings(): Promise<PatientProfileMapping[]> {
    console.log('🔍 Getting existing patient profile mappings...');

    const query = `
      SELECT
        p.id as profile_id,
        p.legacy_user_id,
        p.first_name,
        p.last_name
      FROM profiles p
      WHERE p.profile_type = 'patient'
        AND p.legacy_user_id IS NOT NULL
      ORDER BY p.legacy_user_id
    `;

    try {
      const result = await this.targetPool.query(query);
      console.log(`✓ Found ${result.rows.length} existing patient profiles`);

      // Now get the corresponding legacy patient IDs from source database
      const mappings: PatientProfileMapping[] = [];

      for (const row of result.rows) {
        try {
          const patientQuery = `
            SELECT dp.id as patient_id
            FROM dispatch_patient dp
            WHERE dp.user_id = $1
          `;

          const patientResult = await this.sourcePool.query(patientQuery, [row.legacy_user_id]);

          if (patientResult.rows.length > 0) {
            mappings.push({
              profileId: row.profile_id,
              legacyUserId: row.legacy_user_id,
              legacyPatientId: patientResult.rows[0].patient_id,
              firstName: row.first_name,
              lastName: row.last_name
            });
          }
        } catch (error) {
          console.error(`❌ Error getting patient ID for user ${row.legacy_user_id}:`, error);
          this.stats.errors++;
        }
      }

      console.log(`✓ Created ${mappings.length} complete patient profile mappings`);
      return mappings;

    } catch (error) {
      console.error('❌ Error getting patient profile mappings:', error);
      throw error;
    }
  }

  /**
   * Link treatment plans to existing patient profiles
   */
  private async linkTreatmentPlansToProfiles(mappings: PatientProfileMapping[]): Promise<void> {
    console.log('🔗 Linking treatment plans to existing patient profiles...');

    for (const mapping of mappings) {
      try {
        // Get treatment plan IDs for this patient from source
        const planQuery = `
          SELECT dp.id
          FROM dispatch_plan dp
          INNER JOIN dispatch_instruction di ON dp.instruction_id = di.id
          WHERE di.patient_id = $1
        `;

        const planResult = await this.sourcePool.query(planQuery, [mapping.legacyPatientId]);

        if (planResult.rows.length > 0) {
          const planIds = planResult.rows.map(row => row.id);

          // Update treatment_plans to reference the existing profile UUID
          const updateQuery = `
            UPDATE treatment_plans
            SET patient_id = $1
            WHERE legacy_plan_id = ANY($2) AND patient_id IS NULL
          `;

          const updateResult = await this.targetPool.query(updateQuery, [mapping.profileId, planIds]);
          const updatedCount = updateResult.rowCount || 0;

          if (updatedCount > 0) {
            console.log(`✅ Linked ${updatedCount} treatment plans to ${mapping.firstName} ${mapping.lastName} (Profile: ${mapping.profileId})`);
            this.stats.treatmentLinksUpdated += updatedCount;
          }
        }

        this.stats.totalProfilesProcessed++;

      } catch (error) {
        console.error(`❌ Error linking treatments for ${mapping.firstName} ${mapping.lastName}:`, error);
        this.stats.errors++;
      }
    }
  }

  /**
   * Link orders to existing patient profiles
   */
  private async linkOrdersToProfiles(mappings: PatientProfileMapping[]): Promise<void> {
    console.log('🔗 Linking orders to existing patient profiles...');

    for (const mapping of mappings) {
      try {
        // Get instruction IDs for this patient from source
        const instructionQuery = `
          SELECT id
          FROM dispatch_instruction
          WHERE patient_id = $1
        `;

        const instructionResult = await this.sourcePool.query(instructionQuery, [mapping.legacyPatientId]);

        if (instructionResult.rows.length > 0) {
          const instructionIds = instructionResult.rows.map(row => row.id);

          // Update orders to reference the existing profile UUID
          const updateQuery = `
            UPDATE orders
            SET patient_id = $1
            WHERE legacy_instruction_id = ANY($2) AND patient_id IS NULL
          `;

          const updateResult = await this.targetPool.query(updateQuery, [mapping.profileId, instructionIds]);
          const updatedCount = updateResult.rowCount || 0;

          if (updatedCount > 0) {
            console.log(`✅ Linked ${updatedCount} orders to ${mapping.firstName} ${mapping.lastName} (Profile: ${mapping.profileId})`);
            this.stats.orderLinksUpdated += updatedCount;
          }
        }

      } catch (error) {
        console.error(`❌ Error linking orders for ${mapping.firstName} ${mapping.lastName}:`, error);
        this.stats.errors++;
      }
    }
  }

  /**
   * Clean up any duplicate patient records created by the incorrect migration
   */
  private async cleanupDuplicatePatients(): Promise<void> {
    console.log('🧹 Cleaning up any duplicate patient records...');

    try {
      // Find profiles that have the same legacy_user_id but different profile_type
      const duplicateQuery = `
        SELECT
          p1.id as profile_id,
          p1.legacy_user_id,
          p1.profile_type,
          p1.first_name,
          p1.last_name,
          p1.created_at
        FROM profiles p1
        WHERE p1.legacy_user_id IN (
          SELECT legacy_user_id
          FROM profiles
          WHERE profile_type = 'patient'
          GROUP BY legacy_user_id
          HAVING COUNT(*) > 1
        )
        ORDER BY p1.legacy_user_id, p1.created_at DESC
      `;

      const duplicateResult = await this.targetPool.query(duplicateQuery);

      if (duplicateResult.rows.length > 0) {
        console.log(`⚠️  Found ${duplicateResult.rows.length} potential duplicate patient records`);

        // Group by legacy_user_id
        const groupedByUserId = duplicateResult.rows.reduce((acc, row) => {
          if (!acc[row.legacy_user_id]) {
            acc[row.legacy_user_id] = [];
          }
          acc[row.legacy_user_id].push(row);
          return acc;
        }, {} as Record<number, any[]>);

        for (const [userId, profiles] of Object.entries(groupedByUserId)) {
          const profileList = profiles as any[];
          if (profileList.length > 1) {
            // Keep the first patient profile, remove any others
            const patientProfiles = profileList.filter((p: any) => p.profile_type === 'patient');
            if (patientProfiles.length > 1) {
              const keepProfile = patientProfiles[0]; // Keep the oldest one
              const removeProfiles = patientProfiles.slice(1);

              console.log(`📋 User ID ${userId}: Keeping profile ${keepProfile.profile_id}, removing ${removeProfiles.length} duplicates`);

              for (const removeProfile of removeProfiles) {
                // Note: In a production environment, you might want to migrate any references first
                console.log(`⚠️  Would remove duplicate profile: ${removeProfile.profile_id} (${removeProfile.first_name} ${removeProfile.last_name})`);
                // Uncomment the following line to actually remove duplicates:
                // await this.targetPool.query('DELETE FROM profiles WHERE id = $1', [removeProfile.profile_id]);
              }
            }
          }
        }
      } else {
        console.log('✅ No duplicate patient records found');
      }

    } catch (error) {
      console.error('❌ Error during cleanup:', error);
      this.stats.errors++;
    }
  }

  /**
   * Main migration function
   */
  async migrate(): Promise<void> {
    console.log('🚀 Starting corrected patient-treatment linking migration...');
    console.log('📋 This migration will:');
    console.log('   1. Use existing patient profiles from profiles table');
    console.log('   2. Map legacy patient IDs to existing profile UUIDs');
    console.log('   3. Update treatment plans to reference existing profiles');
    console.log('   4. Update orders to reference existing profiles');
    console.log('   5. Clean up any duplicate records');

    try {
      // Step 1: Get existing patient profile mappings
      const mappings = await this.getPatientProfileMappings();

      if (mappings.length === 0) {
        console.log('❌ No patient profile mappings found. Make sure profiles migration completed successfully.');
        return;
      }

      // Step 2: Link treatment plans to existing profiles
      await this.linkTreatmentPlansToProfiles(mappings);

      // Step 3: Link orders to existing profiles
      await this.linkOrdersToProfiles(mappings);

      // Step 4: Clean up duplicates
      await this.cleanupDuplicatePatients();

      this.stats.endTime = new Date();

      // Print final statistics
      console.log('\n🎉 Corrected patient-treatment linking migration completed!');
      console.log('==========================================');
      console.log(`📊 Migration Statistics:`);
      console.log(`   • Patient profiles processed: ${this.stats.totalProfilesProcessed}`);
      console.log(`   • Treatment plan links updated: ${this.stats.treatmentLinksUpdated}`);
      console.log(`   • Order links updated: ${this.stats.orderLinksUpdated}`);
      console.log(`   • Errors encountered: ${this.stats.errors}`);
      console.log(`   • Total duration: ${this.stats.endTime.getTime() - this.stats.startTime.getTime()}ms`);

    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    }
  }

  /**
   * Cleanup database connections
   */
  async cleanup(): Promise<void> {
    try {
      await this.sourcePool.end();
      await this.targetPool.end();
    } catch (error) {
      console.error('❌ Error during cleanup:', error);
    }
  }
}

// Main execution
async function main() {
  const sourceConfig: DatabaseConfig = {
    host: process.env.SOURCE_DB_HOST || 'localhost',
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME || 'source_db',
    username: process.env.SOURCE_DB_USER || 'postgres',
    password: process.env.SOURCE_DB_PASSWORD || ''
  };

  const targetConfig: DatabaseConfig = {
    host: process.env.TARGET_DB_HOST || 'localhost',
    port: parseInt(process.env.TARGET_DB_PORT || '54322'),
    database: process.env.TARGET_DB_NAME || 'postgres',
    username: process.env.TARGET_DB_USER || 'postgres',
    password: process.env.TARGET_DB_PASSWORD || 'postgres'
  };

  const migrationService = new PatientTreatmentLinkService(sourceConfig, targetConfig);

  try {
    await migrationService.migrate();
  } catch (error) {
    console.error('❌ Main execution failed:', error);
    process.exit(1);
  } finally {
    await migrationService.cleanup();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Script execution failed:', error);
    process.exit(1);
  });
}

export { PatientTreatmentLinkService };