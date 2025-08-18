import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function validateTechnicianRolesMigration() {
  console.log('🔍 Validating technician_roles migration...\n');
  
  const sourceClient = new Client({
    host: process.env.SOURCE_DB_HOST!,
    port: parseInt(process.env.SOURCE_DB_PORT!),
    user: process.env.SOURCE_DB_USER!,
    password: process.env.SOURCE_DB_PASSWORD!,
    database: process.env.SOURCE_DB_NAME!,
  });
  
  try {
    await sourceClient.connect();
    
    // Step 1: Count Validation
    console.log('📊 Step 1: Record Count Validation...');
    
    const sourceCount = await sourceClient.query('SELECT COUNT(*) as count FROM dispatch_role WHERE group_id = 11');
    const sourceRecords = parseInt(sourceCount.rows[0].count);
    
    const { count: targetCount, error: countError } = await supabase
      .from('technician_roles')
      .select('*', { count: 'exact', head: true });
    
    if (countError) {
      throw new Error(`Failed to count target records: ${countError.message}`);
    }
    
    console.log(`   • Source (dispatch_role): ${sourceRecords} records`);
    console.log(`   • Target (technician_roles): ${targetCount} records`);
    console.log(`   • Count Match: ${sourceRecords === targetCount ? '✅ PASS' : '❌ FAIL'}`);
    
    // Step 2: Mapping Validation
    console.log('\n🔗 Step 2: Migration Mapping Validation...');
    
    const { count: mappingCount, error: mappingError } = await supabase
      .from('migration_mappings')
      .select('*', { count: 'exact', head: true })
      .eq('entity_type', 'technician_roles');
    
    if (mappingError) {
      throw new Error(`Failed to count migration mappings: ${mappingError.message}`);
    }
    
    console.log(`   • Migration mappings: ${mappingCount} records`);
    console.log(`   • Mapping completeness: ${sourceRecords === mappingCount ? '✅ PASS' : '❌ FAIL'}`);
    
    // Step 3: Data Integrity Validation
    console.log('\n🔬 Step 3: Data Integrity Validation...');
    
    // Sample role validation
    const sourceRoles = await sourceClient.query(`
      SELECT id, name, abbrev 
      FROM dispatch_role 
      WHERE group_id = 11 
      ORDER BY id 
      LIMIT 10
    `);
    
    const { data: targetRoles, error: targetError } = await supabase
      .from('technician_roles')
      .select('legacy_role_id, role_name, abbreviation, role_type')
      .not('legacy_role_id', 'is', null)
      .order('legacy_role_id')
      .limit(10);
    
    if (targetError) {
      throw new Error(`Failed to fetch target roles: ${targetError.message}`);
    }
    
    let integrityPassed = 0;
    let integrityFailed = 0;
    
    console.log('   📋 Sample Data Comparison:');
    for (let i = 0; i < Math.min(sourceRoles.rows.length, targetRoles.length); i++) {
      const source = sourceRoles.rows[i];
      const target = targetRoles[i];
      
      const nameMatch = source.name === target.role_name;
      const abbrevMatch = (source.abbrev || '').substring(0, 10) === target.abbreviation;
      const idMatch = source.id === target.legacy_role_id;
      
      const passed = nameMatch && abbrevMatch && idMatch;
      
      console.log(`      ${i + 1}. ID: ${source.id} → ${target.legacy_role_id} ${idMatch ? '✅' : '❌'}`);
      console.log(`         Name: "${source.name}" → "${target.role_name}" ${nameMatch ? '✅' : '❌'}`);
      console.log(`         Abbrev: "${source.abbrev || 'N/A'}" → "${target.abbreviation}" ${abbrevMatch ? '✅' : '❌'}`);
      console.log(`         Type: → "${target.role_type}"`);
      
      if (passed) integrityPassed++;
      else integrityFailed++;
    }
    
    console.log(`   • Sample integrity: ${integrityPassed}/${integrityPassed + integrityFailed} passed`);
    
    // Step 4: Enum Validation
    console.log('\n📋 Step 4: Role Type Enum Validation...');
    
    const { data: roleTypes, error: enumError } = await supabase
      .from('technician_roles')
      .select('role_type')
      .not('role_type', 'is', null);
    
    if (enumError) {
      throw new Error(`Failed to fetch role types: ${enumError.message}`);
    }
    
    const typeDistribution: Record<string, number> = {};
    roleTypes.forEach(role => {
      typeDistribution[role.role_type] = (typeDistribution[role.role_type] || 0) + 1;
    });
    
    console.log('   📊 Role Type Distribution:');
    Object.entries(typeDistribution).forEach(([type, count]) => {
      console.log(`      • ${type}: ${count} roles`);
    });
    
    // Step 5: Migration Control Validation
    console.log('\n📝 Step 5: Migration Control Validation...');
    
    const { data: migrationControl, error: controlError } = await supabase
      .from('migration_control')
      .select('*')
      .eq('table_name', 'technician_roles')
      .eq('phase', 'execution')
      .order('started_at', { ascending: false })
      .limit(1);
    
    if (controlError) {
      throw new Error(`Failed to fetch migration control: ${controlError.message}`);
    }
    
    if (migrationControl && migrationControl.length > 0) {
      const control = migrationControl[0];
      console.log(`   • Migration ID: ${control.id}`);
      console.log(`   • Status: ${control.status}`);
      console.log(`   • Records processed: ${control.records_processed}`);
      console.log(`   • Started: ${new Date(control.started_at).toLocaleString()}`);
      console.log(`   • Completed: ${new Date(control.completed_at).toLocaleString()}`);
      console.log(`   • Duration: ${Math.round((new Date(control.completed_at).getTime() - new Date(control.started_at).getTime()) / 1000)}s`);
    }
    
    // Summary
    console.log('\n🎯 Validation Summary:');
    const allValidationsPassed = sourceRecords === targetCount && 
                                sourceRecords === mappingCount && 
                                integrityFailed === 0;
    
    console.log(`   • Overall Status: ${allValidationsPassed ? '✅ ALL VALIDATIONS PASSED' : '❌ SOME VALIDATIONS FAILED'}`);
    console.log(`   • Source Records: ${sourceRecords}`);
    console.log(`   • Target Records: ${targetCount}`);
    console.log(`   • Mappings: ${mappingCount}`);
    console.log(`   • Data Integrity: ${integrityPassed}/${integrityPassed + integrityFailed} samples passed`);
    
    return {
      success: allValidationsPassed,
      sourceRecords,
      targetRecords: targetCount,
      mappingRecords: mappingCount,
      integrityScore: integrityPassed / (integrityPassed + integrityFailed),
      roleTypeDistribution: typeDistribution
    };
    
  } catch (error: any) {
    console.error('❌ Validation failed:', error.message);
    throw error;
    
  } finally {
    await sourceClient.end();
  }
}

// Execute validation
if (require.main === module) {
  validateTechnicianRolesMigration()
    .then(result => {
      console.log('\n✨ Validation Result:', result);
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('\n💥 Validation Error:', error.message);
      process.exit(1);
    });
}

export { validateTechnicianRolesMigration };
