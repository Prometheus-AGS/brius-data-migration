import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function investigateRolesSchema() {
  console.log('🔍 Investigating roles and role_permissions schema and source data...\n');

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

    // Check what auth/permission related tables exist in source
    console.log('📋 1. Checking source tables for auth/roles/permissions...');
    const sourceTablesResult = await sourceClient.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND (table_name LIKE '%auth%' OR table_name LIKE '%role%' OR table_name LIKE '%permission%' OR table_name LIKE '%group%')
      ORDER BY table_name;
    `);

    console.log('🗂️ Found auth/role related source tables:');
    sourceTablesResult.rows.forEach((row: any) => {
      console.log(`   • ${row.table_name}`);
    });

    // Check specific tables we're interested in
    const tablesToCheck = ['auth_group', 'auth_group_permissions', 'auth_permission', 'dispatch_role', 'dispatch_user_role'];

    for (const tableName of tablesToCheck) {
      console.log(`\n📊 ${tableName}:`);

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

          // Get count and sample data
          const countResult = await sourceClient.query(`SELECT COUNT(*) as count FROM ${tableName}`);
          console.log(`   📈 Count: ${countResult.rows[0].count} records`);

          if (parseInt(countResult.rows[0].count) > 0) {
            const sampleResult = await sourceClient.query(`SELECT * FROM ${tableName} LIMIT 3`);
            console.log(`   📋 Sample data:`);
            sampleResult.rows.forEach((row: any, index: number) => {
              console.log(`     ${index + 1}. ${JSON.stringify(row)}`);
            });
          }
        } else {
          console.log(`   ❌ Table does not exist`);
        }
      } catch (error: any) {
        console.log(`   ❌ Error accessing table: ${error.message}`);
      }
    }

    console.log('\n📋 2. Checking target tables (roles, role_permissions)...');

    // Check target roles table
    try {
      const { data: rolesData, error: rolesError } = await supabase
        .from('roles')
        .select('*')
        .limit(3);

      if (rolesError) {
        console.log(`❌ Error accessing roles table: ${rolesError.message}`);
      } else {
        console.log(`✅ roles table accessible`);
        if (rolesData && rolesData.length > 0) {
          console.log(`   📋 Sample structure:`, Object.keys(rolesData[0]));
          console.log(`   📋 Sample record:`, rolesData[0]);
        } else {
          console.log(`   📊 roles table is empty`);

          // Try a test insert to discover schema
          console.log(`\n🧪 Testing roles table schema...`);
          const testRole = {
            id: '00000000-0000-0000-0000-000000000001',
            name: 'test_role',
            description: 'Test role',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };

          const { data: testResult, error: testError } = await supabase
            .from('roles')
            .insert(testRole)
            .select();

          if (testError) {
            console.log(`   ❌ Test insert failed: ${testError.message}`);
          } else {
            console.log(`   ✅ Test insert successful:`, testResult);
            // Clean up
            await supabase.from('roles').delete().eq('id', testRole.id);
            console.log(`   🧹 Cleaned up test record`);
          }
        }
      }
    } catch (error: any) {
      console.log(`❌ Error with roles table: ${error.message}`);
    }

    // Check target role_permissions table
    try {
      const { data: rolePermData, error: rolePermError } = await supabase
        .from('role_permissions')
        .select('*')
        .limit(3);

      if (rolePermError) {
        console.log(`❌ Error accessing role_permissions table: ${rolePermError.message}`);
      } else {
        console.log(`✅ role_permissions table accessible`);
        if (rolePermData && rolePermData.length > 0) {
          console.log(`   📋 Sample structure:`, Object.keys(rolePermData[0]));
          console.log(`   📋 Sample record:`, rolePermData[0]);
        } else {
          console.log(`   📊 role_permissions table is empty`);

          // Try a test insert to discover schema
          console.log(`\n🧪 Testing role_permissions table schema...`);
          const testRolePermission = {
            id: '00000000-0000-0000-0000-000000000002',
            role_id: '00000000-0000-0000-0000-000000000001',
            permission: 'test_permission',
            resource: 'test_resource',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };

          const { data: testResult, error: testError } = await supabase
            .from('role_permissions')
            .insert(testRolePermission)
            .select();

          if (testError) {
            console.log(`   ❌ Test insert failed: ${testError.message}`);

            // Try alternative field combinations
            const altTests = [
              { role_id: '00000000-0000-0000-0000-000000000001', permission_name: 'test_permission' },
              { role_id: '00000000-0000-0000-0000-000000000001', permission: 'test_permission' },
              { role_id: '00000000-0000-0000-0000-000000000001', permission_id: '00000000-0000-0000-0000-000000000003' }
            ];

            for (const altTest of altTests) {
              const { data: altResult, error: altError } = await supabase
                .from('role_permissions')
                .insert(altTest)
                .select();

              if (!altError && altResult) {
                console.log(`   ✅ Alternative schema works:`, Object.keys(altTest));
                // Clean up
                await supabase.from('role_permissions').delete().eq('id', altResult[0].id);
                break;
              }
            }
          } else {
            console.log(`   ✅ Test insert successful:`, testResult);
            // Clean up
            await supabase.from('role_permissions').delete().eq('id', testRolePermission.id);
            console.log(`   🧹 Cleaned up test record`);
          }
        }
      }
    } catch (error: any) {
      console.log(`❌ Error with role_permissions table: ${error.message}`);
    }

    console.log('\n📊 SCHEMA INVESTIGATION SUMMARY:');
    console.log('✅ Source database checked for auth/role tables');
    console.log('✅ Target database schema discovery attempted');
    console.log('💡 Ready to create aligned migration scripts');

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
  investigateRolesSchema().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default investigateRolesSchema;