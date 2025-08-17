import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const sourcePool = new Pool({
  host: process.env.SOURCE_DB_HOST!,
  port: parseInt(process.env.SOURCE_DB_PORT!),
  user: process.env.SOURCE_DB_USER!,
  password: process.env.SOURCE_DB_PASSWORD!,
  database: process.env.SOURCE_DB_NAME!
});

const targetPool = new Pool({
  host: process.env.TARGET_DB_HOST!,
  port: parseInt(process.env.TARGET_DB_PORT!),
  user: process.env.TARGET_DB_USER!,
  password: process.env.TARGET_DB_PASSWORD!,
  database: process.env.TARGET_DB_NAME!
});

async function validateMigration() {
  try {
    console.log('🔍 OFFERS & DISCOUNTS MIGRATION VALIDATION REPORT');
    console.log('='.repeat(60));

    // Source counts
    const sourceOfferCount = await sourcePool.query('SELECT COUNT(*) as count FROM dispatch_offer');
    const sourceDiscountCount = await sourcePool.query('SELECT COUNT(*) as count FROM dispatch_discount');
    
    // Target counts
    const targetOfferCount = await targetPool.query('SELECT COUNT(*) as count FROM offers WHERE legacy_offer_id IS NOT NULL');
    const targetDiscountCount = await targetPool.query('SELECT COUNT(*) as count FROM discounts WHERE legacy_discount_id IS NOT NULL');
    
    console.log('\n📊 RECORD COUNTS:');
    console.log(`Source dispatch_offer: ${sourceOfferCount.rows[0].count}`);
    console.log(`Target offers (migrated): ${targetOfferCount.rows[0].count}`);
    console.log(`Migration rate: ${((targetOfferCount.rows[0].count / sourceOfferCount.rows[0].count) * 100).toFixed(2)}%`);
    console.log('');
    console.log(`Source dispatch_discount: ${sourceDiscountCount.rows[0].count}`);
    console.log(`Target discounts (migrated): ${targetDiscountCount.rows[0].count}`);
    console.log(`Migration rate: ${((targetDiscountCount.rows[0].count / sourceDiscountCount.rows[0].count) * 100).toFixed(2)}%`);

    // Data integrity checks
    console.log('\n🔗 DATA INTEGRITY CHECKS:');
    
    // Check for duplicate legacy IDs
    const duplicateOffers = await targetPool.query(`
      SELECT legacy_offer_id, COUNT(*) 
      FROM offers 
      WHERE legacy_offer_id IS NOT NULL 
      GROUP BY legacy_offer_id 
      HAVING COUNT(*) > 1
    `);
    console.log(`Duplicate offer legacy IDs: ${duplicateOffers.rows.length}`);
    
    const duplicateDiscounts = await targetPool.query(`
      SELECT legacy_discount_id, COUNT(*) 
      FROM discounts 
      WHERE legacy_discount_id IS NOT NULL 
      GROUP BY legacy_discount_id 
      HAVING COUNT(*) > 1
    `);
    console.log(`Duplicate discount legacy IDs: ${duplicateDiscounts.rows.length}`);
    
    // Check foreign key relationships
    const orphanedOffers = await targetPool.query(`
      SELECT COUNT(*) as count 
      FROM offers 
      WHERE order_id NOT IN (SELECT id FROM orders)
    `);
    console.log(`Orphaned offers (invalid order_id): ${orphanedOffers.rows[0].count}`);

    // Pricing validation
    console.log('\n💰 PRICING ANALYSIS:');
    const pricingStats = await targetPool.query(`
      SELECT 
        COUNT(*) as total_offers,
        MIN(offer_amount) as min_amount,
        MAX(offer_amount) as max_amount,
        AVG(offer_amount) as avg_amount,
        SUM(offer_amount) as total_amount
      FROM offers 
      WHERE legacy_offer_id IS NOT NULL
    `);
    
    const stats = pricingStats.rows[0];
    console.log(`Total migrated offers: ${stats.total_offers}`);
    console.log(`Price range: $${stats.min_amount} - $${stats.max_amount}`);
    console.log(`Average offer: $${parseFloat(stats.avg_amount).toFixed(2)}`);
    console.log(`Total offer value: $${parseFloat(stats.total_amount).toFixed(2)}`);

    // Discount analysis
    console.log('\n🏷️  DISCOUNT ANALYSIS:');
    const discountStats = await targetPool.query(`
      SELECT 
        COUNT(*) as total_discounts,
        MIN(percentage) as min_percentage,
        MAX(percentage) as max_percentage,
        AVG(percentage) as avg_percentage
      FROM discounts 
      WHERE legacy_discount_id IS NOT NULL AND discount_type = 'percentage'
    `);
    
    const dStats = discountStats.rows[0];
    console.log(`Total migrated discounts: ${dStats.total_discounts}`);
    console.log(`Percentage range: ${dStats.min_percentage}% - ${dStats.max_percentage}%`);
    console.log(`Average discount: ${parseFloat(dStats.avg_percentage).toFixed(2)}%`);

    // Sample validation - compare source vs target
    console.log('\n🔍 SAMPLE DATA VALIDATION:');
    
    const sourceOfferSample = await sourcePool.query(`
      SELECT id, price_both, price_upper, price_lower, doctor_id 
      FROM dispatch_offer 
      WHERE id IN (43, 44, 50)
      ORDER BY id
    `);
    
    const targetOfferSample = await targetPool.query(`
      SELECT legacy_offer_id, offer_amount, description, metadata
      FROM offers 
      WHERE legacy_offer_id IN (43, 44, 50)
      ORDER BY legacy_offer_id
    `);
    
    console.log('Source offers sample:');
    sourceOfferSample.rows.forEach(row => {
      console.log(`  Offer ${row.id}: Both=$${row.price_both}, Upper=$${row.price_upper}, Lower=$${row.price_lower}`);
    });
    
    console.log('Target offers sample:');
    targetOfferSample.rows.forEach(row => {
      const metadata = row.metadata;
      console.log(`  Offer ${row.legacy_offer_id}: Amount=$${row.offer_amount}`);
      console.log(`    Description: ${row.description}`);
      console.log(`    Source Doctor: ${metadata.source_doctor_id}`);
    });

    console.log('\n✅ VALIDATION COMPLETE!');
    console.log('='.repeat(60));

  } catch (error: any) {
    console.error('❌ Validation failed:', error.message);
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

// Run validation
if (require.main === module) {
  validateMigration().catch(console.error);
}
