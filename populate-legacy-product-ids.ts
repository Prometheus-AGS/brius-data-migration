import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function populateLegacyProductIds() {
  console.log('🚀 Populating legacy_product_id in products table from source dispatch_product...\n');

  const sourceClient = new Client({
    host: process.env.SOURCE_DB_HOST!,
    port: parseInt(process.env.SOURCE_DB_PORT!),
    user: process.env.SOURCE_DB_USER!,
    password: process.env.SOURCE_DB_PASSWORD!,
    database: process.env.SOURCE_DB_NAME!,
  });

  try {
    await sourceClient.connect();
    console.log('✅ Connected to source database');

    // Step 1: Check target products table structure
    console.log('\n🎯 Checking target products table structure...');
    const { data: sampleProduct, error: sampleError } = await supabase
      .from('products')
      .select('*')
      .limit(1)
      .single();

    if (sampleError) {
      throw new Error(`Failed to access products table: ${sampleError.message}`);
    }

    console.log('✅ Target products table structure:', Object.keys(sampleProduct));
    console.log('📋 Sample product record:', sampleProduct);

    const hasLegacyProductId = sampleProduct.hasOwnProperty('legacy_product_id');
    console.log(`🔍 Has legacy_product_id column: ${hasLegacyProductId}`);

    if (!hasLegacyProductId) {
      throw new Error('Products table does not have legacy_product_id column - please add it first');
    }

    // Step 2: Get source products structure
    console.log('\n📦 Checking source dispatch_product table structure...');
    const sourceStructureResult = await sourceClient.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'dispatch_product' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);

    console.log('📋 Source dispatch_product structure:');
    sourceStructureResult.rows.forEach((col: any) => {
      console.log(`   • ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'required'})`);
    });

    // Get source products count
    const sourceCountResult = await sourceClient.query(`SELECT COUNT(*) as count FROM dispatch_product`);
    const sourceCount = parseInt(sourceCountResult.rows[0].count);
    console.log(`📊 Source products count: ${sourceCount}`);

    // Sample source products
    const sourceSampleResult = await sourceClient.query(`SELECT * FROM dispatch_product LIMIT 3`);
    console.log('\n📋 Sample source products:');
    sourceSampleResult.rows.forEach((row: any, index: number) => {
      console.log(`   ${index + 1}. ID: ${row.id}, Name: ${row.name || 'N/A'}`);
    });

    // Step 3: Get all target products
    console.log('\n🎯 Fetching all target products...');
    const { data: targetProducts, error: targetError } = await supabase
      .from('products')
      .select('id, name, legacy_product_id')
      .order('created_at');

    if (targetError) {
      throw new Error(`Failed to fetch target products: ${targetError.message}`);
    }

    console.log(`📊 Target products count: ${targetProducts.length}`);
    console.log(`📊 Products with legacy_product_id already set: ${targetProducts.filter(p => p.legacy_product_id).length}`);

    // Step 4: Get all source products for matching
    console.log('\n📦 Fetching all source products for matching...');
    const sourceProductsResult = await sourceClient.query(`
      SELECT id, name
      FROM dispatch_product
      ORDER BY id;
    `);

    console.log(`📊 Source products retrieved: ${sourceProductsResult.rows.length}`);

    // Step 5: Match and populate legacy_product_id
    console.log('\n🔄 Matching products by name and populating legacy_product_id...');

    let updated = 0;
    let skipped = 0;
    let notFound = 0;

    for (const targetProduct of targetProducts) {
      // Skip if legacy_product_id already set
      if (targetProduct.legacy_product_id) {
        skipped++;
        continue;
      }

      // Match by name
      let matchedSourceProduct = null;

      if (targetProduct.name) {
        matchedSourceProduct = sourceProductsResult.rows.find(sp =>
          sp.name && sp.name.toLowerCase().trim() === targetProduct.name.toLowerCase().trim()
        );
      }

      if (matchedSourceProduct) {
        // Update the target product with legacy_product_id
        const { error: updateError } = await supabase
          .from('products')
          .update({ legacy_product_id: matchedSourceProduct.id })
          .eq('id', targetProduct.id);

        if (updateError) {
          console.error(`❌ Error updating product ${targetProduct.id}: ${updateError.message}`);
        } else {
          updated++;
          if (updated <= 5) {
            console.log(`   ✅ Updated "${targetProduct.name}" → legacy_product_id: ${matchedSourceProduct.id}`);
          }
        }
      } else {
        notFound++;
        if (notFound <= 5) {
          console.warn(`   ⚠️  No match found for: "${targetProduct.name}"`);
        }
      }
    }

    // Summary
    console.log('\n📊 LEGACY PRODUCT ID POPULATION SUMMARY:');
    console.log(`✅ Target products total: ${targetProducts.length}`);
    console.log(`✅ Already had legacy_product_id: ${skipped}`);
    console.log(`✅ Successfully updated: ${updated}`);
    console.log(`⚠️  No matches found: ${notFound}`);
    console.log(`📈 Success rate: ${((updated / (targetProducts.length - skipped)) * 100).toFixed(1)}%`);

    // Verify final count
    const { data: finalProducts } = await supabase
      .from('products')
      .select('id, legacy_product_id')
      .not('legacy_product_id', 'is', null);

    console.log(`📦 Final products with legacy_product_id: ${finalProducts?.length || 0}`);

    if (updated > 0) {
      console.log('\n🎉 Legacy product ID population completed successfully!');
      console.log('✅ Products table now ready for template_products migration');
    } else {
      console.log('\n⚠️  No products were updated - check matching criteria');
    }

    return updated;

  } catch (error: any) {
    console.error('❌ Population failed:', error);
    throw error;
  } finally {
    await sourceClient.end();
    console.log('🔌 Disconnected from source database');
  }
}

// Run the population
if (require.main === module) {
  populateLegacyProductIds().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default populateLegacyProductIds;