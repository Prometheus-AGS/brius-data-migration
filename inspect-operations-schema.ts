import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function inspectOperationsSchema() {
  console.log('🔍 Inspecting operations table schema and source data...\n');

  try {
    // First, let's try to get a sample record from operations to see the actual structure
    console.log('1️⃣ Checking target operations table structure...');

    const { data: sampleOp, error: opError } = await supabase
      .from('operations')
      .select('*')
      .limit(1);

    if (opError) {
      console.log(`❌ Error accessing operations table: ${opError.message}`);
    } else {
      if (sampleOp && sampleOp.length > 0) {
        console.log('✅ Operations table columns:');
        Object.keys(sampleOp[0]).forEach(col => {
          console.log(`   • ${col}: ${typeof sampleOp[0][col]}`);
        });
      } else {
        console.log('✅ Operations table exists but is empty');

        // Try to insert a test record to see what columns are required/available
        console.log('\n🧪 Testing operations table structure with dummy insert...');

        const testOp = {
          // Try common operation fields
          id: '00000000-0000-0000-0000-000000000001',
          case_id: '00000000-0000-0000-0000-000000000001',
          operation_type: 'payment',
          description: 'Test operation',
          amount: 100.00,
          status: 'completed',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          metadata: { test: true }
        };

        const { data: insertTest, error: insertError } = await supabase
          .from('operations')
          .insert(testOp)
          .select();

        if (insertError) {
          console.log(`❌ Insert test failed: ${insertError.message}`);
          console.log(`💡 This tells us about missing or incorrect column names`);
        } else {
          console.log(`✅ Insert test successful:`, insertTest);

          // Clean up test record
          await supabase
            .from('operations')
            .delete()
            .eq('id', testOp.id);

          console.log('🧹 Cleaned up test record');
        }
      }
    }

    // Now check source data structure
    console.log('\n2️⃣ Checking source dispatch_operation table...');

    const sourceClient = new Client({
      host: process.env.SOURCE_DB_HOST!,
      port: parseInt(process.env.SOURCE_DB_PORT!),
      user: process.env.SOURCE_DB_USER!,
      password: process.env.SOURCE_DB_PASSWORD!,
      database: process.env.SOURCE_DB_NAME!,
    });

    await sourceClient.connect();

    // Get source table structure
    const sourceStructure = await sourceClient.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'dispatch_operation'
      AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);

    console.log('✅ Source dispatch_operation columns:');
    sourceStructure.rows.forEach((col: any) => {
      console.log(`   • ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'required'})`);
    });

    // Get sample source data
    const sampleSource = await sourceClient.query(`
      SELECT * FROM dispatch_operation
      ORDER BY id
      LIMIT 3;
    `);

    console.log('\n📋 Sample source records:');
    sampleSource.rows.forEach((row, index) => {
      console.log(`   Record ${index + 1}:`, row);
    });

    // Get count and statistics
    const countResult = await sourceClient.query(`
      SELECT
        COUNT(*) as total_operations,
        COUNT(DISTINCT type) as unique_types,
        MIN(made_at) as earliest_date,
        MAX(made_at) as latest_date,
        SUM(price) as total_amount
      FROM dispatch_operation;
    `);

    console.log('\n📊 Source data statistics:');
    console.log(`   Total operations: ${countResult.rows[0].total_operations}`);
    console.log(`   Unique types: ${countResult.rows[0].unique_types}`);
    console.log(`   Date range: ${countResult.rows[0].earliest_date} to ${countResult.rows[0].latest_date}`);
    console.log(`   Total amount: $${countResult.rows[0].total_amount || 0}`);

    // Get type breakdown
    const typeBreakdown = await sourceClient.query(`
      SELECT type, COUNT(*) as count
      FROM dispatch_operation
      GROUP BY type
      ORDER BY count DESC;
    `);

    console.log('\n📈 Operation types breakdown:');
    typeBreakdown.rows.forEach((row: any) => {
      console.log(`   ${row.type || 'NULL'}: ${row.count} operations`);
    });

    await sourceClient.end();

  } catch (error: any) {
    console.error('❌ Inspection failed:', error);
  }

  console.log('\n✨ Operations schema inspection completed!');
}

// Run the inspection
if (require.main === module) {
  inspectOperationsSchema().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default inspectOperationsSchema;