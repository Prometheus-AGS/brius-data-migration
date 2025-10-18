import { Client as PgClient } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

const BATCH_SIZE = 1000;

async function migrateComments() {
  const sourceClient = new PgClient({
    host: process.env.SOURCE_DB_HOST,
    port: parseInt(process.env.SOURCE_DB_PORT || "5432"),
    user: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASSWORD,
    database: process.env.SOURCE_DB_NAME,
  });

  const targetClient = new PgClient({
    host: process.env.TARGET_DB_HOST,
    port: parseInt(process.env.TARGET_DB_PORT || "5432"),
    user: process.env.TARGET_DB_USER,
    password: process.env.TARGET_DB_PASSWORD,
    database: process.env.TARGET_DB_NAME,
  });

  try {
    await sourceClient.connect();
    await targetClient.connect();

    console.log("Building author lookup map...");
    const profileResult = await targetClient.query(`SELECT id, legacy_user_id FROM public.profiles WHERE legacy_user_id IS NOT NULL`);
    const profileMap = new Map(profileResult.rows.map(r => [r.legacy_user_id, r.id]));
    console.log(`Loaded ${profileMap.size} profile mappings`);

    console.log("Fetching comments from source...");
    const result = await sourceClient.query(`
      SELECT id, created_at, text, author_id, plan_id
      FROM dispatch_comment
      ORDER BY id
    `);
    console.log(`Found ${result.rows.length} comments in source`);

    const existing = await targetClient.query(`SELECT legacy_id FROM public.comments WHERE legacy_table = 'dispatch_comment' AND legacy_id IS NOT NULL`);
    const existingIds = new Set(existing.rows.map(r => r.legacy_id));
    console.log(`Found ${existingIds.size} existing comments in target`);

    const comments = result.rows.filter(c => !existingIds.has(c.id));
    console.log(`${comments.length} new comments to migrate`);

    let inserted = 0;
    let skipped = 0;

    for (let i = 0; i < comments.length; i += BATCH_SIZE) {
      const batch = comments.slice(i, i + BATCH_SIZE);
      const values = [];
      const placeholders = [];
      let idx = 1;

      for (const comment of batch) {
        const authorId = comment.author_id ? profileMap.get(comment.author_id) : null;
        
        if (!authorId) {
          skipped++;
          continue;
        }

        placeholders.push(`($${idx}, $${idx+1}, $${idx+2}, $${idx+3}, $${idx+4}, $${idx+5})`);
        values.push(
          comment.text || '',
          'treatment_discussion',
          authorId,
          comment.created_at,
          comment.id,
          'dispatch_comment'
        );
        idx += 6;
      }

      if (placeholders.length > 0) {
        await targetClient.query(`
          INSERT INTO public.comments (content, comment_type, author_id, created_at, legacy_id, legacy_table)
          VALUES ${placeholders.join(", ")}
          ON CONFLICT DO NOTHING
        `, values);
        inserted += placeholders.length;
        console.log(`Batch ${Math.floor(i/BATCH_SIZE)+1}: ${inserted} comments`);
      }
    }

    console.log(`✓ Migrated ${inserted} comments`);
    console.log(`⚠ Skipped ${skipped} comments (no author mapping)`);

    const verifyResult = await targetClient.query(`SELECT COUNT(*) as count FROM public.comments WHERE legacy_table = 'dispatch_comment'`);
    console.log(`Total comments in target: ${verifyResult.rows[0].count}`);

  } finally {
    await sourceClient.end();
    await targetClient.end();
  }
}

migrateComments().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
