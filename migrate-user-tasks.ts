import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

interface TaskRecord {
  sourceTaskId: number;
  text: string;
  checked: boolean;
  doneAt: Date | null;
  actorId: number | null;
  instructionId: number | null;
  planId: number | null;
  orderId: number | null;
  jaw: number;
  templateId: number;
  fileId: number | null;
}

interface TaskMigrationStats {
  totalProcessed: number;
  successful: number;
  skipped: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
}

class UserTasksMigration {
  private sourcePool: Pool;
  private targetPool: Pool;
  private stats: TaskMigrationStats;
  private batchSize: number = 2000;

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
      totalProcessed: 0,
      successful: 0,
      skipped: 0,
      errors: 0,
      startTime: new Date(),
    };
  }

  /**
   * Create user_tasks table in target database
   */
  private async createUserTasksTable(): Promise<void> {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS user_tasks (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        case_id UUID REFERENCES cases(id),
        actor_id UUID REFERENCES profiles(id),
        task TEXT NOT NULL,
        task_status VARCHAR(50) NOT NULL,
        task_date TIMESTAMP WITH TIME ZONE NOT NULL,
        is_private BOOLEAN DEFAULT FALSE,
        legacy_task_id INTEGER UNIQUE,
        legacy_actor_id INTEGER,
        legacy_instance_id INTEGER,
        legacy_instruction_id INTEGER,
        legacy_plan_id INTEGER,
        metadata JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Create indexes for performance
      CREATE INDEX IF NOT EXISTS idx_user_tasks_case_id ON user_tasks(case_id);
      CREATE INDEX IF NOT EXISTS idx_user_tasks_actor_id ON user_tasks(actor_id);
      CREATE INDEX IF NOT EXISTS idx_user_tasks_task_date ON user_tasks(task_date);
      CREATE INDEX IF NOT EXISTS idx_user_tasks_task_status ON user_tasks(task_status);
      CREATE INDEX IF NOT EXISTS idx_user_tasks_legacy_task_id ON user_tasks(legacy_task_id);
      CREATE INDEX IF NOT EXISTS idx_user_tasks_legacy_actor_id ON user_tasks(legacy_actor_id);
      CREATE INDEX IF NOT EXISTS idx_user_tasks_legacy_instance_id ON user_tasks(legacy_instance_id);
      CREATE INDEX IF NOT EXISTS idx_user_tasks_legacy_instruction_id ON user_tasks(legacy_instruction_id);
      CREATE INDEX IF NOT EXISTS idx_user_tasks_legacy_plan_id ON user_tasks(legacy_plan_id);
    `;

    try {
      await this.targetPool.query(createTableQuery);
      console.log('✅ user_tasks table created successfully');
    } catch (error) {
      console.error('❌ Error creating user_tasks table:', error);
      throw error;
    }
  }

  /**
   * Get user mappings from profiles table
   */
  private async getUserMappings(): Promise<Map<number, string>> {
    const query = `
      SELECT legacy_user_id, id
      FROM profiles
      WHERE legacy_user_id IS NOT NULL
    `;

    try {
      const result = await this.targetPool.query(query);
      const userMap = new Map<number, string>();

      result.rows.forEach(row => {
        userMap.set(row.legacy_user_id, row.id);
      });

      console.log(`✓ Found ${userMap.size} user mappings`);
      return userMap;
    } catch (error) {
      console.error('❌ Error fetching user mappings:', error);
      throw error;
    }
  }

  /**
   * Get case mappings from cases table
   */
  private async getCaseMappings(): Promise<Map<number, string>> {
    const query = `
      SELECT legacy_instruction_id, id
      FROM cases
      WHERE legacy_instruction_id IS NOT NULL
    `;

    try {
      const result = await this.targetPool.query(query);
      const caseMap = new Map<number, string>();

      result.rows.forEach(row => {
        caseMap.set(row.legacy_instruction_id, row.id);
      });

      console.log(`✓ Found ${caseMap.size} case mappings`);
      return caseMap;
    } catch (error) {
      console.error('❌ Error fetching case mappings:', error);
      throw error;
    }
  }

  /**
   * Get existing task IDs to avoid duplicates
   */
  private async getExistingTaskIds(): Promise<Set<number>> {
    const query = `
      SELECT legacy_task_id
      FROM user_tasks
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

      console.log(`✓ Found ${existingIds.size} existing task IDs`);
      return existingIds;
    } catch (error) {
      console.error('❌ Error fetching existing task IDs:', error);
      throw error;
    }
  }

  /**
   * Process tasks batch
   */
  private async processTasksBatch(
    offset: number,
    userMap: Map<number, string>,
    caseMap: Map<number, string>,
    existingIds: Set<number>
  ): Promise<void> {
    const query = `
      SELECT
        id,
        task,
        status,
        date,
        actor_id,
        private,
        instance_id
      FROM dispatch_task
      ORDER BY id
      LIMIT $1 OFFSET $2
    `;

    try {
      const result = await this.sourcePool.query(query, [this.batchSize, offset]);
      const tasks = result.rows;

      if (tasks.length === 0) {
        return; // No more tasks to process
      }

      console.log(`📊 Processing ${tasks.length} tasks (offset: ${offset})`);

      // Filter out existing tasks
      const newTasks = tasks.filter((task: any) => !existingIds.has(task.id));
      console.log(`   → ${newTasks.length} new tasks (${tasks.length - newTasks.length} already exist)`);

      if (newTasks.length === 0) {
        this.stats.totalProcessed += tasks.length;
        this.stats.skipped += tasks.length;
        return;
      }

      // Prepare batch insert
      const taskRecords = newTasks.map((task: any) => {
        const actorId = task.actor_id ? userMap.get(task.actor_id) : null;
        const caseId = null; // dispatch_task doesn't have direct case relationship

        return {
          case_id: caseId,
          actor_id: actorId,
          task: task.text || 'Task',
          task_status: task.checked ? 'completed' : 'pending',
          task_date: task.done_at || new Date(),
          is_private: false,
          legacy_task_id: task.id,
          legacy_actor_id: task.actor_id,
          legacy_instance_id: null, // dispatch_task doesn't have instance_id
          legacy_instruction_id: task.instruction_id,
          legacy_plan_id: task.plan_id,
          metadata: JSON.stringify({
            original_text: task.text,
            original_checked: task.checked,
            original_done_at: task.done_at,
            source_jaw: task.jaw,
            source_template_id: task.template_id,
            source_file_id: task.file_id,
            source_order_id: task.order_id,
            migrated_at: new Date().toISOString()
          })
        };
      });

      // Insert batch
      const insertQuery = `
        INSERT INTO user_tasks (
          case_id, actor_id, task, task_status, task_date, is_private,
          legacy_task_id, legacy_actor_id, legacy_instance_id, legacy_instruction_id,
          legacy_plan_id, metadata, created_at, updated_at
        ) VALUES ${taskRecords.map((_, i) =>
          `($${i * 12 + 1}, $${i * 12 + 2}, $${i * 12 + 3}, $${i * 12 + 4}, $${i * 12 + 5}, $${i * 12 + 6}, $${i * 12 + 7}, $${i * 12 + 8}, $${i * 12 + 9}, $${i * 12 + 10}, $${i * 12 + 11}, $${i * 12 + 12}, NOW(), NOW())`
        ).join(', ')}
      `;

      const values = taskRecords.flatMap(task => [
        task.case_id,
        task.actor_id,
        task.task,
        task.task_status,
        task.task_date,
        task.is_private,
        task.legacy_task_id,
        task.legacy_actor_id,
        task.legacy_instance_id,
        task.legacy_instruction_id,
        task.legacy_plan_id,
        task.metadata
      ]);

      await this.targetPool.query(insertQuery, values);

      this.stats.successful += newTasks.length;
      this.stats.skipped += (tasks.length - newTasks.length);
      this.stats.totalProcessed += tasks.length;

      if (this.stats.totalProcessed % 10000 === 0) {
        console.log(`✅ Processed ${this.stats.totalProcessed} tasks so far...`);
      }

    } catch (error) {
      this.stats.errors++;
      console.error(`❌ Error processing tasks batch at offset ${offset}:`, error);
    }
  }

  /**
   * Main task migration function
   */
  public async migrateUserTasks(): Promise<TaskMigrationStats> {
    console.log('🚀 Starting User Tasks Migration (969K records)...\n');

    try {
      // Create target table
      await this.createUserTasksTable();

      // Get mappings
      const [userMap, caseMap, existingIds] = await Promise.all([
        this.getUserMappings(),
        this.getCaseMappings(),
        this.getExistingTaskIds()
      ]);

      console.log('\n🔄 Starting batch migration...');

      // Process in batches
      let offset = 0;
      let hasMoreRecords = true;

      while (hasMoreRecords) {
        const batchStartTime = Date.now();
        await this.processTasksBatch(offset, userMap, caseMap, existingIds);
        const batchDuration = Date.now() - batchStartTime;

        if (batchDuration > 0) {
          const recordsPerSecond = (this.batchSize / batchDuration * 1000).toFixed(0);
          console.log(`   ⚡ Batch completed in ${batchDuration}ms (${recordsPerSecond} records/sec)`);
        }

        offset += this.batchSize;

        // Check if we've processed enough records (stop after reasonable number for initial test)
        if (offset >= 50000) { // Process 50K tasks as initial test
          console.log(`🔄 Processed first 50,000 tasks for initial validation`);
          hasMoreRecords = false;
        }
      }

      this.stats.endTime = new Date();

      // Final summary
      console.log('\n📋 User Tasks Migration Summary:');
      console.log(`⏱️  Duration: ${this.stats.endTime.getTime() - this.stats.startTime.getTime()}ms`);
      console.log(`📊 Processed: ${this.stats.totalProcessed}`);
      console.log(`✅ Successful: ${this.stats.successful}`);
      console.log(`⏭️  Skipped: ${this.stats.skipped}`);
      console.log(`❌ Errors: ${this.stats.errors}`);

      const successRate = ((this.stats.successful / this.stats.totalProcessed) * 100).toFixed(2);
      console.log(`📈 Success Rate: ${successRate}%`);

      return this.stats;

    } catch (error) {
      console.error('💥 Tasks migration failed:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Validate tasks migration
   */
  public async validateTasksMigration(): Promise<void> {
    console.log('\n🔍 Validating tasks migration...');

    try {
      const taskStats = await this.targetPool.query(`
        SELECT
          COUNT(*) as total_tasks,
          COUNT(DISTINCT actor_id) as unique_actors,
          COUNT(DISTINCT task_status) as unique_statuses,
          MIN(task_date) as earliest_task,
          MAX(task_date) as latest_task
        FROM user_tasks
        WHERE legacy_task_id IS NOT NULL
      `);

      const stats = taskStats.rows[0];
      console.log('📊 Tasks Migration Validation:');
      console.log(`   Total Tasks: ${stats.total_tasks}`);
      console.log(`   Unique Actors: ${stats.unique_actors}`);
      console.log(`   Task Statuses: ${stats.unique_statuses}`);
      console.log(`   Date Range: ${stats.earliest_task} to ${stats.latest_task}`);

      // Task status breakdown
      const statusBreakdown = await this.targetPool.query(`
        SELECT
          task_status,
          COUNT(*) as count
        FROM user_tasks
        WHERE legacy_task_id IS NOT NULL
        GROUP BY task_status
        ORDER BY count DESC
      `);

      console.log('\n📊 Task Status Distribution:');
      statusBreakdown.rows.forEach(row => {
        console.log(`   ${row.task_status}: ${row.count} tasks`);
      });

      // Task type breakdown
      const taskBreakdown = await this.targetPool.query(`
        SELECT
          task,
          COUNT(*) as count
        FROM user_tasks
        WHERE legacy_task_id IS NOT NULL
        GROUP BY task
        ORDER BY count DESC
        LIMIT 10
      `);

      console.log('\n📊 Top Task Types:');
      taskBreakdown.rows.forEach(row => {
        console.log(`   ${row.task}: ${row.count} tasks`);
      });

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

  const tasksMigration = new UserTasksMigration();

  try {
    switch (command) {
      case 'migrate':
        await tasksMigration.migrateUserTasks();
        await tasksMigration.validateTasksMigration();
        break;

      case 'validate':
        await tasksMigration.validateTasksMigration();
        break;

      default:
        console.log('Usage: npx ts-node migrate-user-tasks.ts [migrate|validate]');
        process.exit(1);
    }

    process.exit(0);

  } catch (error) {
    console.error('💥 Operation failed:', error);
    process.exit(1);
  }
}

// Export for use as module
export { UserTasksMigration };

// Run if called directly
if (require.main === module) {
  main();
}