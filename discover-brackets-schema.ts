import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function discoverBracketsSchema() {
  console.log('🔍 Discovering actual brackets table schema...\n');
  
  // Try direct SQL approach to get table structure
  const { data: schemaData, error: schemaError } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT 
        column_name, 
        data_type, 
        is_nullable, 
        column_default
      FROM information_schema.columns 
      WHERE table_name = 'brackets' 
      AND table_schema = 'public'
      ORDER BY ordinal_position;
    `
  });
  
  if (schemaError) {
    console.error('Error getting schema:', schemaError);
    return;
  }
  
  if (schemaData && Array.isArray(schemaData) && schemaData.length > 0) {
    console.log('✅ brackets table structure discovered:');
    schemaData.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'} ${col.column_default ? 'DEFAULT ' + col.column_default : ''}`);
    });
    
    // Now try to insert a test record based on discovered structure
    console.log('\n🧪 Testing insert with discovered structure...');
    
    // Create a minimal test record based on discovered columns
    const testRecord: any = {};
    
    // Fill in common column patterns
    schemaData.forEach(col => {
      const colName = col.column_name;
      if (colName === 'id' && col.column_default) {
        // Skip auto-generated IDs
        return;
      } else if (colName.includes('name') || colName.includes('title')) {
        testRecord[colName] = 'Test Bracket';
      } else if (colName.includes('type') || colName.includes('category')) {
        testRecord[colName] = 'test';
      } else if (colName.includes('description')) {
        testRecord[colName] = 'Test bracket description';
      } else if (col.data_type === 'boolean') {
        testRecord[colName] = false;
      } else if (col.data_type.includes('int')) {
        testRecord[colName] = 1;
      } else if (col.data_type.includes('timestamp') && col.column_default === null) {
        testRecord[colName] = new Date().toISOString();
      } else if (col.data_type.includes('uuid') && col.column_default === null) {
        testRecord[colName] = '123e4567-e89b-12d3-a456-426614174000';
      }
    });
    
    console.log('Test record to insert:', JSON.stringify(testRecord, null, 2));
    
    const { data: insertData, error: insertError } = await supabase
      .from('brackets')
      .insert(testRecord)
      .select();
      
    if (insertError) {
      console.log('Insert error (helps identify required fields):');
      console.log(insertError.message);
    } else {
      console.log('✅ Test insert successful!');
      console.log('Inserted record:', insertData);
      
      // Clean up test record
      if (insertData && insertData[0] && insertData[0].id) {
        await supabase
          .from('brackets')
          .delete()
          .eq('id', insertData[0].id);
        console.log('Test record cleaned up');
      }
    }
    
  } else {
    console.log('No schema data found or empty result');
  }
}

discoverBracketsSchema().catch(console.error);
