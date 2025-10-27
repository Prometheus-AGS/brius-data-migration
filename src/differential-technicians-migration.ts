/**
 * Differential Technicians Migration Service
 * Migrates new technicians from dispatch_agent to technicians table
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

interface DispatchAgent {
  id: number;
  user_id: number | null;
  name: string;
  email: string | null;
  phone: string | null;
  department: string | null;
  position: string | null;
  status: number;
  created_at: Date;
  updated_at: Date;
}

interface MigrationStats {
  totalNewTechnicians: number;
  successfulMigrations: number;
  errors: number;
  skipped: number;
  startTime: Date;
  endTime?: Date;
}

class DifferentialTechniciansMigrationService {
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
      totalNewTechnicians: 0,
      successfulMigrations: 0,
      errors: 0,
      skipped: 0,
      startTime: new Date()
    };
  }

  /**
   * Get new technicians that haven't been migrated
   */
  private async getNewTechnicians(): Promise<DispatchAgent[]> {
    console.log('🔍 Identifying new technicians in source database...');

    // Get existing legacy agent IDs from target
    const existingIdsQuery = `
      SELECT legacy_agent_id
      FROM technicians
      WHERE legacy_agent_id IS NOT NULL
    `;

    const existingIdsResult = await this.targetPool.query(existingIdsQuery);
    const existingIds = existingIdsResult.rows.map(row => row.legacy_agent_id);

    console.log(`✓ Found ${existingIds.length} technicians already migrated in target`);

    // Get source agents that are NOT in the existing IDs
    let query = `
      SELECT
        da.id,
        da.user_id,
        au.username as name,
        au.email,
        da.phone,
        da.department,
        da.position,
        da.status,
        da.created_at,
        da.updated_at
      FROM dispatch_agent da
      LEFT JOIN auth_user au ON da.user_id = au.id
    `;

    if (existingIds.length > 0) {
      query += ` WHERE da.id NOT IN (${existingIds.join(',')})`;
    }

    query += ` ORDER BY da.created_at DESC`;

    try {
      const result = await this.sourcePool.query(query);
      console.log(`✓ Found ${result.rows.length} new technicians to migrate`);

      return result.rows.map(row => ({
        id: row.id,
        user_id: row.user_id,
        name: row.name || `Agent ${row.id}`,
        email: row.email,
        phone: row.phone,
        department: row.department,
        position: row.position,
        status: row.status || 1,
        created_at: row.created_at,
        updated_at: row.updated_at
      }));
    } catch (error) {
      console.error('❌ Error getting new technicians:', error);
      throw error;
    }
  }

  /**
   * Get profile UUID mapping for user_id
   */
  private async getProfileMapping(userId: number | null): Promise<string | null> {
    if (!userId) return null;

    try {
      const profileQuery = `
        SELECT id
        FROM profiles
        WHERE legacy_user_id = $1
      `;

      const profileResult = await this.targetPool.query(profileQuery, [userId]);
      return profileResult.rows.length > 0 ? profileResult.rows[0].id : null;
    } catch (error) {
      console.error(`❌ Error getting profile mapping for user ${userId}:`, error);
      return null;
    }
  }

  /**
   * Map status from integer to string
   */
  private mapStatus(status: number): string {
    const statusMap: { [key: number]: string } = {
      0: 'inactive',
      1: 'active',
      2: 'suspended',
      3: 'terminated'
    };

    return statusMap[status] || 'active';
  }

  /**
   * Migrate technicians in batches
   */
  private async migrateTechnicians(technicians: DispatchAgent[]): Promise<void> {
    console.log('👨‍🔧 Starting technicians migration...');

    const batchSize = 50;

    for (let i = 0; i < technicians.length; i += batchSize) {
      const batch = technicians.slice(i, i + batchSize);
      console.log(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(technicians.length / batchSize)} (${batch.length} technicians)`);

      for (const technician of batch) {
        try {
          // Get profile UUID mapping if user_id exists
          const profileUuid = await this.getProfileMapping(technician.user_id);

          // Insert technician into target
          const insertQuery = `
            INSERT INTO technicians (
              profile_id,
              employee_id,
              department,
              position,
              status,
              phone,
              email,
              name,
              metadata,
              created_at,
              updated_at,
              legacy_agent_id,
              legacy_user_id
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
            )
          `;

          const values = [
            profileUuid,                                     // profile_id
            technician.id.toString(),                        // employee_id
            technician.department,                           // department
            technician.position,                             // position
            this.mapStatus(technician.status),               // status
            technician.phone,                                // phone
            technician.email,                                // email
            technician.name,                                 // name
            JSON.stringify({                                 // metadata
              migration: {
                source_table: 'dispatch_agent',
                migrated_at: new Date().toISOString(),
                legacy_data: {
                  original_status: technician.status
                }
              }
            }),
            technician.created_at,                           // created_at
            technician.updated_at,                           // updated_at
            technician.id,                                   // legacy_agent_id
            technician.user_id                               // legacy_user_id
          ];

          await this.targetPool.query(insertQuery, values);
          this.stats.successfulMigrations++;

          console.log(`✅ Migrated technician: ${technician.name} (Legacy ID: ${technician.id})`);

        } catch (error) {
          console.error(`❌ Error migrating technician ${technician.id}:`, error);
          this.stats.errors++;
        }
      }
    }
  }

  /**
   * Validate the migration results
   */
  private async validateMigration(): Promise<void> {
    console.log('🔍 Validating migration results...');

    try {
      // Count total technicians in target
      const targetCountResult = await this.targetPool.query('SELECT COUNT(*) as count FROM technicians');
      const targetCount = parseInt(targetCountResult.rows[0].count);

      // Count technicians with legacy IDs
      const legacyCountResult = await this.targetPool.query('SELECT COUNT(*) as count FROM technicians WHERE legacy_agent_id IS NOT NULL');
      const legacyCount = parseInt(legacyCountResult.rows[0].count);

      console.log(`✓ Target database now has ${targetCount.toLocaleString()} total technicians`);
      console.log(`✓ ${legacyCount.toLocaleString()} technicians have legacy agent ID mappings`);

      // Check for missing technicians
      const sourceCountResult = await this.sourcePool.query('SELECT COUNT(*) as count FROM dispatch_agent');
      const sourceCount = parseInt(sourceCountResult.rows[0].count);
      const missingCount = sourceCount - legacyCount;

      if (missingCount > 0) {
        console.warn(`⚠️  ${missingCount} source agents still not migrated`);
      } else {
        console.log(`✅ All source agents have been successfully migrated to technicians`);
      }

    } catch (error) {
      console.error('❌ Error during validation:', error);
      this.stats.errors++;
    }
  }

  /**
   * Main migration function
   */
  async migrate(): Promise<void> {
    console.log('🚀 Starting differential technicians migration...');
    console.log('📋 This migration will:');
    console.log('   1. Identify new dispatch_agent records');
    console.log('   2. Map user_id to profile UUIDs where available');
    console.log('   3. Migrate technicians in batches');
    console.log('   4. Validate results');

    try {
      // Step 1: Get new technicians
      const newTechnicians = await this.getNewTechnicians();
      this.stats.totalNewTechnicians = newTechnicians.length;

      if (newTechnicians.length === 0) {
        console.log('✅ No new technicians to migrate');
        return;
      }

      // Step 2: Migrate technicians
      await this.migrateTechnicians(newTechnicians);

      // Step 3: Validate migration
      await this.validateMigration();

      this.stats.endTime = new Date();

      // Print final statistics
      console.log('\n🎉 Differential technicians migration completed!');
      console.log('==============================================');
      console.log(`📊 Migration Statistics:`);
      console.log(`   • New technicians found: ${this.stats.totalNewTechnicians}`);
      console.log(`   • Successfully migrated: ${this.stats.successfulMigrations}`);
      console.log(`   • Skipped (missing dependencies): ${this.stats.skipped}`);
      console.log(`   • Errors encountered: ${this.stats.errors}`);
      console.log(`   • Success rate: ${this.stats.totalNewTechnicians > 0 ? ((this.stats.successfulMigrations / this.stats.totalNewTechnicians) * 100).toFixed(2) : 0}%`);
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

  const migrationService = new DifferentialTechniciansMigrationService(sourceConfig, targetConfig);

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

export { DifferentialTechniciansMigrationService };