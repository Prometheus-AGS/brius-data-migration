import { Client as PgClient } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

const BATCH_SIZE = 1000;

async function migrateTasks() {
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

    const orderResult = await targetClient.query(`SELECT id, legacy_instruction_id FROM public.orders WHERE legacy_instruction_id IS NOT NULL`);
    const orderMap = new Map(orderResult.rows.map(r => [r.legacy_instruction_id, r.id]));
    console.log(`Loaded ${orderMap.size} order mappings`);

    const templateResult = await targetClient.query(`SELECT id, legacy_template_id FROM public.templates WHERE legacy_template_id IS NOT NULL`);
    const templateMap = new Map(templateResult.rows.map(r => [r.legacy_template_id, r.id]));
    console.log(`Loaded ${templateMap.size} template mappings`);

    console.log("Fetching tasks from source...");
    const result = await sourceClient.query(`
      SELECT id, checked, template_id, done_at, text, instruction_id, actor_id, jaw
      FROM dispatch_task
      ORDER BY id
    `);
    console.log(`Found ${result.rows.length} tasks in source`);

    const existing = await targetClient.query(`SELECT legacy_task_id FROM public.tasks WHERE legacy_task_id IS NOT NULL`);
    const existingIds = new Set(existing.rows.map(r => r.legacy_task_id));
    console.log(`Found ${existingIds.size} existing tasks in target`);

    const tasks = result.rows.filter(t => !existingIds.has(t.id));
    console.log(`${tasks.length} new tasks to migrate`);

    let inserted = 0;
    let skipped = 0;

    for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
      const batch = tasks.slice(i, i + BATCH_SIZE);
      const values = [];
      const placeholders = [];
      let idx = 1;

      for (const task of batch) {
        const orderId = task.instruction_id ? orderMap.get(task.instruction_id) : null;
        const templateId = task.template_id ? templateMap.get(task.template_id) : null;
        const actorId = task.actor_id ? profileMap.get(task.actor_id) : null;
        
        if (!orderId) {
          skipped++;
          continue;
        }

        const status = task.checked ? 'completed' : 'pending';

        placeholders.push(`($${idx}, $${idx+1}, $${idx+2}, $${idx+3}, $${idx+4}, $${idx+5}, $${idx+6}, $${idx+7}, $${idx+8}, $${idx+9})`);
        values.push(
          orderId,
          actorId,
          templateId,
          'Task',
          task.text || '',
          task.jaw,
          status,
          task.checked,
          task.id,
          task.done_at
        );
        idx += 10;

      }

      if (placeholders.length > 0) {
        await targetClient.query(`
          INSERT INTO public.tasks (order_id, assigned_to, template_id, template_name, description, jaw_specification, status, checked, legacy_task_id, completed_at)
          VALUES ${placeholders.join(", ")}
          ON CONFLICT (legacy_task_id) DO NOTHING
        `, values);
        inserted += placeholders.length;
        if (i % BATCH_SIZE === 0) {
          console.log(`Batch ${Math.floor(i/BATCH_SIZE)+1}: ${inserted} tasks`);
        }
      }
    }

    console.log(`✓ Migrated ${inserted} tasks`);
    console.log(`⚠ Skipped ${skipped} tasks (no order mapping)`);

    const verifyResult = await targetClient.query(`SELECT COUNT(*) as count FROM public.tasks WHERE legacy_task_id IS NOT NULL`);
    console.log(`Total tasks in target: ${verifyResult.rows[0].count}`);

  } finally {
    await sourceClient.end();
    await targetClient.end();
  }
}

migrateTasks().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });