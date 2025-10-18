import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function inspectTargetSchemasSql() {
  console.log('🔍 Inspecting target table schemas using SQL...\n');

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
      // Get actual column definitions using SQL
      const { data: columnData, error } = await supabase.rpc('exec_sql', {
        sql: `
          SELECT
            column_name,
            data_type,
            is_nullable,
            column_default
          FROM information_schema.columns
          WHERE table_name = '${tableName}'
          AND table_schema = 'public'
          ORDER BY ordinal_position;
        `
      });

      if (error) {
        console.log(`   ❌ Error getting schema: ${error.message}`);
        continue;
      }

      // Handle different response formats
      let actualColumns = columnData;
      if (columnData && !Array.isArray(columnData)) {
        actualColumns = columnData.data || columnData.rows || [];
      }

      if (actualColumns && Array.isArray(actualColumns) && actualColumns.length > 0) {
        console.log('   ✅ Columns:');
        actualColumns.forEach((col: any) => {
          const nullable = col.is_nullable === 'YES' ? '(nullable)' : '(required)';
          const defaultVal = col.column_default ? ` default: ${col.column_default}` : '';
          console.log(`      • ${col.column_name}: ${col.data_type} ${nullable}${defaultVal}`);
        });
      } else {
        console.log('   ❌ No column information available');
      }

    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`);
    }

    console.log('');
  }

  console.log('✨ Target schema inspection completed!');
}

// Run the inspection
if (require.main === module) {
  inspectTargetSchemasSql().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default inspectTargetSchemasSql;