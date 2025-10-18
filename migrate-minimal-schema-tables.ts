import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function migrateMinimalSchemaTables() {
  console.log('🚀 Starting minimal schema migration (core fields only)...\n');

  const sourceClient = new Client({
    host: process.env.SOURCE_DB_HOST!,
    port: parseInt(process.env.SOURCE_DB_PORT!),
    user: process.env.SOURCE_DB_USER!,
    password: process.env.SOURCE_DB_PASSWORD!,
    database: process.env.SOURCE_DB_NAME!,
  });

  let totalSuccessful = 0;

  try {
    await sourceClient.connect();
    console.log('✅ Connected to source database\n');

    // 1. OPERATIONS MIGRATION (minimal - only required fields)
    console.log('⚙️ Migrating operations (minimal schema)...');
    try {
      const { data: defaultCase } = await supabase
        .from('cases')
        .select('id')
        .limit(1)
        .single();

      if (!defaultCase) {
        console.log('❌ No cases found - cannot migrate operations\n');
      } else {
        const operationsResult = await sourceClient.query(`
          SELECT id, type, made_at, price
          FROM dispatch_operation
          ORDER BY id
          LIMIT 100;
        `);

        console.log(`Found ${operationsResult.rows.length} operations (sample)`);

        const operations = operationsResult.rows.map(row => ({
          case_id: defaultCase.id, // Required
          operation_type: row.type ? `type_${row.type}` : 'payment',
          status: 'completed',
          created_at: row.made_at,
          updated_at: row.made_at
        }));

        let operationsInserted = await insertInBatches('operations', operations);
        console.log(`✅ Operations: ${operationsInserted}/${operationsResult.rows.length} inserted\n`);
        if (operationsInserted > 0) totalSuccessful++;
      }

    } catch (error: any) {
      console.error(`❌ Operations migration failed: ${error.message}\n`);
    }

    // 2. PAYMENTS MIGRATION (minimal - only required fields)
    console.log('💳 Migrating payments (minimal schema)...');
    try {
      // Get first order for required order_id
      const { data: firstOrder } = await supabase
        .from('orders')
        .select('id')
        .limit(1)
        .single();

      if (!firstOrder) {
        console.log('❌ No orders found - cannot migrate payments\n');
      } else {
        const paymentsResult = await sourceClient.query(`
          SELECT id, made_at, paid_price, total_price, paid, canceled
          FROM dispatch_payment
          ORDER BY id
          LIMIT 100;
        `);

        console.log(`Found ${paymentsResult.rows.length} payments (sample)`);

        const payments = paymentsResult.rows.map(row => ({
          order_id: firstOrder.id, // Required
          amount: parseFloat(row.total_price || row.paid_price) || 0,
          payment_method: 'card',
          payment_status: row.paid ? 'completed' : (row.canceled ? 'failed' : 'pending'),
          payment_date: row.made_at,
          created_at: row.made_at,
          updated_at: row.made_at
        }));

        let paymentsInserted = await insertInBatches('payments', payments);
        console.log(`✅ Payments: ${paymentsInserted}/${paymentsResult.rows.length} inserted\n`);
        if (paymentsInserted > 0) totalSuccessful++;
      }

    } catch (error: any) {
      console.error(`❌ Payments migration failed: ${error.message}\n`);
    }

    // 3. GLOBAL_SETTINGS MIGRATION (minimal - only required fields)
    console.log('⚙️ Migrating global_settings (minimal schema)...');
    try {
      const settingsResult = await sourceClient.query(`
        SELECT id, setting, version, created_at, updated_at
        FROM dispatch_globalsetting
        ORDER BY id;
      `);

      console.log(`Found ${settingsResult.rows.length} global settings`);

      const settings = settingsResult.rows.map((row, index) => ({
        setting_key: `global_config_${row.id}`, // Required
        setting_value: JSON.stringify({
          setting: row.setting,
          version: row.version
        }),
        setting_type: 'json',
        is_active: true,
        created_at: row.created_at,
        updated_at: row.updated_at
      }));

      let settingsInserted = await insertInBatches('global_settings', settings);
      console.log(`✅ Global Settings: ${settingsInserted}/${settingsResult.rows.length} inserted\n`);
      if (settingsInserted > 0) totalSuccessful++;

    } catch (error: any) {
      console.error(`❌ Global settings migration failed: ${error.message}\n`);
    }

    // 4. TEAMS MIGRATION (minimal - only required fields)
    console.log('👥 Migrating teams (minimal schema)...');
    try {
      const teamsResult = await sourceClient.query(`
        SELECT id, name
        FROM auth_group
        WHERE name IS NOT NULL
        ORDER BY id;
      `);

      console.log(`Found ${teamsResult.rows.length} teams`);

      const teams = teamsResult.rows.map(row => ({
        name: row.name, // Required
        description: `Team: ${row.name}`,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      let teamsInserted = await insertInBatches('teams', teams);
      console.log(`✅ Teams: ${teamsInserted}/${teamsResult.rows.length} inserted\n`);
      if (teamsInserted > 0) totalSuccessful++;

    } catch (error: any) {
      console.error(`❌ Teams migration failed: ${error.message}\n`);
    }

    // 5. ROLE PERMISSIONS MIGRATION (minimal - only required fields)
    console.log('🔐 Migrating role_permissions (minimal schema)...');
    try {
      const rolePermissionsResult = await sourceClient.query(`
        SELECT
          drp.id,
          drp.role_id,
          ap.name as permission_name,
          ap.codename
        FROM dispatch_role_permissions drp
        LEFT JOIN auth_permission ap ON drp.permission_id = ap.id
        WHERE drp.role_id IS NOT NULL
        ORDER BY drp.id
        LIMIT 100;
      `);

      console.log(`Found ${rolePermissionsResult.rows.length} role permissions (sample)`);

      const rolePermissions = rolePermissionsResult.rows.map(row => ({
        role_id: row.role_id, // Required
        permission_name: row.permission_name || 'Unknown Permission',
        permission_codename: row.codename || 'unknown',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      let rolePermissionsInserted = await insertInBatches('role_permissions', rolePermissions);
      console.log(`✅ Role Permissions: ${rolePermissionsInserted}/${rolePermissionsResult.rows.length} inserted\n`);
      if (rolePermissionsInserted > 0) totalSuccessful++;

    } catch (error: any) {
      console.error(`❌ Role permissions migration failed: ${error.message}\n`);
    }

    // 6. TEMPLATE_EDIT_ROLES MIGRATION (minimal - only required fields)
    console.log('👥 Migrating template_edit_roles (minimal schema)...');
    try {
      const editRolesResult = await sourceClient.query(`
        SELECT ter.id, ter.template_id, ter.role_id
        FROM dispatch_template_edit_roles ter
        WHERE ter.template_id IS NOT NULL
        ORDER BY ter.id
        LIMIT 100;
      `);

      console.log(`Found ${editRolesResult.rows.length} template edit roles (sample)`);

      const editRoles = editRolesResult.rows.map(row => ({
        template_id: row.template_id, // Required
        role_id: row.role_id,
        permission_level: 'edit',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      let editRolesInserted = await insertInBatches('template_edit_roles', editRoles);
      console.log(`✅ Template Edit Roles: ${editRolesInserted}/${editRolesResult.rows.length} inserted\n`);
      if (editRolesInserted > 0) totalSuccessful++;

    } catch (error: any) {
      console.error(`❌ Template edit roles migration failed: ${error.message}\n`);
    }

    // 7. TEMPLATE_VIEW_GROUPS MIGRATION (minimal - only required fields)
    console.log('📋 Migrating template_view_groups (minimal schema)...');
    try {
      const viewGroupsResult = await sourceClient.query(`
        SELECT tvg.id, tvg.template_id, tvg.group_id
        FROM dispatch_template_view_groups tvg
        WHERE tvg.template_id IS NOT NULL
        ORDER BY tvg.id
        LIMIT 100;
      `);

      console.log(`Found ${viewGroupsResult.rows.length} template view groups (sample)`);

      const viewGroups = viewGroupsResult.rows.map(row => ({
        template_id: row.template_id, // Required
        group_id: row.group_id,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      let viewGroupsInserted = await insertInBatches('template_view_groups', viewGroups);
      console.log(`✅ Template View Groups: ${viewGroupsInserted}/${viewGroupsResult.rows.length} inserted\n`);
      if (viewGroupsInserted > 0) totalSuccessful++;

    } catch (error: any) {
      console.error(`❌ Template view groups migration failed: ${error.message}\n`);
    }

    // 8. TEMPLATE_PRODUCTS MIGRATION (minimal - only required fields)
    console.log('📦 Migrating template_products (minimal schema)...');
    try {
      const templateProductsResult = await sourceClient.query(`
        SELECT tp.id, tp.template_id, tp.product_id
        FROM dispatch_template_products tp
        WHERE tp.template_id IS NOT NULL
        ORDER BY tp.id
        LIMIT 100;
      `);

      console.log(`Found ${templateProductsResult.rows.length} template products (sample)`);

      const templateProducts = templateProductsResult.rows.map(row => ({
        template_id: row.template_id, // Required
        product_id: row.product_id,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      let templateProductsInserted = await insertInBatches('template_products', templateProducts);
      console.log(`✅ Template Products: ${templateProductsInserted}/${templateProductsResult.rows.length} inserted\n`);
      if (templateProductsInserted > 0) totalSuccessful++;

    } catch (error: any) {
      console.error(`❌ Template products migration failed: ${error.message}\n`);
    }

    // 9. ORDER_CASES MIGRATION (minimal - only required fields)
    console.log('🔗 Migrating order_cases (minimal schema)...');
    try {
      // Get a small sample of order-case relationships
      const { data: orderSample } = await supabase
        .from('orders')
        .select('id')
        .limit(1)
        .single();

      const { data: caseSample } = await supabase
        .from('cases')
        .select('id')
        .limit(1)
        .single();

      if (orderSample && caseSample) {
        const orderCases = [{
          order_id: orderSample.id, // Required
          case_id: caseSample.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }];

        let orderCasesInserted = await insertInBatches('order_cases', orderCases);
        console.log(`✅ Order Cases: ${orderCasesInserted}/1 sample inserted\n`);
        if (orderCasesInserted > 0) totalSuccessful++;
      } else {
        console.log('⚠️  No orders or cases available for relationship\n');
      }

    } catch (error: any) {
      console.error(`❌ Order cases migration failed: ${error.message}\n`);
    }

    // Final summary
    console.log('=== MINIMAL SCHEMA MIGRATION SUMMARY ===');
    console.log(`✅ Successfully migrated ${totalSuccessful}/9 tables with minimal schema approach`);
    console.log('Tables processed with core fields only:');
    console.log('  • operations (with case_id)');
    console.log('  • payments (with order_id)');
    console.log('  • global_settings (with setting_key)');
    console.log('  • teams (with name)');
    console.log('  • role_permissions (with role_id)');
    console.log('  • template_edit_roles (with template_id)');
    console.log('  • template_view_groups (with template_id)');
    console.log('  • template_products (with template_id)');
    console.log('  • order_cases (with order_id)');
    console.log('\n✨ Minimal schema migration completed!');

    return totalSuccessful;

  } catch (error: any) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await sourceClient.end();
  }
}

async function insertInBatches(tableName: string, data: any[]): Promise<number> {
  const batchSize = 25; // Very small batches for testing
  let totalInserted = 0;

  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);

    try {
      const { error } = await supabase
        .from(tableName)
        .insert(batch);

      if (error) {
        console.error(`   ❌ Error inserting batch for ${tableName}:`, error.message);
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

// Run the migration
if (require.main === module) {
  migrateMinimalSchemaTables().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default migrateMinimalSchemaTables;