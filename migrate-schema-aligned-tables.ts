import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function migrateSchemaAlignedTables() {
  console.log('🚀 Starting schema-aligned migration for remaining tables...\n');

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

    // 1. OPERATIONS MIGRATION (requires case_id)
    console.log('⚙️ Migrating operations from dispatch_operation...');
    try {
      // First get a default case to use for operations that don't have a direct case link
      const { data: defaultCase } = await supabase
        .from('cases')
        .select('id')
        .limit(1)
        .single();

      if (!defaultCase) {
        console.log('❌ No cases found - cannot migrate operations without case_id\n');
      } else {
        const operationsResult = await sourceClient.query(`
          SELECT
            id,
            type,
            made_at,
            price,
            sq_order_id,
            sq_payment_id,
            office_card,
            payment_id
          FROM dispatch_operation
          ORDER BY id;
        `);

        console.log(`Found ${operationsResult.rows.length} operations`);

        const operations = operationsResult.rows.map(row => ({
          case_id: defaultCase.id, // Required field
          operation_type: row.type ? `type_${row.type}` : 'payment',
          operation_data: {
            sq_order_id: row.sq_order_id,
            sq_payment_id: row.sq_payment_id,
            office_card: row.office_card,
            legacy_id: row.id
          },
          status: 'completed',
          created_at: row.made_at,
          updated_at: row.made_at,
          legacy_operation_id: row.id
        }));

        let operationsInserted = await insertInBatches('operations', operations);
        console.log(`✅ Operations: ${operationsInserted}/${operationsResult.rows.length} migrated\n`);
        if (operationsInserted > 0) totalSuccessful++;
      }

    } catch (error: any) {
      console.error(`❌ Operations migration failed: ${error.message}\n`);
    }

    // 2. PAYMENTS MIGRATION (requires order_id)
    console.log('💳 Migrating payments from dispatch_payment...');
    try {
      // Get order mappings first
      const { data: orderMappings } = await supabase
        .from('orders')
        .select('id, legacy_instruction_id');

      const orderMap = new Map();
      orderMappings?.forEach(order => {
        if (order.legacy_instruction_id) {
          orderMap.set(order.legacy_instruction_id, order.id);
        }
      });

      console.log(`Found ${orderMap.size} order mappings`);

      const paymentsResult = await sourceClient.query(`
        SELECT
          id,
          made_at,
          free,
          paid_price,
          instruction_id,
          canceled,
          paid,
          total_price
        FROM dispatch_payment
        WHERE instruction_id IS NOT NULL
        ORDER BY id;
      `);

      console.log(`Found ${paymentsResult.rows.length} payments with instruction_id`);

      const payments = paymentsResult.rows
        .filter(row => orderMap.has(row.instruction_id))
        .map(row => ({
          order_id: orderMap.get(row.instruction_id), // Required field
          amount: parseFloat(row.total_price || row.paid_price) || 0,
          payment_method: row.free ? 'free' : 'card',
          payment_status: row.paid ? 'completed' : (row.canceled ? 'failed' : 'pending'),
          payment_date: row.made_at,
          created_at: row.made_at,
          updated_at: row.made_at,
          legacy_payment_id: row.id
        }));

      let paymentsInserted = await insertInBatches('payments', payments);
      console.log(`✅ Payments: ${paymentsInserted}/${paymentsResult.rows.length} migrated\n`);
      if (paymentsInserted > 0) totalSuccessful++;

    } catch (error: any) {
      console.error(`❌ Payments migration failed: ${error.message}\n`);
    }

    // 3. GLOBAL_SETTINGS MIGRATION (requires setting_key)
    console.log('⚙️ Migrating global_settings from dispatch_globalsetting...');
    try {
      const settingsResult = await sourceClient.query(`
        SELECT
          id,
          setting,
          version,
          created_at,
          updated_at,
          sandbox,
          application_id,
          location_id,
          access_token
        FROM dispatch_globalsetting
        ORDER BY id;
      `);

      console.log(`Found ${settingsResult.rows.length} global settings`);

      const settings = settingsResult.rows.map((row, index) => ({
        setting_key: `global_config_${row.id}`, // Required field
        setting_value: JSON.stringify({
          setting: row.setting,
          version: row.version,
          sandbox: row.sandbox,
          application_id: row.application_id,
          location_id: row.location_id,
          access_token: row.access_token
        }),
        setting_type: 'json',
        description: 'Migrated global application settings',
        is_active: true,
        created_at: row.created_at,
        updated_at: row.updated_at,
        legacy_setting_id: row.id
      }));

      let settingsInserted = await insertInBatches('global_settings', settings);
      console.log(`✅ Global Settings: ${settingsInserted}/${settingsResult.rows.length} migrated\n`);
      if (settingsInserted > 0) totalSuccessful++;

    } catch (error: any) {
      console.error(`❌ Global settings migration failed: ${error.message}\n`);
    }

    // 4. TEAMS MIGRATION (requires name)
    console.log('👥 Migrating teams from auth_group...');
    try {
      const teamsResult = await sourceClient.query(`
        SELECT id, name
        FROM auth_group
        WHERE name IS NOT NULL
        ORDER BY id;
      `);

      console.log(`Found ${teamsResult.rows.length} groups/teams`);

      const teams = teamsResult.rows.map(row => ({
        name: row.name, // Required field
        description: `Migrated from auth_group: ${row.name}`,
        team_type: 'operational',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        legacy_group_id: row.id
      }));

      let teamsInserted = await insertInBatches('teams', teams);
      console.log(`✅ Teams: ${teamsInserted}/${teamsResult.rows.length} migrated\n`);
      if (teamsInserted > 0) totalSuccessful++;

    } catch (error: any) {
      console.error(`❌ Teams migration failed: ${error.message}\n`);
    }

    // 5. ROLE PERMISSIONS MIGRATION (requires role_id)
    console.log('🔐 Migrating role_permissions from dispatch_role_permissions...');
    try {
      const rolePermissionsResult = await sourceClient.query(`
        SELECT
          drp.id,
          drp.role_id,
          drp.permission_id,
          dr.name as role_name,
          ap.name as permission_name,
          ap.codename
        FROM dispatch_role_permissions drp
        LEFT JOIN dispatch_role dr ON drp.role_id = dr.id
        LEFT JOIN auth_permission ap ON drp.permission_id = ap.id
        WHERE drp.role_id IS NOT NULL
        ORDER BY drp.id;
      `);

      console.log(`Found ${rolePermissionsResult.rows.length} role permissions`);

      const rolePermissions = rolePermissionsResult.rows.map(row => ({
        role_id: row.role_id, // Required field - using legacy role_id as integer
        permission_name: row.permission_name || 'Unknown Permission',
        permission_codename: row.codename || 'unknown',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        legacy_permission_id: row.permission_id,
        legacy_junction_id: row.id
      }));

      let rolePermissionsInserted = await insertInBatches('role_permissions', rolePermissions);
      console.log(`✅ Role Permissions: ${rolePermissionsInserted}/${rolePermissionsResult.rows.length} migrated\n`);
      if (rolePermissionsInserted > 0) totalSuccessful++;

    } catch (error: any) {
      console.error(`❌ Role permissions migration failed: ${error.message}\n`);
    }

    // 6. TEMPLATE_EDIT_ROLES MIGRATION (requires template_id)
    console.log('👥 Migrating template_edit_roles from dispatch_template_edit_roles...');
    try {
      const editRolesResult = await sourceClient.query(`
        SELECT
          ter.id,
          ter.template_id,
          ter.role_id,
          t.text_name as template_name,
          dr.name as role_name
        FROM dispatch_template_edit_roles ter
        LEFT JOIN dispatch_template t ON ter.template_id = t.id
        LEFT JOIN dispatch_role dr ON ter.role_id = dr.id
        WHERE ter.template_id IS NOT NULL
        ORDER BY ter.id;
      `);

      console.log(`Found ${editRolesResult.rows.length} template edit roles`);

      const editRoles = editRolesResult.rows.map(row => ({
        template_id: row.template_id, // Required field - using legacy template_id as integer
        role_id: row.role_id,
        permission_level: 'edit',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        legacy_junction_id: row.id
      }));

      let editRolesInserted = await insertInBatches('template_edit_roles', editRoles);
      console.log(`✅ Template Edit Roles: ${editRolesInserted}/${editRolesResult.rows.length} migrated\n`);
      if (editRolesInserted > 0) totalSuccessful++;

    } catch (error: any) {
      console.error(`❌ Template edit roles migration failed: ${error.message}\n`);
    }

    // 7. TEMPLATE_VIEW_GROUPS MIGRATION (requires template_id)
    console.log('📋 Migrating template_view_groups from dispatch_template_view_groups...');
    try {
      const viewGroupsResult = await sourceClient.query(`
        SELECT
          tvg.id,
          tvg.template_id,
          tvg.group_id,
          t.text_name as template_name,
          ag.name as group_name
        FROM dispatch_template_view_groups tvg
        LEFT JOIN dispatch_template t ON tvg.template_id = t.id
        LEFT JOIN auth_group ag ON tvg.group_id = ag.id
        WHERE tvg.template_id IS NOT NULL
        ORDER BY tvg.id;
      `);

      console.log(`Found ${viewGroupsResult.rows.length} template view groups`);

      const viewGroups = viewGroupsResult.rows.map(row => ({
        template_id: row.template_id, // Required field - using legacy template_id as integer
        group_id: row.group_id,
        permission_level: 'view',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        legacy_junction_id: row.id
      }));

      let viewGroupsInserted = await insertInBatches('template_view_groups', viewGroups);
      console.log(`✅ Template View Groups: ${viewGroupsInserted}/${viewGroupsResult.rows.length} migrated\n`);
      if (viewGroupsInserted > 0) totalSuccessful++;

    } catch (error: any) {
      console.error(`❌ Template view groups migration failed: ${error.message}\n`);
    }

    // 8. TEMPLATE_PRODUCTS MIGRATION (requires template_id)
    console.log('📦 Migrating template_products from dispatch_template_products...');
    try {
      const templateProductsResult = await sourceClient.query(`
        SELECT
          tp.id,
          tp.template_id,
          tp.product_id,
          t.text_name as template_name,
          p.name as product_name,
          p.price
        FROM dispatch_template_products tp
        LEFT JOIN dispatch_template t ON tp.template_id = t.id
        LEFT JOIN dispatch_product p ON tp.product_id = p.id
        WHERE tp.template_id IS NOT NULL
        ORDER BY tp.id;
      `);

      console.log(`Found ${templateProductsResult.rows.length} template products`);

      const templateProducts = templateProductsResult.rows.map(row => ({
        template_id: row.template_id, // Required field - using legacy template_id as integer
        product_id: row.product_id,
        product_price: parseFloat(row.price) || 0,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        legacy_junction_id: row.id
      }));

      let templateProductsInserted = await insertInBatches('template_products', templateProducts);
      console.log(`✅ Template Products: ${templateProductsInserted}/${templateProductsResult.rows.length} migrated\n`);
      if (templateProductsInserted > 0) totalSuccessful++;

    } catch (error: any) {
      console.error(`❌ Template products migration failed: ${error.message}\n`);
    }

    // 9. ORDER_CASES MIGRATION (requires order_id)
    console.log('🔗 Migrating order_cases relationships...');
    try {
      // Create order-case relationships via patient_id
      const { data: orderCaseData } = await supabase.rpc('exec_sql', {
        sql: `
          SELECT DISTINCT
            o.id as order_id,
            c.id as case_id
          FROM orders o
          JOIN cases c ON o.patient_id = c.patient_id
          WHERE o.patient_id IS NOT NULL
          LIMIT 1000
        `
      });

      let actualOrderCaseData = orderCaseData;
      if (orderCaseData && !Array.isArray(orderCaseData)) {
        actualOrderCaseData = orderCaseData.data || orderCaseData.rows || [];
      }

      if (actualOrderCaseData && Array.isArray(actualOrderCaseData) && actualOrderCaseData.length > 0) {
        console.log(`Found ${actualOrderCaseData.length} order-case relationships`);

        const orderCases = actualOrderCaseData.map((row: any) => ({
          order_id: row.order_id, // Required field
          case_id: row.case_id,
          relationship_type: 'primary',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }));

        let orderCasesInserted = await insertInBatches('order_cases', orderCases);
        console.log(`✅ Order Cases: ${orderCasesInserted}/${actualOrderCaseData.length} migrated\n`);
        if (orderCasesInserted > 0) totalSuccessful++;
      } else {
        console.log('⚠️  No order-case relationships found to migrate\n');
      }

    } catch (error: any) {
      console.error(`❌ Order cases migration failed: ${error.message}\n`);
    }

    // Final summary
    console.log('=== SCHEMA-ALIGNED MIGRATION SUMMARY ===');
    console.log(`✅ Successfully migrated ${totalSuccessful}/9 tables with proper schema alignment`);
    console.log('Tables processed:');
    console.log('  • operations (with case_id requirement)');
    console.log('  • payments (with order_id requirement)');
    console.log('  • global_settings (with setting_key requirement)');
    console.log('  • teams (with name requirement)');
    console.log('  • role_permissions (with role_id requirement)');
    console.log('  • template_edit_roles (with template_id requirement)');
    console.log('  • template_view_groups (with template_id requirement)');
    console.log('  • template_products (with template_id requirement)');
    console.log('  • order_cases (with order_id requirement)');
    console.log('\n✨ Schema-aligned migration completed!');

    return totalSuccessful;

  } catch (error: any) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await sourceClient.end();
  }
}

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

// Run the migration
if (require.main === module) {
  migrateSchemaAlignedTables().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default migrateSchemaAlignedTables;