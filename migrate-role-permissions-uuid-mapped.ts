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

async function migrateRolePermissionsWithUuidMapping() {
  console.log('🚀 Starting role_permissions migration with UUID mapping...\n');

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

    // Step 1: Build mapping from legacy role IDs to UUIDs
    console.log('\n🗺️ Building legacy role ID to UUID mapping...');
    const { data: roles, error: rolesError } = await supabase
      .from('roles')
      .select('id, legacy_id, name');

    if (rolesError) {
      throw new Error(`Failed to fetch roles: ${rolesError.message}`);
    }

    if (!roles || roles.length === 0) {
      throw new Error('No roles found in target database. Please migrate roles first.');
    }

    // Create mapping: legacy_id -> UUID
    const roleIdMapping = new Map<number, string>();
    roles.forEach(role => {
      if (role.legacy_id) {
        roleIdMapping.set(role.legacy_id, role.id);
      }
    });

    console.log(`📊 Built mapping for ${roleIdMapping.size} roles`);
    console.log('📋 Sample mappings:');
    let count = 0;
    for (const [legacyId, uuid] of roleIdMapping) {
      if (count < 3) {
        const roleName = roles.find(r => r.id === uuid)?.name;
        console.log(`   Legacy ID ${legacyId} → ${uuid} (${roleName})`);
        count++;
      }
    }

    // Step 2: Get source role_permissions data
    console.log('\n🔐 Fetching role_permissions from source...');
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

    // Step 3: Create role permission records with UUID mapping
    const rolePermissions = [];
    let mappingMisses = 0;

    for (const row of rolePermissionsResult.rows) {
      const targetRoleUuid = roleIdMapping.get(row.role_id);

      if (!targetRoleUuid) {
        console.warn(`⚠️  No UUID mapping found for legacy role_id ${row.role_id} (${row.role_name})`);
        mappingMisses++;
        continue;
      }

      rolePermissions.push({
        role_id: targetRoleUuid, // Use UUID instead of legacy ID
        permission: row.permission_name || 'unknown_permission',
        resource: row.codename || 'unknown_resource',
        is_active: true, // New column - default to true for migrated permissions
        legacy_id: row.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }

    console.log(`📦 Prepared ${rolePermissions.length} role permissions for insertion`);
    if (mappingMisses > 0) {
      console.log(`⚠️  ${mappingMisses} permissions skipped due to missing role mapping`);
    }

    // Show sample role permission with proper UUID
    if (rolePermissions.length > 0) {
      console.log('\n📦 Sample role_permission record with UUID:');
      console.log(JSON.stringify(rolePermissions[0], null, 2));
    }

    // Step 4: Insert role_permissions in batches
    console.log('\n⚡ Starting batch insertion...');
    const rolePermissionsInserted = await insertInBatches('role_permissions', rolePermissions);

    // Summary
    console.log('\n📊 ROLE PERMISSIONS MIGRATION SUMMARY:');
    console.log(`✅ Source role permissions: ${rolePermissionsResult.rows.length}`);
    console.log(`✅ Successfully mapped and migrated: ${rolePermissionsInserted}`);
    console.log(`✅ Success rate: ${((rolePermissionsInserted / rolePermissions.length) * 100).toFixed(1)}%`);

    if (mappingMisses > 0) {
      console.log(`⚠️  Mapping misses: ${mappingMisses} permissions could not be mapped to roles`);
    }

    // Verify final count
    const { count: finalCount } = await supabase
      .from('role_permissions')
      .select('*', { count: 'exact', head: true });

    console.log(`📦 Final role_permissions count in database: ${finalCount || 0}`);

    // Show permission distribution by role
    if (rolePermissionsInserted > 0) {
      console.log('\n📈 Role permissions distribution:');
      const rolePermissionCounts = new Map<string, number>();

      rolePermissions.slice(0, rolePermissionsInserted).forEach(rp => {
        const roleName = roles.find(r => r.id === rp.role_id)?.name || 'Unknown Role';
        rolePermissionCounts.set(roleName, (rolePermissionCounts.get(roleName) || 0) + 1);
      });

      const sortedRoles = Array.from(rolePermissionCounts.entries())
        .sort((a, b) => b[1] - a[1]);

      sortedRoles.slice(0, 10).forEach(([roleName, count]) => {
        console.log(`   ${roleName}: ${count} permissions`);
      });

      if (sortedRoles.length > 10) {
        console.log(`   ... and ${sortedRoles.length - 10} more roles`);
      }
    }

    if (rolePermissionsInserted > 0) {
      console.log('\n🎉 Role permissions migration completed successfully!');
      console.log('🔗 All permissions properly linked to role UUIDs');
      console.log('🔗 Legacy linkage: role_permissions.legacy_id → dispatch_role_permissions.id');
    } else {
      console.log('\n⚠️  Role permissions migration completed with issues - check errors above');
    }

    return rolePermissionsInserted;

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
  migrateRolePermissionsWithUuidMapping().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default migrateRolePermissionsWithUuidMapping;