import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

// Helper function to map role names to technician_type enum
function mapRoleToTechnicianType(roleName: string): string {
  const name = roleName.toLowerCase();

  if (name.includes('designing') || name.includes('dt-') || name.includes('dt')) return 'designing';
  if (name.includes('manufacturing') || name.includes('mt-') || name.includes('mt')) return 'manufacturing';
  if (name.includes('sectioning') || name.includes('st') || name.includes('idb')) return 'sectioning';
  if (name.includes('remote') || name.includes('rt') || name.includes('dtr')) return 'remote';
  if (name.includes('supervisor') || name.includes('master')) return 'master';
  if (name.includes('inspect') || name.includes('quality')) return 'quality_control';

  return 'manufacturing'; // Default
}

async function migrateCompleteTechnicians() {
  console.log('🚀 Starting complete technicians migration...');
  console.log('   Phase 1: Migrate technician users to profiles & technicians');
  console.log('   Phase 2: Migrate technician roles');
  console.log('');

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

    // PHASE 1: Migrate Technician Users
    console.log('\n📋 PHASE 1: Migrating technician users...');

    // Get technician users from source
    const technicianUsers = await sourceClient.query(`
      SELECT
        au.id,
        au.username,
        au.first_name,
        au.last_name,
        au.email,
        au.is_staff,
        au.is_active,
        au.date_joined,
        au.last_login
      FROM auth_user au
      JOIN auth_user_groups aug ON au.id = aug.user_id
      WHERE aug.group_id = 11
      ORDER BY au.id;
    `);

    console.log(`Found ${technicianUsers.rows.length} technician users to migrate`);

    let profilesCreated = 0;
    let techniciansCreated = 0;
    const technicianProfiles: any[] = [];

    // Process in batches
    const batchSize = 10;
    for (let i = 0; i < technicianUsers.rows.length; i += batchSize) {
      const batch = technicianUsers.rows.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(technicianUsers.rows.length/batchSize)}: ${batch.length} users`);

      for (const user of batch) {
        try {
          // Check if profile already exists
          const { data: existingProfile } = await supabase
            .from('profiles')
            .select('id')
            .eq('legacy_user_id', user.id)
            .single();

          let profileId = existingProfile?.id;

          if (!existingProfile) {
            // Create profile first
            const { data: newProfile, error: profileError } = await supabase
              .from('profiles')
              .insert({
                profile_type: 'technician',
                full_name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username,
                email: user.email,
                legacy_user_id: user.id,
                is_active: user.is_active,
                created_at: user.date_joined,
                updated_at: user.last_login || user.date_joined,
                metadata: {
                  migrationDate: new Date().toISOString(),
                  sourceTable: 'auth_user',
                  username: user.username,
                  isStaff: user.is_staff
                }
              })
              .select('id')
              .single();

            if (profileError) {
              console.error(`❌ Error creating profile for user ${user.id}:`, profileError.message);
              continue;
            }

            profileId = newProfile!.id;
            profilesCreated++;
            console.log(`   ✅ Created profile for ${user.username} (${user.first_name} ${user.last_name})`);
          } else {
            console.log(`   ⚠️  Profile already exists for ${user.username}`);
          }

          // Check if technician record already exists
          const { data: existingTechnician } = await supabase
            .from('technicians')
            .select('id')
            .eq('profile_id', profileId)
            .single();

          if (!existingTechnician) {
            // Create technician record
            const { data: newTechnician, error: technicianError } = await supabase
              .from('technicians')
              .insert({
                profile_id: profileId,
                employee_id: user.username,
                status: user.is_active ? 'active' : 'inactive',
                hire_date: user.date_joined,
                created_at: user.date_joined,
                updated_at: user.last_login || user.date_joined,
                legacy_technician_id: user.id,
                legacy_user_id: user.id,
                metadata: {
                  migrationDate: new Date().toISOString(),
                  sourceTable: 'auth_user',
                  originalUsername: user.username
                }
              })
              .select('*')
              .single();

            if (technicianError) {
              console.error(`❌ Error creating technician for user ${user.id}:`, technicianError.message);
              continue;
            }

            techniciansCreated++;
            technicianProfiles.push(newTechnician);
            console.log(`   ✅ Created technician record for ${user.username}`);
          } else {
            // Add existing technician to our list for role assignment
            const { data: existingTechData } = await supabase
              .from('technicians')
              .select('*')
              .eq('id', existingTechnician.id)
              .single();

            if (existingTechData) {
              technicianProfiles.push(existingTechData);
            }
            console.log(`   ⚠️  Technician already exists for ${user.username}`);
          }

        } catch (error: any) {
          console.error(`❌ Error processing user ${user.id} (${user.username}):`, error.message);
        }
      }
    }

    console.log(`\n📊 Phase 1 Results:`);
    console.log(`   • Profiles created: ${profilesCreated}`);
    console.log(`   • Technicians created: ${techniciansCreated}`);
    console.log(`   • Total technician records available: ${technicianProfiles.length}`);

    // PHASE 2: Migrate Technician Roles
    console.log('\n📋 PHASE 2: Migrating technician roles...');

    // Get technician roles from source
    const sourceRoles = await sourceClient.query(`
      SELECT
        id,
        name,
        abbrev,
        type,
        "order",
        user_id,
        group_id
      FROM dispatch_role
      WHERE group_id = 11
      ORDER BY id;
    `);

    console.log(`Found ${sourceRoles.rows.length} technician roles in source database`);

    if (sourceRoles.rows.length === 0 || technicianProfiles.length === 0) {
      console.log('⚠️  No roles or technicians available for role assignment');
      return;
    }

    // Use the first available technician for role assignments (or distribute roles)
    const primaryTechnician = technicianProfiles[0];
    console.log(`Using primary technician: ${primaryTechnician.employee_id} (${primaryTechnician.id})`);

    // Transform roles data
    const transformedRoles = sourceRoles.rows.map(role => {
      const roleType = mapRoleToTechnicianType(role.name);

      return {
        technician_id: primaryTechnician.id,
        role_type: roleType,
        role_name: role.name,
        abbreviation: role.abbrev || role.name.substring(0, 10),
        is_active: true,
        assigned_at: new Date().toISOString(),
        legacy_role_id: role.id,
        metadata: {
          migrationDate: new Date().toISOString(),
          sourceTable: 'dispatch_role',
          originalOrder: role.order,
          originalType: role.type
        }
      };
    });

    console.log(`📦 Prepared ${transformedRoles.length} technician role records`);

    // Insert technician roles in batches
    let rolesCreated = 0;
    const roleBatchSize = 20;

    for (let i = 0; i < transformedRoles.length; i += roleBatchSize) {
      const roleBatch = transformedRoles.slice(i, i + roleBatchSize);

      try {
        const { data: insertedRoles, error: insertError } = await supabase
          .from('technician_roles')
          .insert(roleBatch)
          .select('*');

        if (insertError) {
          console.error(`❌ Error inserting role batch:`, insertError.message);
          continue;
        }

        rolesCreated += roleBatch.length;
        console.log(`   ✅ Inserted ${roleBatch.length} roles (total: ${rolesCreated})`);

        // Create migration mappings for this batch
        const mappings = insertedRoles!.map(role => ({
          entity_type: 'technician_roles',
          legacy_id: role.legacy_role_id,
          new_id: role.id,
          migrated_at: new Date().toISOString(),
          migration_batch: `technician_roles_batch_${Math.floor(i/roleBatchSize) + 1}`
        }));

        await supabase.from('migration_mappings').insert(mappings);

      } catch (error: any) {
        console.error(`❌ Error processing role batch:`, error.message);
      }
    }

    // Final validation
    console.log('\n🔍 Final Validation...');

    const { count: profileCount } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('profile_type', 'technician');

    const { count: technicianCount } = await supabase
      .from('technicians')
      .select('*', { count: 'exact', head: true });

    const { count: roleCount } = await supabase
      .from('technician_roles')
      .select('*', { count: 'exact', head: true });

    const { count: mappingCount } = await supabase
      .from('migration_mappings')
      .select('*', { count: 'exact', head: true })
      .eq('entity_type', 'technician_roles');

    console.log('\n📈 Final Migration Results:');
    console.log(`   🔵 Source technician users: ${technicianUsers.rows.length}`);
    console.log(`   🔵 Source technician roles: ${sourceRoles.rows.length}`);
    console.log(`   ✅ Technician profiles created: ${profilesCreated}`);
    console.log(`   ✅ Technician records created: ${techniciansCreated}`);
    console.log(`   ✅ Technician roles created: ${rolesCreated}`);
    console.log(`   📊 Current totals in target:`);
    console.log(`      • Technician profiles: ${profileCount || 0}`);
    console.log(`      • Technician records: ${technicianCount || 0}`);
    console.log(`      • Technician roles: ${roleCount || 0}`);
    console.log(`      • Migration mappings: ${mappingCount || 0}`);

    console.log('\n🎉 Complete technicians migration finished successfully!');

    return {
      status: 'SUCCESS',
      sourceUsers: technicianUsers.rows.length,
      sourceRoles: sourceRoles.rows.length,
      profilesCreated,
      techniciansCreated,
      rolesCreated,
      finalTotals: {
        profiles: profileCount,
        technicians: technicianCount,
        roles: roleCount,
        mappings: mappingCount
      }
    };

  } catch (error: any) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await sourceClient.end();
  }
}

// Execute the migration
if (require.main === module) {
  migrateCompleteTechnicians()
    .then(result => {
      console.log('\n✨ Final Result:', result);
      process.exit(0);
    })
    .catch(error => {
      console.error('\n💥 Migration Error:', error.message);
      process.exit(1);
    });
}

export { migrateCompleteTechnicians };