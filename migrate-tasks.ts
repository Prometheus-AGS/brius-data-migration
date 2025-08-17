import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

// Source database connection
const sourceClient = new Client({
  host: process.env.SOURCE_DB_HOST,
  port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
  database: process.env.SOURCE_DB_NAME,
  user: process.env.SOURCE_DB_USER,
  password: process.env.SOURCE_DB_PASSWORD,
});

// Target database connection
const targetClient = new Client({
  host: process.env.TARGET_DB_HOST,
  port: parseInt(process.env.TARGET_DB_PORT || '5432'),
  database: process.env.TARGET_DB_NAME,
  user: process.env.TARGET_DB_USER,
  password: process.env.TARGET_DB_PASSWORD,
});

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '500');
const TEST_MODE = process.env.TEST_MODE === 'true';

interface SourceTask {
  id: number;
  checked: boolean;
  file_id: number | null;
  template_id: number;
  done_at: Date | null;
  text: string | null;
  plan_id: number | null;
  instruction_id: number | null;
  actor_id: number | null;
  jaw: number;
  order_id: number | null;
}

async function buildLookupMappings() {
  console.log('Building lookup mappings...');
  
  // Build order mapping (legacy_instruction_id -> target order UUID)
  const orderResult = await targetClient.query(`
    SELECT id, legacy_instruction_id 
    FROM orders 
    WHERE legacy_instruction_id IS NOT NULL
  `);
  const orderMapping = new Map<number, string>();
  for (const row of orderResult.rows) {
    orderMapping.set(row.legacy_instruction_id, row.id);
  }
  console.log(`  Built ${orderMapping.size} order mappings`);

  // Build profile mapping for actors (legacy_user_id -> target profile UUID)
  const profileResult = await targetClient.query(`
    SELECT id, legacy_user_id 
    FROM profiles 
    WHERE legacy_user_id IS NOT NULL
  `);
  const profileMapping = new Map<number, string>();
  for (const row of profileResult.rows) {
    profileMapping.set(row.legacy_user_id, row.id);
  }
  console.log(`  Built ${profileMapping.size} profile mappings`);

  // Build template mapping (legacy_template_id -> target template UUID)
  // Note: Templates may not be migrated yet, so this could be empty
  const templateResult = await targetClient.query(`
    SELECT id, legacy_template_id 
    FROM templates 
    WHERE legacy_template_id IS NOT NULL
  `);
  const templateMapping = new Map<number, string>();
  for (const row of templateResult.rows) {
    templateMapping.set(row.legacy_template_id, row.id);
  }
  console.log(`  Built ${templateMapping.size} template mappings`);

  return { orderMapping, profileMapping, templateMapping };
}

function mapTaskStatus(checked: boolean, doneAt: Date | null): string {
  if (checked && doneAt) {
    return 'completed';
  } else if (doneAt) {
    return 'in_progress';
  } else {
    return 'pending';
  }
}

function getTemplateName(templateId: number): string {
  // Map common template IDs to names based on patterns
  // This is a fallback when templates aren't migrated yet
  const templateNames: { [key: number]: string } = {
    16: 'Review Task',
    17: 'File Upload Task', 
    18: 'Quality Check',
    19: 'Approval Task',
    20: 'Processing Task'
  };
  
  return templateNames[templateId] || `Template ${templateId}`;
}

async function migrateTasksBatch(
  tasks: SourceTask[],
  orderMapping: Map<number, string>,
  profileMapping: Map<number, string>,
  templateMapping: Map<number, string>
): Promise<{ success: number; skipped: number; errors: number }> {
  
  const insertData: any[] = [];
  let skipped = 0;

  for (const task of tasks) {
    // Get order ID - this is required
    let orderId: string | null = null;
    if (task.instruction_id) {
      orderId = orderMapping.get(task.instruction_id) || null;
    }
    
    if (!orderId) {
      // Skip tasks without valid order mapping as order_id is required
      skipped++;
      continue;
    }

    const templateId = task.template_id ? templateMapping.get(task.template_id) : null;
    const assignedTo = task.actor_id ? profileMapping.get(task.actor_id) : null;
    
    const status = mapTaskStatus(task.checked, task.done_at);
    const templateName = getTemplateName(task.template_id);
    
    insertData.push({
      order_id: orderId,
      assigned_to: assignedTo,
      template_id: templateId,
      template_name: templateName,
      description: task.text,
      jaw_specification: task.jaw,
      status: status,
      checked: task.checked,
      completed_at: task.done_at,
      legacy_task_id: task.id,
      metadata: JSON.stringify({
        legacy_file_id: task.file_id,
        legacy_plan_id: task.plan_id,
        legacy_order_id: task.order_id,
        legacy_template_id: task.template_id,
        legacy_actor_id: task.actor_id
      })
    });
  }

  if (insertData.length === 0) {
    return { success: 0, skipped, errors: 0 };
  }

  try {
    // Build the insert query
    const fields = [
      'order_id', 'assigned_to', 'template_id', 'template_name', 
      'description', 'jaw_specification', 'status', 'checked',
      'completed_at', 'legacy_task_id', 'metadata'
    ];
    
    const values = insertData.map((_, index) => {
      const base = index * fields.length;
      return `(${fields.map((_, i) => `$${base + i + 1}`).join(', ')})`;
    }).join(', ');

    const query = `
      INSERT INTO tasks (${fields.join(', ')})
      VALUES ${values}
      ON CONFLICT (legacy_task_id) DO NOTHING
    `;

    const queryParams: any[] = [];
    for (const data of insertData) {
      queryParams.push(
        data.order_id,
        data.assigned_to,
        data.template_id,
        data.template_name,
        data.description,
        data.jaw_specification,
        data.status,
        data.checked,
        data.completed_at,
        data.legacy_task_id,
        data.metadata
      );
    }

    const result = await targetClient.query(query, queryParams);
    
    return { 
      success: result.rowCount || 0, 
      skipped, 
      errors: 0 
    };

  } catch (error) {
    console.error('    Batch insert error:', error);
    return { 
      success: 0, 
      skipped, 
      errors: insertData.length 
    };
  }
}

async function migrateTasks() {
  try {
    await sourceClient.connect();
    await targetClient.connect();
    console.log('Connected to both databases');

    const { orderMapping, profileMapping, templateMapping } = await buildLookupMappings();

    // Get total count
    const countResult = await sourceClient.query(`
      SELECT COUNT(*) as total FROM dispatch_task
    `);
    const totalRecords = parseInt(countResult.rows[0].total);
    console.log(`Total tasks to migrate: ${totalRecords.toLocaleString()}\n`);

    if (TEST_MODE) {
      console.log('🧪 Running in TEST MODE - processing only first 10 records\n');
    }

    // Process in batches
    let processed = 0;
    let totalSuccess = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    const limit = TEST_MODE ? Math.min(10, BATCH_SIZE) : BATCH_SIZE;
    const maxRecords = TEST_MODE ? 10 : totalRecords;

    while (processed < maxRecords) {
      const offset = processed;
      const currentBatchSize = Math.min(limit, maxRecords - processed);
      
      console.log(`Processing batch: ${offset + 1} to ${offset + currentBatchSize}`);

      // Fetch batch
      const batchResult = await sourceClient.query(`
        SELECT id, checked, file_id, template_id, done_at, text,
               plan_id, instruction_id, actor_id, jaw, order_id
        FROM dispatch_task
        ORDER BY id
        LIMIT $1 OFFSET $2
      `, [currentBatchSize, offset]);

      const tasks: SourceTask[] = batchResult.rows;

      if (tasks.length === 0) {
        break;
      }

      // Migrate batch
      const result = await migrateTasksBatch(
        tasks, 
        orderMapping, 
        profileMapping,
        templateMapping
      );

      totalSuccess += result.success;
      totalSkipped += result.skipped;
      totalErrors += result.errors;

      if (result.errors === 0) {
        console.log(`    Successfully inserted ${result.success} tasks`);
        if (result.skipped > 0) {
          console.log(`    Skipped ${result.skipped} tasks (no order mapping)`);
        }
      }

      processed += tasks.length;
      
      const progressPercent = ((processed / totalRecords) * 100).toFixed(1);
      console.log(`Progress: ${progressPercent}% (${processed.toLocaleString()}/${totalRecords.toLocaleString()}) - Success: ${totalSuccess.toLocaleString()}, Skipped: ${totalSkipped.toLocaleString()}, Errors: ${totalErrors.toLocaleString()}\n`);
    }

    console.log('=== Migration Complete ===');
    console.log(`Total processed: ${processed.toLocaleString()}`);
    console.log(`Successfully migrated: ${totalSuccess.toLocaleString()}`);
    console.log(`Skipped: ${totalSkipped.toLocaleString()}`);
    console.log(`Errors: ${totalErrors.toLocaleString()}`);

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await sourceClient.end();
    await targetClient.end();
  }
}

// Run migration
migrateTasks();
