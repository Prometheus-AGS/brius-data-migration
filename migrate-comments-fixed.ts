import { createClient } from '@supabase/supabase-js';
import { Client as PgClient } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

// Source database configuration
const sourceDb = new PgClient({
  host: process.env.SOURCE_DB_HOST!,
  port: parseInt(process.env.SOURCE_DB_PORT!),
  user: process.env.SOURCE_DB_USER!,
  password: process.env.SOURCE_DB_PASSWORD!,
  database: process.env.SOURCE_DB_NAME!,
});

// Supabase client configuration
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE!
);

interface SourceComment {
  id: number;
  created_at: string;
  text: string;
  author_id: number | null;
  plan_id: number;
}

interface ProfileLookup {
  [legacyId: number]: string; // legacy_id -> profile_id
}

interface TreatmentPlanLookup {
  [legacyPlanId: number]: string; // legacy_plan_id -> treatment_plan_id
}

// Function to execute SQL commands (for INSERT/UPDATE operations)
async function execSQL(sql: string) {
  const { data, error } = await supabase.rpc('exec_sql', { sql });
  if (error) {
    console.error('SQL execution error:', error);
    throw error;
  }
  return data;
}

async function migrateComments() {
  console.log('🔄 Migrating dispatch_comment → comments + treatment_discussions...\n');

  try {
    // Connect to source database
    await sourceDb.connect();

    // 1. Build lookup maps
    console.log('1️⃣ Building lookup maps...');
    
    // Get profile mappings (if profiles exist)
    let profileLookup: ProfileLookup = {};
    try {
      const { data: profileMappingResult, error: profileError } = await supabase
        .from('profiles')
        .select('id, legacy_id')
        .not('legacy_id', 'is', null);
        
      if (profileError) {
        console.log('   ⚠️  No profiles table or error:', profileError.message);
      } else if (profileMappingResult) {
        profileMappingResult.forEach((row: any) => {
          profileLookup[row.legacy_id] = row.id;
        });
      }
    } catch (error) {
      console.log('   ⚠️  Profiles not available, continuing without author mapping');
    }
    console.log(`   📋 Loaded ${Object.keys(profileLookup).length} profile mappings`);

    // Get treatment plan mappings using direct Supabase query
    const { data: treatmentPlanMappingResult, error: tpError } = await supabase
      .from('treatment_plans')
      .select('id, legacy_plan_id')
      .not('legacy_plan_id', 'is', null);
      
    if (tpError) {
      console.error('❌ Error fetching treatment plans:', tpError);
      throw tpError;
    }
    
    // Build the simple lookup: dispatch_comment.plan_id -> treatment_plan_id
    const treatmentPlanLookup: TreatmentPlanLookup = {};
    if (treatmentPlanMappingResult) {
      treatmentPlanMappingResult.forEach((row: any) => {
        treatmentPlanLookup[row.legacy_plan_id] = row.id;
      });
    }
    console.log(`   🎯 Loaded ${Object.keys(treatmentPlanLookup).length} treatment plan mappings`);

    // 2. Get source comments
    console.log('2️⃣ Fetching source comments...');
    const sourceCommentsQuery = `
      SELECT id, created_at, text, author_id, plan_id
      FROM dispatch_comment
      ORDER BY created_at;
    `;
    
    const sourceCommentsResult = await sourceDb.query(sourceCommentsQuery);
    const sourceComments = sourceCommentsResult.rows as SourceComment[];
    console.log(`   📊 Found ${sourceComments.length} comments to migrate`);

    // 3. Process comments in batches
    console.log('3️⃣ Processing comments...');
    const batchSize = 100;
    const totalBatches = Math.ceil(sourceComments.length / batchSize);
    let successfulMigrations = 0;
    let errors = 0;

    for (let i = 0; i < totalBatches; i++) {
      const startIdx = i * batchSize;
      const endIdx = Math.min(startIdx + batchSize, sourceComments.length);
      const batch = sourceComments.slice(startIdx, endIdx);
      
      console.log(`   📦 Processing batch ${i + 1}/${totalBatches} (${batch.length} comments)...`);
      
      const commentInserts: string[] = [];
      const discussionInserts: Array<{commentLegacyId: number, treatmentPlanId: string, createdAt: string}> = [];

      // Process each comment in the batch
      for (const comment of batch) {
        // Skip comments without text
        if (!comment.text || comment.text.trim().length === 0) {
          console.log(`   ⚠️ Skipping comment ${comment.id}: no text content`);
          continue;
        }

        // Look up treatment plan
        const treatmentPlanId = treatmentPlanLookup[comment.plan_id];
        if (!treatmentPlanId) {
          console.log(`   ⚠️ Skipping comment ${comment.id}: no treatment plan mapping for plan_id ${comment.plan_id}`);
          continue;
        }

        // Look up author (optional)
        const authorId = comment.author_id ? profileLookup[comment.author_id] : null;

        // Prepare comment insert
        const commentId = `gen_random_uuid()`;
        const escapedText = comment.text.replace(/'/g, "''");
        const authorIdValue = authorId ? `'${authorId}'` : 'NULL';
        
        commentInserts.push(`(${commentId}, '${escapedText}', ${authorIdValue}, '${comment.created_at}', '${comment.created_at}', 'dispatch_comment', ${comment.id})`);
        
        // Prepare discussion insert (we'll use a different approach)
        discussionInserts.push({
          commentLegacyId: comment.id,
          treatmentPlanId: treatmentPlanId,
          createdAt: comment.created_at
        });
      }

      // Insert comments if we have any
      if (commentInserts.length > 0) {
        try {
          const commentInsertSQL = `
            INSERT INTO comments (id, content, author_id, created_at, updated_at, legacy_table, legacy_id)
            VALUES ${commentInserts.join(',')};
          `;
          await execSQL(commentInsertSQL);

          // Link discussions - use a simpler approach
          for (const discussion of discussionInserts) {
            try {
              const linkSQL = `
                INSERT INTO treatment_discussions (id, comment_id, treatment_plan_id, created_at)
                SELECT gen_random_uuid(), c.id, '${discussion.treatmentPlanId}', '${discussion.createdAt}'
                FROM comments c 
                WHERE c.legacy_id = ${discussion.commentLegacyId} 
                AND c.legacy_table = 'dispatch_comment'
                AND NOT EXISTS (
                  SELECT 1 FROM treatment_discussions td WHERE td.comment_id = c.id
                );
              `;
              await execSQL(linkSQL);
            } catch (linkError) {
              console.log(`   ⚠️ Error linking discussion for comment ${discussion.commentLegacyId}:`, linkError);
              errors++;
            }
          }

          successfulMigrations += commentInserts.length;
          console.log(`   ✅ Migrated ${commentInserts.length} comments`);
        } catch (insertError) {
          console.error(`   ❌ Error inserting batch ${i + 1}:`, insertError);
          errors += commentInserts.length;
        }
      }

      // Progress update
      const progressPercent = Math.round((i + 1) / totalBatches * 100);
      console.log(`   📊 Progress: ${progressPercent}% (${successfulMigrations} successful, ${errors} errors)`);
    }

    console.log('\n✅ Comment migration completed!');
    console.log(`📊 Final results: ${successfulMigrations} successful, ${errors} errors`);

  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await sourceDb.end();
  }
}

// Run migration
migrateComments().catch(console.error);
