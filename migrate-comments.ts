import { Client as PgClient } from 'pg';
import { createClient } from '@supabase/supabase-js';
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

// Target database configuration (Supabase)
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE!;

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  global: {
    headers: {
      'Authorization': `Bearer ${supabaseServiceKey}`
    }
  }
});

async function execSQL(sql: string): Promise<any> {
  const { data, error } = await supabase.rpc('exec_sql', { sql });
  if (error) throw error;
  return data;
}

interface SourceComment {
  id: number;
  created_at: Date;
  text: string | null;
  author_id: number | null;
  plan_id: number;
}

interface ProfileLookup {
  [key: number]: string;
}

interface TreatmentPlanLookup {
  [key: number]: string;
}

async function migrateComments() {
  console.log('🔄 Migrating dispatch_comment → comments + treatment_discussions...\n');

  let processedCount = 0;
  let successCount = 0;
  let errorCount = 0;
  const errors: Array<{ comment: SourceComment; error: string }> = [];

  try {
    await sourceDb.connect();

    // 1. Build lookup maps
    console.log('1️⃣ Building lookup maps...');

    // Get profile mappings (author_id -> uuid)
    const profileMappingResult = await execSQL(`
      SELECT legacy_id, id 
      FROM profiles 
      WHERE legacy_id IS NOT NULL;
    `);
    
    const profileLookup: ProfileLookup = {};
    if (Array.isArray(profileMappingResult)) {
      profileMappingResult.forEach((row: any) => {
        profileLookup[row.legacy_id] = row.id;
      });
    }
    console.log(`   📋 Loaded ${Object.keys(profileLookup).length} profile mappings`);

    // Get treatment plan mappings (via projects -> dispatch_plan -> plan_id)
    const treatmentPlanMappingResult = await execSQL(`
      SELECT tp.id as treatment_plan_id, p.legacy_id as project_legacy_id
      FROM treatment_plans tp
      JOIN projects p ON tp.project_id = p.id
      WHERE p.legacy_id IS NOT NULL;
    `);
    
    // Now get dispatch_plan mappings to connect plan_id to project_id
    const planToProjectQuery = `
      SELECT dp.id as plan_id, dp.project_id 
      FROM dispatch_plan dp;
    `;
    const planToProjectResult = await sourceDb.query(planToProjectQuery);
    
    // Build the lookup: dispatch_comment.plan_id -> treatment_plan_id
    const treatmentPlanLookup: TreatmentPlanLookup = {};
    if (Array.isArray(treatmentPlanMappingResult)) {
      treatmentPlanMappingResult.forEach((row: any) => {
        // Find the dispatch_plan record that references this project
        const planRecord = planToProjectResult.rows.find(p => p.project_id === row.project_legacy_id);
        if (planRecord) {
          treatmentPlanLookup[planRecord.plan_id] = row.treatment_plan_id;
        }
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

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batchStart = batchIndex * batchSize;
      const batchEnd = Math.min(batchStart + batchSize, sourceComments.length);
      const batch = sourceComments.slice(batchStart, batchEnd);

      console.log(`   📦 Processing batch ${batchIndex + 1}/${totalBatches} (${batch.length} comments)...`);

      const commentInserts: string[] = [];
      const discussionInserts: string[] = [];

      for (const comment of batch) {
        try {
          processedCount++;

          // Skip comments with no text
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

          // Generate comment UUID
          const commentId = `gen_random_uuid()`;
          
          // Prepare comment insert
          const content = comment.text.replace(/'/g, "''"); // Escape single quotes
          const createdAt = comment.created_at.toISOString();
          
          commentInserts.push(`
            (${commentId}, '${content}', 'treatment_discussion'::comment_type_enum, ${authorId ? `'${authorId}'` : 'NULL'}, NULL, '${createdAt}', '${createdAt}', ${comment.id}, 'dispatch_comment')
          `);

          // Prepare treatment_discussions insert (using the same UUID)
          discussionInserts.push(`
            (gen_random_uuid(), ${commentId}, '${treatmentPlanId}', '${createdAt}')
          `);

          successCount++;

        } catch (error) {
          errorCount++;
          errors.push({ comment, error: error instanceof Error ? error.message : String(error) });
          console.log(`   ❌ Error processing comment ${comment.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Execute batch inserts
      if (commentInserts.length > 0) {
        try {
          // Insert comments
          const commentInsertSQL = `
            INSERT INTO comments (id, content, comment_type, author_id, parent_comment_id, created_at, updated_at, legacy_id, legacy_table)
            VALUES ${commentInserts.join(',')};
          `;
          await execSQL(commentInsertSQL);

          // Insert treatment discussions (need to use the actual comment IDs)
          const discussionInsertSQL = `
            INSERT INTO treatment_discussions (id, comment_id, treatment_plan_id, created_at)
            SELECT gen_random_uuid(), c.id, td_data.treatment_plan_id, td_data.created_at
            FROM comments c
            JOIN (VALUES ${commentInserts.map((_, index) => `(${commentInserts[index].split(',')[6]}, '${discussionInserts[index].split("'")[3]}', '${discussionInserts[index].split("'")[1]}')`).join(',')}) 
            AS td_data(legacy_id, treatment_plan_id, created_at) ON c.legacy_id = td_data.legacy_id
            WHERE c.legacy_table = 'dispatch_comment';
          `;
          
          // Simplified approach - let's do it differently
          const simpleDiscussionSQL = `
            INSERT INTO treatment_discussions (id, comment_id, treatment_plan_id, created_at)
            SELECT 
              gen_random_uuid(),
              c.id,
              tp.id as treatment_plan_id,
              c.created_at
            FROM comments c
            JOIN treatment_plans tp ON tp.id::text IN (${discussionInserts.map(insert => `'${insert.split("'")[3]}'`).join(',')})
            WHERE c.legacy_table = 'dispatch_comment'
            AND c.legacy_id IN (${batch.map(comment => comment.id).join(',')})
            AND NOT EXISTS (
              SELECT 1 FROM treatment_discussions td WHERE td.comment_id = c.id
            );
          `;

          // Actually, let's use a more direct approach
          for (let i = 0; i < batch.length; i++) {
            const comment = batch[i];
            if (!comment.text || comment.text.trim().length === 0) continue;
            
            const treatmentPlanId = treatmentPlanLookup[comment.plan_id];
            if (!treatmentPlanId) continue;

            const linkSQL = `
              INSERT INTO treatment_discussions (id, comment_id, treatment_plan_id, created_at)
              SELECT gen_random_uuid(), c.id, '${treatmentPlanId}', c.created_at
              FROM comments c 
              WHERE c.legacy_id = ${comment.id} 
              AND c.legacy_table = 'dispatch_comment'
              AND NOT EXISTS (
                SELECT 1 FROM treatment_discussions td WHERE td.comment_id = c.id
              );
            `;
            
            try {
              await execSQL(linkSQL);
            } catch (linkError) {
              console.log(`   ⚠️ Warning linking comment ${comment.id}: ${linkError}`);
            }
          }

        } catch (batchError) {
          console.log(`   ❌ Batch insert error: ${batchError}`);
          errorCount += commentInserts.length;
        }
      }

      // Progress update
      const progressPercent = Math.round((batchEnd / sourceComments.length) * 100);
      console.log(`   📊 Progress: ${progressPercent}% (${successCount} successful, ${errorCount} errors)`);
    }

    // 4. Final validation
    console.log('4️⃣ Validating migration results...');
    
    const finalCommentsCount = await execSQL('SELECT COUNT(*) as count FROM comments WHERE legacy_table = \'dispatch_comment\';');
    const finalDiscussionsCount = await execSQL('SELECT COUNT(*) as count FROM treatment_discussions;');
    
    const commentsCount = Array.isArray(finalCommentsCount) ? finalCommentsCount[0]?.count || 0 : 0;
    const discussionsCount = Array.isArray(finalDiscussionsCount) ? finalDiscussionsCount[0]?.count || 0 : 0;
    
    console.log(`\n📊 Migration Results:`);
    console.log(`   • Processed: ${processedCount} comments`);
    console.log(`   • Successful: ${successCount} comments`);
    console.log(`   • Errors: ${errorCount} comments`);
    console.log(`   • Comments created: ${commentsCount}`);
    console.log(`   • Treatment discussions created: ${discussionsCount}`);
    console.log(`   • Success rate: ${Math.round((successCount / processedCount) * 100)}%`);

    if (errors.length > 0) {
      console.log(`\n❌ Error Details (first 10):`);
      errors.slice(0, 10).forEach((error, index) => {
        console.log(`   ${index + 1}. Comment ${error.comment.id}: ${error.error}`);
      });
    }

    console.log('\n🎉 Comment migration completed!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await sourceDb.end();
  }
}

migrateComments().catch(console.error);
