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

// Target database configuration (Supabase)
const targetDb = new PgClient({
  host: process.env.TARGET_DB_HOST || 'localhost',
  port: parseInt(process.env.TARGET_DB_PORT || '5432'),
  user: process.env.TARGET_DB_USER || 'postgres',
  password: process.env.TARGET_DB_PASSWORD!,
  database: process.env.TARGET_DB_NAME || 'postgres',
});

interface SourceComment {
  id: number;
  created_at: string;
  text: string;
  author_id: number | null;
  plan_id: number;
}

interface TreatmentPlanLookup {
  [legacyPlanId: number]: string; // legacy_plan_id -> treatment_plan_id
}

async function migrateComments() {
  console.log('🔄 Migrating dispatch_comment → comments + treatment_discussions...\n');

  try {
    // Connect to both databases
    await sourceDb.connect();
    await targetDb.connect();
    
    console.log('✅ Connected to source and target databases');

    // 1. Build treatment plan lookup map
    console.log('1️⃣ Building treatment plan lookup map...');
    
    const treatmentPlanQuery = `
      SELECT id, legacy_plan_id
      FROM treatment_plans
      WHERE legacy_plan_id IS NOT NULL;
    `;
    
    const treatmentPlanResult = await targetDb.query(treatmentPlanQuery);
    const treatmentPlanLookup: TreatmentPlanLookup = {};
    
    treatmentPlanResult.rows.forEach((row: any) => {
      treatmentPlanLookup[row.legacy_plan_id] = row.id;
    });
    
    console.log(`   🎯 Loaded ${Object.keys(treatmentPlanLookup).length} treatment plan mappings`);

    // 2. Get source comments
    console.log('2️⃣ Fetching source comments...');
    const sourceCommentsQuery = `
      SELECT id, created_at, text, author_id, plan_id
      FROM dispatch_comment
      WHERE text IS NOT NULL AND TRIM(text) != ''
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
    let skippedComments = 0;
    let errors = 0;

    for (let i = 0; i < totalBatches; i++) {
      const startIdx = i * batchSize;
      const endIdx = Math.min(startIdx + batchSize, sourceComments.length);
      const batch = sourceComments.slice(startIdx, endIdx);
      
      console.log(`   📦 Processing batch ${i + 1}/${totalBatches} (${batch.length} comments)...`);
      
      // Process each comment in the batch
      for (const comment of batch) {
        try {
          // Look up treatment plan
          const treatmentPlanId = treatmentPlanLookup[comment.plan_id];
          if (!treatmentPlanId) {
            console.log(`   ⚠️ Skipping comment ${comment.id}: no treatment plan mapping for plan_id ${comment.plan_id}`);
            skippedComments++;
            continue;
          }

          // Insert comment with all required fields
          const insertCommentQuery = `
            INSERT INTO comments (id, content, comment_type, author_id, created_at, updated_at, legacy_table, legacy_id)
            VALUES (gen_random_uuid(), $1, 'treatment_discussion', $2, $3, $3, 'dispatch_comment', $4)
            RETURNING id;
          `;
          
          const commentResult = await targetDb.query(insertCommentQuery, [
            comment.text,
            comment.author_id, // This can be null
            comment.created_at,
            comment.id
          ]);
          
          const newCommentId = commentResult.rows[0].id;

          // Insert treatment discussion linkage
          const insertDiscussionQuery = `
            INSERT INTO treatment_discussions (id, comment_id, treatment_plan_id, created_at)
            VALUES (gen_random_uuid(), $1, $2, $3);
          `;
          
          await targetDb.query(insertDiscussionQuery, [
            newCommentId,
            treatmentPlanId,
            comment.created_at
          ]);

          successfulMigrations++;

        } catch (error) {
          console.error(`   ❌ Error migrating comment ${comment.id}:`, error);
          errors++;
        }
      }

      // Progress update
      const progressPercent = Math.round((i + 1) / totalBatches * 100);
      console.log(`   📊 Progress: ${progressPercent}% (${successfulMigrations} successful, ${skippedComments} skipped, ${errors} errors)`);
      
      // Brief pause between batches to avoid overwhelming the database
      if (i < totalBatches - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log('\n✅ Comment migration completed!');
    console.log(`📊 Final results:`);
    console.log(`  • Comments migrated: ${successfulMigrations}`);
    console.log(`  • Comments skipped: ${skippedComments}`);
    console.log(`  • Errors: ${errors}`);
    console.log(`  • Success rate: ${Math.round((successfulMigrations / sourceComments.length) * 100)}%`);

  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await sourceDb.end();
    await targetDb.end();
  }
}

// Run migration
migrateComments().catch(console.error);
