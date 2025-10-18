import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function investigateSystemMessagesSchema() {
  console.log('🔍 Investigating system_messages table schema...\n');

  try {
    // Step 1: Try to get the schema by querying a sample record
    console.log('📋 Checking system_messages table structure...');
    const { data: sampleData, error: sampleError } = await supabase
      .from('system_messages')
      .select('*')
      .limit(1);

    if (sampleError) {
      console.log(`❌ Error accessing system_messages table: ${sampleError.message}`);
      return;
    }

    if (sampleData && sampleData.length > 0) {
      console.log('✅ Found existing data in system_messages table');
      console.log('📋 Available columns:', Object.keys(sampleData[0]));
      console.log('📋 Sample record:', JSON.stringify(sampleData[0], null, 2));
    } else {
      console.log('📊 system_messages table is empty - will try to insert a test record to discover schema');

      // Try to insert a minimal test record to discover schema requirements
      const testRecord = {
        id: '00000000-0000-0000-0000-000000000001', // Use a specific UUID for testing
        content: 'Test message',
        message_type: 'info',
        priority: 'normal',
        is_active: true,
        legacy_record_id: 99999,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      console.log('🧪 Attempting test insert to discover schema...');
      const { data: insertData, error: insertError } = await supabase
        .from('system_messages')
        .insert([testRecord])
        .select();

      if (insertError) {
        console.log(`❌ Test insert failed: ${insertError.message}`);
        console.log('💡 This helps us understand the expected schema');

        // Try alternative column names
        const alternativeTests = [
          { title: 'Test with "text" instead of "content"', record: { ...testRecord, text: testRecord.content } },
          { title: 'Test with "body" instead of "content"', record: { ...testRecord, body: testRecord.content } },
          { title: 'Test without "content"', record: { id: testRecord.id, message_type: 'info', is_active: true } }
        ];

        for (const test of alternativeTests) {
          console.log(`\n🧪 ${test.title}:`);
          const { error: altError } = await supabase
            .from('system_messages')
            .insert([test.record]);

          if (altError) {
            console.log(`   ❌ ${altError.message}`);
          } else {
            console.log(`   ✅ Success! This column structure works`);
            // Clean up the test record
            await supabase.from('system_messages').delete().eq('id', test.record.id);
            break;
          }
        }
      } else {
        console.log('✅ Test insert successful');
        console.log('📋 Inserted record:', insertData);

        // Clean up the test record
        await supabase.from('system_messages').delete().eq('id', testRecord.id);
        console.log('🧹 Test record cleaned up');
      }
    }

    // Step 2: Try to get table information from PostgreSQL system tables via raw SQL
    console.log('\n📋 Attempting to query table schema via SQL...');
    try {
      // This might not work with Supabase client, but worth trying
      const { data: schemaData, error: schemaError } = await supabase.rpc('get_table_schema', {
        table_name: 'system_messages'
      });

      if (schemaError) {
        console.log(`❌ Schema RPC failed: ${schemaError.message}`);
      } else {
        console.log('✅ Schema data:', schemaData);
      }
    } catch (rpcError: any) {
      console.log(`❌ RPC not available: ${rpcError.message}`);
    }

    console.log('\n📊 SCHEMA INVESTIGATION COMPLETE');
    console.log('💡 Use the discovered column names to update the migration script');

  } catch (error: any) {
    console.error('❌ Investigation failed:', error);
    throw error;
  }
}

// Run the investigation
if (require.main === module) {
  investigateSystemMessagesSchema().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default investigateSystemMessagesSchema;