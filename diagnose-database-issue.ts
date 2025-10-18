import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function diagnoseDatabaseIssue() {
  console.log('🔍 DIAGNOSING DATABASE CONNECTION AND DATA ISSUE\n');
  console.log(`🌐 Connecting to: ${process.env.SUPABASE_URL}`);
  console.log(`🔑 Using service role: ${process.env.SUPABASE_SERVICE_ROLE?.substring(0, 20)}...\n`);

  try {
    // Test basic connection
    console.log('1️⃣ Testing basic connection...');
    const { data: testData, error: testError } = await supabase
      .from('information_schema')
      .select('table_name')
      .limit(1);

    if (testError) {
      console.error('❌ Connection test failed:', testError);
      return;
    }
    console.log('✅ Connection successful!\n');

    // Check what tables exist
    console.log('2️⃣ Checking available tables...');
    const tables = ['files', 'orders', 'cases', 'case_files', 'case_messages', 'case_states', 'purchases', 'shipments'];

    for (const tableName of tables) {
      try {
        const { count, error } = await supabase
          .from(tableName)
          .select('*', { count: 'exact', head: true });

        if (error) {
          console.log(`   ❌ ${tableName}: Table doesn't exist or access denied - ${error.message}`);
        } else {
          console.log(`   ✅ ${tableName}: ${count || 0} records`);
        }
      } catch (tableError: any) {
        console.log(`   ❌ ${tableName}: Error - ${tableError.message}`);
      }
    }

    // Test actual insert into case_files
    console.log('\n3️⃣ Testing direct insert into case_files...');
    const testRecord = {
      file_id: '00000000-0000-0000-0000-000000000001',
      case_id: '00000000-0000-0000-0000-000000000001',
      file_name: 'test-diagnostic-file.txt',
      file_type: 'text/plain',
      uploaded_at: new Date().toISOString(),
      metadata: { diagnostic: true }
    };

    const { data: insertData, error: insertError } = await supabase
      .from('case_files')
      .insert(testRecord)
      .select();

    if (insertError) {
      console.log(`   ❌ Insert failed: ${insertError.message}`);
      console.log(`   🔍 Error details:`, insertError);
    } else {
      console.log(`   ✅ Insert successful:`, insertData);

      // Now try to read it back
      const { data: readData, error: readError } = await supabase
        .from('case_files')
        .select('*')
        .eq('file_name', 'test-diagnostic-file.txt');

      if (readError) {
        console.log(`   ❌ Read back failed: ${readError.message}`);
      } else {
        console.log(`   ✅ Read back successful: ${readData?.length || 0} records found`);
      }

      // Clean up test record
      await supabase
        .from('case_files')
        .delete()
        .eq('file_name', 'test-diagnostic-file.txt');
    }

    // Check current migration status tables
    console.log('\n4️⃣ Checking migration control tables...');
    try {
      const { data: controlData, error: controlError } = await supabase
        .from('migration_control')
        .select('*')
        .limit(5);

      if (controlError) {
        console.log('   ❌ migration_control: Not accessible');
      } else {
        console.log(`   ✅ migration_control: ${controlData?.length || 0} recent records`);
      }
    } catch (e) {
      console.log('   ❌ migration_control: Table may not exist');
    }

    // Final count verification
    console.log('\n5️⃣ Final verification - Current counts in all tables:');
    for (const tableName of tables) {
      try {
        const { count } = await supabase
          .from(tableName)
          .select('*', { count: 'exact', head: true });
        console.log(`   📊 ${tableName}: ${count || 0} records`);
      } catch (e) {
        console.log(`   ❌ ${tableName}: Cannot access`);
      }
    }

  } catch (error: any) {
    console.error('❌ Diagnostic failed:', error);
  }

  console.log('\n✨ Database diagnostic completed!');
}

// Run the diagnostic
if (require.main === module) {
  diagnoseDatabaseIssue().catch(error => {
    console.error('Fatal diagnostic error:', error);
    process.exit(1);
  });
}

export default diagnoseDatabaseIssue;