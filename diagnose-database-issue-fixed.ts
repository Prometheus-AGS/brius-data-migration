import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function diagnoseDatabaseIssueFixed() {
  console.log('🔍 DIAGNOSING DATABASE CONNECTION AND DATA ISSUE (FIXED)\n');
  console.log(`🌐 Connecting to: ${process.env.SUPABASE_URL}`);
  console.log(`🔑 Using service role: ${process.env.SUPABASE_SERVICE_ROLE?.substring(0, 20)}...\n`);

  try {
    // Test basic connection with a known table
    console.log('1️⃣ Testing basic connection...');
    const { data: testData, error: testError } = await supabase
      .from('operations')
      .select('*', { count: 'exact', head: true });

    if (testError) {
      console.error('❌ Connection test failed:', testError);
    } else {
      console.log(`✅ Connection successful! Found ${testData || 0} operations\n`);
    }

    // Check what tables exist with data
    console.log('2️⃣ Checking available tables and data...');
    const tables = [
      'files', 'orders', 'cases', 'case_files', 'case_messages', 'case_states',
      'purchases', 'shipments', 'operations', 'payments', 'global_settings',
      'teams', 'role_permissions', 'template_edit_roles', 'template_view_groups',
      'template_products', 'order_cases', 'message_attachments'
    ];

    const existingTables = [];

    for (const tableName of tables) {
      try {
        const { count, error } = await supabase
          .from(tableName)
          .select('*', { count: 'exact', head: true });

        if (error) {
          console.log(`   ❌ ${tableName}: ${error.message}`);
        } else {
          console.log(`   ✅ ${tableName}: ${count || 0} records`);
          if (count && count > 0) {
            existingTables.push({ table: tableName, count });
          }
        }
      } catch (tableError: any) {
        console.log(`   ❌ ${tableName}: ${tableError.message}`);
      }
    }

    // Show summary of tables with data
    console.log('\n3️⃣ SUMMARY - Tables with actual data:');
    if (existingTables.length > 0) {
      existingTables.forEach(({ table, count }) => {
        console.log(`   📊 ${table}: ${count} records`);
      });
    } else {
      console.log('   ⚠️  No tables found with data');
    }

    // Test insert into a table that definitely exists
    if (existingTables.length > 0) {
      const targetTable = 'operations'; // Based on error hint
      console.log(`\n4️⃣ Testing insert capability on ${targetTable}...`);

      try {
        // Get the table structure first
        const { data: sampleData, error: sampleError } = await supabase
          .from(targetTable)
          .select('*')
          .limit(1);

        if (!sampleError && sampleData && sampleData.length > 0) {
          console.log(`   ✅ Sample record structure:`, Object.keys(sampleData[0]));
        }
      } catch (e) {
        console.log(`   ❌ Could not examine ${targetTable} structure`);
      }
    }

    // Check for any migration tracking tables
    console.log('\n5️⃣ Checking for migration control tables...');
    const migrationTables = ['migration_control', 'migration_mappings', 'migration_checkpoints'];

    for (const tableName of migrationTables) {
      try {
        const { count, error } = await supabase
          .from(tableName)
          .select('*', { count: 'exact', head: true });

        if (!error) {
          console.log(`   ✅ ${tableName}: ${count || 0} records`);
        } else {
          console.log(`   ❌ ${tableName}: Does not exist or no access`);
        }
      } catch (e) {
        console.log(`   ❌ ${tableName}: Not accessible`);
      }
    }

  } catch (error: any) {
    console.error('❌ Diagnostic failed:', error);
  }

  console.log('\n✨ Database diagnostic completed!');
}

// Run the diagnostic
if (require.main === module) {
  diagnoseDatabaseIssueFixed().catch(error => {
    console.error('Fatal diagnostic error:', error);
    process.exit(1);
  });
}

export default diagnoseDatabaseIssueFixed;