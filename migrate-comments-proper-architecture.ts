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

// Target database configuration
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

interface AuthorLookup {
  [legacyUserId: number]: string; // legacy_user_id -> profile_id
}

async function migrateCommentsProperArchitecture() {
  console.log('🔄 Migrating dispatch_comment → comments + treatment_discussions (proper architecture)...\n');

  try {
    // Connect to both databases
    await sourceDb.connect();
    await targetDb.connect();
    
    console.log('✅ Connected to source and target databases');

    // 1. Build treatment plan lookup map (legacy_plan_id -> treatment_plan.id)
    console.log('1️⃣ Building treatment plan lookup map...');
    
    const treatmentPlanQuery = `
      SELECT id, legacy_plan_id
      FROM treatment_plans 
      WHERE legacy_plan_id IS NOT NULL
    `;
    
    const treatmentPlanResult = await targetDb.query(treatmentPlanQuery);
    const treatmentPlanLookup: TreatmentPlanLookup = {};
    
    treatmentPlanResult.rows.forEach(row => {
      treatmentPlanLookup[row.legacy_plan_id] = row.id;
    });
    
    console.log(`   🎯 Loaded ${Object.keys(treatmentPlanLookup).length} treatment plan mappings`);

    // 2. Build author lookup map (legacy_user_id -> profile.id)
    console.log('2️⃣ Building author lookup map...');
    
    const authorQuery = `
      SELECT id, legacy_user_id
      FROM profiles 
      WHERE legacy_user_id IS NOT NULL
    `;
    
    const authorResult = await targetDb.query(authorQuery);
    const authorLookup: AuthorLookup = {};
    
    authorResult.rows.forEach(row => {
      authorLookup[row.legacy_user_id] = row.id;
    });
    
    console.log(`   👤 Loaded ${Object.keys(authorLookup).length} author mappings`);

    // 3. Get source comments
    console.log('3️⃣ Fetching source comments...');
    const sourceCommentsQuery = `
      SELECT id, created_at, text, author_id, plan_id
      FROM dispatch_comment
      WHERE text IS NOT NULL AND TRIM(text) != ''
      ORDER BY created_at;
    `;
    
    const sourceCommentsResult = await sourceDb.query(sourceCommentsQuery);
    const sourceComments: SourceComment[] = sourceCommentsResult.rows;
    
    console.log(`   📝 Found ${sourceComments.length} comments to migrate`);

    // 4. Clear any existing migrated data
    console.log('4️⃣ Cleaning up any existing migration data...');
    
    // First delete treatment_discussions that link to migrated comments
    const cleanupDiscussions = await targetDb.query(`
      DELETE FROM treatment_discussions 
      WHERE comment_id IN (
        SELECT id FROM comments 
        WHERE legacy_table = 'dispatch_comment'
      )
    `);
    console.log(`   🧹 Cleaned up ${cleanupDiscussions.rowCount} treatment_discussions`);
    
    // Then delete the comments themselves
    const cleanupComments = await targetDb.query(`
      DELETE FROM comments 
      WHERE legacy_table = 'dispatch_comment'
    `);
    console.log(`   🧹 Cleaned up ${cleanupComments.rowCount} comments`);

    // 5. Process comments in batches
    console.log('5️⃣ Migrating comments with proper architecture...\n');
    
    const batchSize = 100;
    const totalBatches = Math.ceil(sourceComments.length / batchSize);
    let successfulMigrations = 0;
    let skippedComments = 0;
    let errors = 0;
    let authorMappingMisses = 0;

    for (let i = 0; i < totalBatches; i++) {
      const batchStart = i * batchSize;
      const batchEnd = Math.min((i + 1) * batchSize, sourceComments.length);
      const batch = sourceComments.slice(batchStart, batchEnd);
      
      console.log(`   📦 Processing batch ${i + 1}/${totalBatches} (${batch.length} comments)...`);

      for (const comment of batch) {
        try {
          // Check if we have a treatment plan mapping
          const treatmentId = treatmentPlanLookup[comment.plan_id];
          if (!treatmentId) {
            console.log(`   ⚠️ Skipping comment ${comment.id}: no treatment plan mapping for plan_id ${comment.plan_id}`);
            skippedComments++;
            continue;
          }

          // Resolve author ID - can be null
          let authorId: string | null = null;
          if (comment.author_id !== null) {
            authorId = authorLookup[comment.author_id] || null;
            if (!authorId) {
              authorMappingMisses++;
              console.log(`   👤 No author mapping for legacy user ID ${comment.author_id} (comment ${comment.id}) - will set to null`);
            }
          }

          // Step 1: Insert into comments table
          const insertCommentQuery = `
            INSERT INTO comments (id, content, comment_type, author_id, created_at, updated_at, legacy_table, legacy_id)
            VALUES (gen_random_uuid(), $1, 'treatment_discussion', $2, $3, $3, 'dispatch_comment', $4)
            RETURNING id;
          `;
          
          const commentResult = await targetDb.query(insertCommentQuery, [
            comment.text,        // content
            authorId,            // author_id (mapped from legacy author_id or null)
            comment.created_at,  // created_at
            comment.id           // legacy_id
          ]);
          
          const newCommentId = commentResult.rows[0].id;

          // Step 2: Insert into treatment_discussions table with comment_id foreign key
          const insertDiscussionQuery = `
            INSERT INTO treatment_discussions (
              id, 
              treatment_id, 
              comment_id, 
              created_at, 
              legacy_comment_id,
              is_visible_to_patient
            )
            VALUES (
              gen_random_uuid(), 
              $1, 
              $2, 
              $3, 
              $4,
              true
            );
          `;
          
          await targetDb.query(insertDiscussionQuery, [
            treatmentId,        // treatment_id (mapped from legacy plan_id)
            newCommentId,       // comment_id (foreign key to comments table)
            comment.created_at, // created_at
            comment.id          // legacy_comment_id
          ]);

          successfulMigrations++;

        } catch (error) {
          errors++;
          console.log(`   ❌ Error migrating comment ${comment.id}:`, error);
        }
      }

      // Progress update
      const progressPercent = Math.round((i + 1) / totalBatches * 100);
      console.log(`   📊 Progress: ${progressPercent}% (${successfulMigrations} successful, ${skippedComments} skipped, ${errors} errors)`);
      
      // Brief pause between batches
      if (i < totalBatches - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log('\n✅ Comment migration completed with proper architecture!');
    console.log(`📊 Final results:`);
    console.log(`  • Comments migrated: ${successfulMigrations}`);
    console.log(`  • Treatment discussions created: ${successfulMigrations}`);
    console.log(`  • Comments skipped (no treatment plan): ${skippedComments - authorMappingMisses}`);
    console.log(`  • Comments with missing author mapping: ${authorMappingMisses}`);
    console.log(`  • Errors: ${errors}`);
    console.log(`  • Success rate: ${Math.round((successfulMigrations / sourceComments.length) * 100)}%`);

    // Final verification
    console.log('\n🔍 Verification:');
    const finalCommentCount = await targetDb.query(`
      SELECT COUNT(*) as count FROM comments 
      WHERE legacy_table = 'dispatch_comment'
    `);
    const finalDiscussionCount = await targetDb.query(`
      SELECT COUNT(*) as count FROM treatment_discussions 
      WHERE comment_id IS NOT NULL
    `);
    
    console.log(`   Comments in database: ${finalCommentCount.rows[0].count}`);
    console.log(`   Treatment discussions with comment_id: ${finalDiscussionCount.rows[0].count}`);

  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await sourceDb.end();
    await targetDb.end();
  }
}

// Run migration
migrateCommentsProperArchitecture().catch(console.error);
