#!/usr/bin/env node

/**
 * Critical Missing Entities Migration
 *
 * Migrates the 8 critical entities that have significant data gaps:
 * - team_communications (904k+ missing)
 * - system_messages (3.8M+ missing)
 * - order_files (potential gaps)
 * - order_states (check for gaps)
 * - case_states (check for gaps)
 * - operations (28 missing)
 * - message_attachments (check for gaps)
 * - case_messages (40k+ missing)
 */

import { Pool } from 'pg';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

interface MigrationEntity {
  name: string;
  sourceTable: string;
  targetTable: string;
  identifierField: string;
  legacyIdField: string;
  priority: number;
}

class CriticalEntitiesMigrator {
  private sourceDb: Pool;
  private targetDb: Pool;
  private supabase: any;

  constructor() {
    this.sourceDb = new Pool({
      host: process.env.SOURCE_DB_HOST!,
      port: parseInt(process.env.SOURCE_DB_PORT!) || 5432,
      database: process.env.SOURCE_DB_NAME!,
      user: process.env.SOURCE_DB_USER!,
      password: process.env.SOURCE_DB_PASSWORD!,
    });

    this.targetDb = new Pool({
      host: process.env.TARGET_DB_HOST!,
      port: parseInt(process.env.TARGET_DB_PORT!) || 5432,
      database: process.env.TARGET_DB_NAME!,
      user: process.env.TARGET_DB_USER || 'postgres',
      password: process.env.TARGET_DB_PASSWORD!,
    });

    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE!
    );
  }

  /**
   * Critical entities with gaps to migrate
   */
  private getCriticalEntities(): MigrationEntity[] {
    return [
      {
        name: 'team_communications',
        sourceTable: 'dispatch_task',
        targetTable: 'team_communications',
        identifierField: 'id',
        legacyIdField: 'legacy_task_id',
        priority: 1
      },
      {
        name: 'system_messages',
        sourceTable: 'dispatch_notification',
        targetTable: 'system_messages',
        identifierField: 'id',
        legacyIdField: 'legacy_notification_id',
        priority: 1
      },
      {
        name: 'case_messages',
        sourceTable: 'dispatch_record',
        targetTable: 'case_messages',
        identifierField: 'id',
        legacyIdField: 'legacy_record_id',
        priority: 2
      },
      {
        name: 'operations',
        sourceTable: 'dispatch_operation',
        targetTable: 'operations',
        identifierField: 'id',
        legacyIdField: 'legacy_operation_id',
        priority: 3
      },
      {
        name: 'message_attachments',
        sourceTable: 'dispatch_record_attachments',
        targetTable: 'message_attachments',
        identifierField: 'id',
        legacyIdField: 'legacy_attachment_id',
        priority: 4
      },
      {
        name: 'order_files',
        sourceTable: 'dispatch_file',
        targetTable: 'order_files',
        identifierField: 'id',
        legacyIdField: 'legacy_file_id',
        priority: 5
      },
      {
        name: 'case_states',
        sourceTable: 'dispatch_state',
        targetTable: 'case_states',
        identifierField: 'id',
        legacyIdField: 'legacy_state_id',
        priority: 6
      },
      {
        name: 'order_states',
        sourceTable: 'dispatch_state',
        targetTable: 'order_states',
        identifierField: 'id',
        legacyIdField: 'legacy_state_id',
        priority: 6
      }
    ];
  }

  /**
   * Execute migration for all critical entities
   */
  async execute(): Promise<void> {
    console.log('🚀 Migrating 8 Critical Missing Entities to Remote Supabase...');

    try {
      await this.testConnections();

      const entities = this.getCriticalEntities();

      for (const entity of entities) {
        await this.migrateEntity(entity);
      }

      await this.generateFinalReport();

      console.log('\n✅ Critical entities migration completed!');

    } catch (error) {
      console.error('❌ Critical entities migration failed:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Test connections
   */
  private async testConnections(): Promise<void> {
    console.log('🔌 Testing connections...');

    try {
      await this.sourceDb.query('SELECT 1');
      console.log('  ✅ Source database connected');

      await this.targetDb.query('SELECT 1');
      console.log('  ✅ Remote Supabase connected');
    } catch (error) {
      console.error('  ❌ Connection failed:', error);
      throw error;
    }
  }

  /**
   * Migrate individual entity
   */
  private async migrateEntity(entity: MigrationEntity): Promise<void> {
    console.log(`\n🔄 Migrating ${entity.name}...`);

    try {
      // Find the appropriate migration script
      const migrationScript = await this.findMigrationScript(entity);

      if (!migrationScript) {
        console.log(`  ⚠️  No migration script found for ${entity.name}`);
        return;
      }

      console.log(`  🚀 Using script: ${migrationScript}`);

      // Execute migration
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const startTime = Date.now();
      const result = await execAsync(`npx ts-node ${migrationScript}`, {
        timeout: 1800000, // 30 minutes
        maxBuffer: 1024 * 1024 * 50 // 50MB buffer for large outputs
      });

      const duration = Date.now() - startTime;
      console.log(`  ✅ ${entity.name} completed in ${(duration/1000).toFixed(2)}s`);

    } catch (error) {
      console.error(`  ❌ ${entity.name} failed:`, (error as Error).message);
    }
  }

  /**
   * Find the appropriate migration script for an entity
   */
  private async findMigrationScript(entity: MigrationEntity): Promise<string | null> {
    const possibleScripts = [
      `migrate-${entity.name.replace('_', '-')}.ts`,
      `src/${entity.name.replace('_', '-')}-migration.ts`,
      `migrate-${entity.name.replace('_', '-')}-complete.ts`,
      `migrate-${entity.name.replace('_', '-')}-fixed.ts`,
      `migrate-${entity.name.replace('_', '-')}-incremental-fixed.ts`,
      `migrate-${entity.name.replace('_', '-')}-updated.ts`
    ];

    for (const script of possibleScripts) {
      try {
        await import('fs').then(fs => fs.promises.access(script));
        return script;
      } catch {
        continue;
      }
    }

    return null;
  }

  /**
   * Generate final migration report
   */
  private async generateFinalReport(): Promise<void> {
    console.log('\n📋 Checking final migration status...');

    const finalCounts = await this.targetDb.query(`
      SELECT
        'FINAL STATUS CHECK' as status,
        (SELECT COUNT(*) FROM team_communications) as team_communications,
        (SELECT COUNT(*) FROM system_messages) as system_messages,
        (SELECT COUNT(*) FROM order_files) as order_files,
        (SELECT COUNT(*) FROM order_states) as order_states,
        (SELECT COUNT(*) FROM case_states) as case_states,
        (SELECT COUNT(*) FROM operations) as operations,
        (SELECT COUNT(*) FROM message_attachments) as message_attachments,
        (SELECT COUNT(*) FROM case_messages) as case_messages
    `);

    const counts = finalCounts.rows[0];

    console.log('\n📊 FINAL ENTITY COUNTS');
    console.log('========================');
    console.log(`✅ team_communications: ${parseInt(counts.team_communications).toLocaleString()}`);
    console.log(`✅ system_messages: ${parseInt(counts.system_messages).toLocaleString()}`);
    console.log(`✅ order_files: ${parseInt(counts.order_files).toLocaleString()}`);
    console.log(`✅ order_states: ${parseInt(counts.order_states).toLocaleString()}`);
    console.log(`✅ case_states: ${parseInt(counts.case_states).toLocaleString()}`);
    console.log(`✅ operations: ${parseInt(counts.operations).toLocaleString()}`);
    console.log(`✅ message_attachments: ${parseInt(counts.message_attachments).toLocaleString()}`);
    console.log(`✅ case_messages: ${parseInt(counts.case_messages).toLocaleString()}`);

    const totalRecords = Object.values(counts)
      .filter((v): v is string => typeof v === 'string' && !isNaN(parseInt(v)))
      .reduce((sum: number, v: string) => sum + parseInt(v), 0);

    console.log(`\n📈 Total Records in 8 Critical Entities: ${totalRecords.toLocaleString()}`);
  }

  /**
   * Cleanup resources
   */
  private async cleanup(): Promise<void> {
    await this.sourceDb.end();
    await this.targetDb.end();
  }
}

// Main execution
if (require.main === module) {
  const migrator = new CriticalEntitiesMigrator();

  migrator.execute()
    .then(() => {
      console.log('\n🎉 Critical entities migration completed successfully!');
      console.log('\n📋 Next Steps:');
      console.log('  1. Review migration logs for any errors');
      console.log('  2. Validate data integrity for the 8 entities');
      console.log('  3. Run comprehensive system validation');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Critical entities migration failed:', error);
      process.exit(1);
    });
}

export { CriticalEntitiesMigrator };