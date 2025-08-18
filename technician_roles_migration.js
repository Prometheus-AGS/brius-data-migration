const https = require('https');
const http = require('http');

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:8000';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE;
const TECHNICIAN_PROFILE_ID = '72c23a3d-1f5e-4830-8fec-07e631f56f2e';

// Helper function to make HTTP requests
function makeRequest(url, options, data = null) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    
    const req = client.request(url, options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          const jsonData = responseData ? JSON.parse(responseData) : null;
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(jsonData);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
          }
        } catch (error) {
          reject(new Error(`Parse error: ${error.message}`));
        }
      });
    });
    
    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

// Function to map role names to technician_type enum
function mapRoleToTechnicianType(roleName) {
  const name = roleName.toLowerCase();
  
  if (name.includes('designing') || name.includes('dt-')) return 'designing';
  if (name.includes('manufacturing') || name.includes('mt-')) return 'manufacturing';
  if (name.includes('sectioning') || name.includes('st') || name.includes('idb')) return 'sectioning';
  if (name.includes('remote') || name.includes('rt') || name.includes('dtr')) return 'remote';
  if (name.includes('supervisor') || name.includes('master')) return 'master';
  if (name.includes('inspect') || name.includes('quality')) return 'quality_control';
  
  return 'manufacturing'; // Default
}

// Main migration function
async function migrateTechnicianRoles() {
  const headers = {
    'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    'apikey': SERVICE_ROLE_KEY,
    'Content-Type': 'application/json'
  };
  
  try {
    console.log('🚀 Starting technician_roles migration...');
    
    // Step 1: Create migration control record
    console.log('📝 Creating migration control record...');
    const migrationRecord = await makeRequest(`${SUPABASE_URL}/rest/v1/migration_control`, {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'return=representation' }
    }, {
      phase: 'execution',
      table_name: 'technician_roles',
      operation: 'supabase_api_migration',
      status: 'running',
      total_records: 31,
      started_at: new Date().toISOString(),
      batch_size: 31,
      worker_id: 1,
      source_query: 'dispatch_role where group_id = 11'
    });
    
    console.log('✅ Migration control record created:', migrationRecord[0].id);
    const migrationId = migrationRecord[0].id;
    
    // Step 2: Prepare technician role data
    console.log('🔄 Preparing technician role data...');
    
    // Source data (from our analysis)
    const sourceRoles = [
      { id: 27, name: 'Andrea', abbrev: '' },
      { id: 2, name: 'AT/Bracket/IDB', abbrev: 'ATBD' },
      { id: 3, name: 'Designing Technician', abbrev: 'DT-XZ/SF' },
      { id: 28, name: 'Diego', abbrev: '' },
      { id: 29, name: 'DMT', abbrev: 'DMT' },
      { id: 13, name: 'DT-IDB', abbrev: 'DT-IDB' },
      { id: 31, name: 'DTR-Alejandro', abbrev: 'DTRAO' },
      { id: 30, name: 'DT-Remote', abbrev: 'DTR' },
      { id: 35, name: 'Garrett', abbrev: 'Garrett' },
      { id: 37, name: 'Heli', abbrev: 'Heli' },
      { id: 55, name: 'Japan Aligner Technician', abbrev: 'ATJ' },
      { id: 26, name: 'Kate', abbrev: 'KW' },
      { id: 4, name: 'Manufacturing Technician', abbrev: 'MT' },
      { id: 22, name: 'MT-IDB', abbrev: 'MT-IDB' },
      { id: 20, name: 'MT-Inspect', abbrev: 'MT-Insp' },
      { id: 14, name: 'MT-IPR/Sticker', abbrev: 'MT-IPR/St' },
      { id: 15, name: 'MT-Laser', abbrev: 'MT-Laser' },
      { id: 23, name: 'MT-Load', abbrev: 'MT-Load' },
      { id: 16, name: 'MT-Metal Print', abbrev: 'MT-Metal' },
      { id: 21, name: 'MT-Pictured/Ship', abbrev: 'MT-Pic/Shp' },
      { id: 24, name: 'MT-Refiner', abbrev: 'MT-Refiner' },
      { id: 42, name: 'MT-Resin Coating', abbrev: 'MT-Resin' },
      { id: 17, name: 'MT-SF/EP', abbrev: 'MT-SF/EP' },
      { id: 33, name: 'Remote-IDB/Sectioning', abbrev: 'IDB/ST-RMT' },
      { id: 25, name: 'Remote Technician', abbrev: 'RT' },
      { id: 43, name: 'Remote Technician Sectioning Approver', abbrev: 'RTSA' },
      { id: 36, name: 'Ricardo', abbrev: 'Ricardo' },
      { id: 12, name: 'Sales', abbrev: 'Sales' },
      { id: 1, name: 'Sectioning Technician', abbrev: 'ST' },
      { id: 32, name: 'Sergio', abbrev: 'Load+cut' },
      { id: 34, name: 'Supervisor', abbrev: 'Supervisor' }
    ];
    
    // Transform data for target schema
    const technicianRoles = sourceRoles.map(role => ({
      technician_id: TECHNICIAN_PROFILE_ID,
      role_type: mapRoleToTechnicianType(role.name),
      role_name: role.name,
      abbreviation: role.abbrev || role.name.substring(0, 10),
      is_active: true,
      assigned_at: new Date().toISOString(),
      legacy_role_id: role.id
    }));
    
    console.log(`📦 Prepared ${technicianRoles.length} technician role records`);
    
    // Step 3: Insert technician roles via Supabase API
    console.log('💾 Inserting technician roles...');
    const insertedRoles = await makeRequest(`${SUPABASE_URL}/rest/v1/technician_roles`, {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'return=representation' }
    }, technicianRoles);
    
    console.log(`✅ Inserted ${insertedRoles.length} technician roles`);
    
    // Step 4: Create migration mappings
    console.log('🔗 Creating migration mappings...');
    const mappings = insertedRoles.map(role => ({
      entity_type: 'technician_roles',
      legacy_id: role.legacy_role_id,
      new_id: role.id,
      migrated_at: new Date().toISOString(),
      migration_batch: 'technician_roles_batch_1'
    }));
    
    await makeRequest(`${SUPABASE_URL}/rest/v1/migration_mappings`, {
      method: 'POST',
      headers
    }, mappings);
    
    console.log(`✅ Created ${mappings.length} migration mappings`);
    
    // Step 5: Update migration control record
    console.log('📊 Updating migration control...');
    await makeRequest(`${SUPABASE_URL}/rest/v1/migration_control?id=eq.${migrationId}`, {
      method: 'PATCH',
      headers
    }, {
      status: 'completed',
      records_processed: insertedRoles.length,
      completed_at: new Date().toISOString()
    });
    
    console.log('✅ Migration control updated');
    
    // Step 6: Validation
    console.log('🔍 Validating migration...');
    const validationResult = await makeRequest(`${SUPABASE_URL}/rest/v1/technician_roles?select=count`, {
      method: 'GET',
      headers: { ...headers, 'Prefer': 'count=exact' }
    });
    
    console.log('📈 Migration Results:');
    console.log(`   • Source records: 31`);
    console.log(`   • Migrated records: ${insertedRoles.length}`);
    console.log(`   • Current total: ${validationResult[0].count || 'count not available'}`);
    console.log(`   • Migration mappings: ${mappings.length}`);
    
    console.log('🎉 technician_roles migration completed successfully!');
    
    return {
      status: 'SUCCESS',
      recordsMigrated: insertedRoles.length,
      mappingsCreated: mappings.length,
      migrationId: migrationId
    };
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  }
}

// Run migration
migrateTechnicianRoles()
  .then(result => {
    console.log('Final result:', result);
    process.exit(0);
  })
  .catch(error => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
