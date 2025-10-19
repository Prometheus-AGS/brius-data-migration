import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function exploreAvailableTables() {
  console.log('🔍 Exploring available tables in source and target databases...\n');

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

    // 1. Find all dispatch_* tables in source
    const sourceTablesResult = await sourceClient.query(`
      SELECT table_name,
             (SELECT COUNT(*) FROM information_schema.columns
              WHERE table_name = t.table_name AND table_schema = 'public') as column_count
      FROM information_schema.tables t
      WHERE table_schema = 'public'
      AND table_name LIKE 'dispatch_%'
      ORDER BY table_name;
    `);

    console.log('📋 Available dispatch_* tables in source database:');
    console.log('================================================');
    for (const table of sourceTablesResult.rows) {
      // Get record count
      try {
        const countResult = await sourceClient.query(`SELECT COUNT(*) as count FROM ${table.table_name}`);
        const recordCount = countResult.rows[0].count;
        console.log(`${table.table_name}: ${recordCount} records (${table.column_count} columns)`);
      } catch (error) {
        console.log(`${table.table_name}: Unable to count records (${table.column_count} columns)`);
      }
    }

    // 2. Check specific tables that were requested
    const requestedTables = [
      'dispatch_feedback', // customer_feedback
      'dispatch_setting', // global_settings
      'dispatch_operation', // operations
      'dispatch_patient_event', // patient_events
      'dispatch_payment', // payments
      'dispatch_shipment', // shipments
      'dispatch_system_message', // system_messages
      'dispatch_template_product', // template_products
      'dispatch_template_edit_roles', // template_edit_roles
      'dispatch_template_view_groups' // template_view_groups
    ];

    console.log('\n🎯 Status of specifically requested tables:');
    console.log('============================================');
    for (const tableName of requestedTables) {
      try {
        const tableExistsResult = await sourceClient.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name = '${tableName}'
          );
        `);

        if (tableExistsResult.rows[0].exists) {
          // Get columns and sample data
          const columnsResult = await sourceClient.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = '${tableName}'
            AND table_schema = 'public'
            ORDER BY ordinal_position;
          `);

          const countResult = await sourceClient.query(`SELECT COUNT(*) as count FROM ${tableName}`);

          console.log(`\n✅ ${tableName}:`);
          console.log(`   Records: ${countResult.rows[0].count}`);
          console.log(`   Columns: ${columnsResult.rows.map(r => r.column_name).join(', ')}`);

          // Get sample record if any exist
          if (parseInt(countResult.rows[0].count) > 0) {
            const sampleResult = await sourceClient.query(`SELECT * FROM ${tableName} LIMIT 1`);
            if (sampleResult.rows.length > 0) {
              console.log(`   Sample: ${JSON.stringify(sampleResult.rows[0], null, 2).substring(0, 200)}...`);
            }
          }
        } else {
          console.log(`❌ ${tableName}: Not found`);
        }
      } catch (error: any) {
        console.log(`❌ ${tableName}: Error - ${error.message}`);
      }
    }

    // 3. Check what tables exist in target Supabase that match our targets
    console.log('\n🎯 Target tables in Supabase:');
    console.log('==============================');
    const targetTables = [
      'customer_feedback',
      'global_settings',
      'operations',
      'order_cases',
      'patient_events',
      'payments',
      'role_permissions',
      'shipments',
      'system_messages',
      'teams',
      'template_products',
      'template_view_groups',
      'template_edit_roles'
    ];

    for (const tableName of targetTables) {
      try {
        const { count, error } = await supabase
          .from(tableName)
          .select('*', { count: 'exact', head: true });

        if (!error) {
          console.log(`✅ ${tableName}: ${count || 0} records exist`);
        } else {
          console.log(`❌ ${tableName}: ${error.message}`);
        }
      } catch (error: any) {
        console.log(`❌ ${tableName}: ${error.message}`);
      }
    }

    // 4. Look for alternative table names or patterns
    console.log('\n🔍 Looking for alternative patterns in source database:');
    console.log('======================================================');

    const alternativePatterns = [
      'auth_group', // for teams/roles
      'auth_user', // for users/profiles
      'auth_permission', // for permissions
      '%payment%', // any table with payment
      '%message%', // any table with message
      '%event%', // any table with event
      '%template%', // any table with template
      '%feedback%', // any table with feedback
      '%setting%', // any table with setting
      '%operation%' // any table with operation
    ];

    for (const pattern of alternativePatterns) {
      const result = await sourceClient.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name LIKE '${pattern}'
        ORDER BY table_name;
      `);

      if (result.rows.length > 0) {
        console.log(`Pattern "${pattern}": ${result.rows.map(r => r.table_name).join(', ')}`);
      }
    }

    console.log('\n✨ Exploration completed!');

  } catch (error: any) {
    console.error('❌ Exploration failed:', error);
    throw error;
  } finally {
    await sourceClient.end();
  }
}

// Run the exploration
if (require.main === module) {
  exploreAvailableTables().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default exploreAvailableTables;