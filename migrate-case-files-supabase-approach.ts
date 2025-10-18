import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function migrateCaseFilesSupabaseApproach() {
  console.log('🚀 Starting case_files migration using Supabase query approach...\n');

  // Step 1: Check existing case_files table
  console.log('📋 Step 1: Checking current case_files table...');

  const { count: existingCount } = await supabase
    .from('case_files')
    .select('*', { count: 'exact', head: true });

  console.log(`Current case_files records: ${existingCount || 0}`);

  // Step 2: Get files with order_id first
  console.log('\n🔍 Step 2: Processing files with order relationships...');

  let totalInserted = 0;
  let batchSize = 500;
  let offset = 0;

  while (true) {
    // Get files with order_id
    const { data: filesWithOrders, error: filesError } = await supabase
      .from('files')
      .select('id, filename, file_type, uploaded_by, uploaded_at, metadata, order_id')
      .not('order_id', 'is', null)
      .range(offset, offset + batchSize - 1)
      .order('id');

    if (filesError) {
      console.error('❌ Error fetching files:', filesError);
      break;
    }

    if (!filesWithOrders || filesWithOrders.length === 0) {
      console.log('✅ No more files to process');
      break;
    }

    console.log(`Processing batch: ${filesWithOrders.length} files (offset: ${offset})`);

    // For each file, find the corresponding case via orders and patient_id
    const caseFilesRecords = [];

    for (const file of filesWithOrders) {
      try {
        // Get the order for this file
        const { data: order, error: orderError } = await supabase
          .from('orders')
          .select('id, patient_id')
          .eq('id', file.order_id)
          .single();

        if (orderError || !order || !order.patient_id) {
          console.log(`   ⚠️  Skipping file ${file.filename} - no order or patient_id found`);
          continue;
        }

        // Get the case for this patient
        const { data: caseForPatient, error: caseError } = await supabase
          .from('cases')
          .select('id')
          .eq('patient_id', order.patient_id)
          .single();

        if (caseError || !caseForPatient) {
          console.log(`   ⚠️  Skipping file ${file.filename} - no case found for patient ${order.patient_id}`);
          continue;
        }

        // Create case_files record
        caseFilesRecords.push({
          case_id: caseForPatient.id,
          file_id: file.id,
          file_purpose: determinePurpose(file.file_type, file.metadata),
          display_order: 0,
          created_by: file.uploaded_by,
          created_at: file.uploaded_at,
          notes: `File from order ${file.order_id}`
        });

      } catch (error: any) {
        console.log(`   ❌ Error processing file ${file.filename}:`, error.message);
      }
    }

    console.log(`   📦 Prepared ${caseFilesRecords.length} case_files records from ${filesWithOrders.length} files`);

    // Insert the batch
    if (caseFilesRecords.length > 0) {
      const { error: insertError } = await supabase
        .from('case_files')
        .insert(caseFilesRecords);

      if (insertError) {
        console.error(`❌ Error inserting batch at offset ${offset}:`, insertError);
        // Continue with next batch
        offset += batchSize;
        continue;
      }

      totalInserted += caseFilesRecords.length;
      console.log(`   ✅ Inserted ${caseFilesRecords.length} case_files records (total: ${totalInserted})`);
    } else {
      console.log(`   ⚠️  No valid case_files records to insert from this batch`);
    }

    offset += batchSize;

    if (filesWithOrders.length < batchSize) {
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
  const purposeStatsResult = await supabase
    .from('case_files')
    .select('file_purpose');

  let purposeStats: { file_purpose: string; count: number; }[] = [];
  if (purposeStatsResult.data) {
    const counts: { [key: string]: number } = {};
    purposeStatsResult.data.forEach(item => {
      counts[item.file_purpose] = (counts[item.file_purpose] || 0) + 1;
    });

    purposeStats = Object.entries(counts).map(([file_purpose, count]) => ({ file_purpose, count }));
  }

  if (purposeStats && purposeStats.length > 0) {
    console.log('\n📊 Case files by purpose:');
    purposeStats.forEach((stat: any) => {
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
  migrateCaseFilesSupabaseApproach()
    .then(result => {
      console.log('\n✨ Final Result:', result);
      process.exit(0);
    })
    .catch(error => {
      console.error('\n💥 Migration Error:', error.message);
      process.exit(1);
    });
}

export { migrateCaseFilesSupabaseApproach };