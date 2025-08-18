import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function refactorCaseFilesSchema() {
  console.log('🔧 Refactoring case_files table to reference files table...\n');
  
  // First, let's see the current case_files table structure
  console.log('📋 Getting current case_files table structure...');
  
  const { data: currentSchema, error: schemaError } = await supabase.rpc('exec_sql', {
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
  
  console.log('Current schema result:', currentSchema);
  
  // Get constraints
  const { data: constraints, error: constraintError } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT 
        conname as constraint_name,
        pg_get_constraintdef(c.oid) as definition
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_namespace n ON t.relnamespace = n.oid
      WHERE t.relname = 'case_files' AND n.nspname = 'public';
    `
  });
  
  console.log('Current constraints:', constraints);
  
  // Propose the new schema structure
  console.log('\n🏗️  Proposed new case_files schema:');
  console.log(`
    CREATE TABLE case_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      file_purpose VARCHAR(50), -- e.g., 'initial_photos', 'treatment_plan', 'progress', etc.
      display_order INTEGER DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      created_by UUID REFERENCES profiles(id),
      UNIQUE(case_id, file_id)
    );
  `);
  
  // Check if we should proceed with the schema change
  console.log('\n⚠️  This will modify the existing case_files table structure.');
  console.log('Current table appears to have columns that duplicate files table data.');
  console.log('New structure will be a proper junction table with references.');
  
  // For safety, let's create a backup and then apply the changes step by step
  const steps = [
    'Drop existing case_files table (if safe)',
    'Create new case_files table with proper foreign key references',
    'Create indexes for performance',
    'Populate case_files with relationships from source data'
  ];
  
  console.log('\n📝 Migration steps needed:');
  steps.forEach((step, index) => {
    console.log(`${index + 1}. ${step}`);
  });
  
  return { currentSchema, constraints, steps };
}

refactorCaseFilesSchema().catch(console.error);
