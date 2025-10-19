import { Client as PgClient } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

const BATCH_SIZE = 1000;

async function migrateDoctorNotes() {
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

    console.log("Fetching doctor notes from source...");
    const result = await sourceClient.query(`
      SELECT id, created_at, text, author_id, doctor_id
      FROM dispatch_note
      ORDER BY id
    `);
    console.log(`Found ${result.rows.length} doctor notes in source`);

    const existing = await targetClient.query(`SELECT legacy_note_id FROM public.doctor_notes WHERE legacy_note_id IS NOT NULL`);
    const existingIds = new Set(existing.rows.map(r => r.legacy_note_id));
    console.log(`Found ${existingIds.size} existing doctor notes in target`);

    const notes = result.rows.filter(n => !existingIds.has(n.id));
    console.log(`${notes.length} new doctor notes to migrate`);

    let inserted = 0;
    let skipped = 0;

    for (const note of notes) {
      const doctorId = note.doctor_id ? profileMap.get(note.doctor_id) : null;
      const authorId = note.author_id ? profileMap.get(note.author_id) : null;
      
      if (!doctorId) {
        skipped++;
        continue;
      }

      await targetClient.query(`
        INSERT INTO public.doctor_notes (doctor_id, author_id, text, created_at, legacy_note_id)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (legacy_note_id) DO NOTHING
      `, [doctorId, authorId, note.text || '', note.created_at, note.id]);
      inserted++;
    }

    console.log(`✓ Migrated ${inserted} doctor notes`);
    console.log(`⚠ Skipped ${skipped} notes (no doctor mapping)`);

    const verifyResult = await targetClient.query(`SELECT COUNT(*) as count FROM public.doctor_notes WHERE legacy_note_id IS NOT NULL`);
    console.log(`Total doctor notes in target: ${verifyResult.rows[0].count}`);

  } finally {
    await sourceClient.end();
    await targetClient.end();
  }
}

migrateDoctorNotes().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
