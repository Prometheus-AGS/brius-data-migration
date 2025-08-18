import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

// Helper function to map role names to technician_type enum
function mapRoleToTechnicianType(roleName: string): string {
  const name = roleName.toLowerCase();
  
  if (name.includes('designing') || name.includes('dt-')) return 'designing';
  if (name.includes('manufacturing') || name.includes('mt-')) return 'manufacturing';
  if (name.includes('sectioning') || name.includes('st') || name.includes('idb')) return 'sectioning';
  if (name.includes('remote') || name.includes('rt') || name.includes('dtr')) return 'remote';
  if (name.includes('supervisor') || name.includes('master')) return 'master';
  if (name.includes('inspect') || name.includes('quality')) return 'quality_control';
  
  return 'manufacturing'; // Default
}

async function migrateTechnicianRoles() {
  console.log('🚀 Starting technician_roles migration using agent methodology...\n');
  
  // Step 1: Connect to source and get technician-related roles
  console.log('📊 Step 1: Fetching source role data...');
  
  const sourceClient = new Client({
    host: process.env.SOURCE_DB_HOST!,
    port: parseInt(process.env.SOURCE_DB_PORT!),
    user: process.env.SOURCE_DB_USER!,
    password: process.env.SOURCE_DB_PASSWORD!,
    database: process.env.SOURCE_DB_NAME!,
  });
  
  try {
    await sourceClient.connect();
    
    // Get technician-related roles from source (group_id = 11)
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
    
    if (sourceRoles.rows.length === 0) {
      console.log('No technician roles found to migrate');
      return;
    }
    
    // Step 2: Create migration control record
    console.log('\n📝 Step 2: Creating migration control record...');
    const { data: migrationRecord, error: controlError } = await supabase
      .from('migration_control')
      .insert({
        phase: 'execution',
        table_name: 'technician_roles',
        operation: 'typescript_migration',
        status: 'running',
        total_records: sourceRoles.rows.length,
        started_at: new Date().toISOString(),
        batch_size: sourceRoles.rows.length,
        worker_id: 1,
        source_query: 'SELECT * FROM dispatch_role WHERE group_id = 11'
      })
      .select('*')
      .single();
    
    if (controlError) {
      throw new Error(`Failed to create migration control record: ${controlError.message}`);
    }
    
    console.log(`✅ Migration control record created: ${migrationRecord.id}`);
    const migrationId = migrationRecord.id;
    
    // Step 3: Get a technician profile ID for role assignments
    console.log('\n🔍 Step 3: Finding technician profile for role assignments...');
    const { data: technicianProfile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('profile_type', 'technician')
      .limit(1)
      .single();
    
    if (profileError || !technicianProfile) {
      throw new Error('No technician profile found for role assignments');
    }
    
    console.log(`✅ Using technician profile: ${technicianProfile.id}`);
    
    // Step 4: Transform roles data for target schema
    console.log('\n🔄 Step 4: Transforming role data for target schema...');
    
    const transformedRoles = sourceRoles.rows.map(role => {
      const roleType = mapRoleToTechnicianType(role.name);
      
      return {
        technician_id: technicianProfile.id,
        role_type: roleType,
        role_name: role.name,
        abbreviation: role.abbrev || role.name.substring(0, 10),
        is_active: true,
        assigned_at: new Date().toISOString(),
        legacy_role_id: role.id
      };
    });
    
    console.log(`📦 Prepared ${transformedRoles.length} technician role records`);
    
    // Step 5: Insert technician roles
    console.log('\n💾 Step 5: Inserting technician roles...');
    const { data: insertedRoles, error: insertError } = await supabase
      .from('technician_roles')
      .insert(transformedRoles)
      .select('*');
    
    if (insertError) {
      throw new Error(`Failed to insert technician roles: ${insertError.message}`);
    }
    
    console.log(`✅ Successfully inserted ${insertedRoles!.length} technician roles`);
    
    // Step 6: Create migration mappings
    console.log('\n🔗 Step 6: Creating migration mappings...');
    const mappings = insertedRoles!.map(role => ({
      entity_type: 'technician_roles',
      legacy_id: role.legacy_role_id,
      new_id: role.id,
      migrated_at: new Date().toISOString(),
      migration_batch: 'technician_roles_batch_1'
    }));
    
    const { error: mappingError } = await supabase
      .from('migration_mappings')
      .insert(mappings);
    
    if (mappingError) {
      throw new Error(`Failed to create migration mappings: ${mappingError.message}`);
    }
    
    console.log(`✅ Created ${mappings.length} migration mappings`);
    
    // Step 7: Update migration control record
    console.log('\n📊 Step 7: Updating migration control...');
    const { error: updateError } = await supabase
      .from('migration_control')
      .update({
        status: 'completed',
        records_processed: insertedRoles!.length,
        completed_at: new Date().toISOString()
      })
      .eq('id', migrationId);
    
    if (updateError) {
      throw new Error(`Failed to update migration control: ${updateError.message}`);
    }
    
    console.log('✅ Migration control record updated');
    
    // Step 8: Validation
    console.log('\n🔍 Step 8: Validating migration...');
    
    // Count validation
    const { count: totalCount, error: countError } = await supabase
      .from('technician_roles')
      .select('*', { count: 'exact', head: true });
    
    if (countError) {
      console.warn(`Warning: Could not verify total count: ${countError.message}`);
    }
    
    // Sample validation
    const { data: sampleRoles, error: sampleError } = await supabase
      .from('technician_roles')
      .select('*')
      .not('legacy_role_id', 'is', null)
      .limit(5);
    
    if (sampleError) {
      console.warn(`Warning: Could not fetch sample data: ${sampleError.message}`);
    }
    
    // Mapping validation
    const { count: mappingCount, error: mappingCountError } = await supabase
      .from('migration_mappings')
      .select('*', { count: 'exact', head: true })
      .eq('entity_type', 'technician_roles');
    
    if (mappingCountError) {
      console.warn(`Warning: Could not verify mapping count: ${mappingCountError.message}`);
    }
    
    console.log('\n📈 Migration Results:');
    console.log(`   • Source records: ${sourceRoles.rows.length}`);
    console.log(`   • Migrated records: ${insertedRoles!.length}`);
    console.log(`   • Current total in target: ${totalCount || 'unknown'}`);
    console.log(`   • Migration mappings created: ${mappingCount || 'unknown'}`);
    console.log(`   • Migration ID: ${migrationId}`);
    
    // Display sample migrated data
    if (sampleRoles && sampleRoles.length > 0) {
      console.log('\n📋 Sample migrated records:');
      sampleRoles.forEach((role, index) => {
        console.log(`   ${index + 1}. ${role.role_name} (${role.role_type}) - Legacy ID: ${role.legacy_role_id}`);
      });
    }
    
    console.log('\n🎉 technician_roles migration completed successfully!');
    
    return {
      status: 'SUCCESS',
      sourceRecords: sourceRoles.rows.length,
      recordsMigrated: insertedRoles!.length,
      mappingsCreated: mappings.length,
      migrationId: migrationId,
      totalInTarget: totalCount
    };
    
  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    
    // Try to mark migration as failed if we have a migration ID
    try {
      await supabase
        .from('migration_control')
        .update({
          status: 'failed',
          error_message: error.message,
          completed_at: new Date().toISOString()
        })
        .eq('table_name', 'technician_roles')
        .eq('status', 'running');
    } catch (updateError) {
      console.error('Failed to update migration control with error:', updateError);
    }
    
    throw error;
    
  } finally {
    await sourceClient.end();
  }
}

// Execute the migration
if (require.main === module) {
  migrateTechnicianRoles()
    .then(result => {
      console.log('\n✨ Final Result:', result);
      process.exit(0);
    })
    .catch(error => {
      console.error('\n💥 Migration Error:', error.message);
      process.exit(1);
    });
}

export { migrateTechnicianRoles };
