import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function investigateTemplateTables() {
  console.log('🔍 Investigating template_products and template_predecessors tables...\n');

  const sourceClient = new Client({
    host: process.env.SOURCE_DB_HOST!,
    port: parseInt(process.env.SOURCE_DB_PORT!),
    user: process.env.SOURCE_DB_USER!,
    password: process.env.SOURCE_DB_PASSWORD!,
    database: process.env.SOURCE_DB_NAME!,
  });

  try {
    await sourceClient.connect();
    console.log('✅ Connected to source database\n');

    // Find all template-related tables in source
    console.log('📋 1. Finding all template-related tables in source...');
    const templateTablesResult = await sourceClient.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name LIKE '%template%'
      ORDER BY table_name;
    `);

    console.log('🗂️ Found template-related source tables:');
    templateTablesResult.rows.forEach((row: any) => {
      console.log(`   • ${row.table_name}`);
    });

    // Look specifically for product and predecessor related tables
    console.log('\n📋 2. Looking for product and predecessor related tables...');
    const productTablesResult = await sourceClient.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND (table_name LIKE '%product%' OR table_name LIKE '%predecessor%')
      ORDER BY table_name;
    `);

    console.log('🗂️ Found product/predecessor related tables:');
    productTablesResult.rows.forEach((row: any) => {
      console.log(`   • ${row.table_name}`);
    });

    // Check specific table names the user mentioned
    const targetTables = ['template_products', 'template_predecessors'];

    for (const tableName of targetTables) {
      console.log(`\n📊 Investigating ${tableName}:`);

      try {
        // Check if table exists and get structure
        const structureResult = await sourceClient.query(`
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_name = $1 AND table_schema = 'public'
          ORDER BY ordinal_position;
        `, [tableName]);

        if (structureResult.rows.length > 0) {
          console.log(`   📋 Structure:`);
          structureResult.rows.forEach((col: any) => {
            console.log(`     • ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'required'})`);
          });

          // Get count and foreign key relationships
          const countResult = await sourceClient.query(`SELECT COUNT(*) as count FROM ${tableName}`);
          console.log(`   📈 Count: ${countResult.rows[0].count} records`);

          // Get foreign key relationships
          const fkResult = await sourceClient.query(`
            SELECT
              kcu.column_name,
              ccu.table_name AS foreign_table_name,
              ccu.column_name AS foreign_column_name
            FROM
              information_schema.table_constraints AS tc
              JOIN information_schema.key_column_usage AS kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema = kcu.table_schema
              JOIN information_schema.constraint_column_usage AS ccu
                ON ccu.constraint_name = tc.constraint_name
                AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1;
          `, [tableName]);

          if (fkResult.rows.length > 0) {
            console.log(`   🔗 Foreign key relationships:`);
            fkResult.rows.forEach((fk: any) => {
              console.log(`     • ${fk.column_name} → ${fk.foreign_table_name}.${fk.foreign_column_name}`);
            });
          }

          // Sample data
          if (parseInt(countResult.rows[0].count) > 0) {
            const sampleResult = await sourceClient.query(`SELECT * FROM ${tableName} LIMIT 3`);
            console.log(`   📋 Sample data:`);
            sampleResult.rows.forEach((row: any, index: number) => {
              console.log(`     ${index + 1}. ${JSON.stringify(row)}`);
            });
          }
        } else {
          console.log(`   ❌ Table does not exist in source database`);
        }
      } catch (error: any) {
        console.log(`   ❌ Error accessing table: ${error.message}`);
      }
    }

    // Check target database for these tables
    console.log('\n📋 3. Checking target database for template tables...');

    for (const tableName of targetTables) {
      try {
        const { data, error } = await supabase
          .from(tableName)
          .select('*')
          .limit(1);

        if (error) {
          console.log(`❌ ${tableName} not accessible in target: ${error.message}`);
        } else {
          console.log(`✅ ${tableName} accessible in target`);
          if (data && data.length > 0) {
            console.log(`   📋 Sample structure:`, Object.keys(data[0]));
          } else {
            console.log(`   📊 ${tableName} is empty in target`);
          }
        }
      } catch (error: any) {
        console.log(`❌ Error with ${tableName} in target: ${error.message}`);
      }
    }

    console.log('\n📊 TEMPLATE INVESTIGATION SUMMARY:');
    console.log('✅ Source database scanned for template tables');
    console.log('✅ Target database schema checked');
    console.log('💡 Ready to create appropriate migration scripts');

  } catch (error: any) {
    console.error('❌ Investigation failed:', error);
    throw error;
  } finally {
    await sourceClient.end();
    console.log('🔌 Disconnected from source database');
  }
}

// Run the investigation
if (require.main === module) {
  investigateTemplateTables().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default investigateTemplateTables;