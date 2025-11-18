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

async function migrateTemplateProducts() {
  console.log('🚀 Starting template_products migration (FIXED version with UUID mapping)...\n');

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

    // First, get UUID mappings from target database
    console.log('\n🔍 Getting UUID mappings from target database...');

    const [templateMappings, productMappings] = await Promise.all([
      // Get template mappings
      supabase.from('templates').select('id, legacy_template_id').not('legacy_template_id', 'is', null),
      // Get product mappings
      supabase.from('products').select('id, legacy_product_id').not('legacy_product_id', 'is', null)
    ]);

    if (templateMappings.error) {
      console.error('❌ Error fetching template mappings:', templateMappings.error);
      return 0;
    }

    if (productMappings.error) {
      console.error('❌ Error fetching product mappings:', productMappings.error);
      return 0;
    }

    // Create mapping objects
    const templateMap = new Map<number, string>();
    const productMap = new Map<number, string>();

    templateMappings.data?.forEach(row => {
      if (row.legacy_template_id) {
        templateMap.set(row.legacy_template_id, row.id);
      }
    });

    productMappings.data?.forEach(row => {
      if (row.legacy_product_id) {
        productMap.set(row.legacy_product_id, row.id);
      }
    });

    console.log(`✓ Found ${templateMap.size} template UUID mappings`);
    console.log(`✓ Found ${productMap.size} product UUID mappings`);

    // Find the correct template products table name
    console.log('\n🔍 Finding template products table in source...');
    const possibleTableNames = [
      'template_products',
      'dispatch_template_product',
      'template_product',
      'dispatch_template_products'
    ];

    let sourceTableName = '';
    let sourceSchema: any[] = [];
    let sourceCount = 0;

    for (const tableName of possibleTableNames) {
      try {
        console.log(`🔍 Trying table name: ${tableName}`);

        // Check if table exists and get structure
        const structureResult = await sourceClient.query(`
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_name = $1 AND table_schema = 'public'
          ORDER BY ordinal_position;
        `, [tableName]);

        if (structureResult.rows.length > 0) {
          sourceTableName = tableName;
          sourceSchema = structureResult.rows;

          // Get count
          const countResult = await sourceClient.query(`SELECT COUNT(*) as count FROM ${tableName}`);
          sourceCount = parseInt(countResult.rows[0].count);

          console.log(`✅ Found source table: ${tableName} with ${sourceCount} records`);
          break;
        }
      } catch (error: any) {
        console.log(`   ❌ ${tableName} not found: ${error.message}`);
      }
    }

    if (!sourceTableName) {
      console.log('❌ Could not find template products table in source database');
      return 0;
    }

    // Display source schema
    console.log(`\n📋 Source table structure (${sourceTableName}):`);
    sourceSchema.forEach((col: any) => {
      console.log(`   • ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'required'})`);
    });

    if (sourceCount === 0) {
      console.log('⚠️  Source table is empty - no data to migrate');
      return 0;
    }

    // Get source data
    console.log(`\n📦 Fetching ${sourceCount} template products from ${sourceTableName}...`);
    const sourceResult = await sourceClient.query(`
      SELECT *
      FROM ${sourceTableName}
      ORDER BY id;
    `);

    console.log(`📊 Retrieved ${sourceResult.rows.length} records from source`);

    // Show sample data
    if (sourceResult.rows.length > 0) {
      console.log('\n📋 Sample source record:');
      console.log(JSON.stringify(sourceResult.rows[0], null, 2));
    }

    // Check existing template_products to avoid duplicates
    console.log('\n🔍 Checking for existing template_products...');
    const { data: existingData } = await supabase
      .from('template_products')
      .select('legacy_id')
      .not('legacy_id', 'is', null);

    const existingIds = new Set<number>();
    if (existingData) {
      existingData.forEach(row => {
        if (row.legacy_id) {
          existingIds.add(row.legacy_id);
        }
      });
    }
    console.log(`✓ Found ${existingIds.size} existing template_products records to skip`);

    // Transform source data to target schema with UUID mapping
    console.log('\n🔄 Transforming data for target schema with UUID mapping...');
    const templateProducts = sourceResult.rows
      .filter((row: any) => !existingIds.has(row.id)) // Skip existing records
      .map((row: any) => {
        // 🔧 FIX: Map legacy integer IDs to UUIDs
        const templateUuid = templateMap.get(row.template_id);
        const productUuid = productMap.get(row.product_id);

        if (!templateUuid) {
          console.log(`⏭️  Skipping template_product ${row.id} - no UUID mapping for template_id ${row.template_id}`);
          return null;
        }

        if (!productUuid) {
          console.log(`⏭️  Skipping template_product ${row.id} - no UUID mapping for product_id ${row.product_id}`);
          return null;
        }

        return {
          template_id: templateUuid, // ✅ NOW USING UUID
          product_id: productUuid,   // ✅ NOW USING UUID
          quantity: row.quantity || 1,
          legacy_id: row.id,
          created_at: row.created_at || new Date().toISOString(),
          updated_at: row.updated_at || new Date().toISOString(),
          metadata: {
            legacy_id: row.id,
            legacy_template_id: row.template_id,
            legacy_product_id: row.product_id,
            source_table: sourceTableName,
            migration_timestamp: new Date().toISOString(),
            original_data: row
          }
        };
      })
      .filter(record => record !== null); // Remove skipped records

    console.log(`📦 Prepared ${templateProducts.length} template products for insertion (${sourceResult.rows.length - templateProducts.length} skipped due to missing mappings)`);

    if (templateProducts.length === 0) {
      console.log('⚠️  No valid template products to migrate after UUID mapping');
      return 0;
    }

    // Show sample transformed record
    console.log('\n📋 Sample transformed record:');
    console.log(JSON.stringify(templateProducts[0], null, 2));

    // Insert in batches
    console.log('\n⚡ Starting batch insertion...');
    const totalInserted = await insertInBatches('template_products', templateProducts);

    // Summary
    console.log('\n📊 TEMPLATE PRODUCTS MIGRATION SUMMARY:');
    console.log(`✅ Source records (${sourceTableName}): ${sourceResult.rows.length}`);
    console.log(`✅ Valid for migration: ${templateProducts.length}`);
    console.log(`✅ Successfully migrated: ${totalInserted}`);
    console.log(`✅ Success rate: ${templateProducts.length > 0 ? ((totalInserted / templateProducts.length) * 100).toFixed(1) : 0}%`);

    // Verify final count
    const { count: finalCount } = await supabase
      .from('template_products')
      .select('*', { count: 'exact', head: true });

    console.log(`📦 Final template_products count in database: ${finalCount || 0}`);

    if (totalInserted > 0) {
      console.log('\n🎉 Template products migration completed successfully!');
      console.log('🔗 Legacy linkage: template_products.legacy_id → source.id');
      console.log('🔗 UUID mapping: template_products.template_id → templates.id');
      console.log('🔗 UUID mapping: template_products.product_id → products.id');
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
  migrateTemplateProducts().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default migrateTemplateProducts;