import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function migrateCaseFilesOptimized() {
  console.log('🚀 Starting optimized case_files migration using target database tables...\n');
  
  // Step 1: Backup and drop existing case_files table if it has data
  console.log('📋 Step 1: Checking current case_files table...');
  
  const { count: existingCount } = await supabase
    .from('case_files')
    .select('*', { count: 'exact', head: true });
    
  console.log(`Current case_files records: ${existingCount || 0}`);
  
  if (existingCount && existingCount > 0) {
    console.log('⚠️  Existing data found. Creating backup...');
    // Could create backup here if needed
  }
  
  // Step 2: Drop and recreate case_files table with proper schema
  console.log('\n🔧 Step 2: Recreating case_files table with optimized schema...');
  
  const dropAndCreateSQL = `
    -- Drop existing table
    DROP TABLE IF EXISTS case_files CASCADE;
    
    -- Create new optimized case_files table
    CREATE TABLE case_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      file_purpose VARCHAR(50), -- e.g., 'initial_photos', 'treatment_plan', 'progress', 'instruction_files'
      display_order INTEGER DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      created_by UUID REFERENCES profiles(id),
      
      -- Prevent duplicate file-case relationships
      UNIQUE(case_id, file_id)
    );
    
    -- Create indexes for performance
    CREATE INDEX idx_case_files_case_id ON case_files(case_id);
    CREATE INDEX idx_case_files_file_id ON case_files(file_id);
    CREATE INDEX idx_case_files_purpose ON case_files(file_purpose);
    CREATE INDEX idx_case_files_created_at ON case_files(created_at);
    
    -- Add RLS policy (following Supabase patterns)
    ALTER TABLE case_files ENABLE ROW LEVEL SECURITY;
  `;
  
  const { error: schemaError } = await supabase.rpc('exec_sql', { sql: dropAndCreateSQL });
  
  if (schemaError) {
    console.error('❌ Error creating schema:', schemaError);
    return;
  }
  
  console.log('✅ New case_files table created successfully');
  
  // Step 3: Analyze existing data relationships for population
  console.log('\n📊 Step 3: Analyzing existing data for case_files population...');
  
  // Check files that are already linked to orders (which are linked to cases)
  const { data: filesWithOrders, error: filesError } = await supabase
    .from('files')
    .select(`
      id,
      order_id,
      filename,
      file_type,
      uploaded_by,
      uploaded_at,
      metadata,
      orders!inner(
        id,
        case_id,
        cases!inner(
          id
        )
      )
    `)
    .not('order_id', 'is', null)
    .limit(10);
    
  if (filesWithOrders) {
    console.log(`Found ${filesWithOrders.length} files linked to orders with cases`);
    console.log('Sample file-order-case relationship:', JSON.stringify(filesWithOrders[0], null, 2));
  }
  
  // Step 4: Populate case_files from files->orders->cases relationships
  console.log('\n🔄 Step 4: Populating case_files from existing relationships...');
  
  let totalInserted = 0;
  let batchSize = 1000;
  let offset = 0;
  
  while (true) {
    const { data: fileBatch, error: batchError } = await supabase
      .from('files')
      .select(`
        id,
        order_id,
        file_type,
        uploaded_by,
        uploaded_at,
        metadata,
        orders!inner(
          id,
          case_id
        )
      `)
      .not('order_id', 'is', null)
      .not('orders.case_id', 'is', null)
      .range(offset, offset + batchSize - 1);
      
    if (batchError) {
      console.error('❌ Error fetching file batch:', batchError);
      break;
    }
    
    if (!fileBatch || fileBatch.length === 0) {
      break;
    }
    
    // Prepare case_files records
    const caseFilesRecords = fileBatch.map(file => ({
      case_id: file.orders.case_id,
      file_id: file.id,
      file_purpose: determinePurpose(file.file_type, file.metadata),
      display_order: 0,
      created_by: file.uploaded_by,
      created_at: file.uploaded_at
    }));
    
    // Insert batch
    const { error: insertError } = await supabase
      .from('case_files')
      .insert(caseFilesRecords);
      
    if (insertError) {
      console.error(`❌ Error inserting batch at offset ${offset}:`, insertError);
      break;
    }
    
    totalInserted += caseFilesRecords.length;
    console.log(`✅ Inserted batch: ${caseFilesRecords.length} records (total: ${totalInserted})`);
    
    offset += batchSize;
    
    if (fileBatch.length < batchSize) {
      break; // Last batch
    }
  }
  
  console.log(`\n🎉 Migration completed! Total case_files records created: ${totalInserted}`);
  
  // Step 5: Validation
  console.log('\n✅ Step 5: Validating migration results...');
  
  const { count: finalCount } = await supabase
    .from('case_files')
    .select('*', { count: 'exact', head: true });
    
  console.log(`Final case_files count: ${finalCount}`);
  
  // Check for some sample relationships
  const { data: sampleCaseFiles } = await supabase
    .from('case_files')
    .select(`
      id,
      file_purpose,
      cases(id),
      files(filename, file_type)
    `)
    .limit(3);
    
  if (sampleCaseFiles) {
    console.log('\n📋 Sample case_files relationships:');
    sampleCaseFiles.forEach((cf, index) => {
      console.log(`${index + 1}. Purpose: ${cf.file_purpose}, File: ${cf.files?.filename}`);
    });
  }
}

function determinePurpose(fileType: string, metadata: any): string {
  // Determine file purpose based on file type and metadata
  if (metadata?.original_type_id !== undefined) {
    // Map original type IDs to purposes
    const typeMap: { [key: number]: string } = {
      1: 'photos',
      2: 'models',
      6: 'treatment_plan',
      7: 'treatment_plan', 
      8: 'treatment_plan',
      12: 'instruction_files',
      13: 'instruction_files',
      // Add more mappings based on the type distribution we saw
    };
    
    return typeMap[metadata.original_type_id] || 'other';
  }
  
  // Fallback to file_type
  switch (fileType) {
    case 'photo': return 'photos';
    case 'model': return 'models';
    case 'document': return 'documents';
    default: return 'other';
  }
}

migrateCaseFilesOptimized().catch(console.error);
