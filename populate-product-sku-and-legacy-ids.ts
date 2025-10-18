import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function populateProductSkuAndLegacyIds() {
  console.log('🚀 Populating products.sku and legacy_product_id from source dispatch_product...\n');

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

    const hasSku = sampleProduct.hasOwnProperty('sku');
    const hasLegacyProductId = sampleProduct.hasOwnProperty('legacy_product_id');
    console.log(`🔍 Has sku column: ${hasSku}`);
    console.log(`🔍 Has legacy_product_id column: ${hasLegacyProductId}`);

    if (!hasSku) {
      throw new Error('Products table does not have sku column - please add it first');
    }
    if (!hasLegacyProductId) {
      throw new Error('Products table does not have legacy_product_id column - please add it first');
    }

    // Step 2: Check source dispatch_product table structure first
    console.log('\n📦 Checking source dispatch_product table structure...');
    const sourceStructureResult = await sourceClient.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'dispatch_product' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);

    console.log('📋 Source dispatch_product structure:');
    const availableColumns: string[] = [];
    sourceStructureResult.rows.forEach((col: any) => {
      console.log(`   • ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'required'})`);
      availableColumns.push(col.column_name);
    });

    const hasSkuColumn = availableColumns.includes('sku');
    console.log(`🔍 Source has sku column: ${hasSkuColumn}`);

    // Build dynamic SELECT query based on available columns
    let selectFields = 'id, name';
    if (hasSkuColumn) {
      selectFields += ', sku';
    }
    if (availableColumns.includes('description')) {
      selectFields += ', description';
    }
    if (availableColumns.includes('free')) {
      selectFields += ', free';
    }
    if (availableColumns.includes('customization')) {
      selectFields += ', customization';
    }
    if (availableColumns.includes('type')) {
      selectFields += ', type';
    }
    if (availableColumns.includes('substitute')) {
      selectFields += ', substitute';
    }
    if (availableColumns.includes('course_id')) {
      selectFields += ', course_id';
    }

    console.log(`📋 Using SELECT fields: ${selectFields}`);

    // Get source products with available fields
    console.log('\n📦 Fetching source dispatch_product data...');
    const sourceProductsResult = await sourceClient.query(`
      SELECT ${selectFields}
      FROM dispatch_product
      ORDER BY id;
    `);

    console.log(`📊 Source products count: ${sourceProductsResult.rows.length}`);

    // Show sample source data
    console.log('\n📋 Sample source products:');
    sourceProductsResult.rows.slice(0, 5).forEach((row: any, index: number) => {
      console.log(`   ${index + 1}. ID: ${row.id}, Name: ${row.name || 'N/A'}, SKU: ${row.sku || 'N/A'}`);
    });

    // Step 3: Get all target products
    console.log('\n🎯 Fetching target products...');
    const { data: targetProducts, error: targetError } = await supabase
      .from('products')
      .select('id, name, sku, legacy_product_id')
      .order('created_at');

    if (targetError) {
      throw new Error(`Failed to fetch target products: ${targetError.message}`);
    }

    console.log(`📊 Target products count: ${targetProducts.length}`);
    console.log(`📊 Products with sku already set: ${targetProducts.filter(p => p.sku).length}`);
    console.log(`📊 Products with legacy_product_id already set: ${targetProducts.filter(p => p.legacy_product_id).length}`);

    // Step 4: Match and populate both sku and legacy_product_id
    console.log('\n🔄 Matching products and populating sku + legacy_product_id...');

    let updated = 0;
    let skipped = 0;
    let notFound = 0;

    for (const targetProduct of targetProducts) {
      // Skip if both fields are already populated (or sku if source doesn't have sku)
      const skipCondition = hasSkuColumn ?
        (targetProduct.sku && targetProduct.legacy_product_id) :
        targetProduct.legacy_product_id;

      if (skipCondition) {
        skipped++;
        continue;
      }

      // Find matching source product by name
      const matchedSourceProduct = sourceProductsResult.rows.find(sp =>
        sp.name && targetProduct.name &&
        sp.name.toLowerCase().trim() === targetProduct.name.toLowerCase().trim()
      );

      if (matchedSourceProduct) {
        // Prepare update data
        const updateData: any = {};

        if (!targetProduct.sku && hasSkuColumn) {
          updateData.sku = matchedSourceProduct.sku || null;
        }

        if (!targetProduct.legacy_product_id) {
          updateData.legacy_product_id = matchedSourceProduct.id;
        }

        // Update the target product
        const { error: updateError } = await supabase
          .from('products')
          .update(updateData)
          .eq('id', targetProduct.id);

        if (updateError) {
          console.error(`❌ Error updating product ${targetProduct.id}: ${updateError.message}`);
        } else {
          updated++;
          if (updated <= 5) {
            const skuInfo = updateData.sku ? `, SKU: ${updateData.sku}` : '';
            const legacyInfo = updateData.legacy_product_id ? `, Legacy ID: ${updateData.legacy_product_id}` : '';
            console.log(`   ✅ Updated "${targetProduct.name}"${skuInfo}${legacyInfo}`);
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
    console.log('\n📊 PRODUCT SKU AND LEGACY ID POPULATION SUMMARY:');
    console.log(`✅ Target products total: ${targetProducts.length}`);
    console.log(`✅ Already complete: ${skipped}`);
    console.log(`✅ Successfully updated: ${updated}`);
    console.log(`⚠️  No matches found: ${notFound}`);
    console.log(`📈 Success rate: ${((updated / (targetProducts.length - skipped)) * 100).toFixed(1)}%`);

    // Verify final counts
    const { data: finalProducts } = await supabase
      .from('products')
      .select('id, sku, legacy_product_id');

    const withSku = finalProducts?.filter(p => p.sku).length || 0;
    const withLegacyId = finalProducts?.filter(p => p.legacy_product_id).length || 0;

    console.log(`📦 Final products with SKU: ${withSku}/${finalProducts?.length || 0}`);
    console.log(`📦 Final products with legacy_product_id: ${withLegacyId}/${finalProducts?.length || 0}`);

    if (updated > 0) {
      console.log('\n🎉 Product SKU and legacy ID population completed successfully!');
      console.log('✅ Products table now ready for template_products migration');
    } else {
      console.log('\n⚠️  No products were updated - check matching criteria or existing data');
    }

    return { updated, withSku, withLegacyId };

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
  populateProductSkuAndLegacyIds().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default populateProductSkuAndLegacyIds;