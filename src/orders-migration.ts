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

interface RawOrderRecord {
  legacy_instruction_id: number;
  order_number: string;
  legacy_user_id: number;      // patient's legacy user_id (for lookup)
  legacy_doctor_id: number;    // doctor's legacy user_id (for lookup)
  legacy_office_id?: number;   // office's legacy office_id (for lookup)
  course_type: 'main' | 'refinement' | 'replacement' | 'any' | 'invoice' | 'merchandise';
  status: 'no_product' | 'submitted' | 'approved' | 'in_production' | 'shipped' | 'cancelled' | 'on_hold' | 'add_plan';
  notes?: string;
  complaint?: string;
  amount?: number;
  submitted_at?: string;
  approved_at?: string;
  shipped_at?: string;
  metadata: any;
  exports?: any;
}

interface OrderRecord {
  legacy_instruction_id: number;
  order_number: string;
  patient_id: string;          // resolved UUID
  doctor_id: string;           // resolved UUID
  office_id?: string;          // resolved UUID (optional)
  course_type: 'main' | 'refinement' | 'replacement' | 'any' | 'invoice' | 'merchandise';
  status: 'no_product' | 'submitted' | 'approved' | 'in_production' | 'shipped' | 'cancelled' | 'on_hold' | 'add_plan';
  notes?: string;
  complaint?: string;
  amount?: number;
  submitted_at?: string;
  approved_at?: string;
  shipped_at?: string;
  metadata: any;
  exports?: any;
}

interface MigrationStats {
  totalProcessed: number;
  inserted: number;
  skipped: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
  throughputPerSecond?: number;
}

class OrdersMigrationService {
  private sourcePool: Pool;
  private targetPool: Pool;
  private batchSize: number = 5000; // Optimized batch size
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
      inserted: 0,
      skipped: 0,
      errors: 0,
      startTime: new Date(),
    };
  }

  /**
   * Extract raw orders from source database (with legacy IDs)
   */
  private async extractRawOrders(): Promise<RawOrderRecord[]> {
    const query = `
      SELECT 
        i.id as legacy_instruction_id,
        CONCAT(p.suffix, '-', i.id) as order_number,
        
        -- Keep legacy IDs for later resolution
        p.user_id as legacy_user_id,
        p.doctor_id as legacy_doctor_id,
        p.office_id as legacy_office_id,
        
        -- Map course_id to course_type enum
        CASE 
          WHEN i.course_id = 1 THEN 'main'
          WHEN i.course_id = 2 THEN 'refinement'
          WHEN i.course_id = 3 THEN 'replacement'
          WHEN i.course_id = 4 THEN 'any'
          WHEN i.course_id = 7 THEN 'invoice'
          WHEN i.course_id = 8 THEN 'merchandise'
          ELSE 'main'
        END as course_type,
        
        -- Map status integer to enum
        CASE 
          WHEN i.status = 0 THEN 'no_product'
          WHEN i.status = 1 THEN 'submitted'
          WHEN i.status = 2 THEN 'approved'
          WHEN i.status = 4 THEN 'shipped'
          ELSE 'no_product'
        END as status,
        
        i.notes,
        i.complaint,
        i.price as amount,
        i.submitted_at,
        
        -- Estimate approved_at and shipped_at based on status
        CASE WHEN i.status >= 2 THEN i.updated_at END as approved_at,
        CASE WHEN i.status = 4 THEN i.updated_at END as shipped_at,
        
        -- Build metadata JSON as text (will parse in application)
        json_build_object(
          'migration', json_build_object(
            'source_table', 'dispatch_instruction',
            'migrated_at', NOW()::text,
            'legacy_data', json_build_object(
              'model', i.model,
              'order_field', i."order",
              'scanner', i.scanner,
              'scanner_notes', i.scanner_notes,
              'cbct', i.cbct,
              'deleted', i.deleted,
              'conditions', i.conditions,
              'accept_extraction', i.accept_extraction,
              'objective', i.objective,
              'comprehensive', i.comprehensive,
              'lower_jaw_id', i.lower_jaw_id,
              'upper_jaw_id', i.upper_jaw_id
            )
          )
        )::text as metadata,
        
        -- Parse exports JSON
        CASE 
          WHEN i.exports IS NOT NULL AND i.exports != '{}' 
          THEN i.exports 
          ELSE NULL 
        END as exports

      FROM dispatch_instruction i
      INNER JOIN dispatch_patient p ON i.patient_id = p.id
      
      WHERE i.deleted = false
      ORDER BY i.id
    `;

    try {
      console.log('🚀 Extracting raw orders from source database...');
      const startTime = Date.now();
      
      const result = await this.sourcePool.query(query);
      
      const duration = Date.now() - startTime;
      console.log(`✓ Extracted ${result.rows.length} raw orders in ${duration}ms`);
      
      return result.rows;
    } catch (error) {
      console.error('❌ Error extracting raw orders:', error);
      throw error;
    }
  }

  /**
   * Build lookup maps for UUIDs from target database
   */
  private async buildLookupMaps() {
    console.log('🗺️ Building UUID lookup maps...');
    const startTime = Date.now();

    // Get patient UUID lookup map
    const patientMap = new Map<number, string>();
    const patientResult = await this.targetPool.query(`
      SELECT legacy_user_id, id 
      FROM patients 
      WHERE legacy_user_id IS NOT NULL
    `);
    patientResult.rows.forEach(row => {
      patientMap.set(row.legacy_user_id, row.id);
    });
    console.log(`✓ Built patient lookup map: ${patientMap.size} entries`);

    // Get doctor UUID lookup map
    const doctorMap = new Map<number, string>();
    const doctorResult = await this.targetPool.query(`
      SELECT legacy_user_id, id 
      FROM profiles 
      WHERE profile_type = 'doctor' AND legacy_user_id IS NOT NULL
    `);
    doctorResult.rows.forEach(row => {
      doctorMap.set(row.legacy_user_id, row.id);
    });
    console.log(`✓ Built doctor lookup map: ${doctorMap.size} entries`);

    // Get office UUID lookup map (optional)
    const officeMap = new Map<number, string>();
    const officeResult = await this.targetPool.query(`
      SELECT legacy_office_id, id 
      FROM offices 
      WHERE legacy_office_id IS NOT NULL
    `);
    officeResult.rows.forEach(row => {
      officeMap.set(row.legacy_office_id, row.id);
    });
    console.log(`✓ Built office lookup map: ${officeMap.size} entries`);

    const duration = Date.now() - startTime;
    console.log(`✓ All lookup maps built in ${duration}ms`);

    return { patientMap, doctorMap, officeMap };
  }

  /**
   * Resolve UUIDs and create final order records
   */
  private async resolveOrderRecords(rawOrders: RawOrderRecord[]): Promise<OrderRecord[]> {
    console.log('🔗 Resolving UUIDs for orders...');
    const startTime = Date.now();

    const { patientMap, doctorMap, officeMap } = await this.buildLookupMaps();

    const resolvedOrders: OrderRecord[] = [];
    let skippedCount = 0;

    for (const rawOrder of rawOrders) {
      // Resolve patient UUID
      const patientId = patientMap.get(rawOrder.legacy_user_id);
      if (!patientId) {
        skippedCount++;
        console.warn(`⚠️ Skipping order ${rawOrder.legacy_instruction_id}: Patient not found for legacy_user_id ${rawOrder.legacy_user_id}`);
        continue;
      }

      // Resolve doctor UUID
      const doctorId = doctorMap.get(rawOrder.legacy_doctor_id);
      if (!doctorId) {
        skippedCount++;
        console.warn(`⚠️ Skipping order ${rawOrder.legacy_instruction_id}: Doctor not found for legacy_user_id ${rawOrder.legacy_doctor_id}`);
        continue;
      }

      // Resolve office UUID (optional)
      const officeId = rawOrder.legacy_office_id ? officeMap.get(rawOrder.legacy_office_id) : null;

      // Create resolved order record
      resolvedOrders.push({
        legacy_instruction_id: rawOrder.legacy_instruction_id,
        order_number: rawOrder.order_number,
        patient_id: patientId,
        doctor_id: doctorId,
        office_id: officeId || undefined,
        course_type: rawOrder.course_type,
        status: rawOrder.status,
        notes: rawOrder.notes,
        complaint: rawOrder.complaint,
        amount: rawOrder.amount,
        submitted_at: rawOrder.submitted_at,
        approved_at: rawOrder.approved_at,
        shipped_at: rawOrder.shipped_at,
        metadata: rawOrder.metadata,
        exports: rawOrder.exports
      });
    }

    const duration = Date.now() - startTime;
    console.log(`✓ Resolved ${resolvedOrders.length} orders, skipped ${skippedCount} in ${duration}ms`);

    return resolvedOrders;
  }

  /**
   * High-performance batch insert using multi-row VALUES
   */
  private async batchInsertOrders(orders: OrderRecord[]): Promise<void> {
    console.log(`🚀 Starting batch insert of ${orders.length} orders...`);
    
    let totalInserted = 0;
    const startTime = Date.now();
    
    for (let i = 0; i < orders.length; i += this.batchSize) {
      const batch = orders.slice(i, i + this.batchSize);
      const batchStartTime = Date.now();
      
      try {
        // Build parameterized multi-row INSERT
        const placeholders = batch.map((_, index) => {
          const base = index * 15; // 15 parameters per order
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, NOW(), NOW(), false, NULL, $${base + 13}::jsonb, $${base + 14}::jsonb, $${base + 15})`;
        }).join(',');

        const insertQuery = `
          INSERT INTO orders (
            order_number, patient_id, doctor_id, office_id, course_type, status,
            notes, complaint, amount, submitted_at, approved_at, shipped_at,
            created_at, updated_at, deleted, deleted_at, metadata, exports, legacy_instruction_id
          ) VALUES ${placeholders}
          ON CONFLICT (legacy_instruction_id) DO NOTHING
        `;

        // Flatten values array with proper null handling
        const values = batch.flatMap(order => [
          order.order_number,                                    // $1
          order.patient_id,                                      // $2
          order.doctor_id,                                       // $3
          order.office_id || null,                              // $4
          order.course_type,                                     // $5
          order.status,                                          // $6
          order.notes || null,                                   // $7
          order.complaint || null,                               // $8
          order.amount || null,                                  // $9
          order.submitted_at || null,                            // $10
          order.approved_at || null,                             // $11
          order.shipped_at || null,                              // $12
          order.metadata,                                        // $13 (will be cast to jsonb)
          order.exports || null,                                 // $14 (will be cast to jsonb)
          order.legacy_instruction_id                            // $15
        ]);

        const result = await this.targetPool.query(insertQuery, values);
        const inserted = result.rowCount || 0;
        totalInserted += inserted;
        this.stats.inserted += inserted;
        this.stats.skipped += (batch.length - inserted);
        this.stats.totalProcessed += batch.length;

        const batchDuration = Date.now() - batchStartTime;
        const batchThroughput = Math.round((batch.length / batchDuration) * 1000);
        
        console.log(`✓ Batch ${Math.floor(i / this.batchSize) + 1}/${Math.ceil(orders.length / this.batchSize)}: ${inserted}/${batch.length} orders in ${batchDuration}ms (${batchThroughput} rec/sec)`);

      } catch (error) {
        this.stats.errors += batch.length;
        console.error(`❌ Error in batch ${Math.floor(i / this.batchSize) + 1}:`, error);
        
        // Try individual inserts for this batch to identify problematic records
        await this.fallbackIndividualInserts(batch);
      }
    }

    const totalDuration = Date.now() - startTime;
    const avgThroughput = Math.round((totalInserted / totalDuration) * 1000);
    console.log(`✅ Completed batch insert: ${totalInserted} orders in ${totalDuration}ms (${avgThroughput} avg rec/sec)`);
  }

  /**
   * Fallback method for problematic batches - insert one by one
   */
  private async fallbackIndividualInserts(orders: OrderRecord[]): Promise<void> {
    console.log(`🔄 Fallback: inserting ${orders.length} orders individually...`);
    
    for (const order of orders) {
      try {
        const insertQuery = `
          INSERT INTO orders (
            order_number, patient_id, doctor_id, office_id, course_type, status,
            notes, complaint, amount, submitted_at, approved_at, shipped_at,
            created_at, updated_at, deleted, deleted_at, metadata, exports, legacy_instruction_id
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 
            NOW(), NOW(), false, NULL, $13::jsonb, $14::jsonb, $15
          )
          ON CONFLICT (legacy_instruction_id) DO NOTHING
        `;

        const values = [
          order.order_number,
          order.patient_id,
          order.doctor_id,
          order.office_id || null,
          order.course_type,
          order.status,
          order.notes || null,
          order.complaint || null,
          order.amount || null,
          order.submitted_at || null,
          order.approved_at || null,
          order.shipped_at || null,
          order.metadata,
          order.exports || null,
          order.legacy_instruction_id
        ];

        const result = await this.targetPool.query(insertQuery, values);
        if (result.rowCount && result.rowCount > 0) {
          this.stats.inserted++;
        } else {
          this.stats.skipped++;
        }

      } catch (error) {
        this.stats.errors++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`❌ Failed to insert order ${order.legacy_instruction_id}:`, errorMessage);
      }
    }
  }

  /**
   * Main migration function
   */
  public async migrate(): Promise<MigrationStats> {
    console.log('🚀 Starting HIGH-PERFORMANCE orders migration...');
    console.log('📊 Target: ~23,272 orders');
    console.log('⚡ Method: Two-step extraction + batch INSERT');

    try {
      // Step 1: Extract raw orders from source database
      const rawOrders = await this.extractRawOrders();
      
      if (rawOrders.length === 0) {
        console.log('ℹ️ No orders found to migrate');
        return this.stats;
      }

      console.log(`📦 Found ${rawOrders.length} raw orders to process`);

      // Step 2: Resolve UUIDs and create final order records
      const resolvedOrders = await this.resolveOrderRecords(rawOrders);

      if (resolvedOrders.length === 0) {
        console.log('⚠️ No orders could be resolved (missing patients/doctors)');
        return this.stats;
      }

      console.log(`🔗 Resolved ${resolvedOrders.length} orders with valid references`);

      // Step 3: Batch insert resolved orders
      await this.batchInsertOrders(resolvedOrders);

      this.stats.endTime = new Date();
      const totalDuration = this.stats.endTime.getTime() - this.stats.startTime.getTime();
      const finalThroughput = Math.round((this.stats.inserted / totalDuration) * 1000);

      // Final summary
      console.log('\n📋 Orders Migration Summary:');
      console.log(`⏱️ Total Duration: ${totalDuration}ms (${(totalDuration / 1000).toFixed(1)}s)`);
      console.log(`📊 Total Processed: ${this.stats.totalProcessed}`);
      console.log(`✅ Successfully Inserted: ${this.stats.inserted}`);
      console.log(`⏭️ Skipped (duplicates): ${this.stats.skipped}`);
      console.log(`❌ Errors: ${this.stats.errors}`);
      console.log(`⚡ Average Throughput: ${finalThroughput} records/second`);

      this.stats.throughputPerSecond = finalThroughput;
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
    console.log('🔍 Validating orders migration...');

    try {
      // Count source records (non-deleted)
      const sourceCount = await this.sourcePool.query(`
        SELECT COUNT(*) as count 
        FROM dispatch_instruction i
        INNER JOIN dispatch_patient p ON i.patient_id = p.id
        WHERE i.deleted = false
      `);

      // Count target records
      const targetCount = await this.targetPool.query(`
        SELECT COUNT(*) as count 
        FROM orders 
        WHERE legacy_instruction_id IS NOT NULL
      `);

      // Check status distribution
      const statusDistribution = await this.targetPool.query(`
        SELECT status, COUNT(*) as count
        FROM orders 
        WHERE legacy_instruction_id IS NOT NULL
        GROUP BY status
        ORDER BY count DESC
      `);

      // Check course type distribution
      const courseTypeDistribution = await this.targetPool.query(`
        SELECT course_type, COUNT(*) as count
        FROM orders 
        WHERE legacy_instruction_id IS NOT NULL
        GROUP BY course_type
        ORDER BY count DESC
      `);

      // Check for missing patient/doctor relationships
      const missingPatients = await this.targetPool.query(`
        SELECT COUNT(*) as count
        FROM orders o
        WHERE legacy_instruction_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM patients p WHERE p.id = o.patient_id)
      `);

      const missingDoctors = await this.targetPool.query(`
        SELECT COUNT(*) as count
        FROM orders o
        WHERE legacy_instruction_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM profiles pr WHERE pr.id = o.doctor_id AND pr.profile_type = 'doctor')
      `);

      // Check for orders with amounts
      const ordersWithAmounts = await this.targetPool.query(`
        SELECT COUNT(*) as with_amounts, AVG(amount) as avg_amount
        FROM orders 
        WHERE legacy_instruction_id IS NOT NULL AND amount IS NOT NULL
      `);

      const validation = {
        source_count: parseInt(sourceCount.rows[0].count),
        target_count: parseInt(targetCount.rows[0].count),
        status_distribution: statusDistribution.rows,
        course_type_distribution: courseTypeDistribution.rows,
        missing_patients: parseInt(missingPatients.rows[0].count),
        missing_doctors: parseInt(missingDoctors.rows[0].count),
        orders_with_amounts: ordersWithAmounts.rows[0],
        success: true
      };

      // Validation checks
      if (validation.target_count !== validation.source_count) {
        const diff = Math.abs(validation.target_count - validation.source_count);
        if (diff > validation.source_count * 0.01) { // Allow 1% difference
          validation.success = false;
          console.log(`❌ Significant count mismatch: Source ${validation.source_count} vs Target ${validation.target_count}`);
        } else {
          console.log(`⚠️ Minor count difference: Source ${validation.source_count} vs Target ${validation.target_count} (within 1%)`);
        }
      }

      if (validation.missing_patients > 0) {
        validation.success = false;
        console.log(`❌ Found ${validation.missing_patients} orders with missing patient references`);
      }

      if (validation.missing_doctors > 0) {
        validation.success = false;
        console.log(`❌ Found ${validation.missing_doctors} orders with missing doctor references`);
      }

      console.log('\n📊 Migration Validation Results:');
      console.log(`📈 Status Distribution:`, validation.status_distribution);
      console.log(`📦 Course Type Distribution:`, validation.course_type_distribution);
      console.log(`💰 Orders with amounts: ${validation.orders_with_amounts.with_amounts}, avg: $${validation.orders_with_amounts.avg_amount || 0}`);

      return { success: validation.success, details: validation };

    } catch (error) {
      console.error('❌ Validation failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, details: { error: errorMessage } };
    }
  }

  /**
   * Rollback migration
   */
  public async rollback(): Promise<void> {
    console.log('🔄 Rolling back orders migration...');
    
    try {
      const result = await this.targetPool.query(`
        DELETE FROM orders 
        WHERE legacy_instruction_id IS NOT NULL
      `);
      
      console.log(`✅ Rollback completed: ${result.rowCount} orders deleted`);
      
    } catch (error) {
      console.error('❌ Rollback failed:', error);
      throw error;
    }
  }

  /**
   * Cleanup connections
   */
  private async cleanup(): Promise<void> {
    try {
      await this.sourcePool.end();
      await this.targetPool.end();
      console.log('🧹 Database connections closed');
    } catch (error) {
      console.error('⚠️ Error during cleanup:', error);
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'migrate';

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

  const migrationService = new OrdersMigrationService(sourceConfig, targetConfig);

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
        console.log('Usage: npm run migrate:orders [migrate|validate|rollback]');
        process.exit(1);
    }
    
    process.exit(0);
    
  } catch (error) {
    console.error('💥 Operation failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { OrdersMigrationService };
