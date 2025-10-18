import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function migrateActualExistingTables() {
  console.log('🚀 Starting migration of actual existing tables with data...\n');

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

    // 1. OPERATIONS MIGRATION (3,720 records)
    console.log('⚙️ Migrating operations from dispatch_operation...');
    try {
      const operationsResult = await sourceClient.query(`
        SELECT
          id,
          type,
          made_at,
          price,
          sq_order_id,
          sq_payment_id,
          sq_refund_id,
          card_brand,
          card_bin,
          card_last,
          office_card,
          payment_id,
          attempts
        FROM dispatch_operation
        ORDER BY id;
      `);

      console.log(`Found ${operationsResult.rows.length} operations`);

      const operations = operationsResult.rows.map(row => ({
        operation_type: row.type ? `type_${row.type}` : 'unknown',
        operation_data: {
          sq_order_id: row.sq_order_id,
          sq_payment_id: row.sq_payment_id,
          sq_refund_id: row.sq_refund_id,
          card_brand: row.card_brand,
          card_bin: row.card_bin,
          card_last: row.card_last,
          office_card: row.office_card,
          attempts: row.attempts
        },
        operation_status: 'completed',
        amount: parseFloat(row.price) || 0,
        started_at: row.made_at,
        completed_at: row.made_at,
        legacy_operation_id: row.id,
        legacy_payment_id: row.payment_id,
        created_at: row.made_at,
        updated_at: row.made_at,
        metadata: {
          migrationDate: new Date().toISOString(),
          sourceTable: 'dispatch_operation'
        }
      }));

      let operationsInserted = await insertInBatches('operations', operations);
      console.log(`✅ Operations: ${operationsInserted}/${operationsResult.rows.length} migrated\n`);
      if (operationsInserted > 0) totalSuccessful++;

    } catch (error: any) {
      console.error(`❌ Operations migration failed: ${error.message}\n`);
    }

    // 2. PAYMENTS MIGRATION (17,133 records)
    console.log('💳 Migrating payments from dispatch_payment...');
    try {
      const paymentsResult = await sourceClient.query(`
        SELECT
          id,
          made_at,
          free,
          tax_rate,
          tax_value,
          paid_price,
          instruction_id,
          used_credit,
          canceled,
          paid,
          custom_price,
          subtotal_price,
          doctor_id,
          office_id,
          order_id,
          installments,
          additional_price,
          netsuite,
          total_price
        FROM dispatch_payment
        ORDER BY id;
      `);

      console.log(`Found ${paymentsResult.rows.length} payments`);

      const payments = paymentsResult.rows.map(row => ({
        amount: parseFloat(row.total_price || row.paid_price) || 0,
        payment_method: row.free ? 'free' : 'card',
        payment_status: row.paid ? 'completed' : (row.canceled ? 'canceled' : 'pending'),
        payment_date: row.made_at,
        transaction_reference: row.id.toString(),
        tax_amount: parseFloat(row.tax_value) || 0,
        subtotal_amount: parseFloat(row.subtotal_price) || 0,
        legacy_payment_id: row.id,
        legacy_instruction_id: row.instruction_id,
        legacy_doctor_id: row.doctor_id,
        legacy_office_id: row.office_id,
        legacy_order_id: row.order_id,
        created_at: row.made_at,
        updated_at: row.made_at,
        metadata: {
          migrationDate: new Date().toISOString(),
          sourceTable: 'dispatch_payment',
          installments: row.installments,
          used_credit: row.used_credit,
          netsuite: row.netsuite
        }
      }));

      let paymentsInserted = await insertInBatches('payments', payments);
      console.log(`✅ Payments: ${paymentsInserted}/${paymentsResult.rows.length} migrated\n`);
      if (paymentsInserted > 0) totalSuccessful++;

    } catch (error: any) {
      console.error(`❌ Payments migration failed: ${error.message}\n`);
    }

    // 3. GLOBAL SETTINGS MIGRATION (1 record)
    console.log('⚙️ Migrating global settings from dispatch_globalsetting...');
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

      const settings = settingsResult.rows.map(row => ({
        setting_key: 'global_config',
        setting_value: JSON.stringify({
          setting: row.setting,
          version: row.version,
          sandbox: row.sandbox,
          application_id: row.application_id,
          location_id: row.location_id,
          access_token: row.access_token
        }),
        setting_type: 'json',
        description: 'Global application settings',
        category: 'system',
        is_active: true,
        legacy_setting_id: row.id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        metadata: {
          migrationDate: new Date().toISOString(),
          sourceTable: 'dispatch_globalsetting'
        }
      }));

      let settingsInserted = await insertInBatches('global_settings', settings);
      console.log(`✅ Global Settings: ${settingsInserted}/${settingsResult.rows.length} migrated\n`);
      if (settingsInserted > 0) totalSuccessful++;

    } catch (error: any) {
      console.error(`❌ Global settings migration failed: ${error.message}\n`);
    }

    // 4. TEMPLATE EDIT ROLES MIGRATION (659 records)
    console.log('👥 Migrating template edit roles from dispatch_template_edit_roles...');
    try {
      const editRolesResult = await sourceClient.query(`
        SELECT
          ter.id,
          ter.template_id,
          ter.role_id,
          COALESCE(t.text_name, t.task_name, 'Unknown Template') as template_name,
          dr.name as role_name
        FROM dispatch_template_edit_roles ter
        LEFT JOIN dispatch_template t ON ter.template_id = t.id
        LEFT JOIN dispatch_role dr ON ter.role_id = dr.id
        ORDER BY ter.id;
      `);

      console.log(`Found ${editRolesResult.rows.length} template edit roles`);

      const editRoles = editRolesResult.rows.map(row => ({
        template_name: row.template_name,
        role_name: row.role_name || 'Unknown Role',
        permission_level: 'edit',
        is_active: true,
        legacy_template_id: row.template_id,
        legacy_role_id: row.role_id,
        legacy_junction_id: row.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {
          migrationDate: new Date().toISOString(),
          sourceTable: 'dispatch_template_edit_roles'
        }
      }));

      let editRolesInserted = await insertInBatches('template_edit_roles', editRoles);
      console.log(`✅ Template Edit Roles: ${editRolesInserted}/${editRolesResult.rows.length} migrated\n`);
      if (editRolesInserted > 0) totalSuccessful++;

    } catch (error: any) {
      console.error(`❌ Template edit roles migration failed: ${error.message}\n`);
    }

    // 5. TEMPLATE VIEW GROUPS MIGRATION (199 records)
    console.log('📋 Migrating template view groups from dispatch_template_view_groups...');
    try {
      const viewGroupsResult = await sourceClient.query(`
        SELECT
          tvg.id,
          tvg.template_id,
          tvg.group_id,
          COALESCE(t.text_name, t.task_name, 'Unknown Template') as template_name,
          ag.name as group_name
        FROM dispatch_template_view_groups tvg
        LEFT JOIN dispatch_template t ON tvg.template_id = t.id
        LEFT JOIN auth_group ag ON tvg.group_id = ag.id
        ORDER BY tvg.id;
      `);

      console.log(`Found ${viewGroupsResult.rows.length} template view groups`);

      const viewGroups = viewGroupsResult.rows.map(row => ({
        template_name: row.template_name,
        group_name: row.group_name || 'Unknown Group',
        permission_level: 'view',
        is_active: true,
        legacy_template_id: row.template_id,
        legacy_group_id: row.group_id,
        legacy_junction_id: row.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {
          migrationDate: new Date().toISOString(),
          sourceTable: 'dispatch_template_view_groups'
        }
      }));

      let viewGroupsInserted = await insertInBatches('template_view_groups', viewGroups);
      console.log(`✅ Template View Groups: ${viewGroupsInserted}/${viewGroupsResult.rows.length} migrated\n`);
      if (viewGroupsInserted > 0) totalSuccessful++;

    } catch (error: any) {
      console.error(`❌ Template view groups migration failed: ${error.message}\n`);
    }

    // 6. TEMPLATE PRODUCTS MIGRATION (183 records)
    console.log('📦 Migrating template products from dispatch_template_products...');
    try {
      const templateProductsResult = await sourceClient.query(`
        SELECT
          tp.id,
          tp.template_id,
          tp.product_id,
          COALESCE(t.text_name, t.task_name, 'Unknown Template') as template_name,
          p.name as product_name,
          p.price
        FROM dispatch_template_products tp
        LEFT JOIN dispatch_template t ON tp.template_id = t.id
        LEFT JOIN dispatch_product p ON tp.product_id = p.id
        ORDER BY tp.id;
      `);

      console.log(`Found ${templateProductsResult.rows.length} template products`);

      const templateProducts = templateProductsResult.rows.map(row => ({
        template_name: row.template_name,
        product_name: row.product_name || 'Unknown Product',
        product_price: parseFloat(row.price) || 0,
        is_active: true,
        legacy_template_id: row.template_id,
        legacy_product_id: row.product_id,
        legacy_junction_id: row.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {
          migrationDate: new Date().toISOString(),
          sourceTable: 'dispatch_template_products'
        }
      }));

      let templateProductsInserted = await insertInBatches('template_products', templateProducts);
      console.log(`✅ Template Products: ${templateProductsInserted}/${templateProductsResult.rows.length} migrated\n`);
      if (templateProductsInserted > 0) totalSuccessful++;

    } catch (error: any) {
      console.error(`❌ Template products migration failed: ${error.message}\n`);
    }

    // 7. TEAMS MIGRATION from auth_group
    console.log('👥 Migrating teams from auth_group...');
    try {
      const teamsResult = await sourceClient.query(`
        SELECT
          id,
          name
        FROM auth_group
        ORDER BY id;
      `);

      console.log(`Found ${teamsResult.rows.length} groups/teams`);

      const teams = teamsResult.rows.map(row => ({
        team_name: row.name,
        team_description: `Migrated from auth_group: ${row.name}`,
        team_type: 'operational',
        is_active: true,
        legacy_group_id: row.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {
          migrationDate: new Date().toISOString(),
          sourceTable: 'auth_group'
        }
      }));

      let teamsInserted = await insertInBatches('teams', teams);
      console.log(`✅ Teams: ${teamsInserted}/${teamsResult.rows.length} migrated\n`);
      if (teamsInserted > 0) totalSuccessful++;

    } catch (error: any) {
      console.error(`❌ Teams migration failed: ${error.message}\n`);
    }

    // 8. ROLE PERMISSIONS MIGRATION from dispatch_role_permissions (1,346 records)
    console.log('🔐 Migrating role permissions from dispatch_role_permissions...');
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
        ORDER BY drp.id;
      `);

      console.log(`Found ${rolePermissionsResult.rows.length} role permissions`);

      const rolePermissions = rolePermissionsResult.rows.map(row => ({
        role_name: row.role_name || 'Unknown Role',
        permission_name: row.permission_name || 'Unknown Permission',
        permission_codename: row.codename || 'unknown',
        permission_level: 'standard',
        is_active: true,
        legacy_role_id: row.role_id,
        legacy_permission_id: row.permission_id,
        legacy_junction_id: row.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {
          migrationDate: new Date().toISOString(),
          sourceTable: 'dispatch_role_permissions'
        }
      }));

      let rolePermissionsInserted = await insertInBatches('role_permissions', rolePermissions);
      console.log(`✅ Role Permissions: ${rolePermissionsInserted}/${rolePermissionsResult.rows.length} migrated\n`);
      if (rolePermissionsInserted > 0) totalSuccessful++;

    } catch (error: any) {
      console.error(`❌ Role permissions migration failed: ${error.message}\n`);
    }

    // Final summary
    console.log('=== ACTUAL EXISTING TABLES MIGRATION SUMMARY ===');
    console.log(`✅ Successfully migrated ${totalSuccessful}/8 tables with actual data`);
    console.log('Tables with data that were processed:');
    console.log('  • dispatch_operation → operations (3,720 records)');
    console.log('  • dispatch_payment → payments (17,133 records)');
    console.log('  • dispatch_globalsetting → global_settings (1 record)');
    console.log('  • dispatch_template_edit_roles → template_edit_roles (659 records)');
    console.log('  • dispatch_template_view_groups → template_view_groups (199 records)');
    console.log('  • dispatch_template_products → template_products (183 records)');
    console.log('  • auth_group → teams (records found)');
    console.log('  • dispatch_role_permissions → role_permissions (1,346 records)');
    console.log('\n✨ Migration of actual existing tables completed!');

    return totalSuccessful;

  } catch (error: any) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await sourceClient.end();
  }
}

async function insertInBatches(tableName: string, data: any[]): Promise<number> {
  const batchSize = 100;
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
  migrateActualExistingTables().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default migrateActualExistingTables;