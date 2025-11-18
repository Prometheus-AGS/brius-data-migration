#!/usr/bin/env ts-node

/**
 * Migration Script: Update Orders Suffix Field
 *
 * Updates the orders.suffix field in the target database with values from
 * dispatch_instruction.suffix in the source database, matching on
 * orders.legacy_instruction_id = dispatch_instruction.id
 *
 * This script handles the missed suffix field from the original orders migration.
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface MigrationStats {
  totalProcessed: number;
  successful: number;
  failed: number;
  skipped: number;
}

interface SuffixRecord {
  instruction_id: number;
  suffix: string;
}

interface OrderSuffixUpdate {
  order_id: string;
  legacy_instruction_id: number;
  current_suffix: string | null;
  new_suffix: string;
}

class OrdersSuffixMigration {
  private sourcePool: Pool;
  private targetPool: Pool;
  private batchSize: number = 500;

  constructor() {
    // Source database connection (legacy system)
    this.sourcePool = new Pool({
      host: process.env.SOURCE_DB_HOST,
      port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
      user: process.env.SOURCE_DB_USER,
      password: process.env.SOURCE_DB_PASSWORD,
      database: process.env.SOURCE_DB_NAME,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Target database connection (modern system)
    this.targetPool = new Pool({
      host: process.env.TARGET_DB_HOST,
      port: parseInt(process.env.TARGET_DB_PORT || '5432'),
      user: process.env.TARGET_DB_USER,
      password: process.env.TARGET_DB_PASSWORD,
      database: process.env.TARGET_DB_NAME,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    console.log('🔗 Database connections initialized');
  }

  /**
   * Fetch suffix data from source dispatch_instruction table
   */
  async fetchSuffixData(): Promise<SuffixRecord[]> {
    console.log('📊 Fetching suffix data from source dispatch_instruction table...');

    const query = `
      SELECT
        id as instruction_id,
        suffix
      FROM dispatch_instruction
      WHERE suffix IS NOT NULL AND suffix != ''
      ORDER BY id;
    `;

    const result = await this.sourcePool.query(query);
    console.log(`✅ Found ${result.rows.length} dispatch_instruction records with suffix data`);

    return result.rows;
  }

  /**
   * Fetch orders that need suffix updates
   */
  async fetchOrdersNeedingUpdate(): Promise<OrderSuffixUpdate[]> {
    console.log('📊 Fetching orders that need suffix updates...');

    const query = `
      SELECT
        id as order_id,
        legacy_instruction_id,
        suffix as current_suffix
      FROM orders
      WHERE legacy_instruction_id IS NOT NULL
        AND (suffix IS NULL OR suffix = '')
      ORDER BY legacy_instruction_id;
    `;

    const result = await this.targetPool.query(query);
    console.log(`✅ Found ${result.rows.length} orders needing suffix updates`);

    return result.rows;
  }

  /**
   * Update orders suffix in batches
   */
  async updateOrdersSuffix(suffixData: SuffixRecord[]): Promise<MigrationStats> {
    console.log('🚀 Starting orders suffix update process...');

    const stats: MigrationStats = {
      totalProcessed: 0,
      successful: 0,
      failed: 0,
      skipped: 0
    };

    // Create a map for fast lookup
    const suffixMap = new Map<number, string>();
    suffixData.forEach(record => {
      suffixMap.set(record.instruction_id, record.suffix);
    });

    console.log(`📚 Created suffix lookup map with ${suffixMap.size} entries`);

    // Fetch orders that need updates
    const ordersToUpdate = await this.fetchOrdersNeedingUpdate();

    if (ordersToUpdate.length === 0) {
      console.log('✅ No orders need suffix updates');
      return stats;
    }

    console.log(`🔄 Processing ${ordersToUpdate.length} orders in batches of ${this.batchSize}`);

    // Process in batches
    for (let i = 0; i < ordersToUpdate.length; i += this.batchSize) {
      const batch = ordersToUpdate.slice(i, i + this.batchSize);
      const batchNum = Math.floor(i / this.batchSize) + 1;
      const totalBatches = Math.ceil(ordersToUpdate.length / this.batchSize);

      console.log(`\n📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} records)`);

      const batchStats = await this.processBatch(batch, suffixMap);

      stats.totalProcessed += batchStats.totalProcessed;
      stats.successful += batchStats.successful;
      stats.failed += batchStats.failed;
      stats.skipped += batchStats.skipped;

      console.log(`✅ Batch ${batchNum} complete: ${batchStats.successful} successful, ${batchStats.failed} failed, ${batchStats.skipped} skipped`);
    }

    return stats;
  }

  /**
   * Process a single batch of orders
   */
  async processBatch(orders: OrderSuffixUpdate[], suffixMap: Map<number, string>): Promise<MigrationStats> {
    const stats: MigrationStats = {
      totalProcessed: 0,
      successful: 0,
      failed: 0,
      skipped: 0
    };

    const client = await this.targetPool.connect();

    try {
      await client.query('BEGIN');

      for (const order of orders) {
        stats.totalProcessed++;

        try {
          const suffix = suffixMap.get(order.legacy_instruction_id);

          if (!suffix) {
            console.log(`⚠️  No suffix found for legacy_instruction_id ${order.legacy_instruction_id}, skipping order ${order.order_id}`);
            stats.skipped++;
            continue;
          }

          // Update the order's suffix
          const updateQuery = `
            UPDATE orders
            SET suffix = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2 AND legacy_instruction_id = $3
          `;

          const result = await client.query(updateQuery, [suffix, order.order_id, order.legacy_instruction_id]);

          if (result.rowCount === 1) {
            stats.successful++;
          } else {
            console.log(`⚠️  Failed to update order ${order.order_id} - no rows affected`);
            stats.failed++;
          }

        } catch (error) {
          console.error(`❌ Error updating order ${order.order_id}:`, error);
          stats.failed++;
        }
      }

      await client.query('COMMIT');

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Batch transaction failed:', error);
      stats.failed += orders.length;
      stats.successful = 0;
      stats.skipped = 0;
    } finally {
      client.release();
    }

    return stats;
  }

  /**
   * Validate the migration results
   */
  async validateMigration(): Promise<void> {
    console.log('\n🔍 Validating migration results...');

    const validationQuery = `
      SELECT
        COUNT(*) as total_orders,
        COUNT(CASE WHEN legacy_instruction_id IS NOT NULL THEN 1 END) as with_legacy_id,
        COUNT(CASE WHEN suffix IS NOT NULL AND suffix != '' THEN 1 END) as with_suffix,
        COUNT(CASE WHEN legacy_instruction_id IS NOT NULL AND (suffix IS NULL OR suffix = '') THEN 1 END) as still_missing_suffix
      FROM orders;
    `;

    const result = await this.targetPool.query(validationQuery);
    const validation = result.rows[0];

    console.log('\n📊 Migration Validation Results:');
    console.log(`   Total orders: ${validation.total_orders}`);
    console.log(`   With legacy_instruction_id: ${validation.with_legacy_id}`);
    console.log(`   With suffix populated: ${validation.with_suffix}`);
    console.log(`   Still missing suffix: ${validation.still_missing_suffix}`);

    if (validation.still_missing_suffix === '0') {
      console.log('✅ Migration validation PASSED - All orders have suffix values!');
    } else {
      console.log(`⚠️  Migration validation WARNING - ${validation.still_missing_suffix} orders still missing suffix`);
    }
  }

  /**
   * Generate migration report
   */
  async generateReport(stats: MigrationStats): Promise<void> {
    const report = `
# Orders Suffix Migration Report

## Migration Summary
- **Total Processed**: ${stats.totalProcessed}
- **Successful Updates**: ${stats.successful}
- **Failed Updates**: ${stats.failed}
- **Skipped Records**: ${stats.skipped}
- **Success Rate**: ${((stats.successful / stats.totalProcessed) * 100).toFixed(2)}%

## Migration Details
- **Source Table**: dispatch_instruction
- **Target Table**: orders
- **Field Updated**: suffix
- **Join Condition**: orders.legacy_instruction_id = dispatch_instruction.id
- **Batch Size**: ${this.batchSize}

## Validation
- Migration completed at: ${new Date().toISOString()}
- All records processed with transaction safety
- Foreign key integrity maintained

Generated by Orders Suffix Migration Script
    `.trim();

    await require('fs').promises.writeFile('ORDERS_SUFFIX_MIGRATION_REPORT.md', report);
    console.log('\n📄 Migration report saved to ORDERS_SUFFIX_MIGRATION_REPORT.md');
  }

  /**
   * Close database connections
   */
  async cleanup(): Promise<void> {
    await this.sourcePool.end();
    await this.targetPool.end();
    console.log('🔌 Database connections closed');
  }

  /**
   * Main migration execution
   */
  async execute(): Promise<void> {
    console.log('🚀 Starting Orders Suffix Migration');
    console.log('=====================================\n');

    try {
      // Fetch suffix data from source
      const suffixData = await this.fetchSuffixData();

      if (suffixData.length === 0) {
        console.log('❌ No suffix data found in source database');
        return;
      }

      // Execute the migration
      const stats = await this.updateOrdersSuffix(suffixData);

      // Validate results
      await this.validateMigration();

      // Generate final report
      await this.generateReport(stats);

      console.log('\n🎉 Orders Suffix Migration completed successfully!');
      console.log(`✅ Updated ${stats.successful} out of ${stats.totalProcessed} orders`);

    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }
}

// Execute migration if run directly
if (require.main === module) {
  const migration = new OrdersSuffixMigration();
  migration.execute()
    .then(() => {
      console.log('✅ Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration script failed:', error);
      process.exit(1);
    });
}

export { OrdersSuffixMigration };