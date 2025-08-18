import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function checkMigrationTablesSchema() {
  console.log('🔍 Checking migration tables schema...\n');
  
  // Check migration_control table
  console.log('📋 migration_control table:');
  
  const { data: controlSample, error: controlError } = await supabase
    .from('migration_control')
    .select('*')
    .limit(1);
    
  if (controlError) {
    console.error('Error accessing migration_control:', controlError);
  } else if (controlSample && controlSample[0]) {
    console.log('Available columns:', Object.keys(controlSample[0]).join(', '));
    console.log('Sample record:');
    console.log(JSON.stringify(controlSample[0], null, 2));
  } else {
    console.log('migration_control table is empty');
  }
  
  // Check migration_mappings table
  console.log('\n📋 migration_mappings table:');
  
  const { data: mappingsSample, error: mappingsError } = await supabase
    .from('migration_mappings')
    .select('*')
    .limit(1);
    
  if (mappingsError) {
    console.error('Error accessing migration_mappings:', mappingsError);
  } else if (mappingsSample && mappingsSample[0]) {
    console.log('Available columns:', Object.keys(mappingsSample[0]).join(', '));
    console.log('Sample record:');
    console.log(JSON.stringify(mappingsSample[0], null, 2));
  } else {
    console.log('migration_mappings table is empty');
  }
}

checkMigrationTablesSchema().catch(console.error);
