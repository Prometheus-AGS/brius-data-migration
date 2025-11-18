import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

interface ActionRecord {
  sourceActionId: number;
  action: string;
  actionDate: Date;
  itemId: number | null;
  data: string;
  ownerId: number | null;
  itemType: string | null;
  ownerType: string | null;
  userId: number | null;
  targetUserId: string | null;
}

interface ActionMigrationStats {
  totalProcessed: number;
  successful: number;
  skipped: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
}

class UserActionsMigration {
  private sourcePool: Pool;
  private targetPool: Pool;
  private stats: ActionMigrationStats;
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
   * Create user_actions table in target database
   */
  private async createUserActionsTable(): Promise<void> {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS user_actions (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        user_id UUID REFERENCES profiles(id),
        action VARCHAR(50) NOT NULL,
        action_date TIMESTAMP WITH TIME ZONE NOT NULL,
        item_id INTEGER,
        item_type VARCHAR(100),
        owner_id INTEGER,
        owner_type VARCHAR(100),
        action_data TEXT,
        legacy_action_id INTEGER UNIQUE,
        legacy_user_id INTEGER,
        metadata JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Create indexes for performance
      CREATE INDEX IF NOT EXISTS idx_user_actions_user_id ON user_actions(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_actions_action_date ON user_actions(action_date);
      CREATE INDEX IF NOT EXISTS idx_user_actions_action ON user_actions(action);
      CREATE INDEX IF NOT EXISTS idx_user_actions_legacy_action_id ON user_actions(legacy_action_id);
      CREATE INDEX IF NOT EXISTS idx_user_actions_legacy_user_id ON user_actions(legacy_user_id);
    `;

    try {
      await this.targetPool.query(createTableQuery);
      console.log('✅ user_actions table created successfully');
    } catch (error) {
      console.error('❌ Error creating user_actions table:', error);
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
   * Get Django content type mappings
   */
  private async getContentTypeMappings(): Promise<Map<number, string>> {
    const query = `
      SELECT id, model
      FROM django_content_type
    `;

    try {
      const result = await this.sourcePool.query(query);
      const typeMap = new Map<number, string>();

      result.rows.forEach(row => {
        typeMap.set(row.id, row.model);
      });

      console.log(`✓ Found ${typeMap.size} content type mappings`);
      return typeMap;
    } catch (error) {
      console.error('❌ Error fetching content type mappings:', error);
      throw error;
    }
  }

  /**
   * Process actions batch
   */
  private async processActionsBatch(offset: number, userMap: Map<number, string>, typeMap: Map<number, string>): Promise<void> {
    const query = `
      SELECT
        id,
        action,
        date,
        item_id,
        data,
        owner_id,
        item_type_id,
        owner_type_id,
        user_id
      FROM dispatch_action
      ORDER BY id
      LIMIT $1 OFFSET $2
    `;

    try {
      const result = await this.sourcePool.query(query, [this.batchSize, offset]);
      const actions = result.rows;

      if (actions.length === 0) {
        return; // No more actions to process
      }

      console.log(`📊 Processing ${actions.length} actions (offset: ${offset})`);

      // Prepare batch insert
      const actionRecords = actions.map((action: any) => {
        const targetUserId = action.user_id ? userMap.get(action.user_id) : null;
        const itemType = action.item_type_id ? typeMap.get(action.item_type_id) : null;
        const ownerType = action.owner_type_id ? typeMap.get(action.owner_type_id) : null;

        return {
          user_id: targetUserId,
          action: action.action,
          action_date: action.date,
          item_id: action.item_id,
          item_type: itemType,
          owner_id: action.owner_id,
          owner_type: ownerType,
          action_data: action.data,
          legacy_action_id: action.id,
          legacy_user_id: action.user_id,
          metadata: JSON.stringify({
            original_item_type_id: action.item_type_id,
            original_owner_type_id: action.owner_type_id,
            migrated_at: new Date().toISOString()
          })
        };
      });

      // Insert batch
      const insertQuery = `
        INSERT INTO user_actions (
          user_id, action, action_date, item_id, item_type, owner_id, owner_type,
          action_data, legacy_action_id, legacy_user_id, metadata, created_at, updated_at
        ) VALUES ${actionRecords.map((_, i) =>
          `($${i * 11 + 1}, $${i * 11 + 2}, $${i * 11 + 3}, $${i * 11 + 4}, $${i * 11 + 5}, $${i * 11 + 6}, $${i * 11 + 7}, $${i * 11 + 8}, $${i * 11 + 9}, $${i * 11 + 10}, $${i * 11 + 11}, NOW(), NOW())`
        ).join(', ')}
        ON CONFLICT (legacy_action_id) DO NOTHING
      `;

      const values = actionRecords.flatMap(action => [
        action.user_id,
        action.action,
        action.action_date,
        action.item_id,
        action.item_type,
        action.owner_id,
        action.owner_type,
        action.action_data,
        action.legacy_action_id,
        action.legacy_user_id,
        action.metadata
      ]);

      await this.targetPool.query(insertQuery, values);

      this.stats.successful += actions.length;
      this.stats.totalProcessed += actions.length;

      if (this.stats.totalProcessed % 10000 === 0) {
        console.log(`✅ Migrated ${this.stats.totalProcessed} actions so far...`);
      }

    } catch (error) {
      this.stats.errors++;
      console.error(`❌ Error processing actions batch at offset ${offset}:`, error);
    }
  }

  /**
   * Main action migration function
   */
  public async migrateUserActions(): Promise<ActionMigrationStats> {
    console.log('🚀 Starting User Actions Migration (3.13M records)...\n');

    try {
      // Create target table
      await this.createUserActionsTable();

      // Get mappings
      const [userMap, typeMap] = await Promise.all([
        this.getUserMappings(),
        this.getContentTypeMappings()
      ]);

      console.log('\n🔄 Starting batch migration...');

      // Process in batches
      let offset = 0;
      let hasMoreRecords = true;

      while (hasMoreRecords) {
        const batchStartTime = Date.now();
        await this.processActionsBatch(offset, userMap, typeMap);
        const batchDuration = Date.now() - batchStartTime;

        if (batchDuration > 0) {
          const recordsPerSecond = (this.batchSize / batchDuration * 1000).toFixed(0);
          console.log(`   ⚡ Batch completed in ${batchDuration}ms (${recordsPerSecond} records/sec)`);
        }

        offset += this.batchSize;

        // Check if we've processed enough records (stop after reasonable number for initial test)
        if (offset >= 50000) { // Process 50K actions as initial test
          console.log(`🔄 Processed first 50,000 actions for initial validation`);
          hasMoreRecords = false;
        }
      }

      this.stats.endTime = new Date();

      // Final summary
      console.log('\n📋 User Actions Migration Summary:');
      console.log(`⏱️  Duration: ${this.stats.endTime.getTime() - this.stats.startTime.getTime()}ms`);
      console.log(`📊 Processed: ${this.stats.totalProcessed}`);
      console.log(`✅ Successful: ${this.stats.successful}`);
      console.log(`⏭️  Skipped: ${this.stats.skipped}`);
      console.log(`❌ Errors: ${this.stats.errors}`);

      const successRate = ((this.stats.successful / this.stats.totalProcessed) * 100).toFixed(2);
      console.log(`📈 Success Rate: ${successRate}%`);

      return this.stats;

    } catch (error) {
      console.error('💥 Actions migration failed:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Validate actions migration
   */
  public async validateActionsMigration(): Promise<void> {
    console.log('\n🔍 Validating actions migration...');

    try {
      const actionStats = await this.targetPool.query(`
        SELECT
          COUNT(*) as total_actions,
          COUNT(DISTINCT user_id) as unique_users,
          COUNT(DISTINCT action) as unique_action_types,
          MIN(action_date) as earliest_action,
          MAX(action_date) as latest_action
        FROM user_actions
        WHERE legacy_action_id IS NOT NULL
      `);

      const stats = actionStats.rows[0];
      console.log('📊 Actions Migration Validation:');
      console.log(`   Total Actions: ${stats.total_actions}`);
      console.log(`   Unique Users: ${stats.unique_users}`);
      console.log(`   Action Types: ${stats.unique_action_types}`);
      console.log(`   Date Range: ${stats.earliest_action} to ${stats.latest_action}`);

      // Action type breakdown
      const actionBreakdown = await this.targetPool.query(`
        SELECT
          action,
          COUNT(*) as count
        FROM user_actions
        WHERE legacy_action_id IS NOT NULL
        GROUP BY action
        ORDER BY count DESC
      `);

      console.log('\n📊 Action Type Distribution:');
      actionBreakdown.rows.forEach(row => {
        console.log(`   ${row.action}: ${row.count} actions`);
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

  const actionsMigration = new UserActionsMigration();

  try {
    switch (command) {
      case 'migrate':
        await actionsMigration.migrateUserActions();
        await actionsMigration.validateActionsMigration();
        break;

      case 'validate':
        await actionsMigration.validateActionsMigration();
        break;

      default:
        console.log('Usage: npx ts-node migrate-user-actions.ts [migrate|validate]');
        process.exit(1);
    }

    process.exit(0);

  } catch (error) {
    console.error('💥 Operation failed:', error);
    process.exit(1);
  }
}

// Export for use as module
export { UserActionsMigration };

// Run if called directly
if (require.main === module) {
  main();
}