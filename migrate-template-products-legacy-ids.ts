import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function insertInBatches(tableName: string, data: any[]): Promise<number> {
  const batchSize = 50;
  let totalInserted = 0;

  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);

    try {
      const { error } = await supabase
        .from(tableName)
        .insert(batch);

      if (error) {
        console.error(`   ❌ Error inserting batch for ${tableName}:`, error.message);
        if (batch.length > 0) {
          console.error(`   First item structure:`, JSON.stringify(batch[0], null, 2));
        }
        continue;
      }

      totalInserted += batch.length;
      console.log(`   ✅ Inserted ${batch.length} records for ${tableName} (total: ${totalInserted})`);

    } catch (batchError: any) {
      console.error(`   ❌ Batch error for ${tableName}:`, batchError.message);
    }
  }

  return totalInserted;
}

async function migrateTemplateProductsWithLegacyIds() {
  console.log('🚀 Starting template_products migration using legacy IDs...\n');

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

    // Get source template_products data
    console.log('\n📦 Fetching template products from dispatch_template_products...');
    const sourceResult = await sourceClient.query(`
      SELECT id, template_id, product_id
      FROM dispatch_template_products
      ORDER BY id;
    `);

    console.log(`📊 Found ${sourceResult.rows.length} template products to migrate`);

    if (sourceResult.rows.length === 0) {
      console.log('⚠️  No template products found in source');
      return 0;
    }

    // Show sample source data
    console.log('\n📋 Sample source record:');
    console.log(JSON.stringify(sourceResult.rows[0], null, 2));

    // Transform data using legacy IDs directly
    const templateProducts = sourceResult.rows.map((row: any) => ({
      template_id: row.template_id,   // Use legacy template ID directly
      product_id: row.product_id,     // Use legacy product ID directly
      quantity: 1,
      legacy_id: row.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: {
        legacy_id: row.id,
        source_table: 'dispatch_template_products',
        migration_timestamp: new Date().toISOString(),
        original_data: {
          id: row.id,
          template_id: row.template_id,
          product_id: row.product_id
        }
      }
    }));

    console.log(`📦 Prepared ${templateProducts.length} template products for insertion`);

    // Show sample transformed record
    console.log('\n📦 Sample template_product record with legacy IDs:');
    if (templateProducts.length > 0) {
      console.log(JSON.stringify(templateProducts[0], null, 2));
    }

    // Insert in batches
    console.log('\n⚡ Starting batch insertion...');
    const totalInserted = await insertInBatches('template_products', templateProducts);

    // Summary
    console.log('\n📊 TEMPLATE PRODUCTS MIGRATION SUMMARY:');
    console.log(`✅ Source records: ${sourceResult.rows.length}`);
    console.log(`✅ Successfully migrated: ${totalInserted}`);
    console.log(`✅ Success rate: ${((totalInserted / sourceResult.rows.length) * 100).toFixed(1)}%`);

    // Verify final count
    const { count: finalCount } = await supabase
      .from('template_products')
      .select('*', { count: 'exact', head: true });

    console.log(`📦 Final template_products count in database: ${finalCount || 0}`);

    if (totalInserted > 0) {
      console.log('\n🎉 Template products migration completed successfully!');
      console.log('🔗 Template-product relationships using legacy IDs for compatibility');
      console.log('🔗 Legacy linkage: template_products.legacy_id → dispatch_template_products.id');
      console.log('🔗 Template relation: template_products.template_id → templates.legacy_id');
      console.log('🔗 Product relation: template_products.product_id → products.legacy_id');

      // Show relationship statistics
      const uniqueTemplates = new Set(templateProducts.slice(0, totalInserted).map(tp => tp.template_id));
      const uniqueProducts = new Set(templateProducts.slice(0, totalInserted).map(tp => tp.product_id));

      console.log('\n📈 Template-Product relationship statistics:');
      console.log(`   📋 Unique templates with products: ${uniqueTemplates.size}`);
      console.log(`   📦 Unique products in templates: ${uniqueProducts.size}`);
      console.log(`   🔗 Total template-product associations: ${totalInserted}`);

      // Show template and product ID ranges
      const templateIds = templateProducts.slice(0, totalInserted).map(tp => tp.template_id);
      const productIds = templateProducts.slice(0, totalInserted).map(tp => tp.product_id);

      console.log(`   📋 Template ID range: ${Math.min(...templateIds)} - ${Math.max(...templateIds)}`);
      console.log(`   📦 Product ID range: ${Math.min(...productIds)} - ${Math.max(...productIds)}`);
    } else {
      console.log('\n⚠️  Template products migration completed with issues - check errors above');
    }

    return totalInserted;

  } catch (error: any) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await sourceClient.end();
    console.log('🔌 Disconnected from source database');
  }
}

// Run the migration
if (require.main === module) {
  migrateTemplateProductsWithLegacyIds().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default migrateTemplateProductsWithLegacyIds;