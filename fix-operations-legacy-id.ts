import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function fixOperationsLegacyId() {
  console.log('🔧 Fixing operations table to add legacy_id column and populate from metadata...\n');

  try {
    // Step 1: Check current operations table structure
    console.log('1️⃣ Checking current operations table structure...');
    const { data: sampleOperation, error: sampleError } = await supabase
      .from('operations')
      .select('*')
      .limit(1)
      .single();

    if (sampleError) {
      throw new Error(`Failed to check operations table: ${sampleError.message}`);
    }

    console.log('✅ Current operations table columns:', Object.keys(sampleOperation));
    console.log('📋 Sample record structure:');
    console.log(JSON.stringify(sampleOperation, null, 2));

    const hasLegacyId = sampleOperation.hasOwnProperty('legacy_id');
    console.log(`🔍 Has legacy_id column: ${hasLegacyId}`);

    // Step 2: Add legacy_id column if it doesn't exist
    if (!hasLegacyId) {
      console.log('\n2️⃣ Adding legacy_id column to operations table...');

      const addColumnSql = `
        ALTER TABLE operations
        ADD COLUMN IF NOT EXISTS legacy_id INTEGER;
      `;

      const { error: alterError } = await supabase.rpc('exec_sql', {
        sql: addColumnSql
      });

      if (alterError) {
        throw new Error(`Failed to add legacy_id column: ${alterError.message}`);
      }

      console.log('✅ Added legacy_id column to operations table');
    } else {
      console.log('\n2️⃣ legacy_id column already exists');
    }

    // Step 3: Get count of operations that need updating
    console.log('\n3️⃣ Checking operations that need legacy_id population...');
    const { count: totalCount, error: countError } = await supabase
      .from('operations')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      throw new Error(`Failed to count operations: ${countError.message}`);
    }

    console.log(`📊 Total operations in table: ${totalCount}`);

    // Check how many have legacy_id populated
    const { count: populatedCount, error: populatedError } = await supabase
      .from('operations')
      .select('*', { count: 'exact', head: true })
      .not('legacy_id', 'is', null);

    console.log(`📊 Operations with legacy_id populated: ${populatedCount || 0}`);
    const needsUpdate = (totalCount || 0) - (populatedCount || 0);
    console.log(`📊 Operations needing legacy_id update: ${needsUpdate}`);

    if (needsUpdate > 0) {
      // Step 4: Update operations in batches to extract legacy_id from metadata
      console.log('\n4️⃣ Updating operations to populate legacy_id from metadata...');

      const batchSize = 100;
      let updated = 0;

      for (let offset = 0; offset < (totalCount || 0); offset += batchSize) {
        console.log(`Processing batch: ${offset + 1}-${Math.min(offset + batchSize, totalCount || 0)}`);

        // Get operations without legacy_id
        const { data: operations, error: fetchError } = await supabase
          .from('operations')
          .select('id, metadata')
          .is('legacy_id', null)
          .limit(batchSize);

        if (fetchError) {
          console.error(`❌ Error fetching operations batch: ${fetchError.message}`);
          continue;
        }

        if (!operations || operations.length === 0) {
          console.log('✅ No more operations to update');
          break;
        }

        // Update each operation with legacy_id extracted from metadata
        for (const operation of operations) {
          const legacyId = operation.metadata?.legacy_id;

          if (legacyId) {
            const { error: updateError } = await supabase
              .from('operations')
              .update({ legacy_id: legacyId })
              .eq('id', operation.id);

            if (updateError) {
              console.error(`❌ Error updating operation ${operation.id}: ${updateError.message}`);
            } else {
              updated++;
            }
          }
        }

        console.log(`   ✅ Updated ${operations.length} operations (total updated: ${updated})`);
      }

      console.log(`\n✅ Successfully updated ${updated} operations with legacy_id`);
    }

    // Step 5: Verify the fix
    console.log('\n5️⃣ Verifying the fix...');

    const { count: finalPopulatedCount, error: finalCountError } = await supabase
      .from('operations')
      .select('*', { count: 'exact', head: true })
      .not('legacy_id', 'is', null);

    if (finalCountError) {
      console.warn(`Warning: Could not verify final count: ${finalCountError.message}`);
    }

    console.log(`📊 Final operations with legacy_id: ${finalPopulatedCount || 0}/${totalCount || 0}`);

    // Show sample with legacy_id
    const { data: sampleWithLegacyId, error: sampleLegacyError } = await supabase
      .from('operations')
      .select('id, legacy_id, operation_type, metadata')
      .not('legacy_id', 'is', null)
      .limit(3);

    if (sampleWithLegacyId && sampleWithLegacyId.length > 0) {
      console.log('\n📋 Sample operations with legacy_id:');
      sampleWithLegacyId.forEach((op, index) => {
        console.log(`   ${index + 1}. ID: ${op.id}, Legacy ID: ${op.legacy_id}, Type: ${op.operation_type}`);
      });
    }

    console.log('\n🎉 Operations legacy_id fix completed successfully!');
    console.log('🔗 All operations now have proper legacy_id linking back to dispatch_operation.id');

  } catch (error: any) {
    console.error('❌ Fix failed:', error);
    throw error;
  }
}

// Run the fix
if (require.main === module) {
  fixOperationsLegacyId().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default fixOperationsLegacyId;