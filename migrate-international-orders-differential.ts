import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

interface DispatchInstruction {
  id: number;
  notes: string | null;
  status: number;
  submitted_at: Date | null;
  patient_id: number;
  office_id: number;
  office_country: string;
  office_name: string;
}

interface InternationalOrdersMigrationStats {
  totalInternationalInstructions: number;
  existingOrders: number;
  migratedOrders: number;
  skippedOrders: number;
  errors: number;
  countriesCovered: string[];
  startTime: Date;
  endTime?: Date;
}

class InternationalOrdersMigration {
  private sourcePool: Pool;
  private targetPool: Pool;
  private stats: InternationalOrdersMigrationStats;
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
      host: process.env.TARGET_DB_HOST || 'localhost',
      port: parseInt(process.env.TARGET_DB_PORT || '54322'),
      database: process.env.TARGET_DB_NAME || 'postgres',
      user: process.env.TARGET_DB_USER || 'supabase_admin',
      password: process.env.TARGET_DB_PASSWORD || 'postgres',
    });

    this.stats = {
      totalInternationalInstructions: 0,
      existingOrders: 0,
      migratedOrders: 0,
      skippedOrders: 0,
      errors: 0,
      countriesCovered: [],
      startTime: new Date(),
    };
  }

  /**
   * Get international orders from source that are missing in target
   */
  private async getMissingInternationalOrders(): Promise<DispatchInstruction[]> {
    console.log('🔍 Analyzing international orders in source database...');

    // Get all international orders from source
    const sourceQuery = `
      SELECT
        di.id,
        di.notes,
        di.status,
        di.submitted_at,
        di.patient_id,
        dp.office_id,
        doff.country as office_country,
        doff.name as office_name
      FROM dispatch_instruction di
      INNER JOIN dispatch_patient dp ON di.patient_id = dp.id
      INNER JOIN dispatch_office doff ON dp.office_id = doff.id
      WHERE doff.country IS NOT NULL
        AND UPPER(doff.country) NOT IN ('USA', 'US', 'UNITED STATES', 'UNITED STATES OF AMERICA')
      ORDER BY doff.country, di.id;
    `;

    const sourceResult = await this.sourcePool.query(sourceQuery);
    const internationalInstructions = sourceResult.rows;
    this.stats.totalInternationalInstructions = internationalInstructions.length;

    // Get countries covered
    const countries = new Set(internationalInstructions.map(i => i.office_country));
    this.stats.countriesCovered = Array.from(countries);

    console.log(`✓ Found ${this.stats.totalInternationalInstructions} international orders from ${countries.size} countries:`);
    this.stats.countriesCovered.forEach(country => {
      const countryCount = internationalInstructions.filter(i => i.office_country === country).length;
      console.log(`   ${country}: ${countryCount} orders`);
    });

    // Check which orders already exist in target
    console.log('\n🔍 Checking existing orders in target database...');

    const existingOrdersQuery = `
      SELECT legacy_instruction_id
      FROM orders
      WHERE legacy_instruction_id = ANY($1)
    `;

    const instructionIds = internationalInstructions.map(i => i.id);
    const existingResult = await this.targetPool.query(existingOrdersQuery, [instructionIds]);
    const existingOrderIds = new Set(existingResult.rows.map(row => row.legacy_instruction_id));

    this.stats.existingOrders = existingOrderIds.size;
    console.log(`✓ Found ${this.stats.existingOrders} international orders already migrated`);

    // Filter to only missing orders
    const missingOrders = internationalInstructions.filter(instruction =>
      !existingOrderIds.has(instruction.id)
    );

    console.log(`✓ Identified ${missingOrders.length} missing international orders to migrate`);

    return missingOrders;
  }

  /**
   * Get required mappings for order migration
   */
  private async getMappings(): Promise<{
    patientMappings: Map<number, string>,
    officeMappings: Map<number, string>
  }> {
    console.log('\n📋 Loading UUID mappings...');

    const [patientMappingsResult, officeMappingsResult] = await Promise.all([
      this.targetPool.query(`
        SELECT legacy_patient_id, id
        FROM patients
        WHERE legacy_patient_id IS NOT NULL
      `),
      this.targetPool.query(`
        SELECT legacy_office_id, id
        FROM offices
        WHERE legacy_office_id IS NOT NULL
      `)
    ]);

    const patientMappings = new Map<number, string>();
    const officeMappings = new Map<number, string>();

    patientMappingsResult.rows.forEach(row => {
      patientMappings.set(row.legacy_patient_id, row.id);
    });

    officeMappingsResult.rows.forEach(row => {
      officeMappings.set(row.legacy_office_id, row.id);
    });

    console.log(`✓ Loaded ${patientMappings.size} patient mappings`);
    console.log(`✓ Loaded ${officeMappings.size} office mappings`);

    return { patientMappings, officeMappings };
  }

  /**
   * Map order status to target enum
   */
  private mapOrderStatus(status: number): 'pending' | 'in_progress' | 'completed' | 'cancelled' {
    switch (status) {
      case 0: return 'pending';      // NEW
      case 1: return 'in_progress';  // IN_PROGRESS
      case 2: return 'completed';    // COMPLETED
      case 3: return 'cancelled';    // CANCELLED
      default: return 'pending';
    }
  }

  /**
   * Migrate missing international orders in batches
   */
  private async migrateOrdersBatch(
    orders: DispatchInstruction[],
    patientMappings: Map<number, string>,
    officeMappings: Map<number, string>
  ): Promise<void> {
    if (orders.length === 0) return;

    console.log(`📦 Migrating batch of ${orders.length} international orders...`);

    const orderRecords = orders.map(order => {
      const patientUuid = patientMappings.get(order.patient_id);
      const officeUuid = officeMappings.get(order.office_id);

      if (!patientUuid) {
        console.log(`⚠️  Skipping order ${order.id} - no patient mapping for patient_id ${order.patient_id}`);
        return null;
      }

      if (!officeUuid) {
        console.log(`⚠️  Skipping order ${order.id} - no office mapping for office_id ${order.office_id}`);
        return null;
      }

      return {
        patient_id: patientUuid,
        office_id: officeUuid,
        status: this.mapOrderStatus(order.status),
        notes: order.notes,
        submitted_at: order.submitted_at,
        legacy_instruction_id: order.id,
        metadata: JSON.stringify({
          source_office_country: order.office_country,
          source_office_name: order.office_name,
          source_patient_id: order.patient_id,
          source_office_id: order.office_id,
          migrated_at: new Date().toISOString(),
          migration_type: 'international_differential'
        })
      };
    }).filter(record => record !== null);

    console.log(`   → ${orderRecords.length}/${orders.length} orders have required mappings`);

    if (orderRecords.length === 0) {
      this.stats.skippedOrders += orders.length;
      return;
    }

    try {
      // Insert batch
      const insertQuery = `
        INSERT INTO orders (
          patient_id, office_id, status, notes, submitted_at,
          legacy_instruction_id, metadata, created_at, updated_at
        ) VALUES ${orderRecords.map((_, i) =>
          `($${i * 7 + 1}, $${i * 7 + 2}, $${i * 7 + 3}, $${i * 7 + 4}, $${i * 7 + 5}, $${i * 7 + 6}, $${i * 7 + 7}, NOW(), NOW())`
        ).join(', ')}
        ON CONFLICT (legacy_instruction_id) DO NOTHING
      `;

      const values = orderRecords.flatMap(order => [
        order.patient_id,
        order.office_id,
        order.status,
        order.notes,
        order.submitted_at,
        order.legacy_instruction_id,
        order.metadata
      ]);

      const result = await this.targetPool.query(insertQuery, values);
      const insertedCount = result.rowCount || 0;

      this.stats.migratedOrders += insertedCount;
      this.stats.skippedOrders += (orders.length - insertedCount);

      console.log(`✅ Successfully migrated ${insertedCount} international orders`);

      // Show sample of what was migrated
      if (insertedCount > 0) {
        const sampleOrder = orderRecords[0];
        const metadata = JSON.parse(sampleOrder.metadata);
        console.log(`   📋 Sample: Order from ${metadata.source_office_country} (${metadata.source_office_name})`);
      }

    } catch (error) {
      this.stats.errors++;
      console.error(`❌ Error migrating international orders batch:`, error);
    }
  }

  /**
   * Main migration function
   */
  public async executeInternationalOrdersMigration(): Promise<InternationalOrdersMigrationStats> {
    console.log('🚀 Starting International Orders Differential Migration...\n');

    try {
      // Get missing international orders and mappings
      const [missingOrders, mappings] = await Promise.all([
        this.getMissingInternationalOrders(),
        this.getMappings()
      ]);

      const { patientMappings, officeMappings } = mappings;

      if (missingOrders.length === 0) {
        console.log('🎉 All international orders are already migrated!');
        this.stats.endTime = new Date();
        return this.stats;
      }

      console.log('\n🔄 Starting batch migration...');

      // Process in batches
      for (let i = 0; i < missingOrders.length; i += this.batchSize) {
        const batchStartTime = Date.now();
        const batch = missingOrders.slice(i, i + this.batchSize);

        await this.migrateOrdersBatch(batch, patientMappings, officeMappings);

        const batchDuration = Date.now() - batchStartTime;
        const recordsPerSecond = (batch.length / batchDuration * 1000).toFixed(0);
        console.log(`   ⚡ Batch ${Math.floor(i / this.batchSize) + 1} completed in ${batchDuration}ms (${recordsPerSecond} records/sec)`);
      }

      this.stats.endTime = new Date();

      // Final summary
      console.log('\n📋 International Orders Migration Summary:');
      console.log(`⏱️  Duration: ${this.stats.endTime.getTime() - this.stats.startTime.getTime()}ms`);
      console.log(`🌍 Countries: ${this.stats.countriesCovered.join(', ')}`);
      console.log(`📊 Source International Orders: ${this.stats.totalInternationalInstructions}`);
      console.log(`✅ Already Migrated: ${this.stats.existingOrders}`);
      console.log(`🆕 Newly Migrated: ${this.stats.migratedOrders}`);
      console.log(`⏭️  Skipped: ${this.stats.skippedOrders}`);
      console.log(`❌ Errors: ${this.stats.errors}`);

      const successRate = this.stats.totalInternationalInstructions > 0
        ? ((this.stats.migratedOrders + this.stats.existingOrders) / this.stats.totalInternationalInstructions * 100).toFixed(2)
        : 100;
      console.log(`📈 Overall Success Rate: ${successRate}%`);

      if (this.stats.migratedOrders > 0) {
        console.log(`\n🎉 Successfully migrated ${this.stats.migratedOrders} missing international orders!`);
        console.log('🌍 International patients now have complete order history');
      }

      return this.stats;

    } catch (error) {
      console.error('💥 International orders migration failed:', error);
      throw error;
    }
  }

  /**
   * Validate the migration results
   */
  public async validateMigration(): Promise<void> {
    console.log('\n🔍 Validating international orders migration...');

    try {
      const validationQuery = `
        SELECT
          o.country,
          COUNT(DISTINCT p.id) as total_patients,
          COUNT(DISTINCT orders.id) as order_count,
          COUNT(CASE WHEN orders.legacy_instruction_id IS NOT NULL THEN 1 END) as migrated_orders,
          ROUND(COUNT(DISTINCT orders.id)::decimal / NULLIF(COUNT(DISTINCT p.id), 0) * 100, 2) as orders_per_patient_pct
        FROM offices o
        INNER JOIN patients_doctors_offices pdo ON pdo.office_id = o.id
        INNER JOIN patients p ON p.id = pdo.patient_id
        LEFT JOIN orders ON orders.patient_id = p.id
        WHERE o.country IS NOT NULL
          AND UPPER(o.country) NOT IN ('USA', 'US', 'UNITED STATES', 'UNITED STATES OF AMERICA')
        GROUP BY o.country
        ORDER BY order_count DESC;
      `;

      const result = await this.targetPool.query(validationQuery);

      console.log('📊 International Orders Validation:');

      if (result.rows.length === 0) {
        console.log('⚠️  No international orders found - this indicates an issue with the migration or relationships');
      } else {
        result.rows.forEach(row => {
          console.log(`   ${row.country}: ${row.order_count} orders for ${row.total_patients} patients (${row.orders_per_patient_pct}% coverage)`);
        });
      }

      console.log('\n✅ Validation completed');

    } catch (error) {
      console.error('❌ Validation failed:', error);
    }
  }

  /**
   * Cleanup connections
   */
  public async cleanup(): Promise<void> {
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

  const migration = new InternationalOrdersMigration();

  try {
    switch (command) {
      case 'migrate':
        await migration.executeInternationalOrdersMigration();
        await migration.validateMigration();
        break;

      case 'validate':
        await migration.validateMigration();
        break;

      default:
        console.log('Usage: npx ts-node migrate-international-orders-differential.ts [migrate|validate]');
        process.exit(1);
    }

    process.exit(0);

  } catch (error) {
    console.error('💥 Operation failed:', error);
    process.exit(1);
  } finally {
    // Cleanup is handled here to ensure validation can run before pools are closed
    if (migration) {
      await migration.cleanup();
    }
  }
}

// Export for use as module
export { InternationalOrdersMigration };

// Run if called directly
if (require.main === module) {
  main();
}