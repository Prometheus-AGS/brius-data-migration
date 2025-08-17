import * as dotenv from 'dotenv';

dotenv.config();

async function fixTreatmentDiscussionsSchemaViaAPI() {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE!;
  
  console.log('🔧 Fixing treatment_discussions schema via Supabase API...');
  
  try {
    // First, let's check if there's any existing data
    console.log('   Checking existing data...');
    
    const checkDataResponse = await fetch(`${supabaseUrl}/rest/v1/treatment_discussions?select=count`, {
      method: 'GET',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'count=exact'
      }
    });
    
    if (!checkDataResponse.ok) {
      throw new Error(`Failed to check data: ${checkDataResponse.statusText}`);
    }
    
    const countHeader = checkDataResponse.headers.get('content-range');
    const count = countHeader ? parseInt(countHeader.split('/')[1]) : 0;
    console.log(`   Current treatment_discussions records: ${count}`);
    
    if (count > 0) {
      console.log('⚠️  WARNING: There are existing records in treatment_discussions');
      console.log('   Please backup the data before proceeding with schema changes');
      return;
    }
    
    // Now let's execute the SQL to modify the schema
    console.log('   Adding comment_id column and making other adjustments...');
    
    const sqlCommands = [
      // Add comment_id column as foreign key to comments table
      'ALTER TABLE treatment_discussions ADD COLUMN comment_id UUID REFERENCES comments(id) ON DELETE CASCADE;',
      
      // Make content column nullable (will be redundant since content comes from comments)
      'ALTER TABLE treatment_discussions ALTER COLUMN content DROP NOT NULL;',
      
      // Make author_id nullable (will come from comments table)
      'ALTER TABLE treatment_discussions ALTER COLUMN author_id DROP NOT NULL;',
      
      // Make author_role nullable 
      'ALTER TABLE treatment_discussions ALTER COLUMN author_role DROP NOT NULL;'
    ];
    
    for (const sql of sqlCommands) {
      console.log(`   Executing: ${sql}`);
      
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sql: sql
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`SQL execution failed: ${response.statusText} - ${errorText}`);
      }
      
      const result = await response.text();
      console.log(`   ✅ Success: ${result || 'OK'}`);
    }
    
    console.log('✅ Schema changes completed via Supabase API!');
    console.log('   Next steps:');
    console.log('   1. Migrate comments to comments table with comment_type = "treatment_discussion"');
    console.log('   2. Link treatment_discussions to comments via comment_id');
    console.log('   3. Eventually remove redundant fields from treatment_discussions');
    
  } catch (error) {
    console.error('❌ Schema fix via API failed:', error);
  }
}

fixTreatmentDiscussionsSchemaViaAPI().catch(console.error);
