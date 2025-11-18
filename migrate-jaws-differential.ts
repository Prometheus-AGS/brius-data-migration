import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

interface DispatchJaw {
  id: number;
  bond_teeth: string;
  extract_teeth: string;
  reason: number | null;
  product_id: number | null;
  labial: boolean;
}

interface JawMigrationStats {
  totalSourceRecords: number;
  totalTargetRecords: number;
  missingRecords: number;
  migratedRecords: number;
  skippedRecords: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
}

class JawsDifferentialMigration {
  private sourcePool: Pool;
  private targetPool: Pool;
  private stats: JawMigrationStats;
  private batchSize: number = 1000;

  constructor() {
    this.sourcePool = new Pool({
      host: process.env.SOURCE_DB_HOST,
      port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
      database: process.env.SOURCE_DB_NAME,
      user: process.env.SOURCE_DB_USER,
      password: process.env.SOURCE_DB_PASSWORD,
      ssl: { rejectUnauthorized: false }
    });

    this.targetPool = new Pool({
      host: process.env.TARGET_DB_HOST,
      port: parseInt(process.env.TARGET_DB_PORT || '5432'),
      database: process.env.TARGET_DB_NAME,
      user: process.env.TARGET_DB_USER,
      password: process.env.TARGET_DB_PASSWORD,
    });

    this.stats = {
      totalSourceRecords: 0,
      totalTargetRecords: 0,
      missingRecords: 0,
      migratedRecords: 0,
      skippedRecords: 0,
      errors: 0,
      startTime: new Date(),
    };
  }

  /**
   * Get existing jaw IDs in target database
   */
  private async getExistingJawIds(): Promise<Set<number>> {
    const query = `
      SELECT legacy_jaw_id
      FROM jaws
      WHERE legacy_jaw_id IS NOT NULL
    `;

    try {
      const result = await this.targetPool.query(query);
      const existingIds = new Set<number>();

      result.rows.forEach(row => {
        if (row.legacy_jaw_id) {
          existingIds.add(row.legacy_jaw_id);
        }
      });

      console.log(`✓ Found ${existingIds.size} existing jaw IDs in target`);
      return existingIds;
    } catch (error) {
      console.error('❌ Error fetching existing jaw IDs:', error);
      throw error;
    }
  }

  /**
   * Get missing jaws from source database
   */
  private async getMissingJaws(existingIds: Set<number>): Promise<DispatchJaw[]> {
    const query = `
      SELECT
        id,
        bond_teeth,
        extract_teeth,
        reason,
        product_id,
        labial
      FROM dispatch_jaw
      ORDER BY id
    `;

    try {
      const result = await this.sourcePool.query(query);
      this.stats.totalSourceRecords = result.rows.length;

      // Filter to only missing jaws
      const missingJaws = result.rows.filter((jaw: any) => !existingIds.has(jaw.id));
      this.stats.missingRecords = missingJaws.length;

      console.log(`✓ Found ${this.stats.totalSourceRecords} total jaws in source`);
      console.log(`✓ Identified ${this.stats.missingRecords} missing jaws to migrate`);

      return missingJaws;
    } catch (error) {
      console.error('❌ Error fetching missing jaws:', error);
      throw error;
    }
  }

  /**
   * Get required mappings for jaw migration
   */
  private async getMappings(): Promise<{
    orderMappings: Map<number, { orderId: string, upperJawId?: number, lowerJawId?: number }>,
    productMappings: Map<number, string>
  }> {
    try {
      const [orderMappingsResult, productMappingsResult] = await Promise.all([
        // Get order mappings with jaw references
        this.sourcePool.query(`
          SELECT
            di.id as instruction_id,
            di.upper_jaw_id,
            di.lower_jaw_id
          FROM dispatch_instruction di
        `),
        // Get product mappings
        this.targetPool.query(`
          SELECT legacy_product_id, id
          FROM products
          WHERE legacy_product_id IS NOT NULL
        `)
      ]);

      const orderMappings = new Map<number, { orderId: string, upperJawId?: number, lowerJawId?: number }>();
      const productMappings = new Map<number, string>();

      // Get UUID mappings for orders
      const orderUuidMappings = await this.targetPool.query(`
        SELECT legacy_instruction_id, id
        FROM orders
        WHERE legacy_instruction_id IS NOT NULL
      `);

      const orderUuidMap = new Map<number, string>();
      orderUuidMappings.rows.forEach(row => {
        orderUuidMap.set(row.legacy_instruction_id, row.id);
      });

      orderMappingsResult.rows.forEach(row => {
        const orderId = orderUuidMap.get(row.instruction_id);
        if (orderId) {
          orderMappings.set(row.instruction_id, {
            orderId,
            upperJawId: row.upper_jaw_id,
            lowerJawId: row.lower_jaw_id
          });
        }
      });

      productMappingsResult.rows.forEach(row => {
        productMappings.set(row.legacy_product_id, row.id);
      });

      console.log(`✓ Found ${orderMappings.size} order mappings`);
      console.log(`✓ Found ${productMappings.size} product mappings`);

      return { orderMappings, productMappings };
    } catch (error) {
      console.error('❌ Error fetching mappings:', error);
      throw error;
    }
  }

  /**
   * Map replacement reason to enum
   */
  private mapReplacementReason(reason: number | null): string | null {
    switch (reason) {
      case 1: return 'breakage';
      case 2: return 'other';
      case 3: return 'complete';
      default: return null;
    }
  }

  /**
   * Determine jaw type based on order relationships
   */
  private determineJawType(
    jawId: number,
    orderInfo: { orderId: string, upperJawId?: number, lowerJawId?: number }
  ): 'upper' | 'lower' | null {
    if (orderInfo.upperJawId === jawId) return 'upper';
    if (orderInfo.lowerJawId === jawId) return 'lower';
    return null; // Can't determine jaw type
  }

  /**
   * Migrate jaws batch
   */
  private async migrateJawsBatch(
    jaws: DispatchJaw[],
    orderMappings: Map<number, { orderId: string, upperJawId?: number, lowerJawId?: number }>,
    productMappings: Map<number, string>
  ): Promise<void> {
    if (jaws.length === 0) return;

    console.log(`📊 Migrating batch of ${jaws.length} jaws...`);

    // Find which orders use these jaws
    const jawOrderMap = new Map<number, { orderId: string, upperJawId?: number, lowerJawId?: number }>();

    for (const [instructionId, orderInfo] of orderMappings.entries()) {
      for (const jaw of jaws) {
        if (orderInfo.upperJawId === jaw.id || orderInfo.lowerJawId === jaw.id) {
          jawOrderMap.set(jaw.id, orderInfo);
          break;
        }
      }
    }

    // Prepare batch insert
    const jawRecords = jaws
      .map(jaw => {
        const orderInfo = jawOrderMap.get(jaw.id);
        if (!orderInfo) {
          console.log(`⏭️  Skipping jaw ${jaw.id} - no order relationship found`);
          return null;
        }

        const jawType = this.determineJawType(jaw.id, orderInfo);
        if (!jawType) {
          console.log(`⏭️  Skipping jaw ${jaw.id} - cannot determine jaw type`);
          return null;
        }

        const productId = jaw.product_id ? productMappings.get(jaw.product_id) : null;
        const replacementReason = this.mapReplacementReason(jaw.reason);

        return {
          order_id: orderInfo.orderId,
          product_id: productId,
          jaw_type: jawType,
          labial: jaw.labial,
          bond_teeth: jaw.bond_teeth,
          extract_teeth: jaw.extract_teeth,
          replacement_reason: replacementReason,
          legacy_jaw_id: jaw.id,
          metadata: JSON.stringify({
            source_reason: jaw.reason,
            source_product_id: jaw.product_id,
            migrated_at: new Date().toISOString()
          })
        };
      })
      .filter(record => record !== null);

    console.log(`   → ${jawRecords.length}/${jaws.length} jaws have required mappings`);

    if (jawRecords.length === 0) {
      this.stats.skippedRecords += jaws.length;
      return;
    }

    try {
      // Insert batch using ON CONFLICT since legacy_jaw_id has UNIQUE constraint
      const insertQuery = `
        INSERT INTO jaws (
          order_id, product_id, jaw_type, labial, bond_teeth, extract_teeth,
          replacement_reason, legacy_jaw_id, metadata, created_at, updated_at
        ) VALUES ${jawRecords.map((_, i) =>
          `($${i * 9 + 1}, $${i * 9 + 2}, $${i * 9 + 3}, $${i * 9 + 4}, $${i * 9 + 5}, $${i * 9 + 6}, $${i * 9 + 7}, $${i * 9 + 8}, $${i * 9 + 9}, NOW(), NOW())`
        ).join(', ')}
        ON CONFLICT (legacy_jaw_id) DO NOTHING
      `;

      const values = jawRecords.flatMap(jaw => [
        jaw.order_id,
        jaw.product_id,
        jaw.jaw_type,
        jaw.labial,
        jaw.bond_teeth,
        jaw.extract_teeth,
        jaw.replacement_reason,
        jaw.legacy_jaw_id,
        jaw.metadata
      ]);

      const result = await this.targetPool.query(insertQuery, values);
      const insertedCount = result.rowCount || 0;

      this.stats.migratedRecords += insertedCount;
      this.stats.skippedRecords += (jawRecords.length - insertedCount);

      console.log(`✅ Successfully migrated ${insertedCount} jaws`);

    } catch (error) {
      this.stats.errors++;
      console.error(`❌ Error migrating jaws batch:`, error);
    }
  }

  /**
   * Main differential migration function
   */
  public async executeDifferentialMigration(): Promise<JawMigrationStats> {
    console.log('🚀 Starting Jaws Differential Migration (43.6K orthodontic records)...\n');

    try {
      // Get existing IDs and missing jaws
      const existingIds = await this.getExistingJawIds();
      const missingJaws = await this.getMissingJaws(existingIds);

      if (missingJaws.length === 0) {
        console.log('🎉 All jaws are already migrated!');
        this.stats.endTime = new Date();
        return this.stats;
      }

      // Get required mappings
      const { orderMappings, productMappings } = await this.getMappings();

      console.log('\n🔄 Starting batch migration...');

      // Process in batches
      for (let i = 0; i < missingJaws.length; i += this.batchSize) {
        const batchStartTime = Date.now();
        const batch = missingJaws.slice(i, i + this.batchSize);

        await this.migrateJawsBatch(batch, orderMappings, productMappings);

        const batchDuration = Date.now() - batchStartTime;
        const recordsPerSecond = (batch.length / batchDuration * 1000).toFixed(0);
        console.log(`   ⚡ Batch ${Math.floor(i / this.batchSize) + 1} completed in ${batchDuration}ms (${recordsPerSecond} records/sec)`);

        if (this.stats.migratedRecords % 5000 === 0 && this.stats.migratedRecords > 0) {
          console.log(`✅ Progress: ${this.stats.migratedRecords} jaws migrated...`);
        }
      }

      this.stats.endTime = new Date();

      // Final summary
      console.log('\n📋 Jaws Differential Migration Summary:');
      console.log(`⏱️  Duration: ${this.stats.endTime.getTime() - this.stats.startTime.getTime()}ms`);
      console.log(`📊 Source Records: ${this.stats.totalSourceRecords}`);
      console.log(`📊 Missing Records: ${this.stats.missingRecords}`);
      console.log(`✅ Successfully Migrated: ${this.stats.migratedRecords}`);
      console.log(`⏭️  Skipped: ${this.stats.skippedRecords}`);
      console.log(`❌ Errors: ${this.stats.errors}`);

      const successRate = this.stats.missingRecords > 0
        ? ((this.stats.migratedRecords / this.stats.missingRecords) * 100).toFixed(2)
        : 100;
      console.log(`📈 Success Rate: ${successRate}%`);

      return this.stats;

    } catch (error) {
      console.error('💥 Jaws differential migration failed:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Validate the migration results
   */
  public async validateMigration(): Promise<void> {
    console.log('\n🔍 Validating jaws migration...');

    try {
      const validationStats = await this.targetPool.query(`
        SELECT
          COUNT(*) as total_jaws,
          COUNT(CASE WHEN legacy_jaw_id IS NOT NULL THEN 1 END) as migrated_jaws,
          COUNT(CASE WHEN jaw_type = 'upper' THEN 1 END) as upper_jaws,
          COUNT(CASE WHEN jaw_type = 'lower' THEN 1 END) as lower_jaws,
          COUNT(CASE WHEN labial = true THEN 1 END) as labial_jaws,
          COUNT(DISTINCT order_id) as unique_orders,
          COUNT(DISTINCT product_id) as unique_products,
          MIN(created_at) as earliest_jaw,
          MAX(created_at) as latest_jaw
        FROM jaws
      `);

      const stats = validationStats.rows[0];
      console.log('📊 Jaws Validation:');
      console.log(`   Total Jaws: ${stats.total_jaws}`);
      console.log(`   Migrated Jaws (with legacy_jaw_id): ${stats.migrated_jaws}`);
      console.log(`   Upper Jaws: ${stats.upper_jaws}`);
      console.log(`   Lower Jaws: ${stats.lower_jaws}`);
      console.log(`   Labial Jaws: ${stats.labial_jaws}`);
      console.log(`   Unique Orders: ${stats.unique_orders}`);
      console.log(`   Unique Products: ${stats.unique_products}`);
      console.log(`   Date Range: ${stats.earliest_jaw} to ${stats.latest_jaw}`);

      // Jaw type breakdown
      const replacementReasons = await this.targetPool.query(`
        SELECT
          replacement_reason,
          COUNT(*) as count
        FROM jaws
        WHERE legacy_jaw_id IS NOT NULL
        AND replacement_reason IS NOT NULL
        GROUP BY replacement_reason
        ORDER BY count DESC
      `);

      console.log('\n📊 Replacement Reason Distribution:');
      if (replacementReasons.rows.length > 0) {
        replacementReasons.rows.forEach(row => {
          console.log(`   ${row.replacement_reason}: ${row.count} jaws`);
        });
      } else {
        console.log('   No replacement reasons found');
      }

      // Check coverage against source
      const sourceTotal = await this.sourcePool.query('SELECT COUNT(*) FROM dispatch_jaw');
      const targetMigrated = parseInt(stats.migrated_jaws);
      const sourceCount = parseInt(sourceTotal.rows[0].count);

      console.log(`\n📊 Migration Coverage:`);
      console.log(`   Source Jaws: ${sourceCount}`);
      console.log(`   Target Migrated: ${targetMigrated}`);
      console.log(`   Coverage: ${((targetMigrated / sourceCount) * 100).toFixed(2)}%`);

      if (sourceCount === targetMigrated) {
        console.log('🎉 PERFECT MIGRATION: All jaws successfully migrated!');
      } else {
        console.log(`⚠️  ${sourceCount - targetMigrated} jaws still missing`);
      }

      console.log('\n✅ Validation completed');

    } catch (error) {
      console.error('❌ Validation failed:', error);
    }
  }

  /**
   * Cleanup connections
   */
  private async cleanup(): Promise<void> {
    try {
      await Promise.all([
        this.sourcePool.end(),
        this.targetPool.end()
      ]);
      console.log('🧹 Database connections closed');
    } catch (error) {
      console.error('⚠️  Error during cleanup:', error);
    }
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'migrate';

  const migration = new JawsDifferentialMigration();

  try {
    switch (command) {
      case 'migrate':
        await migration.executeDifferentialMigration();
        await migration.validateMigration();
        break;

      case 'validate':
        await migration.validateMigration();
        break;

      default:
        console.log('Usage: npx ts-node migrate-jaws-differential.ts [migrate|validate]');
        process.exit(1);
    }

    process.exit(0);

  } catch (error) {
    console.error('💥 Operation failed:', error);
    process.exit(1);
  }
}

// Export for use as module
export { JawsDifferentialMigration };

// Run if called directly
if (require.main === module) {
  main();
}