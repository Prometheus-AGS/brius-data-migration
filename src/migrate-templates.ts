import { Client as PgClient } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

async function migrateTemplates() {
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

    console.log("Building category lookup map...");
    const categoryResult = await targetClient.query(`SELECT id, legacy_category_id FROM public.categories WHERE legacy_category_id IS NOT NULL`);
    const categoryMap = new Map(categoryResult.rows.map(r => [r.legacy_category_id, r.id]));
    console.log(`Loaded ${categoryMap.size} category mappings`);

    console.log("Fetching templates from source...");
    const result = await sourceClient.query(`
      SELECT id, task_name, action_name, function, status, duration, category_id, predefined, read_only, text_name, extensions, alerts, separate
      FROM dispatch_template
      ORDER BY id
    `);
    console.log(`Found ${result.rows.length} templates in source`);

    const existing = await targetClient.query(`SELECT legacy_template_id FROM public.templates WHERE legacy_template_id IS NOT NULL`);
    const existingIds = new Set(existing.rows.map(r => r.legacy_template_id));
    console.log(`Found ${existingIds.size} existing templates in target`);

    const templates = result.rows.filter(t => !existingIds.has(t.id));
    console.log(`${templates.length} new templates to migrate`);

    let inserted = 0;

    for (const template of templates) {
      const categoryId = template.category_id ? categoryMap.get(template.category_id) : null;
      const isActive = template.status === 1;
      const name = template.task_name || template.text_name || 'Unnamed Template';

      const metadata = {
        function: template.function,
        predefined: template.predefined,
        read_only: template.read_only,
        extensions: template.extensions,
        alerts: template.alerts,
        separate: template.separate
      };

      await targetClient.query(`
        INSERT INTO public.templates (name, action_name, category_id, is_active, estimated_duration_minutes, metadata, legacy_template_id)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
        ON CONFLICT (legacy_template_id) DO NOTHING
      `, [name, template.action_name, categoryId, isActive, template.duration, JSON.stringify(metadata), template.id]);
      inserted++;
    }

    console.log(`✓ Migrated ${inserted} templates`);

    const verifyResult = await targetClient.query(`SELECT COUNT(*) as count FROM public.templates WHERE legacy_template_id IS NOT NULL`);
    console.log(`Total templates in target: ${verifyResult.rows[0].count}`);

  } finally {
    await sourceClient.end();
    await targetClient.end();
  }
}

migrateTemplates().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
