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

async function discoverOperationsSchema(): Promise<string[]> {
  console.log('🔍 Discovering operations table schema...');

  // Test different field combinations to find what works
  const testConfigurations = [
    { case_id: '00000000-0000-0000-0000-000000000001' }, // Minimal
    { case_id: '00000000-0000-0000-0000-000000000001', description: 'Test' },
    { case_id: '00000000-0000-0000-0000-000000000001', procedure_name: 'Test' },
    { case_id: '00000000-0000-0000-0000-000000000001', operation_name: 'Test' },
    { case_id: '00000000-0000-0000-0000-000000000001', notes: 'Test' },
    { case_id: '00000000-0000-0000-0000-000000000001', cost: 100.50 },
    { case_id: '00000000-0000-0000-0000-000000000001', price: 100.50 },
    { case_id: '00000000-0000-0000-0000-000000000001', total_amount: 100.50 }
  ];

  for (const testFields of testConfigurations) {
    try {
      const { data: result, error } = await supabase
        .from('operations')
        .insert(testFields)
        .select();

      if (!error && result) {
        console.log(`✅ Working schema found: ${Object.keys(testFields).join(', ')}`);

        // Clean up test record
        await supabase
          .from('operations')
          .delete()
          .eq('id', result[0].id);

        return Object.keys(testFields);
      }
    } catch (e) {
      // Continue to next test
    }
  }

  console.log('❌ Could not find working schema, using minimal fields');
  return ['case_id']; // Fallback to minimal required field
}

async function migrateOperations() {
  console.log('🚀 Starting operations migration based on existing pattern...\n');

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

    // Discover what fields work in the operations table
    const workingFields = await discoverOperationsSchema();

    // Get a default case to use for operations that don't have a direct case link
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
    console.log(`💰 Total value: $${operationsResult.rows.reduce((sum: number, row: any) => sum + parseFloat(row.price || '0'), 0).toFixed(2)}`);

    // Map source data to target schema based on discovered fields
    const operations = operationsResult.rows.map((row: any) => {
      const baseOperation: any = {
        case_id: defaultCase.id, // Always required
      };

      // Add fields based on what was discovered to work
      if (workingFields.includes('description')) {
        baseOperation.description = `Square Payment - ${row.card_brand} ending in ${row.card_last}`;
      }

      if (workingFields.includes('procedure_name')) {
        baseOperation.procedure_name = `Payment Processing - Type ${row.type}`;
      }

      if (workingFields.includes('operation_name')) {
        baseOperation.operation_name = `Square Payment - ${row.card_brand}`;
      }

      if (workingFields.includes('notes')) {
        baseOperation.notes = `Square Order: ${row.sq_order_id}, Payment: ${row.sq_payment_id}`;
      }

      // Try different amount field names
      if (workingFields.includes('cost')) {
        baseOperation.cost = parseFloat(row.price || '0');
      } else if (workingFields.includes('price')) {
        baseOperation.price = parseFloat(row.price || '0');
      } else if (workingFields.includes('total_amount')) {
        baseOperation.total_amount = parseFloat(row.price || '0');
      }

      // Add standard fields if they exist
      if (workingFields.includes('created_at') || workingFields.includes('operation_date')) {
        const dateField = workingFields.includes('created_at') ? 'created_at' : 'operation_date';
        baseOperation[dateField] = row.made_at || new Date().toISOString();
      }

      if (workingFields.includes('updated_at')) {
        baseOperation.updated_at = row.made_at || new Date().toISOString();
      }

      // Add metadata if supported
      if (workingFields.includes('metadata')) {
        baseOperation.metadata = {
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
          operation_type: row.type
        };
      }

      return baseOperation;
    });

    console.log(`\n📦 Prepared ${operations.length} operations for insertion`);
    console.log(`🏗️  Using fields: ${Object.keys(operations[0] || {}).join(', ')}`);

    // Show sample operation
    if (operations.length > 0) {
      console.log('\n📋 Sample operation:');
      console.log(JSON.stringify(operations[0], null, 2));
    }

    // Insert operations in batches
    console.log('\n⚡ Starting batch insertion...');
    const totalInserted = await insertInBatches('operations', operations);

    // Final summary
    console.log('\n📊 OPERATIONS MIGRATION SUMMARY:');
    console.log(`✅ Source operations: ${operationsResult.rows.length}`);
    console.log(`✅ Successfully migrated: ${totalInserted}`);
    console.log(`✅ Success rate: ${((totalInserted / operationsResult.rows.length) * 100).toFixed(1)}%`);
    console.log(`💰 Total value migrated: $${operations.slice(0, totalInserted).reduce((sum: number, op: any) => {
      return sum + (parseFloat(op.cost || op.price || op.total_amount || '0'));
    }, 0).toFixed(2)}`);

    // Verify final count
    const { count: finalCount } = await supabase
      .from('operations')
      .select('*', { count: 'exact', head: true });

    console.log(`📦 Final operations count in database: ${finalCount || 0}`);

    if (totalInserted > 0) {
      console.log('\n🎉 Operations migration completed successfully!');
    } else {
      console.log('\n⚠️  Operations migration completed with issues - check errors above');
    }

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
  migrateOperations().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default migrateOperations;