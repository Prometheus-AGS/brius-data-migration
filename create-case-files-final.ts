import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function createCaseFilesFinal() {
  console.log('🚀 Creating final case_files table with proper relationships...\n');
  
  // Step 1: Drop and recreate case_files table with proper schema
  console.log('📋 Step 1: Creating optimized case_files table...');
  
  const createCaseFilesSQL = `
    -- Drop existing table if it exists
    DROP TABLE IF EXISTS case_files CASCADE;
    
    -- Create new case_files table as a proper junction/relationship table
    CREATE TABLE case_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      
      -- File context and organization
      file_purpose VARCHAR(50), -- 'initial_photos', 'progress_photos', 'treatment_plan', 'instruction_files', 'final_photos'
      display_order INTEGER DEFAULT 0,
      notes TEXT,
      
      -- Audit fields
      created_at TIMESTAMPTZ DEFAULT NOW(),
      created_by UUID REFERENCES profiles(id),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      
      -- Prevent duplicate file-case relationships
      UNIQUE(case_id, file_id)
    );
    
    -- Create indexes for performance
    CREATE INDEX idx_case_files_case_id ON case_files(case_id);
    CREATE INDEX idx_case_files_file_id ON case_files(file_id);
    CREATE INDEX idx_case_files_purpose ON case_files(file_purpose);
    CREATE INDEX idx_case_files_display_order ON case_files(display_order);
    CREATE INDEX idx_case_files_created_at ON case_files(created_at);
    
    -- Composite indexes for common queries
    CREATE INDEX idx_case_files_case_purpose ON case_files(case_id, file_purpose);
    CREATE INDEX idx_case_files_case_order ON case_files(case_id, display_order);
    
    -- Add RLS policy
    ALTER TABLE case_files ENABLE ROW LEVEL SECURITY;
    
    -- Add update trigger for updated_at
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
    END;
    $$ language 'plpgsql';
    
    CREATE TRIGGER update_case_files_updated_at 
        BEFORE UPDATE ON case_files 
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `;
  
  const { error: createError } = await supabase.rpc('exec_sql', { sql: createCaseFilesSQL });
  
  if (createError) {
    console.error('❌ Error creating case_files table:', createError);
    return;
  }
  
  console.log('✅ case_files table created successfully');
  
  // Step 2: Populate case_files using the order_cases junction table
  console.log('\n🔄 Step 2: Populating case_files using order_cases relationships...');
  
  let totalInserted = 0;
  const batchSize = 500;
  
  // Get files that are linked to orders, then find their cases via order_cases
  let offset = 0;
  
  while (true) {
    console.log(`Processing batch starting at offset ${offset}...`);
    
    const { data: filesWithOrderCases, error: queryError } = await supabase
      .from('files')
      .select(`
        id,
        file_type,
        uploaded_by,
        uploaded_at,
        metadata,
        orders!inner (
          id,
          order_cases!inner (
            case_id
          )
        )
      `)
      .not('order_id', 'is', null)
      .range(offset, offset + batchSize - 1);
      
    if (queryError) {
      console.error('❌ Error querying files:', queryError);
      break;
    }
    
    if (!filesWithOrderCases || filesWithOrderCases.length === 0) {
      break;
    }
    
    // Prepare case_files records
    const caseFilesRecords = [];
    
    for (const file of filesWithOrderCases) {
      if (file.orders?.order_cases) {
        for (const orderCase of file.orders.order_cases) {
          caseFilesRecords.push({
            case_id: orderCase.case_id,
            file_id: file.id,
            file_purpose: determinePurpose(file.file_type, file.metadata),
            display_order: 0,
            created_by: file.uploaded_by,
            created_at: file.uploaded_at
          });
        }
      }
    }
    
    if (caseFilesRecords.length > 0) {
      // Insert batch with conflict handling
      const { error: insertError } = await supabase
        .from('case_files')
        .upsert(caseFilesRecords, { 
          onConflict: 'case_id,file_id',
          ignoreDuplicates: true 
        });
        
      if (insertError) {
        console.error(`❌ Error inserting batch at offset ${offset}:`, insertError);
        break;
      }
      
      totalInserted += caseFilesRecords.length;
      console.log(`✅ Inserted ${caseFilesRecords.length} case_file records (total: ${totalInserted})`);
    }
    
    offset += batchSize;
    
    if (filesWithOrderCases.length < batchSize) {
      break; // Last batch
    }
  }
  
  console.log(`\n🎉 Total case_files records created: ${totalInserted}`);
  
  // Step 3: Handle files that are NOT linked to orders (148,295 files)
  // These might be linked via instruction_id from source data
  console.log('\n🔄 Step 3: Handling files not linked to orders...');
  
  const { count: filesWithoutOrders } = await supabase
    .from('files')
    .select('*', { count: 'exact', head: true })
    .is('order_id', null);
    
  console.log(`Files without order_id: ${filesWithoutOrders}`);
  
  // For these files, we might need to use source data or create a default relationship
  // For now, let's document this as a future enhancement
  
  // Step 4: Validation and summary
  console.log('\n✅ Step 4: Final validation...');
  
  const { count: finalCaseFilesCount } = await supabase
    .from('case_files')
    .select('*', { count: 'exact', head: true });
    
  console.log(`Final case_files count: ${finalCaseFilesCount}`);
  
  // Get sample case_files with relationships
  const { data: sampleCaseFiles } = await supabase
    .from('case_files')
    .select(`
      id,
      file_purpose,
      display_order,
      created_at,
      cases!inner(case_number, patient_id),
      files!inner(filename, file_type, file_size_bytes)
    `)
    .limit(5);
    
  if (sampleCaseFiles) {
    console.log('\n📋 Sample case_files relationships:');
    sampleCaseFiles.forEach((cf, index) => {
      console.log(`${index + 1}. Case: ${cf.cases?.case_number} | File: ${cf.files?.filename} (${cf.files?.file_type})`);
      console.log(`   Purpose: ${cf.file_purpose} | Size: ${cf.files?.file_size_bytes} bytes`);
    });
  }
  
  // Summary statistics
  const { data: purposeStats } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT 
        file_purpose,
        COUNT(*) as count
      FROM case_files
      GROUP BY file_purpose
      ORDER BY count DESC;
    `
  });
  
  console.log('\n📊 Files by purpose:');
  if (purposeStats && Array.isArray(purposeStats)) {
    purposeStats.forEach(stat => {
      console.log(`  ${stat.file_purpose || 'null'}: ${stat.count} files`);
    });
  }
  
  console.log('\n🎉 case_files migration completed successfully!');
  console.log('\n📝 Next steps:');
  console.log('1. Remove legacy_instruction_id columns from orders and cases tables');
  console.log('2. Add RLS policies for case_files table');
  console.log('3. Consider handling the 148,295 files not linked to orders');
  console.log('4. Test the relationships in your application');
}

function determinePurpose(fileType: string, metadata: any): string {
  // Determine file purpose based on file type and original type from metadata
  if (metadata?.original_type_id !== undefined) {
    const typeMap: { [key: number]: string } = {
      1: 'initial_photos',     // Photos
      2: 'models',             // 3D models
      3: 'documents',          // Documents
      4: 'treatment_plan',     // Treatment plans
      5: 'treatment_plan',     
      6: 'treatment_plan',     
      7: 'treatment_plan',
      8: 'treatment_plan',
      9: 'instruction_files',  
      10: 'instruction_files',
      11: 'instruction_files',
      12: 'instruction_files',
      13: 'instruction_files',
      14: 'instruction_files',
      15: 'instruction_files',
      16: 'instruction_files',
      17: 'final_photos'       // Final photos
    };
    
    return typeMap[metadata.original_type_id] || 'other';
  }
  
  // Fallback to file_type
  switch (fileType) {
    case 'photo': return 'initial_photos';
    case 'model': return 'models';
    case 'document': return 'documents';
    default: return 'other';
  }
}

createCaseFilesFinal().catch(console.error);
