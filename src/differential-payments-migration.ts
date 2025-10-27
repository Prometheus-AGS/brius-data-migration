/**
 * Differential Payments Migration Service
 * Migrates new payment records from dispatch_payment to payments table with proper order relationships
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

interface DispatchPayment {
  id: number;
  instruction_id: number | null;
  order_id: number | null;
  doctor_id: number | null;
  office_id: number | null;
  paid_price: number;
  total_price: number;
  subtotal_price: number;
  tax_rate: number;
  tax_value: number;
  used_credit: number;
  additional_price: number;
  custom_price: number | null;
  paid: boolean;
  canceled: boolean;
  free: boolean;
  made_at: Date | null;
  installments: string;
}

interface MigrationStats {
  totalNewPayments: number;
  successfulMigrations: number;
  errors: number;
  skipped: number;
  startTime: Date;
  endTime?: Date;
}

class DifferentialPaymentsMigrationService {
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
      totalNewPayments: 0,
      successfulMigrations: 0,
      errors: 0,
      skipped: 0,
      startTime: new Date()
    };
  }

  /**
   * Get new payment records that haven't been migrated
   */
  private async getNewPayments(): Promise<DispatchPayment[]> {
    console.log('💳 Identifying new payment records in source database...');

    // First, get all legacy_payment_ids that already exist in target
    const existingIdsQuery = `
      SELECT legacy_payment_id
      FROM payments
      WHERE legacy_payment_id IS NOT NULL
    `;

    const existingIdsResult = await this.targetPool.query(existingIdsQuery);
    const existingIds = existingIdsResult.rows.map(row => row.legacy_payment_id);

    console.log(`✓ Found ${existingIds.length} payments already migrated in target`);

    // Get source payments that are NOT in the existing IDs
    let query = `
      SELECT
        dp.id,
        dp.instruction_id,
        dp.order_id,
        dp.doctor_id,
        dp.office_id,
        dp.paid_price,
        dp.total_price,
        dp.subtotal_price,
        dp.tax_rate,
        dp.tax_value,
        dp.used_credit,
        dp.additional_price,
        dp.custom_price,
        dp.paid,
        dp.canceled,
        dp.free,
        dp.made_at,
        dp.installments
      FROM dispatch_payment dp
    `;

    if (existingIds.length > 0) {
      query += ` WHERE dp.id NOT IN (${existingIds.join(',')})`;
    }

    query += ` ORDER BY dp.made_at DESC NULLS LAST, dp.id DESC`;

    try {
      const result = await this.sourcePool.query(query);
      console.log(`✓ Found ${result.rows.length} new payment records to migrate`);

      return result.rows.map(row => ({
        id: row.id,
        instruction_id: row.instruction_id,
        order_id: row.order_id,
        doctor_id: row.doctor_id,
        office_id: row.office_id,
        paid_price: parseFloat(row.paid_price) || 0,
        total_price: parseFloat(row.total_price) || 0,
        subtotal_price: parseFloat(row.subtotal_price) || 0,
        tax_rate: parseFloat(row.tax_rate) || 0,
        tax_value: parseFloat(row.tax_value) || 0,
        used_credit: parseFloat(row.used_credit) || 0,
        additional_price: parseFloat(row.additional_price) || 0,
        custom_price: row.custom_price ? parseFloat(row.custom_price) : null,
        paid: row.paid || false,
        canceled: row.canceled || false,
        free: row.free || false,
        made_at: row.made_at,
        installments: row.installments || ''
      }));
    } catch (error) {
      console.error('❌ Error getting new payments:', error);
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
   * Map payment status from boolean flags to string
   */
  private mapPaymentStatus(payment: DispatchPayment): string {
    if (payment.canceled) return 'cancelled';
    if (payment.free) return 'completed'; // Free payments are considered completed
    if (payment.paid) return 'completed';
    return 'pending'; // Not paid, not canceled
  }

  /**
   * Determine payment method from payment data
   * Must match the check constraint: 'card', 'check', 'insurance', 'cash', 'other'
   */
  private inferPaymentMethod(payment: DispatchPayment): string {
    // Since there's no explicit payment_method column, infer from data patterns
    if (payment.free) return 'other'; // Free payments
    if (payment.used_credit > 0 && payment.paid_price === 0) return 'other'; // Credit used
    if (payment.installments && payment.installments !== '' && payment.installments !== '[]') return 'other'; // Financing

    // Default to 'other' since we can't reliably determine the payment method from available data
    // Future enhancement: could analyze other fields or use external data to determine actual method
    return 'other';
  }

  /**
   * Migrate payment records in batches
   */
  private async migratePayments(payments: DispatchPayment[]): Promise<void> {
    console.log('💰 Starting payment records migration...');

    const batchSize = 100;

    for (let i = 0; i < payments.length; i += batchSize) {
      const batch = payments.slice(i, i + batchSize);
      console.log(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(payments.length / batchSize)} (${batch.length} payments)`);

      for (const payment of batch) {
        try {
          // Get UUID mappings
          const orderUuid = await this.getOrderMapping(payment.instruction_id);

          // Skip if no order mapping (this would be an orphaned payment)
          if (!orderUuid) {
            console.warn(`⚠️  Skipping payment ${payment.id}: No order mapping found for instruction ${payment.instruction_id}`);
            this.stats.skipped++;
            continue;
          }

          // Insert payment into target
          const insertQuery = `
            INSERT INTO payments (
              order_id,
              amount,
              currency,
              payment_method,
              status,
              transaction_reference,
              processed_at,
              metadata,
              legacy_payment_id
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9
            )
          `;

          const values = [
            orderUuid,                                       // order_id
            payment.paid_price,                              // amount (use paid_price as the main amount)
            'USD',                                           // currency (default to USD)
            this.inferPaymentMethod(payment),                // payment_method
            this.mapPaymentStatus(payment),                  // status
            null,                                            // transaction_reference (not available in source schema)
            payment.made_at,                                 // processed_at
            JSON.stringify({                                 // metadata
              migration: {
                source_table: 'dispatch_payment',
                migrated_at: new Date().toISOString(),
                legacy_data: {
                  total_price: payment.total_price,
                  subtotal_price: payment.subtotal_price,
                  tax_rate: payment.tax_rate,
                  tax_value: payment.tax_value,
                  used_credit: payment.used_credit,
                  additional_price: payment.additional_price,
                  custom_price: payment.custom_price,
                  paid: payment.paid,
                  canceled: payment.canceled,
                  free: payment.free,
                  installments: payment.installments,
                  instruction_id: payment.instruction_id,
                  order_id: payment.order_id,
                  doctor_id: payment.doctor_id,
                  office_id: payment.office_id
                }
              }
            }),
            payment.id                                       // legacy_payment_id
          ];

          await this.targetPool.query(insertQuery, values);
          this.stats.successfulMigrations++;

          console.log(`✅ Migrated payment: $${payment.paid_price.toFixed(2)} ${this.mapPaymentStatus(payment)} for order ${orderUuid?.substring(0, 8)}... (Legacy ID: ${payment.id})`);

        } catch (error) {
          console.error(`❌ Error migrating payment ${payment.id}:`, error);
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
      // Count total payments in target
      const targetCountResult = await this.targetPool.query('SELECT COUNT(*) as count FROM payments');
      const targetCount = parseInt(targetCountResult.rows[0].count);

      // Count payments with legacy IDs
      const legacyCountResult = await this.targetPool.query('SELECT COUNT(*) as count FROM payments WHERE legacy_payment_id IS NOT NULL');
      const legacyCount = parseInt(legacyCountResult.rows[0].count);

      // Get total payment amount
      const totalAmountResult = await this.targetPool.query('SELECT SUM(amount) as total FROM payments WHERE legacy_payment_id IS NOT NULL');
      const totalAmount = parseFloat(totalAmountResult.rows[0].total) || 0;

      console.log(`✓ Target database now has ${targetCount.toLocaleString()} total payments`);
      console.log(`✓ ${legacyCount.toLocaleString()} payments have legacy payment ID mappings`);
      console.log(`✓ Total payment amount migrated: $${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

      // Check for missing payments
      const sourceCountResult = await this.sourcePool.query('SELECT COUNT(*) as count FROM dispatch_payment');
      const sourceCount = parseInt(sourceCountResult.rows[0].count);
      const missingCount = sourceCount - legacyCount;

      if (missingCount > 0) {
        console.warn(`⚠️  ${missingCount} source payment records still not migrated`);
      } else {
        console.log(`✅ All source payment records have been successfully migrated`);
      }

      // Payment status breakdown
      const statusBreakdownResult = await this.targetPool.query(`
        SELECT
          status,
          COUNT(*) as count,
          SUM(amount) as total_amount
        FROM payments
        WHERE legacy_payment_id IS NOT NULL
        GROUP BY status
        ORDER BY count DESC
      `);

      console.log(`📊 Payment Status Breakdown:`);
      statusBreakdownResult.rows.forEach(row => {
        console.log(`   • ${row.status}: ${row.count} payments ($${parseFloat(row.total_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`);
      });

    } catch (error) {
      console.error('❌ Error during validation:', error);
      this.stats.errors++;
    }
  }

  /**
   * Main migration function
   */
  async migrate(): Promise<void> {
    console.log('🚀 Starting differential payments migration...');
    console.log('📋 This migration will:');
    console.log('   1. Identify new dispatch_payment records');
    console.log('   2. Map instruction_id to order UUIDs');
    console.log('   3. Standardize payment methods and statuses');
    console.log('   4. Migrate payment records in batches');
    console.log('   5. Validate results and calculate totals');

    try {
      // Step 1: Get new payments
      const newPayments = await this.getNewPayments();
      this.stats.totalNewPayments = newPayments.length;

      if (newPayments.length === 0) {
        console.log('✅ No new payment records to migrate');
        return;
      }

      // Step 2: Migrate payments
      await this.migratePayments(newPayments);

      // Step 3: Validate migration
      await this.validateMigration();

      this.stats.endTime = new Date();

      // Print final statistics
      console.log('\n🎉 Differential payments migration completed!');
      console.log('=============================================');
      console.log(`📊 Migration Statistics:`);
      console.log(`   • New payment records found: ${this.stats.totalNewPayments}`);
      console.log(`   • Successfully migrated: ${this.stats.successfulMigrations}`);
      console.log(`   • Skipped (missing dependencies): ${this.stats.skipped}`);
      console.log(`   • Errors encountered: ${this.stats.errors}`);
      console.log(`   • Success rate: ${this.stats.totalNewPayments > 0 ? ((this.stats.successfulMigrations / this.stats.totalNewPayments) * 100).toFixed(2) : 0}%`);
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

  const migrationService = new DifferentialPaymentsMigrationService(sourceConfig, targetConfig);

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

export { DifferentialPaymentsMigrationService };