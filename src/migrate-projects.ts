import { Client as PgClient } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

const BATCH_SIZE = 1000;

async function migrateProjects() {
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

    console.log("Fetching projects from source...");
    const result = await sourceClient.query(`
      SELECT id, uid, created_at, name, size, public, type, status, creator_id
      FROM dispatch_project
      ORDER BY id
    `);
    console.log(`Found ${result.rows.length} projects in source`);

    const existing = await targetClient.query(`SELECT legacy_project_id FROM public.projects WHERE legacy_project_id IS NOT NULL`);
    const existingIds = new Set(existing.rows.map(r => r.legacy_project_id));
    console.log(`Found ${existingIds.size} existing projects in target`);

    const typeMap = {
      0: 'stl_upper',
      1: 'stl_lower',
      2: 'clinical_photo',
      3: 'treatment_plan',
      4: 'xray',
      5: 'cbct_scan',
      10: 'simulation',
      11: 'aligner_design'
    };

    const statusMap = {
      0: 'draft',
      1: 'in_progress',
      2: 'completed',
      3: 'archived'
    };

    const projects = result.rows.filter(p => !existingIds.has(p.id));
    console.log(`${projects.length} new projects to migrate`);

    let inserted = 0;
    let skipped = 0;

    for (let i = 0; i < projects.length; i += BATCH_SIZE) {
      const batch = projects.slice(i, i + BATCH_SIZE);
      const values = [];
      const placeholders = [];
      let idx = 1;

      for (const project of batch) {
        const creatorId = project.creator_id ? profileMap.get(project.creator_id) : null;
        
        if (!creatorId) {
          skipped++;
          continue;
        }

        const projectType = typeMap[project.type] || 'other';
        const projectStatus = statusMap[project.status] || 'draft';

        placeholders.push(`($${idx}, $${idx+1}, $${idx+2}, $${idx+3}, $${idx+4}, $${idx+5}, $${idx+6}, $${idx+7}, $${idx+8})`);
        values.push(
          creatorId,
          project.name,
          projectType,
          projectStatus,
          project.uid,
          project.size,
          project.public,
          project.created_at,
          project.id
        );
        idx += 9;
      }

      if (placeholders.length > 0) {
        await targetClient.query(`
          INSERT INTO public.projects (creator_id, name, project_type, status, file_uid, file_size_bytes, is_public, created_at, legacy_project_id)
          VALUES ${placeholders.join(", ")}
          ON CONFLICT (legacy_project_id) DO NOTHING
        `, values);
        inserted += placeholders.length;
        console.log(`Batch ${Math.floor(i/BATCH_SIZE)+1}: ${inserted} projects`);
      }
    }

    console.log(`✓ Migrated ${inserted} projects`);
    console.log(`⚠ Skipped ${skipped} projects (no creator mapping)`);

    const verifyResult = await targetClient.query(`SELECT COUNT(*) as count FROM public.projects WHERE legacy_project_id IS NOT NULL`);
    console.log(`Total projects in target: ${verifyResult.rows[0].count}`);

  } finally {
    await sourceClient.end();
    await targetClient.end();
  }
}

migrateProjects().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
