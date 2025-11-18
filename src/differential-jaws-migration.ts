/**
 * Differential Jaws Migration Service
 * Migrates new jaw records from dispatch_jaw to jaws table with proper order relationships
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

interface DispatchJaw {
  id: number;
  bond_teeth: string;
  extract_teeth: string;
  reason: number | null;
  product_id: number | null;
  labial: boolean;
  jaw_type: 'upper' | 'lower';
  instruction_id: number;
}

interface MigrationStats {
  totalNewJaws: number;
  successfulMigrations: number;
  errors: number;
  skipped: number;
  startTime: Date;
  endTime?: Date;
}

class DifferentialJawsMigrationService {
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
      totalNewJaws: 0,
      successfulMigrations: 0,
      errors: 0,
      skipped: 0,
      startTime: new Date()
    };
  }

  /**
   * Get new jaw records that haven't been migrated
   * Need to join with dispatch_instruction to determine jaw type and order relationship
   */
  private async getNewJaws(): Promise<DispatchJaw[]> {
    console.log('🔍 Identifying new jaw records in source database...');

    // First, get all legacy_jaw_ids that already exist in target
    const existingIdsQuery = `
      SELECT legacy_jaw_id
      FROM jaws
      WHERE legacy_jaw_id IS NOT NULL
    `;

    const existingIdsResult = await this.targetPool.query(existingIdsQuery);
    const existingIds = existingIdsResult.rows.map(row => row.legacy_jaw_id);

    console.log(`✓ Found ${existingIds.length} jaws already migrated in target`);

    // Get source jaws that are NOT in the existing IDs
    // Join with dispatch_instruction to get jaw type and order relationship
    let query = `
      SELECT
        dj.id,
        dj.bond_teeth,
        dj.extract_teeth,
        dj.reason,
        dj.product_id,
        dj.labial,
        CASE
          WHEN di_upper.upper_jaw_id = dj.id THEN 'upper'
          WHEN di_lower.lower_jaw_id = dj.id THEN 'lower'
          ELSE 'upper'
        END as jaw_type,
        COALESCE(di_upper.id, di_lower.id) as instruction_id
      FROM dispatch_jaw dj
      LEFT JOIN dispatch_instruction di_upper ON di_upper.upper_jaw_id = dj.id
      LEFT JOIN dispatch_instruction di_lower ON di_lower.lower_jaw_id = dj.id
    `;

    if (existingIds.length > 0) {
      query += ` WHERE dj.id NOT IN (${existingIds.join(',')})`;
    }

    query += ` ORDER BY dj.id DESC`;

    try {
      const result = await this.sourcePool.query(query);
      console.log(`✓ Found ${result.rows.length} new jaw records to migrate`);

      return result.rows.map(row => ({
        id: row.id,
        bond_teeth: row.bond_teeth,
        extract_teeth: row.extract_teeth,
        reason: row.reason,
        product_id: row.product_id,
        labial: row.labial,
        jaw_type: row.jaw_type,
        instruction_id: row.instruction_id
      }));
    } catch (error) {
      console.error('❌ Error getting new jaws:', error);
      throw error;
    }
  }

  /**
   * Get order UUID from instruction_id
   */
  private async getOrderMapping(instructionId: number | null): Promise<string | null> {
    if (!instructionId) return null;

    try {
      const orderQuery = `
        SELECT id
        FROM orders
        WHERE legacy_instruction_id = $1
      `;

      const orderResult = await this.targetPool.query(orderQuery, [instructionId]);
      return orderResult.rows.length > 0 ? orderResult.rows[0].id : null;
    } catch (error) {
      console.error(`❌ Error getting order mapping for instruction ${instructionId}:`, error);
      return null;
    }
  }

  /**
   * Get product UUID from legacy product_id
   */
  private async getProductMapping(productId: number | null): Promise<string | null> {
    if (!productId) return null;

    try {
      const productQuery = `
        SELECT id
        FROM products
        WHERE legacy_product_id = $1
      `;

      const productResult = await this.targetPool.query(productQuery, [productId]);
      return productResult.rows.length > 0 ? productResult.rows[0].id : null;
    } catch (error) {
      console.error(`❌ Error getting product mapping for product ${productId}:`, error);
      return null;
    }
  }

  /**
   * Map reason from integer to replacement_reason string
   */
  private mapReplacementReason(reason: number | null): string | null {
    if (!reason) return null;

    const reasonMap: { [key: number]: string } = {
      1: 'breakage',
      2: 'complete',
      3: 'other'
    };

    return reasonMap[reason] || 'other';
  }

  /**
   * Migrate jaw records in batches
   */
  private async migrateJaws(jaws: DispatchJaw[]): Promise<void> {
    console.log('🦷 Starting jaw records migration...');

    const batchSize = 100;

    for (let i = 0; i < jaws.length; i += batchSize) {
      const batch = jaws.slice(i, i + batchSize);
      console.log(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(jaws.length / batchSize)} (${batch.length} jaws)`);

      for (const jaw of batch) {
        try {
          // Get UUID mappings
          const orderUuid = await this.getOrderMapping(jaw.instruction_id);
          const productUuid = await this.getProductMapping(jaw.product_id);

          // Skip if no order mapping (this would be an orphaned jaw)
          if (!orderUuid) {
            console.warn(`⚠️  Skipping jaw ${jaw.id}: No order mapping found for instruction ${jaw.instruction_id}`);
            this.stats.skipped++;
            continue;
          }

          // Insert jaw into target
          const insertQuery = `
            INSERT INTO jaws (
              order_id,
              product_id,
              jaw_type,
              labial,
              bond_teeth,
              extract_teeth,
              replacement_reason,
              metadata,
              created_at,
              updated_at,
              legacy_jaw_id
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
            )
          `;

          const values = [
            orderUuid,                                       // order_id
            productUuid,                                     // product_id
            jaw.jaw_type,                                    // jaw_type
            jaw.labial,                                      // labial
            jaw.bond_teeth,                                  // bond_teeth
            jaw.extract_teeth,                               // extract_teeth
            this.mapReplacementReason(jaw.reason),           // replacement_reason
            JSON.stringify({                                 // metadata
              migration: {
                source_table: 'dispatch_jaw',
                migrated_at: new Date().toISOString(),
                legacy_data: {
                  reason: jaw.reason,
                  product_id: jaw.product_id,
                  instruction_id: jaw.instruction_id,
                  determined_jaw_type: jaw.jaw_type
                }
              }
            }),
            new Date(),                                      // created_at
            new Date(),                                      // updated_at
            jaw.id                                           // legacy_jaw_id
          ];

          await this.targetPool.query(insertQuery, values);
          this.stats.successfulMigrations++;

          console.log(`✅ Migrated jaw: ${jaw.jaw_type} jaw ${jaw.id} for order ${orderUuid?.substring(0, 8)}...`);

        } catch (error) {
          console.error(`❌ Error migrating jaw ${jaw.id}:`, error);
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
      // Count total jaws in target
      const targetCountResult = await this.targetPool.query('SELECT COUNT(*) as count FROM jaws');
      const targetCount = parseInt(targetCountResult.rows[0].count);

      // Count jaws with legacy IDs
      const legacyCountResult = await this.targetPool.query('SELECT COUNT(*) as count FROM jaws WHERE legacy_jaw_id IS NOT NULL');
      const legacyCount = parseInt(legacyCountResult.rows[0].count);

      console.log(`✓ Target database now has ${targetCount.toLocaleString()} total jaws`);
      console.log(`✓ ${legacyCount.toLocaleString()} jaws have legacy jaw ID mappings`);

      // Check for missing jaws
      const sourceCountResult = await this.sourcePool.query('SELECT COUNT(*) as count FROM dispatch_jaw');
      const sourceCount = parseInt(sourceCountResult.rows[0].count);
      const missingCount = sourceCount - legacyCount;

      if (missingCount > 0) {
        console.warn(`⚠️  ${missingCount} source jaw records still not migrated`);
      } else {
        console.log(`✅ All source jaw records have been successfully migrated`);
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
    console.log('🚀 Starting differential jaws migration...');
    console.log('📋 This migration will:');
    console.log('   1. Identify new dispatch_jaw records');
    console.log('   2. Determine jaw type (upper/lower) from instruction relationships');
    console.log('   3. Map instruction_id to order UUIDs');
    console.log('   4. Map product_id to product UUIDs');
    console.log('   5. Migrate jaw records in batches');
    console.log('   6. Validate results');

    try {
      // Step 1: Get new jaws
      const newJaws = await this.getNewJaws();
      this.stats.totalNewJaws = newJaws.length;

      if (newJaws.length === 0) {
        console.log('✅ No new jaw records to migrate');
        return;
      }

      // Step 2: Migrate jaws
      await this.migrateJaws(newJaws);

      // Step 3: Validate migration
      await this.validateMigration();

      this.stats.endTime = new Date();

      // Print final statistics
      console.log('\n🎉 Differential jaws migration completed!');
      console.log('==========================================');
      console.log(`📊 Migration Statistics:`);
      console.log(`   • New jaw records found: ${this.stats.totalNewJaws}`);
      console.log(`   • Successfully migrated: ${this.stats.successfulMigrations}`);
      console.log(`   • Skipped (missing dependencies): ${this.stats.skipped}`);
      console.log(`   • Errors encountered: ${this.stats.errors}`);
      console.log(`   • Success rate: ${this.stats.totalNewJaws > 0 ? ((this.stats.successfulMigrations / this.stats.totalNewJaws) * 100).toFixed(2) : 0}%`);
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
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    database: process.env.TARGET_DB_NAME || 'postgres',
    username: process.env.TARGET_DB_USER || 'postgres',
    password: process.env.TARGET_DB_PASSWORD || 'postgres'
  };

  const migrationService = new DifferentialJawsMigrationService(sourceConfig, targetConfig);

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

export { DifferentialJawsMigrationService };