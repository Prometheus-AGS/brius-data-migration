import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function migrateCaseFilesFixed() {
  console.log('🚀 Starting FIXED case_files migration...\n');

  // Step 1: Check existing case_files table
  console.log('📋 Step 1: Checking current case_files table...');

  const { count: existingCount } = await supabase
    .from('case_files')
    .select('*', { count: 'exact', head: true });

  console.log(`Current case_files records: ${existingCount || 0}`);

  // Step 2: Create relationship mapping (files → orders → cases via patient_id)
  console.log('\n🔍 Step 2: Building file → case relationships...');

  // Since orders.case_id doesn't exist, we need to link via patient_id:
  // files.order_id → orders.patient_id → cases.patient_id
  let totalInserted = 0;
  let batchSize = 500;
  let offset = 0;

  console.log('📊 Processing files with orders and linking to cases via patient_id...');

  while (true) {
    // Get files that have order_id, then join to orders and cases via patient_id
    const { data: fileBatch, error: batchError } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT
          f.id as file_id,
          f.filename,
          f.file_type,
          f.uploaded_by,
          f.uploaded_at,
          f.metadata,
          o.id as order_id,
          o.patient_id,
          c.id as case_id
        FROM files f
        JOIN orders o ON f.order_id = o.id
        JOIN cases c ON o.patient_id = c.patient_id
        WHERE f.order_id IS NOT NULL
        ORDER BY f.id
        LIMIT ${batchSize} OFFSET ${offset}
      `
    });

    if (batchError) {
      console.error('❌ Error fetching file batch:', batchError);
      break;
    }

    // Handle different possible response formats from exec_sql
    let actualFileBatch = fileBatch;
    if (fileBatch && !Array.isArray(fileBatch)) {
      // Sometimes exec_sql returns data wrapped in another structure
      actualFileBatch = fileBatch.data || fileBatch.rows || [];
    }

    if (!actualFileBatch || !Array.isArray(actualFileBatch) || actualFileBatch.length === 0) {
      console.log('✅ No more files to process');
      break;
    }

    console.log(`Processing batch: ${actualFileBatch.length} files (offset: ${offset})`);

    // Prepare case_files records
    const caseFilesRecords = actualFileBatch.map((file: any) => ({
      case_id: file.case_id,
      file_id: file.file_id,
      file_purpose: determinePurpose(file.file_type, file.metadata),
      display_order: 0,
      created_by: file.uploaded_by,
      created_at: file.uploaded_at,
      notes: `File from order ${file.order_id}`
    }));

    // Insert batch
    const { error: insertError } = await supabase
      .from('case_files')
      .insert(caseFilesRecords);

    if (insertError) {
      console.error(`❌ Error inserting batch at offset ${offset}:`, insertError);
      // Continue with next batch instead of breaking
      offset += batchSize;
      continue;
    }

    totalInserted += caseFilesRecords.length;
    console.log(`✅ Inserted batch: ${caseFilesRecords.length} records (total: ${totalInserted})`);

    offset += batchSize;

    if (actualFileBatch.length < batchSize) {
      break; // Last batch
    }
  }

  console.log(`\n🎉 Migration completed! Total case_files records created: ${totalInserted}`);

  // Step 3: Validation
  console.log('\n✅ Step 3: Validating migration results...');

  const { count: finalCount } = await supabase
    .from('case_files')
    .select('*', { count: 'exact', head: true });

  console.log(`Final case_files count: ${finalCount}`);

  // Check file purposes distribution
  const { data: purposeStats } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT
        file_purpose,
        COUNT(*) as count
      FROM case_files
      GROUP BY file_purpose
      ORDER BY count DESC
    `
  });

  // Handle different possible response formats from exec_sql
  let actualPurposeStats = purposeStats;
  if (purposeStats && !Array.isArray(purposeStats)) {
    actualPurposeStats = purposeStats.data || purposeStats.rows || [];
  }

  if (actualPurposeStats && Array.isArray(actualPurposeStats) && actualPurposeStats.length > 0) {
    console.log('\n📊 Case files by purpose:');
    actualPurposeStats.forEach((stat: any) => {
      console.log(`   • ${stat.file_purpose}: ${stat.count} files`);
    });
  }

  // Sample relationships
  const { data: sampleCaseFiles } = await supabase
    .from('case_files')
    .select(`
      id,
      file_purpose,
      notes,
      cases(id),
      files(filename, file_type)
    `)
    .limit(3);

  if (sampleCaseFiles) {
    console.log('\n📋 Sample case_files relationships:');
    sampleCaseFiles.forEach((cf: any, index) => {
      console.log(`   ${index + 1}. Purpose: ${cf.file_purpose}, File: ${cf.files?.filename || 'unknown'}`);
      console.log(`      Notes: ${cf.notes}`);
    });
  }

  return {
    status: 'SUCCESS',
    totalInserted,
    finalCount
  };
}

function determinePurpose(fileType: string, metadata: any): string {
  // Determine file purpose based on file type and metadata
  if (metadata?.original_type_id !== undefined) {
    // Map original type IDs to purposes based on common patterns
    const typeMap: { [key: number]: string } = {
      1: 'photos',
      2: 'models',
      3: 'photos',
      4: 'photos',
      5: 'photos',
      6: 'treatment_plan',
      7: 'treatment_plan',
      8: 'treatment_plan',
      9: 'instruction_files',
      10: 'instruction_files',
      11: 'instruction_files',
      12: 'instruction_files',
      13: 'instruction_files'
    };

    return typeMap[metadata.original_type_id] || 'other';
  }

  // Fallback to file_type string
  if (fileType) {
    const type = fileType.toString();
    if (type === '1' || type === '3' || type === '4' || type === '5') {
      return 'photos';
    } else if (type === '2') {
      return 'models';
    } else if (['6', '7', '8'].includes(type)) {
      return 'treatment_plan';
    } else if (['9', '10', '11', '12', '13'].includes(type)) {
      return 'instruction_files';
    }
  }

  return 'other';
}

// Execute the migration
if (require.main === module) {
  migrateCaseFilesFixed()
    .then(result => {
      console.log('\n✨ Final Result:', result);
      process.exit(0);
    })
    .catch(error => {
      console.error('\n💥 Migration Error:', error.message);
      process.exit(1);
    });
}

export { migrateCaseFilesFixed };