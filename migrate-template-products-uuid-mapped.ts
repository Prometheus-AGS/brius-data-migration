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

async function migrateTemplateProductsWithUuidMapping() {
  console.log('🚀 Starting template_products migration with UUID mapping...\n');

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

    // Step 1: Build mapping from legacy template IDs to UUIDs
    console.log('\n🗺️ Building legacy template ID to UUID mapping...');
    const { data: templates, error: templatesError } = await supabase
      .from('templates')
      .select('id, legacy_template_id, name');

    if (templatesError) {
      throw new Error(`Failed to fetch templates: ${templatesError.message}`);
    }

    const templateIdMapping = new Map<number, string>();
    if (templates && templates.length > 0) {
      templates.forEach(template => {
        if (template.legacy_template_id) {
          templateIdMapping.set(template.legacy_template_id, template.id);
        }
      });
      console.log(`📊 Built template mapping for ${templateIdMapping.size} templates`);

      // Show sample mappings
      let count = 0;
      for (const [legacyId, uuid] of templateIdMapping) {
        if (count < 3) {
          const templateName = templates.find(t => t.id === uuid)?.name;
          console.log(`   Template Legacy ID ${legacyId} → ${uuid} (${templateName || 'Unknown'})`);
          count++;
        }
      }
    } else {
      throw new Error('No templates found - please migrate templates first');
    }

    // Step 2: Build mapping from legacy product IDs to UUIDs
    console.log('\n🗺️ Building legacy product ID to UUID mapping...');
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, legacy_product_id, name');

    if (productsError) {
      throw new Error(`Failed to fetch products: ${productsError.message}`);
    }

    const productIdMapping = new Map<number, string>();
    if (products && products.length > 0) {
      products.forEach(product => {
        if (product.legacy_product_id) {
          productIdMapping.set(product.legacy_product_id, product.id);
        }
      });
      console.log(`📊 Built product mapping for ${productIdMapping.size} products`);

      // Show sample mappings
      let count = 0;
      for (const [legacyId, uuid] of productIdMapping) {
        if (count < 3) {
          const productName = products.find(p => p.id === uuid)?.name;
          console.log(`   Product Legacy ID ${legacyId} → ${uuid} (${productName || 'Unknown'})`);
          count++;
        }
      }
    } else {
      throw new Error('No products found - please populate legacy_product_id first');
    }

    // Step 3: Get source template_products data
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

    // Step 4: Transform data with UUID mapping
    const templateProducts = [];
    let templateMappingMisses = 0;
    let productMappingMisses = 0;

    for (const row of sourceResult.rows) {
      const templateUuid = templateIdMapping.get(row.template_id);
      const productUuid = productIdMapping.get(row.product_id);

      if (!templateUuid) {
        console.warn(`⚠️  No UUID mapping found for template legacy_id ${row.template_id}`);
        templateMappingMisses++;
        continue;
      }

      if (!productUuid) {
        console.warn(`⚠️  No UUID mapping found for product legacy_id ${row.product_id}`);
        productMappingMisses++;
        continue;
      }

      templateProducts.push({
        template_id: templateUuid, // Use UUID instead of legacy ID
        product_id: productUuid,   // Use UUID instead of legacy ID
        quantity: 1,
        legacy_id: row.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {
          legacy_id: row.id,
          legacy_template_id: row.template_id,
          legacy_product_id: row.product_id,
          source_table: 'dispatch_template_products',
          migration_timestamp: new Date().toISOString()
        }
      });
    }

    console.log(`📦 Prepared ${templateProducts.length} template products for insertion`);
    if (templateMappingMisses > 0) {
      console.log(`⚠️  ${templateMappingMisses} records skipped due to missing template mapping`);
    }
    if (productMappingMisses > 0) {
      console.log(`⚠️  ${productMappingMisses} records skipped due to missing product mapping`);
    }

    // Show sample template product with proper UUIDs
    if (templateProducts.length > 0) {
      console.log('\n📦 Sample template_product record with UUIDs:');
      console.log(JSON.stringify(templateProducts[0], null, 2));
    }

    // Step 5: Insert template_products in batches
    if (templateProducts.length > 0) {
      console.log('\n⚡ Starting batch insertion...');
      const totalInserted = await insertInBatches('template_products', templateProducts);

      // Summary
      console.log('\n📊 TEMPLATE PRODUCTS MIGRATION SUMMARY:');
      console.log(`✅ Source records: ${sourceResult.rows.length}`);
      console.log(`✅ Successfully mapped and migrated: ${totalInserted}`);
      console.log(`✅ Success rate: ${((totalInserted / templateProducts.length) * 100).toFixed(1)}%`);

      if (templateMappingMisses > 0 || productMappingMisses > 0) {
        console.log(`⚠️  Mapping misses: ${templateMappingMisses} templates, ${productMappingMisses} products`);
      }

      // Verify final count
      const { count: finalCount } = await supabase
        .from('template_products')
        .select('*', { count: 'exact', head: true });

      console.log(`📦 Final template_products count in database: ${finalCount || 0}`);

      if (totalInserted > 0) {
        console.log('\n🎉 Template products migration completed successfully!');
        console.log('🔗 All template-product relationships properly linked with UUIDs');
        console.log('🔗 Legacy linkage: template_products.legacy_id → dispatch_template_products.id');

        // Show relationship statistics
        const uniqueTemplates = new Set(templateProducts.slice(0, totalInserted).map(tp => tp.template_id));
        const uniqueProducts = new Set(templateProducts.slice(0, totalInserted).map(tp => tp.product_id));

        console.log('\n📈 Template-Product relationship statistics:');
        console.log(`   📋 Unique templates with products: ${uniqueTemplates.size}`);
        console.log(`   📦 Unique products in templates: ${uniqueProducts.size}`);
        console.log(`   🔗 Total template-product associations: ${totalInserted}`);
      } else {
        console.log('\n⚠️  Template products migration completed with issues - check errors above');
      }

      return totalInserted;
    } else {
      console.log('\n⚠️  No template products could be mapped - check template and product migrations');
      return 0;
    }

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
  migrateTemplateProductsWithUuidMapping().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default migrateTemplateProductsWithUuidMapping;