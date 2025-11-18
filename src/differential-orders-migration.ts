/**
 * Differential Orders Migration Service
 * Migrates new orders from dispatch_instruction to orders table with proper UUID mapping
 */

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

interface DispatchInstruction {
  id: number;
  patient_id: number;
  submitted_at: Date;
  deleted: boolean;
  status: number;
  cbct: boolean;
  model: number | null;
  scanner: number | null;
  objective: string;
  conditions: string;
  order: number;
  lower_jaw_id: number | null;
  upper_jaw_id: number | null;
  comprehensive: boolean | null;
  scanner_notes: string;
  accept_extraction: boolean | null;
  updated_at: Date;
  notes: string | null;
  suffix: string;
  course_id: number;
  complaint: string;
  exports: string;
}

interface MigrationStats {
  totalNewOrders: number;
  successfulMigrations: number;
  errors: number;
  skipped: number;
  startTime: Date;
  endTime?: Date;
}

class DifferentialOrdersMigrationService {
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
      totalNewOrders: 0,
      successfulMigrations: 0,
      errors: 0,
      skipped: 0,
      startTime: new Date()
    };
  }

  /**
   * Get new orders from dispatch_instruction that haven't been migrated
   */
  private async getNewOrders(): Promise<DispatchInstruction[]> {
    console.log('🔍 Identifying new orders in source database...');

    // First, get all legacy_instruction_ids that already exist in target
    const existingIdsQuery = `
      SELECT legacy_instruction_id
      FROM orders
      WHERE legacy_instruction_id IS NOT NULL
    `;

    const existingIdsResult = await this.targetPool.query(existingIdsQuery);
    const existingIds = existingIdsResult.rows.map(row => row.legacy_instruction_id);

    console.log(`✓ Found ${existingIds.length} orders already migrated in target`);

    // Now get source orders that are NOT in the existing IDs
    let query = `
      SELECT
        di.id,
        di.patient_id,
        di.submitted_at,
        di.deleted,
        di.status,
        di.cbct,
        di.model,
        di.scanner,
        di.objective,
        di.conditions,
        di.order,
        di.lower_jaw_id,
        di.upper_jaw_id,
        di.comprehensive,
        di.scanner_notes,
        di.accept_extraction,
        di.updated_at,
        di.notes,
        di.suffix,
        di.course_id,
        di.complaint,
        di.exports
      FROM dispatch_instruction di
    `;

    if (existingIds.length > 0) {
      query += ` WHERE di.id NOT IN (${existingIds.join(',')})`;
    }

    query += ` ORDER BY di.submitted_at DESC`;

    try {
      const result = await this.sourcePool.query(query);
      console.log(`✓ Found ${result.rows.length} new orders to migrate`);

      return result.rows.map(row => ({
        id: row.id,
        patient_id: row.patient_id,
        submitted_at: row.submitted_at,
        deleted: row.deleted,
        status: row.status,
        cbct: row.cbct,
        model: row.model,
        scanner: row.scanner,
        objective: row.objective,
        conditions: row.conditions,
        order: row.order,
        lower_jaw_id: row.lower_jaw_id,
        upper_jaw_id: row.upper_jaw_id,
        comprehensive: row.comprehensive,
        scanner_notes: row.scanner_notes,
        accept_extraction: row.accept_extraction,
        updated_at: row.updated_at,
        notes: row.notes,
        suffix: row.suffix,
        course_id: row.course_id,
        complaint: row.complaint,
        exports: row.exports
      }));
    } catch (error) {
      console.error('❌ Error getting new orders:', error);
      throw error;
    }
  }

  /**
   * Get patient profile UUID mapping
   */
  private async getPatientMapping(patientId: number): Promise<string | null> {
    try {
      // First try to find patient profile via user_id relationship
      const sourcePatientQuery = `
        SELECT dp.user_id
        FROM dispatch_patient dp
        WHERE dp.id = $1
      `;

      const sourcePatientResult = await this.sourcePool.query(sourcePatientQuery, [patientId]);

      if (sourcePatientResult.rows.length === 0) {
        return null;
      }

      const userId = sourcePatientResult.rows[0].user_id;

      // Find the patient UUID using the patient's user_id
      // First get the profile, then get the patient record that references it
      const profileQuery = `
        SELECT p.id as profile_id
        FROM profiles p
        WHERE p.profile_type = 'patient' AND p.legacy_user_id = $1
      `;

      const profileResult = await this.targetPool.query(profileQuery, [userId]);

      if (profileResult.rows.length === 0) {
        return null;
      }

      const profileId = profileResult.rows[0].profile_id;

      // Now get the patient record that references this profile
      const targetPatientQuery = `
        SELECT p.id
        FROM patients p
        WHERE p.profile_id = $1
      `;

      const targetPatientResult = await this.targetPool.query(targetPatientQuery, [profileId]);
      return targetPatientResult.rows.length > 0 ? targetPatientResult.rows[0].id : null;
    } catch (error) {
      console.error(`❌ Error getting patient mapping for ${patientId}:`, error);
      return null;
    }
  }

  /**
   * Get doctor profile UUID mapping
   */
  private async getDoctorMapping(patientId: number): Promise<string | null> {
    try {
      // Get patient's doctor directly from dispatch_patient table
      // doctor_id in dispatch_patient is actually the user_id from auth_user
      const patientDoctorQuery = `
        SELECT dp.doctor_id
        FROM dispatch_patient dp
        WHERE dp.id = $1
      `;

      const patientResult = await this.sourcePool.query(patientDoctorQuery, [patientId]);

      if (patientResult.rows.length === 0 || !patientResult.rows[0].doctor_id) {
        return null;
      }

      const doctorUserId = patientResult.rows[0].doctor_id;

      // Find the doctor UUID using the doctor's user_id
      // First get the profile, then get the doctor record that references it
      const profileQuery = `
        SELECT p.id as profile_id
        FROM profiles p
        WHERE p.profile_type = 'doctor' AND p.legacy_user_id = $1
      `;

      const profileResult = await this.targetPool.query(profileQuery, [doctorUserId]);

      if (profileResult.rows.length === 0) {
        return null;
      }

      const profileId = profileResult.rows[0].profile_id;

      // Now get the doctor record that references this profile
      const doctorQuery = `
        SELECT d.id
        FROM doctors d
        WHERE d.profile_id = $1
      `;

      const doctorResult = await this.targetPool.query(doctorQuery, [profileId]);
      return doctorResult.rows.length > 0 ? doctorResult.rows[0].id : null;
    } catch (error) {
      console.error(`❌ Error getting doctor mapping for patient ${patientId}:`, error);
      return null;
    }
  }

  /**
   * Get office UUID mapping
   */
  private async getOfficeMapping(patientId: number): Promise<string | null> {
    try {
      // Get office directly from dispatch_patient table
      const patientOfficeQuery = `
        SELECT dp.office_id
        FROM dispatch_patient dp
        WHERE dp.id = $1
      `;

      const result = await this.sourcePool.query(patientOfficeQuery, [patientId]);

      if (result.rows.length === 0 || !result.rows[0].office_id) {
        return null;
      }

      const legacyOfficeId = result.rows[0].office_id;

      // Find the office UUID
      const officeQuery = `
        SELECT id
        FROM offices
        WHERE legacy_office_id = $1
      `;

      const officeResult = await this.targetPool.query(officeQuery, [legacyOfficeId]);
      return officeResult.rows.length > 0 ? officeResult.rows[0].id : null;
    } catch (error) {
      console.error(`❌ Error getting office mapping for patient ${patientId}:`, error);
      return null;
    }
  }

  /**
   * Generate order number
   */
  private generateOrderNumber(instructionId: number): string {
    // Generate order number in the format used by existing orders
    return `00BB-${instructionId}`;
  }

  /**
   * Map status from integer to string
   */
  private mapStatus(status: number): string {
    const statusMap: { [key: number]: string } = {
      0: 'submitted',
      1: 'approved',
      2: 'shipped',
      3: 'completed',
      4: 'cancelled'
    };

    return statusMap[status] || 'submitted';
  }

  /**
   * Migrate orders in batches
   */
  private async migrateOrders(orders: DispatchInstruction[]): Promise<void> {
    console.log('📋 Starting order migration...');

    const batchSize = 50;

    for (let i = 0; i < orders.length; i += batchSize) {
      const batch = orders.slice(i, i + batchSize);
      console.log(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(orders.length / batchSize)} (${batch.length} orders)`);

      for (const order of batch) {
        try {
          // Get UUID mappings
          const patientUuid = await this.getPatientMapping(order.patient_id);
          const doctorUuid = await this.getDoctorMapping(order.patient_id);
          const officeUuid = await this.getOfficeMapping(order.patient_id);

          if (!patientUuid) {
            console.warn(`⚠️  Skipping order ${order.id}: Patient mapping not found for patient_id ${order.patient_id}`);
            this.stats.skipped++;
            continue;
          }

          // Note: doctor_id and office_id can be null for some orders

          // Insert order into target
          const insertQuery = `
            INSERT INTO orders (
              order_number,
              patient_id,
              doctor_id,
              office_id,
              course_type,
              status,
              notes,
              complaint,
              amount,
              submitted_at,
              approved_at,
              shipped_at,
              created_at,
              updated_at,
              deleted,
              deleted_at,
              metadata,
              legacy_instruction_id
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
            )
          `;

          const values = [
            this.generateOrderNumber(order.id),           // order_number
            patientUuid,                                  // patient_id
            doctorUuid,                                   // doctor_id
            officeUuid,                                   // office_id
            'main',                                       // course_type
            this.mapStatus(order.status),                 // status
            null,                                         // notes
            null,                                         // complaint
            null,                                         // amount
            order.submitted_at,                           // submitted_at
            order.status >= 1 ? order.updated_at : null, // approved_at
            order.status >= 2 ? order.updated_at : null, // shipped_at
            order.submitted_at,                           // created_at
            order.updated_at,                             // updated_at
            order.deleted,                                // deleted
            order.deleted ? order.updated_at : null,     // deleted_at
            JSON.stringify({                              // metadata
              migration: {
                source_table: 'dispatch_instruction',
                migrated_at: new Date().toISOString(),
                legacy_data: {
                  cbct: order.cbct,
                  model: order.model,
                  scanner: order.scanner,
                  objective: order.objective,
                  conditions: order.conditions,
                  order: order.order,
                  lower_jaw_id: order.lower_jaw_id,
                  upper_jaw_id: order.upper_jaw_id,
                  comprehensive: order.comprehensive,
                  scanner_notes: order.scanner_notes,
                  accept_extraction: order.accept_extraction,
                  deleted: order.deleted,
                  suffix: order.suffix,
                  course_id: order.course_id,
                  complaint: order.complaint,
                  exports: order.exports
                }
              }
            }),
            order.id                                      // legacy_instruction_id
          ];

          await this.targetPool.query(insertQuery, values);
          this.stats.successfulMigrations++;

          console.log(`✅ Migrated order: ${this.generateOrderNumber(order.id)} (Legacy ID: ${order.id})`);

        } catch (error) {
          console.error(`❌ Error migrating order ${order.id}:`, error);
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
      // Count total orders in target
      const targetCountResult = await this.targetPool.query('SELECT COUNT(*) as count FROM orders');
      const targetCount = parseInt(targetCountResult.rows[0].count);

      // Count orders with legacy IDs
      const legacyCountResult = await this.targetPool.query('SELECT COUNT(*) as count FROM orders WHERE legacy_instruction_id IS NOT NULL');
      const legacyCount = parseInt(legacyCountResult.rows[0].count);

      console.log(`✓ Target database now has ${targetCount.toLocaleString()} total orders`);
      console.log(`✓ ${legacyCount.toLocaleString()} orders have legacy instruction ID mappings`);

      // Check for missing orders
      const sourceCountResult = await this.sourcePool.query('SELECT COUNT(*) as count FROM dispatch_instruction');
      const sourceCount = parseInt(sourceCountResult.rows[0].count);
      const missingCount = sourceCount - legacyCount;

      if (missingCount > 0) {
        console.warn(`⚠️  ${missingCount} source instructions/orders still not migrated`);
      } else {
        console.log(`✅ All source instructions have been successfully migrated to orders`);
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
    console.log('🚀 Starting differential orders migration...');
    console.log('📋 This migration will:');
    console.log('   1. Identify new dispatch_instruction records');
    console.log('   2. Map patient/doctor/office foreign keys to UUIDs');
    console.log('   3. Migrate orders in batches');
    console.log('   4. Validate results');

    try {
      // Step 1: Get new orders
      const newOrders = await this.getNewOrders();
      this.stats.totalNewOrders = newOrders.length;

      if (newOrders.length === 0) {
        console.log('✅ No new orders to migrate');
        return;
      }

      // Step 2: Migrate orders
      await this.migrateOrders(newOrders);

      // Step 3: Validate migration
      await this.validateMigration();

      this.stats.endTime = new Date();

      // Print final statistics
      console.log('\n🎉 Differential orders migration completed!');
      console.log('==========================================');
      console.log(`📊 Migration Statistics:`);
      console.log(`   • New orders found: ${this.stats.totalNewOrders}`);
      console.log(`   • Successfully migrated: ${this.stats.successfulMigrations}`);
      console.log(`   • Skipped (missing dependencies): ${this.stats.skipped}`);
      console.log(`   • Errors encountered: ${this.stats.errors}`);
      console.log(`   • Success rate: ${this.stats.totalNewOrders > 0 ? ((this.stats.successfulMigrations / this.stats.totalNewOrders) * 100).toFixed(2) : 0}%`);
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

  const migrationService = new DifferentialOrdersMigrationService(sourceConfig, targetConfig);

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

export { DifferentialOrdersMigrationService };