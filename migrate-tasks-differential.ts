import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

interface Task {
  id: number;
  text: string;
  checked: boolean;
  done_at: Date | null;
  actor_id: number | null;
  instruction_id: number | null;
  plan_id: number | null;
  order_id: number | null;
  jaw: number;
  template_id: number;
  file_id: number | null;
}

interface TaskMigrationStats {
  totalSourceRecords: number;
  totalTargetRecords: number;
  missingRecords: number;
  migratedRecords: number;
  skippedRecords: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
}

class TasksDifferentialMigration {
  private sourcePool: Pool;
  private targetPool: Pool;
  private stats: TaskMigrationStats;
  private batchSize: number = 1000;

  constructor() {
    this.sourcePool = new Pool({
      host: process.env.SOURCE_DB_HOST,
      port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
      database: process.env.SOURCE_DB_NAME,
      user: process.env.SOURCE_DB_USER,
      password: process.env.SOURCE_DB_PASSWORD,
      ssl: { rejectUnauthorized: false }
    });

    this.targetPool = new Pool({
      host: process.env.TARGET_DB_HOST,
      port: parseInt(process.env.TARGET_DB_PORT || '5432'),
      database: process.env.TARGET_DB_NAME,
      user: process.env.TARGET_DB_USER,
      password: process.env.TARGET_DB_PASSWORD,
    });

    this.stats = {
      totalSourceRecords: 0,
      totalTargetRecords: 0,
      missingRecords: 0,
      migratedRecords: 0,
      skippedRecords: 0,
      errors: 0,
      startTime: new Date(),
    };
  }

  /**
   * Get existing task IDs in target database
   */
  private async getExistingTaskIds(): Promise<Set<number>> {
    const query = `
      SELECT legacy_task_id
      FROM tasks
      WHERE legacy_task_id IS NOT NULL
    `;

    try {
      const result = await this.targetPool.query(query);
      const existingIds = new Set<number>();

      result.rows.forEach(row => {
        if (row.legacy_task_id) {
          existingIds.add(row.legacy_task_id);
        }
      });

      console.log(`✓ Found ${existingIds.size} existing task IDs in target`);
      return existingIds;
    } catch (error) {
      console.error('❌ Error fetching existing task IDs:', error);
      throw error;
    }
  }

  /**
   * Get missing tasks from source database
   */
  private async getMissingTasks(existingIds: Set<number>): Promise<Task[]> {
    const query = `
      SELECT
        id,
        text,
        checked,
        done_at,
        actor_id,
        instruction_id,
        plan_id,
        order_id,
        jaw,
        template_id,
        file_id
      FROM dispatch_task
      ORDER BY id
    `;

    try {
      const result = await this.sourcePool.query(query);
      this.stats.totalSourceRecords = result.rows.length;

      // Filter to only missing tasks
      const missingTasks = result.rows.filter((task: any) => !existingIds.has(task.id));
      this.stats.missingRecords = missingTasks.length;

      console.log(`✓ Found ${this.stats.totalSourceRecords} total tasks in source`);
      console.log(`✓ Identified ${this.stats.missingRecords} missing tasks to migrate`);

      return missingTasks;
    } catch (error) {
      console.error('❌ Error fetching missing tasks:', error);
      throw error;
    }
  }

  /**
   * Get required mappings for task migration
   */
  private async getMappings(): Promise<{
    orderMappings: Map<number, string>,
    userMappings: Map<number, string>,
    templateMappings: Map<number, string>
  }> {
    try {
      const [orderMappingsResult, userMappingsResult, templateMappingsResult] = await Promise.all([
        // Get order mappings
        this.targetPool.query(`
          SELECT legacy_instruction_id, id
          FROM orders
          WHERE legacy_instruction_id IS NOT NULL
        `),
        // Get user mappings
        this.targetPool.query(`
          SELECT legacy_user_id, id
          FROM profiles
          WHERE legacy_user_id IS NOT NULL
        `),
        // Get template mappings
        this.targetPool.query(`
          SELECT legacy_template_id, id
          FROM templates
          WHERE legacy_template_id IS NOT NULL
        `).catch(() => ({ rows: [] })) // Gracefully handle if templates table doesn't have this field
      ]);

      const orderMappings = new Map<number, string>();
      const userMappings = new Map<number, string>();
      const templateMappings = new Map<number, string>();

      orderMappingsResult.rows.forEach(row => {
        orderMappings.set(row.legacy_instruction_id, row.id);
      });

      userMappingsResult.rows.forEach(row => {
        userMappings.set(row.legacy_user_id, row.id);
      });

      templateMappingsResult.rows.forEach(row => {
        templateMappings.set(row.legacy_template_id, row.id);
      });

      console.log(`✓ Found ${orderMappings.size} order mappings`);
      console.log(`✓ Found ${userMappings.size} user mappings`);
      console.log(`✓ Found ${templateMappings.size} template mappings`);

      return { orderMappings, userMappings, templateMappings };
    } catch (error) {
      console.error('❌ Error fetching mappings:', error);
      throw error;
    }
  }

  /**
   * Migrate tasks batch
   */
  private async migrateTasksBatch(
    tasks: Task[],
    orderMappings: Map<number, string>,
    userMappings: Map<number, string>,
    templateMappings: Map<number, string>
  ): Promise<void> {
    if (tasks.length === 0) return;

    console.log(`📊 Migrating batch of ${tasks.length} tasks...`);

    // Prepare batch insert
    const taskRecords = tasks
      .map(task => {
        const orderId = task.instruction_id ? orderMappings.get(task.instruction_id) :
                      task.order_id ? orderMappings.get(task.order_id) : null;
        const assignedTo = task.actor_id ? userMappings.get(task.actor_id) : null;
        const templateId = task.template_id ? templateMappings.get(task.template_id) : null;

        return {
          order_id: orderId,
          assigned_to: assignedTo,
          template_id: templateId,
          template_name: task.text || 'Task',
          description: task.text,
          jaw_specification: task.jaw,
          status: task.checked ? 'completed' : 'pending',
          checked: task.checked,
          completed_at: task.done_at,
          legacy_task_id: task.id,
          metadata: JSON.stringify({
            source_text: task.text,
            source_checked: task.checked,
            source_done_at: task.done_at,
            source_jaw: task.jaw,
            source_template_id: task.template_id,
            source_file_id: task.file_id,
            source_plan_id: task.plan_id,
            source_actor_id: task.actor_id,
            source_instruction_id: task.instruction_id,
            source_order_id: task.order_id,
            migrated_at: new Date().toISOString()
          })
        };
      })
      .filter(record => {
        if (!record.order_id) {
          console.log(`⏭️  Skipping task ${record.legacy_task_id} - no matching order`);
          return false;
        }
        return true;
      });

    console.log(`   → ${taskRecords.length}/${tasks.length} tasks have required order mappings`);

    if (taskRecords.length === 0) {
      this.stats.skippedRecords += tasks.length;
      return;
    }

    try {
      // Insert batch using ON CONFLICT since legacy_task_id has UNIQUE constraint
      const insertQuery = `
        INSERT INTO tasks (
          order_id, assigned_to, template_id, template_name, description, jaw_specification,
          status, checked, completed_at, legacy_task_id, metadata, created_at, updated_at
        ) VALUES ${taskRecords.map((_, i) =>
          `($${i * 11 + 1}, $${i * 11 + 2}, $${i * 11 + 3}, $${i * 11 + 4}, $${i * 11 + 5}, $${i * 11 + 6}, $${i * 11 + 7}, $${i * 11 + 8}, $${i * 11 + 9}, $${i * 11 + 10}, $${i * 11 + 11}, NOW(), NOW())`
        ).join(', ')}
        ON CONFLICT (legacy_task_id) DO NOTHING
      `;

      const values = taskRecords.flatMap(task => [
        task.order_id,
        task.assigned_to,
        task.template_id,
        task.template_name,
        task.description,
        task.jaw_specification,
        task.status,
        task.checked,
        task.completed_at,
        task.legacy_task_id,
        task.metadata
      ]);

      const result = await this.targetPool.query(insertQuery, values);
      const insertedCount = result.rowCount || 0;

      this.stats.migratedRecords += insertedCount;
      this.stats.skippedRecords += (taskRecords.length - insertedCount);

      console.log(`✅ Successfully migrated ${insertedCount} tasks`);

    } catch (error) {
      this.stats.errors++;
      console.error(`❌ Error migrating tasks batch:`, error);
    }
  }

  /**
   * Main differential migration function
   */
  public async executeDifferentialMigration(): Promise<TaskMigrationStats> {
    console.log('🚀 Starting Tasks Differential Migration (using existing tasks table)...\n');

    try {
      // Get existing IDs and missing tasks
      const existingIds = await this.getExistingTaskIds();
      const missingTasks = await this.getMissingTasks(existingIds);

      if (missingTasks.length === 0) {
        console.log('🎉 All tasks are already migrated!');
        this.stats.endTime = new Date();
        return this.stats;
      }

      // Get required mappings
      const { orderMappings, userMappings, templateMappings } = await this.getMappings();

      console.log('\n🔄 Starting batch migration...');

      // Process in batches
      for (let i = 0; i < missingTasks.length; i += this.batchSize) {
        const batchStartTime = Date.now();
        const batch = missingTasks.slice(i, i + this.batchSize);

        await this.migrateTasksBatch(batch, orderMappings, userMappings, templateMappings);

        const batchDuration = Date.now() - batchStartTime;
        const recordsPerSecond = batch.length > 0 ? (batch.length / batchDuration * 1000).toFixed(0) : '0';
        console.log(`   ⚡ Batch ${Math.floor(i / this.batchSize) + 1} completed in ${batchDuration}ms (${recordsPerSecond} records/sec)`);

        if (this.stats.migratedRecords % 5000 === 0 && this.stats.migratedRecords > 0) {
          console.log(`✅ Progress: ${this.stats.migratedRecords} tasks migrated...`);
        }
      }

      this.stats.endTime = new Date();

      // Final summary
      console.log('\n📋 Tasks Differential Migration Summary:');
      console.log(`⏱️  Duration: ${this.stats.endTime.getTime() - this.stats.startTime.getTime()}ms`);
      console.log(`📊 Source Records: ${this.stats.totalSourceRecords}`);
      console.log(`📊 Missing Records: ${this.stats.missingRecords}`);
      console.log(`✅ Successfully Migrated: ${this.stats.migratedRecords}`);
      console.log(`⏭️  Skipped: ${this.stats.skippedRecords}`);
      console.log(`❌ Errors: ${this.stats.errors}`);

      const successRate = this.stats.missingRecords > 0
        ? ((this.stats.migratedRecords / this.stats.missingRecords) * 100).toFixed(2)
        : 100;
      console.log(`📈 Success Rate: ${successRate}%`);

      return this.stats;

    } catch (error) {
      console.error('💥 Tasks differential migration failed:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Validate the migration results
   */
  public async validateMigration(): Promise<void> {
    console.log('\n🔍 Validating tasks migration...');

    try {
      const validationStats = await this.targetPool.query(`
        SELECT
          COUNT(*) as total_tasks,
          COUNT(CASE WHEN legacy_task_id IS NOT NULL THEN 1 END) as migrated_tasks,
          COUNT(DISTINCT assigned_to) as unique_assignees,
          COUNT(DISTINCT order_id) as unique_orders,
          COUNT(DISTINCT template_id) as unique_templates,
          MIN(assigned_at) as earliest_task,
          MAX(assigned_at) as latest_task
        FROM tasks
      `);

      const stats = validationStats.rows[0];
      console.log('📊 Tasks Validation:');
      console.log(`   Total Tasks: ${stats.total_tasks}`);
      console.log(`   Migrated Tasks (with legacy_task_id): ${stats.migrated_tasks}`);
      console.log(`   Unique Assignees: ${stats.unique_assignees}`);
      console.log(`   Unique Orders: ${stats.unique_orders}`);
      console.log(`   Unique Templates: ${stats.unique_templates}`);
      console.log(`   Date Range: ${stats.earliest_task} to ${stats.latest_task}`);

      // Task status breakdown
      const statusBreakdown = await this.targetPool.query(`
        SELECT
          status,
          COUNT(*) as count
        FROM tasks
        WHERE legacy_task_id IS NOT NULL
        GROUP BY status
        ORDER BY count DESC
      `);

      console.log('\n📊 Task Status Distribution:');
      statusBreakdown.rows.forEach(row => {
        console.log(`   ${row.status}: ${row.count} tasks`);
      });

      // Check for any gaps
      const sourceTotal = await this.sourcePool.query('SELECT COUNT(*) FROM dispatch_task');
      const targetMigrated = parseInt(stats.migrated_tasks);
      const sourceCount = parseInt(sourceTotal.rows[0].count);

      console.log(`\n📊 Migration Coverage:`);
      console.log(`   Source Tasks: ${sourceCount}`);
      console.log(`   Target Migrated: ${targetMigrated}`);
      console.log(`   Coverage: ${((targetMigrated / sourceCount) * 100).toFixed(2)}%`);

      if (sourceCount === targetMigrated) {
        console.log('🎉 PERFECT MIGRATION: All tasks successfully migrated!');
      } else {
        console.log(`⚠️  ${sourceCount - targetMigrated} tasks still missing`);
      }

      console.log('\n✅ Validation completed');

    } catch (error) {
      console.error('❌ Validation failed:', error);
    }
  }

  /**
   * Cleanup connections
   */
  private async cleanup(): Promise<void> {
    try {
      await Promise.all([
        this.sourcePool.end(),
        this.targetPool.end()
      ]);
      console.log('🧹 Database connections closed');
    } catch (error) {
      console.error('⚠️  Error during cleanup:', error);
    }
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'migrate';

  const migration = new TasksDifferentialMigration();

  try {
    switch (command) {
      case 'migrate':
        await migration.executeDifferentialMigration();
        await migration.validateMigration();
        break;

      case 'validate':
        await migration.validateMigration();
        break;

      default:
        console.log('Usage: npx ts-node migrate-tasks-differential.ts [migrate|validate]');
        process.exit(1);
    }

    process.exit(0);

  } catch (error) {
    console.error('💥 Operation failed:', error);
    process.exit(1);
  }
}

// Export for use as module
export { TasksDifferentialMigration };

// Run if called directly
if (require.main === module) {
  main();
}