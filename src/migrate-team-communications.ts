import { Client as PgClient } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

const BATCH_SIZE = 1000;

async function migrateTeamCommunications() {
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

    console.log("Building lookup maps...");
    const profileResult = await targetClient.query(`SELECT id, legacy_user_id FROM public.profiles WHERE legacy_user_id IS NOT NULL`);
    const profileMap = new Map(profileResult.rows.map(r => [r.legacy_user_id, r.id]));
    console.log(`Loaded ${profileMap.size} profile mappings`);

    console.log("Fetching records from source...");
    const result = await sourceClient.query(`
      SELECT dr.id, dr.target_id, dr.type, dr.created_at, dr.text, dr.author_id, dr.public, dct.model
      FROM dispatch_record dr
      LEFT JOIN django_content_type dct ON dr.target_type_id = dct.id
      WHERE dr.type IN (3, 5, 6, 8)
      ORDER BY dr.id
    `);
    console.log(`Found ${result.rows.length} records in source`);

    const existing = await targetClient.query(`SELECT legacy_record_id FROM public.team_communications WHERE legacy_record_id IS NOT NULL`);
    const existingIds = new Set(existing.rows.map(r => r.legacy_record_id));
    console.log(`Found ${existingIds.size} existing records in target`);

    const typeMap = {
      3: 'team_announcement',
      5: 'status_update',
      6: 'production_note',
      8: 'quality_check'
    };

    const records = result.rows.filter(r => !existingIds.has(r.id));
    console.log(`${records.length} new records to migrate`);

    let inserted = 0;
    let skipped = 0;

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const values = [];
      const placeholders = [];
      let idx = 1;

      for (const record of batch) {
        const authorId = record.author_id ? profileMap.get(record.author_id) : null;
        
        if (!authorId) {
          skipped++;
          continue;
        }

        const commType = typeMap[record.type] || 'production_note';
        const visibility = record.public ? 'organization' : 'team';

        placeholders.push(`($${idx}, $${idx+1}, $${idx+2}, $${idx+3}, $${idx+4}, $${idx+5})`);
        values.push(
          commType,
          authorId,
          record.text || '',
          visibility,
          record.created_at,
          record.id
        );
        idx += 6;
      }

      if (placeholders.length > 0) {
        await targetClient.query(`
          INSERT INTO public.team_communications (communication_type, author_id, body, visibility, created_at, legacy_record_id)
          VALUES ${placeholders.join(", ")}
          ON CONFLICT DO NOTHING
        `, values);
        inserted += placeholders.length;
        console.log(`Batch ${Math.floor(i/BATCH_SIZE)+1}: ${inserted} records`);
      }
    }

    console.log(`✓ Migrated ${inserted} team communications`);
    console.log(`⚠ Skipped ${skipped} records (no author mapping)`);

    const verifyResult = await targetClient.query(`SELECT COUNT(*) as count FROM public.team_communications WHERE legacy_record_id IS NOT NULL`);
    console.log(`Total team communications in target: ${verifyResult.rows[0].count}`);

  } finally {
    await sourceClient.end();
    await targetClient.end();
  }
}

migrateTeamCommunications().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
