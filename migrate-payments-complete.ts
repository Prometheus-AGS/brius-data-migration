import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

interface DispatchPayment {
  id: number;
  made_at: Date | null;
  free: boolean;
  tax_rate: number;
  tax_value: number;
  paid_price: number;
  instruction_id: number | null;
  used_credit: number;
  canceled: boolean;
  paid: boolean;
  custom_price: number | null;
  subtotal_price: number;
  doctor_id: number | null;
  office_id: number | null;
  order_id: number | null;
  installments: string;
  additional_price: number;
  netsuite: boolean;
  total_price: number;
}

interface PaymentMigrationStats {
  totalSourceRecords: number;
  migratedRecords: number;
  skippedRecords: number;
  errors: number;
  totalFinancialValue: number;
  migratedFinancialValue: number;
  startTime: Date;
  endTime?: Date;
}

class PaymentsMigration {
  private sourcePool: Pool;
  private targetPool: Pool;
  private stats: PaymentMigrationStats;
  private batchSize: number = 500;

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
      migratedRecords: 0,
      skippedRecords: 0,
      errors: 0,
      totalFinancialValue: 0,
      migratedFinancialValue: 0,
      startTime: new Date(),
    };
  }

  /**
   * Get all source payments
   */
  private async getAllPayments(): Promise<DispatchPayment[]> {
    const query = `
      SELECT
        id,
        made_at,
        free,
        tax_rate,
        tax_value,
        paid_price,
        instruction_id,
        used_credit,
        canceled,
        paid,
        custom_price,
        subtotal_price,
        doctor_id,
        office_id,
        order_id,
        installments,
        additional_price,
        netsuite,
        total_price
      FROM dispatch_payment
      ORDER BY id
    `;

    try {
      const result = await this.sourcePool.query(query);
      this.stats.totalSourceRecords = result.rows.length;

      // Calculate total financial value
      this.stats.totalFinancialValue = result.rows.reduce((sum, payment) => sum + parseFloat(payment.total_price || 0), 0);

      console.log(`✓ Found ${this.stats.totalSourceRecords} total payments in source`);
      console.log(`💰 Total Financial Value: $${this.stats.totalFinancialValue.toLocaleString()}`);

      return result.rows;
    } catch (error) {
      console.error('❌ Error fetching payments:', error);
      throw error;
    }
  }

  /**
   * Get required mappings for payment migration
   */
  private async getMappings(): Promise<{
    orderMappings: Map<number, string>,
    patientMappings: Map<number, string>,
    doctorMappings: Map<number, string>,
    officeMappings: Map<number, string>
  }> {
    try {
      const [orderMappingsResult, patientMappingsResult, doctorMappingsResult, officeMappingsResult] = await Promise.all([
        // Get order mappings (instruction_id maps to orders)
        this.targetPool.query(`
          SELECT legacy_instruction_id, id
          FROM orders
          WHERE legacy_instruction_id IS NOT NULL
        `),
        // Get patient mappings from profiles
        this.targetPool.query(`
          SELECT legacy_user_id, id
          FROM profiles
          WHERE profile_type = 'patient' AND legacy_user_id IS NOT NULL
        `),
        // Get doctor mappings from profiles
        this.targetPool.query(`
          SELECT legacy_user_id, id
          FROM profiles
          WHERE profile_type = 'doctor' AND legacy_user_id IS NOT NULL
        `),
        // Get office mappings
        this.targetPool.query(`
          SELECT legacy_office_id, id
          FROM offices
          WHERE legacy_office_id IS NOT NULL
        `)
      ]);

      const orderMappings = new Map<number, string>();
      const patientMappings = new Map<number, string>();
      const doctorMappings = new Map<number, string>();
      const officeMappings = new Map<number, string>();

      orderMappingsResult.rows.forEach(row => {
        orderMappings.set(row.legacy_instruction_id, row.id);
      });

      patientMappingsResult.rows.forEach(row => {
        patientMappings.set(row.legacy_user_id, row.id);
      });

      doctorMappingsResult.rows.forEach(row => {
        doctorMappings.set(row.legacy_user_id, row.id);
      });

      officeMappingsResult.rows.forEach(row => {
        officeMappings.set(row.legacy_office_id, row.id);
      });

      console.log(`✓ Found ${orderMappings.size} order mappings`);
      console.log(`✓ Found ${patientMappings.size} patient mappings`);
      console.log(`✓ Found ${doctorMappings.size} doctor mappings`);
      console.log(`✓ Found ${officeMappings.size} office mappings`);

      return { orderMappings, patientMappings, doctorMappings, officeMappings };
    } catch (error) {
      console.error('❌ Error fetching mappings:', error);
      throw error;
    }
  }

  /**
   * Map payment status to target enum
   */
  private mapPaymentStatus(payment: DispatchPayment): 'pending' | 'completed' | 'failed' | 'cancelled' | 'refunded' {
    if (payment.canceled) return 'cancelled';
    if (payment.paid) return 'completed';
    return 'pending';
  }

  /**
   * Determine payment method based on data
   */
  private determinePaymentMethod(payment: DispatchPayment): 'card' | 'check' | 'insurance' | 'cash' | 'other' | null {
    if (payment.free) return null; // Free doesn't need a payment method
    if (payment.netsuite) return 'other'; // NetSuite indicates business payment
    if (payment.installments && payment.installments.length > 2) return 'card'; // Installments typically use cards
    return 'card'; // Default assumption for most payments
  }

  /**
   * Migrate payments batch
   */
  private async migratePaymentsBatch(
    payments: DispatchPayment[],
    orderMappings: Map<number, string>,
    patientMappings: Map<number, string>,
    doctorMappings: Map<number, string>,
    officeMappings: Map<number, string>
  ): Promise<void> {
    if (payments.length === 0) return;

    console.log(`📊 Migrating batch of ${payments.length} payments...`);

    // Prepare batch insert
    const paymentRecords = payments.map(payment => {
      const orderId = payment.instruction_id ? orderMappings.get(payment.instruction_id) : null;

      // Get patient from order relationship if direct mapping doesn't work
      let patientId = payment.doctor_id ? patientMappings.get(payment.doctor_id) : null;

      const paymentStatus = this.mapPaymentStatus(payment);
      const paymentMethod = this.determinePaymentMethod(payment);

      return {
        order_id: orderId,
        patient_id: patientId,
        amount: payment.total_price,
        currency: 'USD',
        status: paymentStatus,
        payment_method: paymentMethod,
        external_payment_id: null, // dispatch_payment doesn't have external IDs
        transaction_reference: null,
        processed_at: payment.made_at,
        legacy_payment_id: payment.id,
        metadata: JSON.stringify({
          source_paid_price: payment.paid_price,
          source_subtotal_price: payment.subtotal_price,
          source_tax_rate: payment.tax_rate,
          source_tax_value: payment.tax_value,
          source_used_credit: payment.used_credit,
          source_custom_price: payment.custom_price,
          source_additional_price: payment.additional_price,
          source_installments: payment.installments,
          source_netsuite: payment.netsuite,
          source_free: payment.free,
          source_doctor_id: payment.doctor_id,
          source_office_id: payment.office_id,
          source_order_id: payment.order_id,
          migrated_at: new Date().toISOString()
        })
      };
    });

    // Filter records with required relationships
    const validRecords = paymentRecords.filter(record => {
      if (!record.order_id) {
        console.log(`⏭️  Skipping payment ${record.legacy_payment_id} - no order relationship`);
        return false;
      }
      return true;
    });

    console.log(`   → ${validRecords.length}/${payments.length} payments have required order mappings`);

    if (validRecords.length === 0) {
      this.stats.skippedRecords += payments.length;
      return;
    }

    try {
      // Insert batch
      const insertQuery = `
        INSERT INTO payments (
          order_id, patient_id, amount, currency, status, payment_method,
          external_payment_id, transaction_reference, processed_at, legacy_payment_id,
          metadata, created_at
        ) VALUES ${validRecords.map((_, i) =>
          `($${i * 11 + 1}, $${i * 11 + 2}, $${i * 11 + 3}, $${i * 11 + 4}, $${i * 11 + 5}, $${i * 11 + 6}, $${i * 11 + 7}, $${i * 11 + 8}, $${i * 11 + 9}, $${i * 11 + 10}, $${i * 11 + 11}, NOW())`
        ).join(', ')}
        ON CONFLICT (legacy_payment_id) DO NOTHING
      `;

      const values = validRecords.flatMap(payment => [
        payment.order_id,
        payment.patient_id,
        payment.amount,
        payment.currency,
        payment.status,
        payment.payment_method,
        payment.external_payment_id,
        payment.transaction_reference,
        payment.processed_at,
        payment.legacy_payment_id,
        payment.metadata
      ]);

      const result = await this.targetPool.query(insertQuery, values);
      const insertedCount = result.rowCount || 0;

      this.stats.migratedRecords += insertedCount;
      this.stats.skippedRecords += (payments.length - insertedCount);

      // Calculate migrated financial value
      const batchFinancialValue = validRecords.reduce((sum, payment) => sum + parseFloat(payment.amount.toString()), 0);
      this.stats.migratedFinancialValue += batchFinancialValue;

      console.log(`✅ Successfully migrated ${insertedCount} payments ($${batchFinancialValue.toLocaleString()})`);

    } catch (error) {
      this.stats.errors++;
      console.error(`❌ Error migrating payments batch:`, error);
    }
  }

  /**
   * Main migration function
   */
  public async executePaymentsMigration(): Promise<PaymentMigrationStats> {
    console.log('🚀 Starting Payments Migration ($4.27M financial data)...\n');

    try {
      // Get all payments and mappings
      const [allPayments, mappings] = await Promise.all([
        this.getAllPayments(),
        this.getMappings()
      ]);

      const { orderMappings, patientMappings, doctorMappings, officeMappings } = mappings;

      console.log('\n🔄 Starting batch migration...');

      // Process in batches
      for (let i = 0; i < allPayments.length; i += this.batchSize) {
        const batchStartTime = Date.now();
        const batch = allPayments.slice(i, i + this.batchSize);

        await this.migratePaymentsBatch(batch, orderMappings, patientMappings, doctorMappings, officeMappings);

        const batchDuration = Date.now() - batchStartTime;
        const recordsPerSecond = (batch.length / batchDuration * 1000).toFixed(0);
        console.log(`   ⚡ Batch ${Math.floor(i / this.batchSize) + 1} completed in ${batchDuration}ms (${recordsPerSecond} records/sec)`);

        if (this.stats.migratedRecords % 5000 === 0 && this.stats.migratedRecords > 0) {
          console.log(`✅ Progress: ${this.stats.migratedRecords} payments migrated ($${this.stats.migratedFinancialValue.toLocaleString()})...`);
        }
      }

      this.stats.endTime = new Date();

      // Final summary
      console.log('\n📋 Payments Migration Summary:');
      console.log(`⏱️  Duration: ${this.stats.endTime.getTime() - this.stats.startTime.getTime()}ms`);
      console.log(`📊 Source Records: ${this.stats.totalSourceRecords}`);
      console.log(`✅ Successfully Migrated: ${this.stats.migratedRecords}`);
      console.log(`⏭️  Skipped: ${this.stats.skippedRecords}`);
      console.log(`❌ Errors: ${this.stats.errors}`);
      console.log(`💰 Source Financial Value: $${this.stats.totalFinancialValue.toLocaleString()}`);
      console.log(`💰 Migrated Financial Value: $${this.stats.migratedFinancialValue.toLocaleString()}`);

      const successRate = this.stats.totalSourceRecords > 0
        ? ((this.stats.migratedRecords / this.stats.totalSourceRecords) * 100).toFixed(2)
        : 100;
      console.log(`📈 Success Rate: ${successRate}%`);

      const financialAccuracy = this.stats.totalFinancialValue > 0
        ? ((this.stats.migratedFinancialValue / this.stats.totalFinancialValue) * 100).toFixed(2)
        : 100;
      console.log(`💎 Financial Accuracy: ${financialAccuracy}%`);

      return this.stats;

    } catch (error) {
      console.error('💥 Payments migration failed:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Validate the migration results
   */
  public async validateMigration(): Promise<void> {
    console.log('\n🔍 Validating payments migration...');

    try {
      const validationStats = await this.targetPool.query(`
        SELECT
          COUNT(*) as total_payments,
          COUNT(CASE WHEN legacy_payment_id IS NOT NULL THEN 1 END) as migrated_payments,
          SUM(amount) as total_amount,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_payments,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_payments,
          COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as canceled_payments,
          COUNT(DISTINCT order_id) as unique_orders,
          COUNT(DISTINCT patient_id) as unique_patients,
          MIN(created_at) as earliest_payment,
          MAX(created_at) as latest_payment
        FROM payments
      `);

      const stats = validationStats.rows[0];
      console.log('📊 Payments Validation:');
      console.log(`   Total Payments: ${stats.total_payments}`);
      console.log(`   Migrated Payments (with legacy_payment_id): ${stats.migrated_payments}`);
      console.log(`   Total Amount: $${parseFloat(stats.total_amount || 0).toLocaleString()}`);
      console.log(`   Completed Payments: ${stats.completed_payments}`);
      console.log(`   Pending Payments: ${stats.pending_payments}`);
      console.log(`   Canceled Payments: ${stats.canceled_payments}`);
      console.log(`   Unique Orders: ${stats.unique_orders}`);
      console.log(`   Unique Patients: ${stats.unique_patients}`);
      console.log(`   Date Range: ${stats.earliest_payment} to ${stats.latest_payment}`);

      // Payment method breakdown
      const methodBreakdown = await this.targetPool.query(`
        SELECT
          payment_method,
          COUNT(*) as count,
          SUM(amount) as total_amount
        FROM payments
        WHERE legacy_payment_id IS NOT NULL
        GROUP BY payment_method
        ORDER BY count DESC
      `);

      console.log('\n📊 Payment Method Distribution:');
      methodBreakdown.rows.forEach(row => {
        const amount = parseFloat(row.total_amount || 0);
        console.log(`   ${row.payment_method || 'null'}: ${row.count} payments ($${amount.toLocaleString()})`);
      });

      // Monthly revenue breakdown
      const revenueBreakdown = await this.targetPool.query(`
        SELECT
          EXTRACT(YEAR FROM created_at) as year,
          EXTRACT(MONTH FROM created_at) as month,
          COUNT(*) as payment_count,
          SUM(amount) as monthly_revenue
        FROM payments
        WHERE legacy_payment_id IS NOT NULL
        AND status = 'completed'
        GROUP BY EXTRACT(YEAR FROM created_at), EXTRACT(MONTH FROM created_at)
        ORDER BY year DESC, month DESC
        LIMIT 12
      `);

      console.log('\n📊 Recent Monthly Revenue:');
      revenueBreakdown.rows.forEach(row => {
        const revenue = parseFloat(row.monthly_revenue || 0);
        console.log(`   ${row.year}-${String(row.month).padStart(2, '0')}: ${row.payment_count} payments ($${revenue.toLocaleString()})`);
      });

      // Check financial accuracy
      const sourceTotal = await this.sourcePool.query('SELECT SUM(total_price) as source_total FROM dispatch_payment');
      const targetTotal = parseFloat(stats.total_amount || 0);
      const sourceValue = parseFloat(sourceTotal.rows[0].source_total || 0);

      console.log(`\n💰 Financial Integrity Check:`);
      console.log(`   Source Total: $${sourceValue.toLocaleString()}`);
      console.log(`   Target Total: $${targetTotal.toLocaleString()}`);
      const accuracy = sourceValue > 0 ? ((targetTotal / sourceValue) * 100).toFixed(4) : 100;
      console.log(`   Financial Accuracy: ${accuracy}%`);

      if (Math.abs(sourceValue - targetTotal) < 0.01) {
        console.log('🎉 PERFECT FINANCIAL MIGRATION: All payment amounts preserved!');
      } else {
        const difference = Math.abs(sourceValue - targetTotal);
        console.log(`⚠️  Financial difference: $${difference.toFixed(2)}`);
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

  const migration = new PaymentsMigration();

  try {
    switch (command) {
      case 'migrate':
        await migration.executePaymentsMigration();
        await migration.validateMigration();
        break;

      case 'validate':
        await migration.validateMigration();
        break;

      default:
        console.log('Usage: npx ts-node migrate-payments-complete.ts [migrate|validate]');
        process.exit(1);
    }

    process.exit(0);

  } catch (error) {
    console.error('💥 Operation failed:', error);
    process.exit(1);
  }
}

// Export for use as module
export { PaymentsMigration };

// Run if called directly
if (require.main === module) {
  main();
}