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

interface SourceOffer {
  id: number;
  price_both: string;
  price_upper: string;
  price_lower: string;
  doctor_id: number;
  product_id: number;
}

interface SourceDiscount {
  id: number;
  percent: number;
  reason: string;
  count: number | null;
  start: Date | null;
  finish: Date | null;
  total: boolean;
  used: number | null;
  offer_id: number;
}

async function migrateOffersAndDiscounts() {
  let migrationStats = {
    offersProcessed: 0,
    offersSkipped: 0,
    offersMigrated: 0,
    discountsProcessed: 0,
    discountsSkipped: 0,
    discountsMigrated: 0
  };

  try {
    console.log('🚀 Starting Offers and Discounts Migration...\n');

    // Step 1: Prepare mapping tables
    console.log('📋 Step 1: Preparing doctor and order mappings...');
    
    // Get doctor mappings using legacy_user_id (maps to dispatch_offer.doctor_id)
    const doctorMappings = new Map<number, string>();
    const doctorQuery = await targetPool.query(`
      SELECT id, legacy_user_id 
      FROM doctors 
      WHERE legacy_user_id IS NOT NULL
    `);
    
    doctorQuery.rows.forEach(row => {
      if (row.legacy_user_id) {
        doctorMappings.set(row.legacy_user_id, row.id);
      }
    });
    
    console.log(`Found ${doctorMappings.size} doctor mappings`);

    // Get recent orders from each doctor to use as offer targets
    // Since offers are doctor-specific pricing, we'll create offers tied to orders from those doctors
    const orderMappings = new Map<string, string>(); // doctor_uuid -> order_uuid
    const orderQuery = await targetPool.query(`
      SELECT DISTINCT ON (doctor_id) id, doctor_id
      FROM orders 
      WHERE doctor_id IS NOT NULL
      ORDER BY doctor_id, created_at DESC
    `);
    
    orderQuery.rows.forEach(row => {
      orderMappings.set(row.doctor_id, row.id);
    });
    
    console.log(`Found ${orderMappings.size} order mappings for offers`);

    // Step 2: Migrate Offers
    console.log('\n📊 Step 2: Migrating Offers...');
    
    const sourceOffers = await sourcePool.query<SourceOffer>(`
      SELECT id, price_both, price_upper, price_lower, doctor_id, product_id
      FROM dispatch_offer 
      ORDER BY id
    `);

    console.log(`Processing ${sourceOffers.rows.length} offers...`);

    const offerMappings = new Map<number, string>(); // source_offer_id -> target_offer_uuid
    
    for (const sourceOffer of sourceOffers.rows) {
      migrationStats.offersProcessed++;
      
      try {
        // Try to find doctor mapping using legacy_user_id
        const doctorUuid = doctorMappings.get(sourceOffer.doctor_id);
        if (!doctorUuid) {
          console.log(`⚠️  Skipping offer ${sourceOffer.id} - doctor ${sourceOffer.doctor_id} not found`);
          migrationStats.offersSkipped++;
          continue;
        }
        
        // Find an order for this doctor
        const orderUuid = orderMappings.get(doctorUuid);
        if (!orderUuid) {
          console.log(`⚠️  Skipping offer ${sourceOffer.id} - no orders found for doctor ${sourceOffer.doctor_id}`);
          migrationStats.offersSkipped++;
          continue;
        }

        // Create description based on pricing structure
        let description = `Doctor pricing: `;
        if (sourceOffer.price_both && parseFloat(sourceOffer.price_both) > 0) {
          description += `Both arches: $${sourceOffer.price_both}`;
        }
        if (sourceOffer.price_upper && parseFloat(sourceOffer.price_upper) > 0) {
          description += `, Upper: $${sourceOffer.price_upper}`;
        }
        if (sourceOffer.price_lower && parseFloat(sourceOffer.price_lower) > 0) {
          description += `, Lower: $${sourceOffer.price_lower}`;
        }
        
        // Use the highest price as the offer amount
        const prices = [
          parseFloat(sourceOffer.price_both || '0'),
          parseFloat(sourceOffer.price_upper || '0'),
          parseFloat(sourceOffer.price_lower || '0')
        ];
        const offerAmount = Math.max(...prices);

        // Insert offer
        const insertOfferResult = await targetPool.query(`
          INSERT INTO offers (
            order_id, 
            offer_amount, 
            description, 
            is_accepted, 
            is_active, 
            created_at,
            metadata,
            legacy_offer_id
          ) VALUES (
            $1, $2, $3, true, true, NOW(),
            $4, $5
          ) RETURNING id
        `, [
          orderUuid,
          offerAmount,
          description.trim(),
          JSON.stringify({
            source_doctor_id: sourceOffer.doctor_id,
            source_product_id: sourceOffer.product_id,
            price_breakdown: {
              both: sourceOffer.price_both,
              upper: sourceOffer.price_upper,
              lower: sourceOffer.price_lower
            }
          }),
          sourceOffer.id
        ]);

        const newOfferUuid = insertOfferResult.rows[0].id;
        offerMappings.set(sourceOffer.id, newOfferUuid);
        migrationStats.offersMigrated++;
        
        if (migrationStats.offersMigrated % 50 === 0) {
          console.log(`✅ Migrated ${migrationStats.offersMigrated} offers so far...`);
        }

      } catch (error: any) {
        console.error(`❌ Error migrating offer ${sourceOffer.id}:`, error.message);
        migrationStats.offersSkipped++;
      }
    }

    console.log(`\n✅ Offers migration complete: ${migrationStats.offersMigrated}/${migrationStats.offersProcessed} migrated`);

    // Step 3: Migrate Discounts
    console.log('\n🏷️  Step 3: Migrating Discounts...');
    
    const sourceDiscounts = await sourcePool.query<SourceDiscount>(`
      SELECT id, percent, reason, count, start, finish, total, used, offer_id
      FROM dispatch_discount 
      ORDER BY id
    `);

    console.log(`Processing ${sourceDiscounts.rows.length} discounts...`);

    for (const sourceDiscount of sourceDiscounts.rows) {
      migrationStats.discountsProcessed++;
      
      try {
        // Check if we have the related offer
        const offerUuid = offerMappings.get(sourceDiscount.offer_id);
        if (!offerUuid) {
          console.log(`⚠️  Skipping discount ${sourceDiscount.id} - related offer ${sourceDiscount.offer_id} not migrated`);
          migrationStats.discountsSkipped++;
          continue;
        }

        // Create discount name and code
        const discountName = sourceDiscount.reason || `Discount ${sourceDiscount.percent}%`;
        const discountCode = `LEGACY${sourceDiscount.id}`;

        // Insert discount
        await targetPool.query(`
          INSERT INTO discounts (
            name,
            code,
            discount_type,
            percentage,
            fixed_amount,
            minimum_order_amount,
            is_active,
            valid_from,
            valid_until,
            max_uses,
            current_uses,
            created_at,
            metadata,
            legacy_discount_id
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), $12, $13
          )
        `, [
          discountName,
          discountCode,
          'percentage', // Using percentage type since all source discounts are percentage-based
          sourceDiscount.percent,
          null, // no fixed amount for percentage discounts
          null, // no minimum order amount specified
          true, // assume active
          sourceDiscount.start,
          sourceDiscount.finish,
          sourceDiscount.count,
          sourceDiscount.used || 0,
          JSON.stringify({
            source_offer_id: sourceDiscount.offer_id,
            target_offer_id: offerUuid,
            total_discount: sourceDiscount.total,
            migration_source: 'dispatch_discount'
          }),
          sourceDiscount.id
        ]);

        migrationStats.discountsMigrated++;
        
        if (migrationStats.discountsMigrated % 25 === 0) {
          console.log(`✅ Migrated ${migrationStats.discountsMigrated} discounts so far...`);
        }

      } catch (error: any) {
        console.error(`❌ Error migrating discount ${sourceDiscount.id}:`, error.message);
        migrationStats.discountsSkipped++;
      }
    }

    console.log(`\n✅ Discounts migration complete: ${migrationStats.discountsMigrated}/${migrationStats.discountsProcessed} migrated`);

    // Step 4: Validation
    console.log('\n🔍 Step 4: Validation...');
    
    const finalOffersCount = await targetPool.query('SELECT COUNT(*) as count FROM offers');
    const finalDiscountsCount = await targetPool.query('SELECT COUNT(*) as count FROM discounts');
    
    console.log(`Final offers count: ${finalOffersCount.rows[0].count}`);
    console.log(`Final discounts count: ${finalDiscountsCount.rows[0].count}`);

    // Check foreign key integrity
    const orphanedDiscounts = await targetPool.query(`
      SELECT COUNT(*) as count 
      FROM discounts d 
      WHERE d.metadata->>'target_offer_id' NOT IN (
        SELECT id::text FROM offers
      )
    `);
    
    console.log(`Orphaned discounts: ${orphanedDiscounts.rows[0].count}`);

    // Sample data verification
    console.log('\n📋 Sample migrated data:');
    const sampleOffers = await targetPool.query(`
      SELECT id, offer_amount, description, legacy_offer_id 
      FROM offers 
      WHERE legacy_offer_id IS NOT NULL 
      LIMIT 3
    `);
    console.log('Sample offers:', sampleOffers.rows);

    const sampleDiscounts = await targetPool.query(`
      SELECT id, name, discount_type, percentage, legacy_discount_id 
      FROM discounts 
      WHERE legacy_discount_id IS NOT NULL 
      LIMIT 3
    `);
    console.log('Sample discounts:', sampleDiscounts.rows);

    console.log('\n📊 MIGRATION SUMMARY:');
    console.log('='.repeat(50));
    console.log(`Offers processed: ${migrationStats.offersProcessed}`);
    console.log(`Offers migrated: ${migrationStats.offersMigrated}`);
    console.log(`Offers skipped: ${migrationStats.offersSkipped}`);
    console.log(`Offers success rate: ${((migrationStats.offersMigrated / migrationStats.offersProcessed) * 100).toFixed(2)}%`);
    console.log('');
    console.log(`Discounts processed: ${migrationStats.discountsProcessed}`);
    console.log(`Discounts migrated: ${migrationStats.discountsMigrated}`);
    console.log(`Discounts skipped: ${migrationStats.discountsSkipped}`);
    console.log(`Discounts success rate: ${((migrationStats.discountsMigrated / migrationStats.discountsProcessed) * 100).toFixed(2)}%`);
    console.log('='.repeat(50));

    console.log('\n🎉 Migration completed successfully!');

  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

// Run the migration
if (require.main === module) {
  migrateOffersAndDiscounts().catch(console.error);
}

export { migrateOffersAndDiscounts };
