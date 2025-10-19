import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function insertInBatches(tableName: string, data: any[]): Promise<number> {
  const batchSize = 50;
  let totalInserted = 0;

  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);

    try {
      const { error } = await supabase
        .from(tableName)
        .insert(batch);

      if (error) {
        console.error(`   ❌ Error inserting batch for ${tableName}:`, error.message);
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

async function migrateRolesAndPermissions() {
  console.log('🚀 Starting roles and role_permissions migration...\n');

  const sourceClient = new Client({
    host: process.env.SOURCE_DB_HOST!,
    port: parseInt(process.env.SOURCE_DB_PORT!),
    user: process.env.SOURCE_DB_USER!,
    password: process.env.SOURCE_DB_PASSWORD!,
    database: process.env.SOURCE_DB_NAME!,
  });

  try {
    await sourceClient.connect();
    console.log('✅ Connected to source database');

    // First migrate roles from dispatch_role
    console.log('\n👥 Migrating roles from dispatch_role...');
    const rolesResult = await sourceClient.query(`
      SELECT
        id,
        name,
        abbrev,
        type,
        "order",
        user_id,
        group_id
      FROM dispatch_role
      ORDER BY id;
    `);

    console.log(`📊 Found ${rolesResult.rows.length} roles to migrate`);

    if (rolesResult.rows.length > 0) {
      // Create basic role records with minimal schema requirements
      const roles = rolesResult.rows.map((row: any) => ({
        name: row.name,
        description: row.abbrev || `Role: ${row.name}`,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {
          legacy_id: row.id,
          abbreviation: row.abbrev,
          role_type: row.type,
          order: row.order,
          user_id: row.user_id,
          group_id: row.group_id
        }
      }));

      console.log('\n📦 Sample role record:');
      if (roles.length > 0) {
        console.log(JSON.stringify(roles[0], null, 2));
      }

      const rolesInserted = await insertInBatches('roles', roles);
      console.log(`✅ Roles: ${rolesInserted}/${rolesResult.rows.length} migrated\n`);
    }

    // Now migrate role_permissions
    console.log('🔐 Migrating role_permissions from dispatch_role_permissions...');
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

    console.log(`📊 Found ${rolePermissionsResult.rows.length} role permissions to migrate`);

    if (rolePermissionsResult.rows.length > 0) {
      // Create role permission records with working schema
      const rolePermissions = rolePermissionsResult.rows.map((row: any) => ({
        role_id: row.role_id, // Use legacy role_id as integer
        permission: row.permission_name || 'unknown_permission',
        resource: row.codename || 'unknown_resource',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {
          legacy_id: row.id,
          legacy_role_id: row.role_id,
          legacy_permission_id: row.permission_id,
          role_name: row.role_name,
          permission_name: row.permission_name,
          codename: row.codename
        }
      }));

      console.log('\n📦 Sample role_permission record:');
      if (rolePermissions.length > 0) {
        console.log(JSON.stringify(rolePermissions[0], null, 2));
      }

      const rolePermissionsInserted = await insertInBatches('role_permissions', rolePermissions);
      console.log(`✅ Role Permissions: ${rolePermissionsInserted}/${rolePermissionsResult.rows.length} migrated\n`);
    }

    // Summary
    console.log('\n📊 ROLES AND PERMISSIONS MIGRATION SUMMARY:');
    console.log(`✅ Source roles: ${rolesResult.rows.length}`);
    console.log(`✅ Source role permissions: ${rolePermissionsResult.rows.length}`);

    // Verify final counts
    const { count: rolesCount } = await supabase
      .from('roles')
      .select('*', { count: 'exact', head: true });

    const { count: permissionsCount } = await supabase
      .from('role_permissions')
      .select('*', { count: 'exact', head: true });

    console.log(`📦 Final roles count in database: ${rolesCount || 0}`);
    console.log(`📦 Final role_permissions count in database: ${permissionsCount || 0}`);

    console.log('\n🎉 Roles and permissions migration completed!');

  } catch (error: any) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await sourceClient.end();
    console.log('🔌 Disconnected from source database');
  }
}

// Run the migration
if (require.main === module) {
  migrateRolesAndPermissions().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default migrateRolesAndPermissions;