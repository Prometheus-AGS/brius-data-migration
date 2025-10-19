import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function insertInBatches(tableName: string, data: any[]): Promise<number> {
  const batchSize = 50; // Smaller batches for better error handling
  let totalInserted = 0;

  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);

    try {
      const { error } = await supabase
        .from(tableName)
        .insert(batch);

      if (error) {
        console.error(`   ❌ Error inserting batch for ${tableName}:`, error.message);
        // Log first item to understand structure
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

async function migrateOperationsCorrected() {
  console.log('🚀 Starting corrected operations migration...\n');

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

    // Get a default case to use for operations
    console.log('\n📋 Getting default case for operations...');
    const { data: defaultCase } = await supabase
      .from('cases')
      .select('id')
      .limit(1)
      .single();

    if (!defaultCase) {
      console.log('❌ No cases found - cannot migrate operations without case_id');
      return;
    }

    console.log(`✅ Using default case: ${defaultCase.id}`);

    // Get source operations data
    console.log('\n⚙️ Fetching operations from dispatch_operation...');
    const operationsResult = await sourceClient.query(`
      SELECT
        id,
        type,
        made_at,
        price,
        sq_order_id,
        sq_payment_id,
        sq_refund_id,
        card_brand,
        card_bin,
        card_last,
        office_card,
        payment_id,
        attempts
      FROM dispatch_operation
      ORDER BY id;
    `);

    console.log(`📊 Found ${operationsResult.rows.length} operations to migrate`);

    // Get type distribution for mapping
    const typeStats = operationsResult.rows.reduce((acc: any, row: any) => {
      acc[row.type] = (acc[row.type] || 0) + 1;
      return acc;
    }, {});

    console.log(`📈 Operation types in source:`, typeStats);

    // Map source data to target schema with REQUIRED operation_type
    const operations = operationsResult.rows.map((row: any) => {
      // Map type numbers to operation types (handle null/undefined safely)
      let operationType = 'payment'; // Default
      if (row.type === 1) operationType = 'payment';
      else if (row.type === 2) operationType = 'refund';

      return {
        case_id: defaultCase.id, // Required
        operation_type: operationType, // Required - now included!
        amount: parseFloat(row.price || '0'), // Use the amount column
        legacy_id: row.id, // Use existing legacy_id column
        created_at: row.made_at || new Date().toISOString(),
        updated_at: row.made_at || new Date().toISOString(),
        metadata: {
          legacy_id: row.id,
          sq_order_id: row.sq_order_id,
          sq_payment_id: row.sq_payment_id,
          sq_refund_id: row.sq_refund_id,
          card_brand: row.card_brand,
          card_bin: row.card_bin,
          card_last: row.card_last,
          office_card: row.office_card,
          payment_id: row.payment_id,
          attempts: row.attempts,
          price: parseFloat(row.price || '0')
        }
      };
    });

    console.log(`\n📦 Prepared ${operations.length} operations for insertion`);

    // Show sample operation
    if (operations.length > 0) {
      console.log('\n📋 Sample operation:');
      console.log(JSON.stringify(operations[0], null, 2));
    }

    console.log(`💰 Total value to migrate: $${operations.reduce((sum: number, op: any) => {
      return sum + (parseFloat(op.metadata?.price || '0'));
    }, 0).toFixed(2)}`);

    // Insert operations in batches
    console.log('\n⚡ Starting batch insertion...');
    const totalInserted = await insertInBatches('operations', operations);

    // Final summary
    console.log('\n📊 OPERATIONS MIGRATION SUMMARY:');
    console.log(`✅ Source operations: ${operationsResult.rows.length}`);
    console.log(`✅ Successfully migrated: ${totalInserted}`);
    console.log(`✅ Success rate: ${((totalInserted / operationsResult.rows.length) * 100).toFixed(1)}%`);

    const migratedValue = operations.slice(0, totalInserted).reduce((sum: number, op: any) => {
      return sum + (parseFloat(op.metadata?.price || '0'));
    }, 0);

    console.log(`💰 Total value migrated: $${migratedValue.toFixed(2)}`);

    // Show operation type distribution
    if (totalInserted > 0) {
      const migratedOps = operations.slice(0, totalInserted);
      const typeDistribution = migratedOps.reduce((acc: any, op: any) => {
        acc[op.operation_type] = (acc[op.operation_type] || 0) + 1;
        return acc;
      }, {});

      console.log('\n📈 Migrated operation types:');
      Object.entries(typeDistribution).forEach(([type, count]) => {
        console.log(`   ${type}: ${count} operations`);
      });
    }

    // Verify final count
    const { count: finalCount } = await supabase
      .from('operations')
      .select('*', { count: 'exact', head: true });

    console.log(`📦 Final operations count in database: ${finalCount || 0}`);

    if (totalInserted > 0) {
      console.log('\n🎉 Operations migration completed successfully!');
      console.log('💳 Square payment operations with full card details preserved in metadata');
    } else {
      console.log('\n⚠️  Operations migration completed with issues - check errors above');
    }

    return totalInserted;

  } catch (error: any) {
    console.error('❌ Operations migration failed:', error);
    throw error;
  } finally {
    await sourceClient.end();
    console.log('🔌 Disconnected from source database');
  }
}

// Run the migration
if (require.main === module) {
  migrateOperationsCorrected().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default migrateOperationsCorrected;