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
  instruction_id: number;
  patient_legacy_id: number;
  doctor_legacy_id: number;
  office_legacy_id: number;
  course_type_id: number;
  course_name: string;
  status: number;
  notes?: string;
  price?: number;
  submitted_at?: string;
  updated_at?: string;
  exports?: string;
}

interface OrderRecord {
  id: string;                     // Generated UUID
  order_number: string;           // Generated order number
  patient_id: string;             // Resolved UUID
  doctor_id: string;              // Resolved UUID
  office_id?: string;             // Resolved UUID (optional)
  course_type: 'main' | 'refinement' | 'any' | 'replacement' | 'invoice' | 'merchandise';
  status: 'no_product' | 'submitted' | 'approved' | 'in_production' | 'shipped' | 'add_plan' | 'on_hold' | 'cancelled';
  notes?: string;
  complaint?: string;
  amount?: number;
  submitted_at?: string;
  approved_at?: string;
  shipped_at?: string;
  created_at: string;
  updated_at: string;
  deleted: boolean;
  metadata: any;
  exports: any;
  legacy_instruction_id: number;
}

interface MigrationStats {
  total_source_records: number;
  processed_records: number;
  successful_migrations: number;
  skipped_records: number;
  error_records: number;
  missing_patients: number;
  missing_doctors: number;
  missing_offices: number;
}

/**
 * Get database configuration from environment variables
 */
function getSourceConfig(): DatabaseConfig {
  return {
    host: process.env.SOURCE_DB_HOST!,
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME!,
    username: process.env.SOURCE_DB_USER!,
    password: process.env.SOURCE_DB_PASSWORD!,
  };
}

function getTargetConfig(): DatabaseConfig {
  return {
    host: process.env.TARGET_DB_HOST!,
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    database: process.env.TARGET_DB_NAME!,
    username: process.env.TARGET_DB_USER!,
    password: process.env.TARGET_DB_PASSWORD!,
  };
}

/**
 * Create database connection pools
 */
function createSourcePool(): Pool {
  const config = getSourceConfig();
  return new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
}

function createTargetPool(): Pool {
  const config = getTargetConfig();
  return new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
}

/**
 * Map legacy course type ID to course_type enum
 */
function mapCourseType(courseTypeId: number): 'main' | 'refinement' | 'any' | 'replacement' | 'invoice' | 'merchandise' {
  switch (courseTypeId) {
    case 1: return 'main';
    case 2: return 'refinement';
    case 3: return 'any';
    case 4: return 'replacement';
    case 5: return 'invoice';
    case 6: return 'merchandise';
    default: return 'main'; // default to main for unknown types
  }
}

/**
 * Map legacy status to order_status enum
 */
function mapOrderStatus(status: number): 'no_product' | 'submitted' | 'approved' | 'in_production' | 'shipped' | 'add_plan' | 'on_hold' | 'cancelled' {
  switch (status) {
    case 0: return 'no_product';
    case 1: return 'submitted';
    case 2: return 'on_hold';
    case 4: return 'approved';
    default: return 'submitted'; // default to submitted for unknown status
  }
}

/**
 * Generate order number in the format ORD-{timestamp}-{counter}
 */
function generateOrderNumber(instructionId: number): string {
  const timestamp = Date.now().toString().slice(-8); // last 8 digits of timestamp
  return `ORD-${timestamp}-${instructionId.toString().padStart(6, '0')}`;
}

/**
 * Generate UUID v4
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Extract raw orders from source database with all relationships
 */
async function extractRawOrders(sourcePool: Pool, batchSize: number, offset: number): Promise<RawOrderRecord[]> {
  const query = `
    SELECT 
      di.id as instruction_id,
      dp.user_id as patient_legacy_id,
      dp.doctor_id as doctor_legacy_id,
      dp.office_id as office_legacy_id,
      COALESCE(dc.type, 1) as course_type_id,
      COALESCE(dc.name, 'Main') as course_name,
      di.status,
      di.notes,
      di.price,
      di.submitted_at,
      di.updated_at,
      di.exports
    FROM dispatch_instruction di
    JOIN dispatch_patient dp ON di.patient_id = dp.id
    LEFT JOIN dispatch_course dc ON di.course_id = dc.id
    WHERE di.deleted IS NOT TRUE
    ORDER BY di.id
    LIMIT $1 OFFSET $2
  `;
  
  const result = await sourcePool.query(query, [batchSize, offset]);
  return result.rows as RawOrderRecord[];
}

/**
 * Build lookup maps for UUID resolution
 */
async function buildLookupMaps(targetPool: Pool) {
  console.log('📋 Building UUID lookup maps...');
  
  // Build patient lookup map
  const patientQuery = "SELECT legacy_user_id as legacy_id, id as new_id FROM patients WHERE legacy_user_id IS NOT NULL";
  const patientResult = await targetPool.query(patientQuery);
  const patientMap = new Map<number, string>();
  patientResult.rows.forEach(row => {
    patientMap.set(row.legacy_id, row.new_id);
  });
  
  // Build doctor lookup map (assuming doctors use legacy_user_id)
  const doctorQuery = "SELECT legacy_user_id as legacy_id, id as new_id FROM doctors WHERE legacy_user_id IS NOT NULL";
  const doctorResult = await targetPool.query(doctorQuery);
  const doctorMap = new Map<number, string>();
  doctorResult.rows.forEach(row => {
    doctorMap.set(row.legacy_id, row.new_id);
  });
  
  // Build office lookup map
  const officeQuery = "SELECT legacy_id, new_id FROM migration_mappings WHERE entity_type = 'office'";
  const officeResult = await targetPool.query(officeQuery);
  const officeMap = new Map<number, string>();
  officeResult.rows.forEach(row => {
    officeMap.set(row.legacy_id, row.new_id);
  });
  
  console.log(`✅ Built lookup maps: ${patientMap.size} patients, ${doctorMap.size} doctors, ${officeMap.size} offices`);
  
  return { patientMap, doctorMap, officeMap };
}

/**
 * Transform raw orders to target format with UUID resolution
 */
function transformOrders(
  rawOrders: RawOrderRecord[], 
  patientMap: Map<number, string>,
  doctorMap: Map<number, string>,
  officeMap: Map<number, string>,
  stats: MigrationStats
): OrderRecord[] {
  const transformedOrders: OrderRecord[] = [];
  
  for (const raw of rawOrders) {
    stats.processed_records++;
    
    // Resolve patient UUID
    const patientId = patientMap.get(raw.patient_legacy_id);
    if (!patientId) {
      console.log(`⚠️  Patient not found for legacy ID ${raw.patient_legacy_id}, instruction ${raw.instruction_id}`);
      stats.missing_patients++;
      stats.skipped_records++;
      continue;
    }
    
    // Resolve doctor UUID
    const doctorId = doctorMap.get(raw.doctor_legacy_id);
    if (!doctorId) {
      console.log(`⚠️  Doctor not found for legacy ID ${raw.doctor_legacy_id}, instruction ${raw.instruction_id}`);
      stats.missing_doctors++;
      stats.skipped_records++;
      continue;
    }
    
    // Resolve office UUID (optional)
    const officeId = raw.office_legacy_id ? officeMap.get(raw.office_legacy_id) : undefined;
    if (raw.office_legacy_id && !officeId) {
      console.log(`⚠️  Office not found for legacy ID ${raw.office_legacy_id}, instruction ${raw.instruction_id}`);
      stats.missing_offices++;
      // Continue without office - it's optional
    }
    
    // Parse exports JSON
    let exports = {};
    if (raw.exports) {
      try {
        exports = JSON.parse(raw.exports);
      } catch (e) {
        exports = { raw_exports: raw.exports };
      }
    }
    
    const now = new Date().toISOString();
    
    const transformedOrder: OrderRecord = {
      id: generateUUID(),
      order_number: generateOrderNumber(raw.instruction_id),
      patient_id: patientId,
      doctor_id: doctorId,
      office_id: officeId,
      course_type: mapCourseType(raw.course_type_id),
      status: mapOrderStatus(raw.status),
      notes: raw.notes || undefined,
      complaint: undefined, // Not available in legacy data
      amount: raw.price,
      submitted_at: raw.submitted_at,
      approved_at: raw.status === 4 ? raw.submitted_at : undefined, // Approximate approved time for status 4
      shipped_at: undefined, // Not available in legacy data
      created_at: raw.submitted_at || now,
      updated_at: raw.updated_at || now,
      deleted: false,
      metadata: {
        legacy_course_name: raw.course_name,
        migration_batch: `orders-migration-${Date.now()}`,
        migrated_at: now
      },
      exports: exports,
      legacy_instruction_id: raw.instruction_id
    };
    
    transformedOrders.push(transformedOrder);
  }
  
  return transformedOrders;
}

/**
 * Insert orders in batch
 */
async function insertOrdersBatch(targetPool: Pool, orders: OrderRecord[]): Promise<number> {
  if (orders.length === 0) return 0;
  
  const client = await targetPool.connect();
  try {
    await client.query('BEGIN');
    
    let insertedCount = 0;
    for (const order of orders) {
      const query = `
        INSERT INTO orders (
          id, order_number, patient_id, doctor_id, office_id, course_type, status,
          notes, complaint, amount, submitted_at, approved_at, shipped_at,
          created_at, updated_at, deleted, metadata, exports, legacy_instruction_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      `;
      
      const values = [
        order.id,
        order.order_number,
        order.patient_id,
        order.doctor_id,
        order.office_id,
        order.course_type,
        order.status,
        order.notes,
        order.complaint,
        order.amount,
        order.submitted_at,
        order.approved_at,
        order.shipped_at,
        order.created_at,
        order.updated_at,
        order.deleted,
        JSON.stringify(order.metadata),
        JSON.stringify(order.exports),
        order.legacy_instruction_id
      ];
      
      await client.query(query, values);
      insertedCount++;
    }
    
    await client.query('COMMIT');
    return insertedCount;
    
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Update migration mappings for orders
 */
async function updateOrderMappings(targetPool: Pool, orders: OrderRecord[]): Promise<void> {
  if (orders.length === 0) return;
  
  const client = await targetPool.connect();
  try {
    await client.query('BEGIN');
    
    for (const order of orders) {
      const query = `
        INSERT INTO migration_mappings (entity_type, legacy_id, new_id, migrated_at, migration_batch)
        VALUES ('order', $1, $2, NOW(), 'orders-comprehensive-migration')
      `;
      
      await client.query(query, [order.legacy_instruction_id, order.id]);
    }
    
    await client.query('COMMIT');
    
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Validate migration results
 */
async function validateMigration(sourcePool: Pool, targetPool: Pool): Promise<boolean> {
  console.log('🔍 Validating migration results...');
  
  // Count source records
  const sourceCountResult = await sourcePool.query("SELECT COUNT(*) FROM dispatch_instruction WHERE deleted IS NOT TRUE");
  const sourceCount = parseInt(sourceCountResult.rows[0].count);
  
  // Count target records
  const targetCountResult = await targetPool.query("SELECT COUNT(*) FROM orders");
  const targetCount = parseInt(targetCountResult.rows[0].count);
  
  // Count mappings
  const mappingCountResult = await targetPool.query("SELECT COUNT(*) FROM migration_mappings WHERE entity_type = 'order'");
  const mappingCount = parseInt(mappingCountResult.rows[0].count);
  
  console.log(`📊 Migration validation:`);
  console.log(`   Source records: ${sourceCount}`);
  console.log(`   Target records: ${targetCount}`);
  console.log(`   Mapping records: ${mappingCount}`);
  
  const success = targetCount > 0 && mappingCount === targetCount;
  console.log(`   Validation: ${success ? '✅ PASSED' : '❌ FAILED'}`);
  
  return success;
}

/**
 * Main migration function
 */
async function main() {
  const sourcePool = createSourcePool();
  const targetPool = createTargetPool();
  
  const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '1000');
  const stats: MigrationStats = {
    total_source_records: 0,
    processed_records: 0,
    successful_migrations: 0,
    skipped_records: 0,
    error_records: 0,
    missing_patients: 0,
    missing_doctors: 0,
    missing_offices: 0,
  };
  
  console.log('🚀 Starting comprehensive orders migration');
  console.log(`📊 Batch size: ${BATCH_SIZE}`);
  
  try {
    // Get total count for progress tracking
    const countResult = await sourcePool.query("SELECT COUNT(*) FROM dispatch_instruction WHERE deleted IS NOT TRUE");
    stats.total_source_records = parseInt(countResult.rows[0].count);
    console.log(`📊 Total source records to migrate: ${stats.total_source_records}`);
    
    // Build lookup maps once
    const { patientMap, doctorMap, officeMap } = await buildLookupMaps(targetPool);
    
    let offset = 0;
    let batchNumber = 1;
    
    while (offset < stats.total_source_records) {
      console.log(`\n📄 Processing batch ${batchNumber} (offset ${offset})`);
      
      // Extract raw orders
      const rawOrders = await extractRawOrders(sourcePool, BATCH_SIZE, offset);
      if (rawOrders.length === 0) break;
      
      console.log(`📥 Extracted ${rawOrders.length} raw orders`);
      
      // Transform orders
      const transformedOrders = transformOrders(rawOrders, patientMap, doctorMap, officeMap, stats);
      console.log(`🔄 Transformed ${transformedOrders.length} orders`);
      
      // Insert orders
      if (transformedOrders.length > 0) {
        const insertedCount = await insertOrdersBatch(targetPool, transformedOrders);
        stats.successful_migrations += insertedCount;
        console.log(`✅ Inserted ${insertedCount} orders`);
        
        // Update migration mappings
        await updateOrderMappings(targetPool, transformedOrders);
        console.log(`📝 Updated ${transformedOrders.length} migration mappings`);
      }
      
      // Progress update
      const progressPercent = Math.round((offset + rawOrders.length) / stats.total_source_records * 100);
      console.log(`📈 Progress: ${progressPercent}% (${offset + rawOrders.length}/${stats.total_source_records})`);
      
      offset += rawOrders.length;
      batchNumber++;
    }
    
    // Final validation
    const validationPassed = await validateMigration(sourcePool, targetPool);
    
    // Print final statistics
    console.log(`\n🎉 Migration completed!`);
    console.log(`📊 Final Statistics:`);
    console.log(`   Total source records: ${stats.total_source_records}`);
    console.log(`   Processed records: ${stats.processed_records}`);
    console.log(`   Successfully migrated: ${stats.successful_migrations}`);
    console.log(`   Skipped records: ${stats.skipped_records}`);
    console.log(`   Missing patients: ${stats.missing_patients}`);
    console.log(`   Missing doctors: ${stats.missing_doctors}`);
    console.log(`   Missing offices: ${stats.missing_offices}`);
    console.log(`   Success rate: ${Math.round(stats.successful_migrations / stats.processed_records * 100)}%`);
    console.log(`   Validation: ${validationPassed ? '✅ PASSED' : '❌ FAILED'}`);
    
    if (!validationPassed) {
      console.error('❌ Migration validation failed');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('💥 Fatal error during migration:', error);
    stats.error_records++;
    process.exit(1);
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

// Handle different command line arguments
const command = process.argv[2];

if (command === 'validate') {
  // Quick validation without migration
  (async () => {
    const sourcePool = createSourcePool();
    const targetPool = createTargetPool();
    try {
      await validateMigration(sourcePool, targetPool);
    } finally {
      await sourcePool.end();
      await targetPool.end();
    }
  })();
} else if (command === 'rollback') {
  console.log('🔄 Rolling back orders migration...');
  (async () => {
    const targetPool = createTargetPool();
    try {
      await targetPool.query("DELETE FROM migration_mappings WHERE entity_type = 'order'");
      await targetPool.query("DELETE FROM orders WHERE legacy_instruction_id IS NOT NULL");
      console.log('✅ Rollback completed');
    } catch (error) {
      console.error('❌ Rollback failed:', error);
      process.exit(1);
    } finally {
      await targetPool.end();
    }
  })();
} else {
  // Run the migration
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
