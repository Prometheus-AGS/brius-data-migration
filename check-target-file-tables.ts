import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function checkFileTables() {
  console.log('🔍 Checking all file-related tables in target database...\n');
  
  // List all tables that contain 'file' in their name
  const { data: allTables, error: tablesError } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name LIKE '%file%'
      ORDER BY table_name;
    `
  });
  
  if (allTables && Array.isArray(allTables)) {
    console.log('📋 File-related tables found:');
    allTables.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });
  }
  
  // Check the 'files' table if it exists
  console.log('\n📊 Checking main files table...');
  const { data: filesData, error: filesError } = await supabase
    .from('files')
    .select('*')
    .limit(3);
    
  if (!filesError && filesData) {
    console.log(`✅ files table exists with ${filesData.length} sample records shown`);
    if (filesData.length > 0) {
      console.log('Files table structure:', Object.keys(filesData[0]).join(', '));
      console.log('Sample record:', JSON.stringify(filesData[0], null, 2));
    }
    
    // Get count
    const { count } = await supabase
      .from('files')
      .select('*', { count: 'exact', head: true });
    console.log(`Total files records: ${count}`);
  } else {
    console.log('❌ files table error:', filesError?.message);
  }
  
  // Check case_files table structure by attempting to describe it
  console.log('\n📊 Checking case_files table structure...');
  
  try {
    // Try to get column information using a different approach
    const { data: columnData, error: columnError } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT 
          column_name, 
          data_type, 
          is_nullable, 
          column_default
        FROM information_schema.columns 
        WHERE table_name = 'case_files' 
        AND table_schema = 'public'
        ORDER BY ordinal_position;
      `
    });
    
    if (columnData && Array.isArray(columnData)) {
      console.log('✅ case_files table structure:');
      columnData.forEach(col => {
        console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'} ${col.column_default ? 'DEFAULT ' + col.column_default : ''}`);
      });
    }
  } catch (e) {
    console.log('Error getting case_files structure:', e);
  }
  
  // Try to understand case_files foreign key relationships
  console.log('\n🔗 Checking case_files relationships...');
  
  const { data: fkData, error: fkError } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = 'case_files';
    `
  });
  
  if (fkData && Array.isArray(fkData)) {
    console.log('Foreign key relationships:');
    fkData.forEach(fk => {
      console.log(`  ${fk.column_name} -> ${fk.foreign_table_name}.${fk.foreign_column_name}`);
    });
  }
}

checkFileTables().catch(console.error);
