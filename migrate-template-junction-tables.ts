import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function migrateTemplateJunctionTables() {
  console.log('🚀 Migrating template junction tables...\n');

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

    // 1. Migrate template view groups (junction table)
    console.log('📋 Migrating template view groups...');

    const templateGroupsResult = await sourceClient.query(`
      SELECT
        tvg.id,
        tvg.template_id,
        tvg.group_id,
        COALESCE(t.text_name, t.task_name) as template_name,
        ag.name as group_name
      FROM dispatch_template_view_groups tvg
      JOIN dispatch_template t ON tvg.template_id = t.id
      JOIN auth_group ag ON tvg.group_id = ag.id
      ORDER BY tvg.id;
    `);

    console.log(`Found ${templateGroupsResult.rows.length} template-group associations`);

    if (templateGroupsResult.rows.length > 0) {
      // Transform for target schema
      const templateGroups = templateGroupsResult.rows.map(row => ({
        template_name: row.template_name,
        group_name: row.group_name,
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
      let totalInserted = 0;

      for (let i = 0; i < templateGroups.length; i += batchSize) {
        const batch = templateGroups.slice(i, i + batchSize);

        try {
          const { data, error } = await supabase
            .from('template_view_groups')
            .insert(batch)
            .select('id');

          if (error) {
            console.error(`❌ Error inserting template groups batch:`, error);
          } else {
            totalInserted += batch.length;
            console.log(`✅ Inserted ${batch.length} template groups (total: ${totalInserted})`);
          }
        } catch (error: any) {
          console.error(`❌ Exception inserting template groups:`, error.message);
        }
      }

      console.log(`✅ Template view groups migration: ${totalInserted}/${templateGroupsResult.rows.length} inserted\n`);
    }

    // 2. Migrate template view roles (junction table)
    console.log('👥 Migrating template view roles...');

    const templateRolesResult = await sourceClient.query(`
      SELECT
        tvr.id,
        tvr.template_id,
        tvr.role_id,
        COALESCE(t.text_name, t.task_name) as template_name,
        dr.name as role_name
      FROM dispatch_template_view_roles tvr
      JOIN dispatch_template t ON tvr.template_id = t.id
      JOIN dispatch_role dr ON tvr.role_id = dr.id
      ORDER BY tvr.id;
    `);

    console.log(`Found ${templateRolesResult.rows.length} template-role associations`);

    if (templateRolesResult.rows.length > 0) {
      // Transform for target schema
      const templateRoles = templateRolesResult.rows.map(row => ({
        template_name: row.template_name,
        role_name: row.role_name,
        permission_level: 'view', // Default since this is view roles
        is_active: true,
        legacy_template_id: row.template_id,
        legacy_role_id: row.role_id,
        legacy_junction_id: row.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {
          migrationDate: new Date().toISOString(),
          sourceTable: 'dispatch_template_view_roles',
          originalTemplateId: row.template_id,
          originalRoleId: row.role_id
        }
      }));

      // Insert in batches
      const batchSize = 50;
      let totalRolesInserted = 0;

      for (let i = 0; i < templateRoles.length; i += batchSize) {
        const batch = templateRoles.slice(i, i + batchSize);

        try {
          const { data, error } = await supabase
            .from('template_view_roles')
            .insert(batch)
            .select('id');

          if (error) {
            console.error(`❌ Error inserting template roles batch:`, error);
          } else {
            totalRolesInserted += batch.length;
            console.log(`✅ Inserted ${batch.length} template roles (total: ${totalRolesInserted})`);
          }
        } catch (error: any) {
          console.error(`❌ Exception inserting template roles:`, error.message);
        }
      }

      console.log(`✅ Template view roles migration: ${totalRolesInserted}/${templateRolesResult.rows.length} inserted\n`);
    }

    // Final validation
    const { count: finalGroupsCount } = await supabase
      .from('template_view_groups')
      .select('*', { count: 'exact', head: true });

    const { count: finalRolesCount } = await supabase
      .from('template_view_roles')
      .select('*', { count: 'exact', head: true });

    console.log('=== MIGRATION SUMMARY ===');
    console.log(`Template view groups: ${finalGroupsCount || 0} total records`);
    console.log(`Template view roles: ${finalRolesCount || 0} total records`);
    console.log('✅ Template junction tables migration completed!\n');

  } catch (error: any) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await sourceClient.end();
  }
}

// Run the migration
if (require.main === module) {
  migrateTemplateJunctionTables().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default migrateTemplateJunctionTables;