import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function inspectTargetSchemas() {
  console.log('🔍 Inspecting actual target table schemas in Supabase...\n');

  const targetTables = [
    'operations',
    'payments',
    'global_settings',
    'template_edit_roles',
    'template_view_groups',
    'template_products',
    'teams',
    'role_permissions',
    'customer_feedback',
    'patient_events',
    'shipments',
    'system_messages',
    'order_cases'
  ];

  for (const tableName of targetTables) {
    console.log(`📋 ${tableName}:`);

    try {
      // Try to get schema by attempting to insert an empty record and seeing the error
      const { error } = await supabase
        .from(tableName)
        .insert({});

      if (error) {
        console.log(`   Schema error reveals columns: ${error.message}`);
      }

      // Try to get a sample record to understand structure
      const { data: sampleData, error: selectError } = await supabase
        .from(tableName)
        .select('*')
        .limit(1);

      if (!selectError && sampleData && sampleData.length > 0) {
        console.log(`   Sample record columns: ${Object.keys(sampleData[0]).join(', ')}`);
      } else if (!selectError) {
        console.log(`   Table exists but is empty`);
      }

      // Try to get count
      const { count, error: countError } = await supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true });

      if (!countError) {
        console.log(`   Current record count: ${count || 0}`);
      }

    } catch (error: any) {
      console.log(`   Error accessing table: ${error.message}`);
    }

    console.log('');
  }

  // Also check some working tables for reference
  console.log('📋 Reference - Working table schemas:');
  const workingTables = ['case_messages', 'case_states', 'files', 'orders'];

  for (const tableName of workingTables) {
    try {
      const { data: sampleData, error } = await supabase
        .from(tableName)
        .select('*')
        .limit(1);

      if (!error && sampleData && sampleData.length > 0) {
        console.log(`✅ ${tableName}: ${Object.keys(sampleData[0]).join(', ')}`);
      }
    } catch (error: any) {
      console.log(`❌ ${tableName}: ${error.message}`);
    }
  }

  console.log('\n✨ Target schema inspection completed!');
}

// Run the inspection
if (require.main === module) {
  inspectTargetSchemas().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default inspectTargetSchemas;