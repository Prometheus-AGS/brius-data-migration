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

async function migrateRolesPermissionsMinimal() {
  console.log('🚀 Starting minimal roles and role_permissions migration...\n');

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

    // First migrate roles with minimal fields
    console.log('\n👥 Migrating roles from dispatch_role (minimal schema)...');
    const rolesResult = await sourceClient.query(`
      SELECT id, name, abbrev, type, "order", user_id, group_id
      FROM dispatch_role
      ORDER BY id;
    `);

    console.log(`📊 Found ${rolesResult.rows.length} roles to migrate`);

    if (rolesResult.rows.length > 0) {
      // Create minimal role records - only required fields
      const roles = rolesResult.rows.map((row: any) => ({
        name: row.name,
        description: row.abbrev || `Role: ${row.name}`,
        legacy_id: row.id, // Include legacy_id directly
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      console.log('\n📦 Sample minimal role record:');
      if (roles.length > 0) {
        console.log(JSON.stringify(roles[0], null, 2));
      }

      const rolesInserted = await insertInBatches('roles', roles);
      console.log(`✅ Roles: ${rolesInserted}/${rolesResult.rows.length} migrated\n`);
    }

    // Now migrate role_permissions with minimal fields
    console.log('🔐 Migrating role_permissions (minimal schema)...');
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
      // Create minimal role permission records
      const rolePermissions = rolePermissionsResult.rows.map((row: any) => ({
        role_id: row.role_id, // Legacy role_id as integer
        permission: row.permission_name || 'unknown_permission',
        resource: row.codename || 'unknown_resource',
        legacy_id: row.id, // Include legacy_id directly
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      console.log('\n📦 Sample minimal role_permission record:');
      if (rolePermissions.length > 0) {
        console.log(JSON.stringify(rolePermissions[0], null, 2));
      }

      const rolePermissionsInserted = await insertInBatches('role_permissions', rolePermissions);
      console.log(`✅ Role Permissions: ${rolePermissionsInserted}/${rolePermissionsResult.rows.length} migrated\n`);
    }

    // Summary
    console.log('\n📊 MINIMAL ROLES AND PERMISSIONS MIGRATION SUMMARY:');
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

    if ((rolesCount || 0) > 0 && (permissionsCount || 0) > 0) {
      console.log('\n🎉 Roles and permissions migration completed successfully!');
      console.log('🔗 Role legacy_id linkage: roles.legacy_id → dispatch_role.id');
      console.log('🔗 Permission legacy_id linkage: role_permissions.legacy_id → dispatch_role_permissions.id');
    } else {
      console.log('\n⚠️  Migration completed with issues - check errors above');
    }

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
  migrateRolesPermissionsMinimal().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default migrateRolesPermissionsMinimal;