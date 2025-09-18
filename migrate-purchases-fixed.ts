/**
 * Fixed Purchases Migration Script
 */

const { Pool } = require('pg');
require('dotenv').config();

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

async function migratePurchases() {
  let sourceClient, targetClient;
  
  try {
    console.log('🔄 Starting purchases migration...');
    
    sourceClient = await sourceDb.connect();
    targetClient = await targetDb.connect();
    
    await targetClient.query('BEGIN');
    
    // Get payments with their mappings in one query
    console.log('📋 Fetching payments with order and product mappings...');
    const paymentsResult = await sourceClient.query(`
      SELECT 
        dp.id,
        dp.made_at,
        dp.paid_price,
        dp.subtotal_price,
        dp.total_price,
        dp.instruction_id,
        di.course_id,
        dc.name as course_name
      FROM dispatch_payment dp
      JOIN dispatch_instruction di ON dp.instruction_id = di.id
      JOIN dispatch_course dc ON di.course_id = dc.id
      WHERE dp.paid = true 
        AND dp.canceled = false
        AND dp.total_price > 0
      ORDER BY dp.made_at DESC
      
    `);
    
    console.log(`Found ${paymentsResult.rows.length} payments to process`);
    
    let processed = 0;
    let skipped = 0;
    
    for (const payment of paymentsResult.rows) {
      // Get order UUID
      const orderResult = await targetClient.query(`
        SELECT id FROM orders WHERE legacy_instruction_id = $1
      `, [payment.instruction_id]);
      
      // Get product UUID
      const productResult = await targetClient.query(`
        SELECT id FROM products WHERE legacy_course_id = $1
      `, [payment.course_id]);
      
      if (orderResult.rows.length === 0 || productResult.rows.length === 0) {
        skipped++;
        continue;
      }
      
      const orderUuid = orderResult.rows[0].id;
      const productUuid = productResult.rows[0].id;
      
      // Generate UUID for purchase
      const uuidResult = await targetClient.query('SELECT gen_random_uuid() as id');
      const purchaseUuid = uuidResult.rows[0].id;
      
      // Create metadata
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
        1,
        payment.subtotal_price || payment.total_price,
        payment.total_price,
        payment.made_at,
        JSON.stringify(metadata),
        payment.id
      ]);
      
      processed++;
      
      if (processed % 100 === 0) {
        console.log(`Processed ${processed} purchases...`);
      }
    }
    
    console.log(`✅ Successfully created ${processed} purchases, skipped ${skipped}`);
    
    // Validation
    const targetCount = await targetClient.query('SELECT COUNT(*) as total FROM purchases');
    const revenueSum = await targetClient.query('SELECT SUM(total_amount) as total_revenue FROM purchases');
    
    console.log(`Total purchases in database: ${targetCount.rows[0].total}`);
    console.log(`Total revenue: $${revenueSum.rows[0].total_revenue}`);
    
    await targetClient.query('COMMIT');
    console.log('✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    if (targetClient) {
      await targetClient.query('ROLLBACK');
    }
    throw error;
  } finally {
    if (sourceClient) sourceClient.release();
    if (targetClient) targetClient.release();
  }
}

async function main() {
  try {
    await migratePurchases();
  } catch (error) {
    console.error('❌ Script failed:', error);
    process.exit(1);
  } finally {
    await sourceDb.end();
    await targetDb.end();
  }
}

if (require.main === module) {
  main();
}
