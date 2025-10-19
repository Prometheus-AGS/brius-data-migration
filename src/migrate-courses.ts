import { Client as PgClient } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

async function migrateCourses() {
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

    console.log("Fetching courses...");
    const result = await sourceClient.query(`SELECT id, name, type, customization FROM dispatch_course ORDER BY id`);

    const existing = await targetClient.query(`SELECT legacy_id FROM public.courses WHERE legacy_id IS NOT NULL`);
    const existingIds = new Set(existing.rows.map(r => r.legacy_id));

    let inserted = 0;
    for (const course of result.rows) {
      if (existingIds.has(course.id)) continue;
      await targetClient.query(`INSERT INTO public.courses (legacy_id, name, course_type, customization) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (legacy_id) DO NOTHING`, [course.id, course.name, course.type, course.customization]);
      inserted++;
    }

    console.log(`✓ Migrated ${inserted} courses`);
  } finally {
    await sourceClient.end();
    await targetClient.end();
  }
}

migrateCourses().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
