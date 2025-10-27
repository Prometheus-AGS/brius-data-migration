/**
 * Add payment_status column to target payments table
 * Fixes schema compatibility issue for payments migration
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

class PaymentSchemaFixer {
  private targetPool: Pool;

  constructor(targetConfig: DatabaseConfig) {
    this.targetPool = new Pool({
      host: targetConfig.host,
      port: targetConfig.port,
      database: targetConfig.database,
      user: targetConfig.username,
      password: targetConfig.password,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }

  /**
   * Check current payments table structure
   */
  private async checkPaymentsTableStructure(): Promise<void> {
    console.log('🔍 Checking current payments table structure...');

    try {
      const result = await this.targetPool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'payments' AND table_schema = 'public'
        ORDER BY ordinal_position
      `);

      console.log('✓ Current payments table columns:');
      result.rows.forEach(row => {
        console.log(`   • ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
      });

      // Check if payment_status already exists
      const hasPaymentStatus = result.rows.some(row => row.column_name === 'payment_status');

      if (hasPaymentStatus) {
        console.log('✅ payment_status column already exists');
        return;
      }

      console.log('⚠️  payment_status column is missing - will add it');

    } catch (error) {
      console.error('❌ Error checking table structure:', error);
      throw error;
    }
  }

  /**
   * Add payment_status column with appropriate enum values
   */
  private async addPaymentStatusColumn(): Promise<void> {
    console.log('🔧 Adding payment_status column to payments table...');

    try {
      // First, create the enum type if it doesn't exist
      await this.targetPool.query(`
        DO $$ BEGIN
          CREATE TYPE payment_status_enum AS ENUM (
            'pending',
            'processing',
            'completed',
            'failed',
            'refunded',
            'cancelled',
            'other'
          );
        EXCEPTION
          WHEN duplicate_object THEN null;
        END $$;
      `);

      console.log('✓ Created payment_status_enum type');

      // Add the column
      await this.targetPool.query(`
        ALTER TABLE payments
        ADD COLUMN IF NOT EXISTS payment_status payment_status_enum DEFAULT 'other'
      `);

      console.log('✅ Successfully added payment_status column');

      // Verify the addition
      const verifyResult = await this.targetPool.query(`
        SELECT column_name, data_type, column_default
        FROM information_schema.columns
        WHERE table_name = 'payments'
          AND column_name = 'payment_status'
          AND table_schema = 'public'
      `);

      if (verifyResult.rows.length > 0) {
        console.log('✓ Verification successful:');
        console.log(`   • Column: ${verifyResult.rows[0].column_name}`);
        console.log(`   • Type: ${verifyResult.rows[0].data_type}`);
        console.log(`   • Default: ${verifyResult.rows[0].column_default}`);
      } else {
        throw new Error('Column addition verification failed');
      }

    } catch (error) {
      console.error('❌ Error adding payment_status column:', error);
      throw error;
    }
  }

  /**
   * Main execution function
   */
  async execute(): Promise<void> {
    console.log('🚀 Starting payment table schema fix...');

    try {
      // Step 1: Check current structure
      await this.checkPaymentsTableStructure();

      // Step 2: Add missing column
      await this.addPaymentStatusColumn();

      console.log('🎉 Payment table schema fix completed successfully!');
      console.log('✅ Ready to re-run differential payments migration');

    } catch (error) {
      console.error('❌ Schema fix failed:', error);
      throw error;
    }
  }

  /**
   * Cleanup database connections
   */
  async cleanup(): Promise<void> {
    try {
      await this.targetPool.end();
    } catch (error) {
      console.error('❌ Error during cleanup:', error);
    }
  }
}

// Main execution
async function main() {
  const targetConfig: DatabaseConfig = {
    host: 'db.gyyottknjakkagswebwh.supabase.co',
    port: 5432,
    database: 'postgres',
    username: 'postgres',
    password: 'P@n@m3r@!'
  };

  const schemaFixer = new PaymentSchemaFixer(targetConfig);

  try {
    await schemaFixer.execute();
  } catch (error) {
    console.error('❌ Main execution failed:', error);
    process.exit(1);
  } finally {
    await schemaFixer.cleanup();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Script execution failed:', error);
    process.exit(1);
  });
}

export { PaymentSchemaFixer };