import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function migrateTemplateTablesRemaining() {
  console.log('🚀 Starting template tables migration (products & edit roles)...\n');

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

    // 1. TEMPLATE PRODUCTS MIGRATION
    console.log('📦 Migrating template products...');

    try {
      const templateProductsResult = await sourceClient.query(`
        SELECT
          tp.id,
          tp.template_id,
          tp.product_id,
          COALESCE(t.text_name, t.task_name, 'Unknown Template') as template_name,
          p.name as product_name,
          p.price,
          tp.created_at,
          tp.updated_at
        FROM dispatch_template_product tp
        LEFT JOIN dispatch_template t ON tp.template_id = t.id
        LEFT JOIN dispatch_product p ON tp.product_id = p.id
        ORDER BY tp.id;
      `);

      console.log(`Found ${templateProductsResult.rows.length} template-product associations`);

      if (templateProductsResult.rows.length > 0) {
        const templateProducts = templateProductsResult.rows.map(row => ({
          template_name: row.template_name,
          product_name: row.product_name || 'Unknown Product',
          product_price: parseFloat(row.price) || 0,
          is_active: true,
          legacy_template_id: row.template_id,
          legacy_product_id: row.product_id,
          legacy_junction_id: row.id,
          created_at: row.created_at || new Date().toISOString(),
          updated_at: row.updated_at || new Date().toISOString(),
          metadata: {
            migrationDate: new Date().toISOString(),
            sourceTable: 'dispatch_template_product',
            originalTemplateId: row.template_id,
            originalProductId: row.product_id
          }
        }));

        // Insert in batches
        const batchSize = 50;
        let totalInserted = 0;

        for (let i = 0; i < templateProducts.length; i += batchSize) {
          const batch = templateProducts.slice(i, i + batchSize);

          try {
            const { error } = await supabase
              .from('template_products')
              .insert(batch);

            if (error) {
              console.error(`❌ Error inserting template products batch:`, error.message);
            } else {
              totalInserted += batch.length;
              console.log(`✅ Inserted ${batch.length} template products (total: ${totalInserted})`);
            }
          } catch (error: any) {
            console.error(`❌ Exception inserting template products:`, error.message);
          }
        }

        console.log(`✅ Template products migration: ${totalInserted}/${templateProductsResult.rows.length} inserted\n`);
      }

    } catch (error: any) {
      console.log(`⚠️  Template products table not found or error: ${error.message}\n`);
    }

    // 2. TEMPLATE EDIT ROLES MIGRATION
    console.log('👥 Migrating template edit roles...');

    try {
      const templateEditRolesResult = await sourceClient.query(`
        SELECT
          ter.id,
          ter.template_id,
          ter.role_id,
          COALESCE(t.text_name, t.task_name, 'Unknown Template') as template_name,
          dr.name as role_name,
          ter.created_at,
          ter.updated_at
        FROM dispatch_template_edit_roles ter
        LEFT JOIN dispatch_template t ON ter.template_id = t.id
        LEFT JOIN dispatch_role dr ON ter.role_id = dr.id
        ORDER BY ter.id;
      `);

      console.log(`Found ${templateEditRolesResult.rows.length} template edit role associations`);

      if (templateEditRolesResult.rows.length > 0) {
        const templateEditRoles = templateEditRolesResult.rows.map(row => ({
          template_name: row.template_name,
          role_name: row.role_name || 'Unknown Role',
          permission_level: 'edit', // This is edit roles specifically
          is_active: true,
          legacy_template_id: row.template_id,
          legacy_role_id: row.role_id,
          legacy_junction_id: row.id,
          created_at: row.created_at || new Date().toISOString(),
          updated_at: row.updated_at || new Date().toISOString(),
          metadata: {
            migrationDate: new Date().toISOString(),
            sourceTable: 'dispatch_template_edit_roles',
            originalTemplateId: row.template_id,
            originalRoleId: row.role_id
          }
        }));

        // Insert in batches
        const batchSize = 50;
        let totalEditRolesInserted = 0;

        for (let i = 0; i < templateEditRoles.length; i += batchSize) {
          const batch = templateEditRoles.slice(i, i + batchSize);

          try {
            const { error } = await supabase
              .from('template_edit_roles')
              .insert(batch);

            if (error) {
              console.error(`❌ Error inserting template edit roles batch:`, error.message);
            } else {
              totalEditRolesInserted += batch.length;
              console.log(`✅ Inserted ${batch.length} template edit roles (total: ${totalEditRolesInserted})`);
            }
          } catch (error: any) {
            console.error(`❌ Exception inserting template edit roles:`, error.message);
          }
        }

        console.log(`✅ Template edit roles migration: ${totalEditRolesInserted}/${templateEditRolesResult.rows.length} inserted\n`);
      }

    } catch (error: any) {
      console.log(`⚠️  Template edit roles table not found or error: ${error.message}\n`);
    }

    // 3. TEMPLATE VIEW GROUPS MIGRATION (Corrected version)
    console.log('📋 Migrating template view groups (corrected)...');

    try {
      // First, let's check what columns actually exist
      const columnsResult = await sourceClient.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'dispatch_template_view_groups'
        AND table_schema = 'public'
        ORDER BY ordinal_position;
      `);

      if (columnsResult.rows.length > 0) {
        console.log('Available columns in dispatch_template_view_groups:', columnsResult.rows.map(r => r.column_name));

        // Use a more flexible query based on actual columns
        const templateViewGroupsResult = await sourceClient.query(`
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

        console.log(`Found ${templateViewGroupsResult.rows.length} template view group associations`);

        if (templateViewGroupsResult.rows.length > 0) {
          const templateViewGroups = templateViewGroupsResult.rows.map(row => ({
            template_name: row.template_name,
            group_name: row.group_name || 'Unknown Group',
            access_level: 'view',
            is_active: true,
            legacy_template_id: row.template_id,
            legacy_group_id: row.group_id,
            legacy_junction_id: row.id,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            metadata: {
              migrationDate: new Date().toISOString(),
              sourceTable: 'dispatch_template_view_groups',
              originalTemplateId: row.template_id,
              originalGroupId: row.group_id
            }
          }));

          // Insert in batches
          const batchSize = 50;
          let totalViewGroupsInserted = 0;

          for (let i = 0; i < templateViewGroups.length; i += batchSize) {
            const batch = templateViewGroups.slice(i, i + batchSize);

            try {
              const { error } = await supabase
                .from('template_view_groups')
                .insert(batch);

              if (error) {
                console.error(`❌ Error inserting template view groups batch:`, error.message);
              } else {
                totalViewGroupsInserted += batch.length;
                console.log(`✅ Inserted ${batch.length} template view groups (total: ${totalViewGroupsInserted})`);
              }
            } catch (error: any) {
              console.error(`❌ Exception inserting template view groups:`, error.message);
            }
          }

          console.log(`✅ Template view groups migration: ${totalViewGroupsInserted}/${templateViewGroupsResult.rows.length} inserted\n`);
        }
      }

    } catch (error: any) {
      console.log(`⚠️  Template view groups table not found or error: ${error.message}\n`);
    }

    // Final validation
    const { count: templateProductsCount } = await supabase
      .from('template_products')
      .select('*', { count: 'exact', head: true });

    const { count: templateEditRolesCount } = await supabase
      .from('template_edit_roles')
      .select('*', { count: 'exact', head: true });

    const { count: templateViewGroupsCount } = await supabase
      .from('template_view_groups')
      .select('*', { count: 'exact', head: true });

    console.log('=== TEMPLATE MIGRATION SUMMARY ===');
    console.log(`Template products: ${templateProductsCount || 0} total records`);
    console.log(`Template edit roles: ${templateEditRolesCount || 0} total records`);
    console.log(`Template view groups: ${templateViewGroupsCount || 0} total records`);
    console.log('✅ Template tables migration completed!\n');

    return {
      template_products: templateProductsCount || 0,
      template_edit_roles: templateEditRolesCount || 0,
      template_view_groups: templateViewGroupsCount || 0
    };

  } catch (error: any) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await sourceClient.end();
  }
}

// Run the migration
if (require.main === module) {
  migrateTemplateTablesRemaining().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default migrateTemplateTablesRemaining;