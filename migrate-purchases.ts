/**
 * Purchases Migration Script
 * Migrates data from dispatch_payment table to purchases table
 * Since dispatch_purchase is empty, we create purchases based on payments
 */

const { Pool } = require('pg');
require('dotenv').config();

// Database connections
const sourceDb = new Pool({
  host: process.env.SOURCE_DB_HOST,
  port: process.env.SOURCE_DB_PORT,
  user: process.env.SOURCE_DB_USER,
  password: process.env.SOURCE_DB_PASSWORD,
  database: process.env.SOURCE_DB_NAME
});

const targetDb = new Pool({
  host: process.env.TARGET_DB_HOST,
  port: process.env.TARGET_DB_PORT,
  user: process.env.TARGET_DB_USER,
  password: process.env.TARGET_DB_PASSWORD,
  database: process.env.TARGET_DB_NAME
});

interface SourcePayment {
  id: number;
  made_at: string;
  paid_price: number;
  subtotal_price: number;
  total_price: number;
  order_id?: number;
  instruction_id?: number;
  paid: boolean;
  canceled: boolean;
  course_id?: number;
  course_name?: string;
}

interface TargetPurchase {
  id: string;  // UUID
  order_id: string;  // UUID reference to orders
  product_id: string;  // UUID reference to products
  quantity: number;
  unit_price: number;
  total_amount: number;
  purchased_at: string;
  metadata: object;
  legacy_purchase_id: number;
}

// ID mapping cache
const orderIdMapping = new Map<number, string>();
const productIdMapping = new Map<number, string>();

async function loadIdMappings(targetClient: any) {
  console.log('📋 Loading ID mappings...');
  
  // Load order ID mappings (instruction_id -> order UUID)
  const orderMappings = await targetClient.query(`
    SELECT id, legacy_instruction_id
    FROM orders 
    WHERE legacy_instruction_id IS NOT NULL
  `);
  
  for (const row of orderMappings.rows) {
    orderIdMapping.set(row.legacy_instruction_id, row.id);
  }
  
  console.log(`Loaded ${orderIdMapping.size} order ID mappings`);
  
  // Load product ID mappings (course_id -> product UUID)
  const productMappings = await targetClient.query(`
    SELECT id, legacy_course_id
    FROM products 
    WHERE legacy_course_id IS NOT NULL
  `);
  
  for (const row of productMappings.rows) {
    productIdMapping.set(row.legacy_course_id, row.id);
  }
  
  console.log(`Loaded ${productIdMapping.size} product ID mappings`);
}

async function migratePurchases() {
  let sourceClient, targetClient;
  
  try {
    console.log('🔄 Starting purchases migration...');
    
    // Get connections
    sourceClient = await sourceDb.connect();
    targetClient = await targetDb.connect();
    
    // Load ID mappings
    await loadIdMappings(targetClient);
    
    // Begin transaction
    await targetClient.query('BEGIN');
    
    // Step 1: Fetch payments with order and course information
    console.log('📋 Fetching payments from dispatch_payment...');
    const paymentsResult = await sourceClient.query(`
      SELECT 
        dp.id,
        dp.made_at,
        dp.paid_price,
        dp.subtotal_price,
        dp.total_price,
        dp.order_id,
        dp.instruction_id,
        dp.paid,
        dp.canceled,
        dord.course_id,
        dc.name as course_name
      FROM dispatch_payment dp
      LEFT JOIN dispatch_order dord ON dp.order_id = dord.id
      LEFT JOIN dispatch_course dc ON dord.course_id = dc.id
      WHERE dp.paid = true 
        AND dp.canceled = false
        AND dp.total_price > 0
        AND (dp.instruction_id IS NOT NULL OR dord.course_id IS NOT NULL)
      ORDER BY dp.made_at DESC
    `);
    
    const sourcePayments: SourcePayment[] = paymentsResult.rows;
    console.log(`Found ${sourcePayments.length} valid payments to convert to purchases`);
    
    if (sourcePayments.length === 0) {
      console.log('⚠️ No valid payments found for purchase conversion. Checking alternative approach...');
      
      // Alternative: Check payments with instruction_id only
      const altPaymentsResult = await sourceClient.query(`
        SELECT 
          dp.id,
          dp.made_at,
          dp.paid_price,
          dp.subtotal_price,
          dp.total_price,
          dp.instruction_id,
          dp.paid,
          dp.canceled,
          di.course_id,
          dc.name as course_name
        FROM dispatch_payment dp
        LEFT JOIN dispatch_instruction di ON dp.instruction_id = di.id
        LEFT JOIN dispatch_course dc ON di.course_id = dc.id
        WHERE dp.paid = true 
          AND dp.canceled = false
          AND dp.total_price > 0
          AND dp.instruction_id IS NOT NULL
        ORDER BY dp.made_at DESC
        LIMIT 1000
      `);
      
      const altPayments: SourcePayment[] = altPaymentsResult.rows;
      console.log(`Found ${altPayments.length} payments via instruction route`);
      sourcePayments.push(...altPayments);
    }
    
    if (sourcePayments.length === 0) {
      console.log('⚠️ Still no payments found. Exiting migration.');
      await targetClient.query('ROLLBACK');
      return;
    }
    
    // Step 2: Process and insert purchases
    console.log('🔄 Processing and inserting purchases...');
    
    let processed = 0;
    let skipped = 0;
    const batchSize = parseInt(process.env.BATCH_SIZE || '100');
    
    for (let i = 0; i < sourcePayments.length; i += batchSize) {
      const batch = sourcePayments.slice(i, i + batchSize);
      
      for (const payment of batch) {
        // Determine order_id mapping
        let orderUuid: string | null = null;
        
        if (payment.instruction_id && orderIdMapping.has(payment.instruction_id)) {
          orderUuid = orderIdMapping.get(payment.instruction_id)!;
        }
        
        // Determine product_id mapping
        let productUuid: string | null = null;
        
        if (payment.course_id && productIdMapping.has(payment.course_id)) {
          productUuid = productIdMapping.get(payment.course_id)!;
        }
        
        // Skip if we don't have required mappings
        if (!orderUuid || !productUuid) {
          skipped++;
          continue;
        }
        
        // Generate UUID for the purchase
        const uuidResult = await targetClient.query('SELECT gen_random_uuid() as id');
        const purchaseUuid = uuidResult.rows[0].id;
        
        // Create purchase metadata
        const metadata = {
          source_payment_id: payment.id,
          course_name: payment.course_name,
          subtotal_price: payment.subtotal_price,
          migration_notes: 'Created from dispatch_payment'
        };
        
        // Insert purchase
        await targetClient.query(`
          INSERT INTO purchases (
            id,
            order_id,
            product_id,
            quantity,
            unit_price,
            total_amount,
            purchased_at,
            metadata,
            legacy_purchase_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          purchaseUuid,
          orderUuid,
          productUuid,
          1,  // Default quantity
          payment.subtotal_price || payment.total_price,  // Unit price
          payment.total_price,  // Total amount
          payment.made_at,
          JSON.stringify(metadata),
          payment.id  // Store original payment ID
        ]);
        
        processed++;
      }
      
      console.log(`Processed ${Math.min(i + batchSize, sourcePayments.length)} / ${sourcePayments.length} payments (${processed} purchases created, ${skipped} skipped)`);
    }
    
    console.log(`✅ Successfully processed ${processed} purchases, skipped ${skipped} payments`);
    
    // Step 3: Validation
    console.log('🔍 Validating migration...');
    
    const targetCount = await targetClient.query('SELECT COUNT(*) as total FROM purchases');
    const amountStats = await targetClient.query(`
      SELECT 
        MIN(total_amount) as min_amount,
        MAX(total_amount) as max_amount,
        AVG(total_amount) as avg_amount,
        SUM(total_amount) as total_revenue
      FROM purchases
    `);
    const productBreakdown = await targetClient.query(`
      SELECT 
        p.name as product_name,
        COUNT(pu.*) as purchase_count,
        SUM(pu.total_amount) as total_revenue
      FROM purchases pu
      JOIN products p ON pu.product_id = p.id
      GROUP BY p.id, p.name
      ORDER BY purchase_count DESC
    `);
    
    console.log(`\nMigration Summary:`);
    console.log(`Source payments analyzed: ${sourcePayments.length}`);
    console.log(`Target purchases created: ${targetCount.rows[0].total}`);
    console.log(`Payments skipped (missing mappings): ${skipped}`);
    
    console.log('\n💰 Revenue Statistics:');
    console.table(amountStats.rows);
    
    console.log('\n📊 Product Breakdown:');
    console.table(productBreakdown.rows);
    
    // Show recent samples
    console.log('\n📋 Recent Purchase Samples:');
    const samples = await targetClient.query(`
      SELECT 
        p.name as product_name,
        pu.quantity,
        pu.unit_price,
        pu.total_amount,
        pu.purchased_at,
        pu.legacy_purchase_id
      FROM purchases pu
      JOIN products p ON pu.product_id = p.id
      ORDER BY pu.purchased_at DESC
      LIMIT 5
    `);
    
    console.table(samples.rows);
    
    // Commit transaction
    await targetClient.query('COMMIT');
    console.log('✅ Purchases migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    if (targetClient) {
      await targetClient.query('ROLLBACK');
      console.log('🔄 Transaction rolled back');
    }
    throw error;
  } finally {
    if (sourceClient) sourceClient.release();
    if (targetClient) targetClient.release();
  }
}

async function validatePurchaseData() {
  try {
    console.log('\n🔍 Validating purchase data...');
    
    const client = await targetDb.connect();
    
    // Check for data consistency
    const stats = await client.query(`
      SELECT 
        COUNT(*) as total_purchases,
        COUNT(DISTINCT product_id) as unique_products,
        COUNT(DISTINCT order_id) as unique_orders,
        MIN(purchased_at) as earliest_purchase,
        MAX(purchased_at) as latest_purchase,
        SUM(total_amount) as total_revenue
      FROM purchases
    `);
    
    console.log('📈 Overall Statistics:');
    console.table(stats.rows);
    
    // Check for any data quality issues
    const qualityCheck = await client.query(`
      SELECT 
        'Zero or negative amounts' as issue,
        COUNT(*) as count
      FROM purchases 
      WHERE total_amount <= 0
      
      UNION ALL
      
      SELECT 
        'Missing order references' as issue,
        COUNT(*) as count
      FROM purchases pu
      LEFT JOIN orders o ON pu.order_id = o.id
      WHERE o.id IS NULL
      
      UNION ALL
      
      SELECT 
        'Missing product references' as issue,
        COUNT(*) as count
      FROM purchases pu
      LEFT JOIN products p ON pu.product_id = p.id
      WHERE p.id IS NULL
    `);
    
    console.log('\n🔍 Quality Check:');
    console.table(qualityCheck.rows);
    
    client.release();
    
  } catch (error) {
    console.error('❌ Validation failed:', error);
  }
}

async function main() {
  try {
    await migratePurchases();
    await validatePurchaseData();
  } catch (error) {
    console.error('❌ Script failed:', error);
    process.exit(1);
  } finally {
    await sourceDb.end();
    await targetDb.end();
  }
}

// Run the migration
if (require.main === module) {
  main();
}
