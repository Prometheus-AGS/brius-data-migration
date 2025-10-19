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
  console.log('🚀 Starting template_products migration...\n');

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

    // First, find the correct template products table name
    console.log('\n🔍 Finding template products table in source...');
    const templateTablesResult = await sourceClient.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND (table_name LIKE '%template%' AND table_name LIKE '%product%')
      ORDER BY table_name;
    `);

    if (templateTablesResult.rows.length === 0) {
      console.log('❌ No template product tables found. Checking for alternative names...');

      // Check for alternative table names
      const alternativeNamesResult = await sourceClient.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name LIKE '%product%'
        ORDER BY table_name;
      `);

      console.log('📋 Available product-related tables:');
      alternativeNamesResult.rows.forEach((row: any) => {
        console.log(`   • ${row.table_name}`);
      });

      if (alternativeNamesResult.rows.length === 0) {
        console.log('❌ No product-related tables found in source database');
        return 0;
      }
    }

    // Try different possible table names
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

    // Check target table structure
    console.log('\n🎯 Checking target template_products table...');
    const { data: sampleTarget, error: sampleError } = await supabase
      .from('template_products')
      .select('*')
      .limit(1);

    if (sampleError) {
      console.log(`❌ Error accessing target table: ${sampleError.message}`);
      console.log('💡 Please ensure template_products table exists in target database');
      return 0;
    }

    console.log('✅ Target template_products table is accessible');
    if (sampleTarget && sampleTarget.length > 0) {
      console.log('📋 Target table structure:', Object.keys(sampleTarget[0]));
    }

    // Transform source data to target schema
    console.log('\n🔄 Transforming data for target schema...');
    const templateProducts = sourceResult.rows.map((row: any) => {
      // Basic transformation - adapt based on actual schema
      return {
        template_id: row.template_id,
        product_id: row.product_id,
        quantity: row.quantity || 1,
        legacy_id: row.id,
        created_at: row.created_at || new Date().toISOString(),
        updated_at: row.updated_at || new Date().toISOString(),
        metadata: {
          legacy_id: row.id,
          source_table: sourceTableName,
          migration_timestamp: new Date().toISOString(),
          original_data: row
        }
      };
    });

    console.log(`📦 Prepared ${templateProducts.length} template products for insertion`);

    // Show sample transformed record
    if (templateProducts.length > 0) {
      console.log('\n📋 Sample transformed record:');
      console.log(JSON.stringify(templateProducts[0], null, 2));
    }

    // Insert in batches
    console.log('\n⚡ Starting batch insertion...');
    const totalInserted = await insertInBatches('template_products', templateProducts);

    // Summary
    console.log('\n📊 TEMPLATE PRODUCTS MIGRATION SUMMARY:');
    console.log(`✅ Source records (${sourceTableName}): ${sourceResult.rows.length}`);
    console.log(`✅ Successfully migrated: ${totalInserted}`);
    console.log(`✅ Success rate: ${((totalInserted / sourceResult.rows.length) * 100).toFixed(1)}%`);

    // Verify final count
    const { count: finalCount } = await supabase
      .from('template_products')
      .select('*', { count: 'exact', head: true });

    console.log(`📦 Final template_products count in database: ${finalCount || 0}`);

    if (totalInserted > 0) {
      console.log('\n🎉 Template products migration completed successfully!');
      console.log('🔗 Legacy linkage: template_products.legacy_id → source.id');
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