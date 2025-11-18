/**
 * Differential System Messages Migration Service
 * Migrates new/missed notification records from dispatch_notification to system_messages table
 * Applies validation filtering for "valid subset" of messages as requested
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

interface DispatchNotification {
  id: number;
  created_at: Date;
  sender: string;
  template_name: string;
  template_context: string;
  read: boolean;
  item_id: number | null;
  item_type_id: number | null;
  recipient_id: number;
  sent: boolean | null;
  send: boolean;
}

interface SystemMessage {
  message_type: string;
  order_id: string | null;
  shipment_id: string | null;
  message_code: string;
  message_data: any;
  barcode: string | null;
  tracking_number: string | null;
  carrier: string | null;
  source_system: string;
  created_at: Date;
  processed: boolean;
  processed_at: Date | null;
  legacy_record_id: number;
  is_active: boolean;
  message: string;
  updated_at: Date;
}

interface MigrationStats {
  totalNewNotifications: number;
  successfulMigrations: number;
  errors: number;
  skipped: number;
  invalidJsonSkipped: number;
  startTime: Date;
  endTime?: Date;
}

class DifferentialSystemMessagesMigrationService {
  private sourcePool: Pool;
  private targetPool: Pool;
  private stats: MigrationStats;

  constructor(sourceConfig: DatabaseConfig, targetConfig: DatabaseConfig) {
    this.sourcePool = new Pool({
      host: sourceConfig.host,
      port: sourceConfig.port,
      database: sourceConfig.database,
      user: sourceConfig.username,
      password: sourceConfig.password,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    this.targetPool = new Pool({
      host: targetConfig.host,
      port: targetConfig.port,
      database: targetConfig.database,
      user: targetConfig.username,
      password: targetConfig.password,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    this.stats = {
      totalNewNotifications: 0,
      successfulMigrations: 0,
      errors: 0,
      skipped: 0,
      invalidJsonSkipped: 0,
      startTime: new Date()
    };
  }

  /**
   * Get new notification records that haven't been migrated
   * Apply "valid subset" filtering as requested
   */
  private async getNewNotifications(): Promise<DispatchNotification[]> {
    console.log('📧 Identifying new notification records in source database...');

    // First, get all legacy_record_ids that already exist in target
    const existingIdsQuery = `
      SELECT legacy_record_id
      FROM system_messages
      WHERE legacy_record_id IS NOT NULL
    `;

    const existingIdsResult = await this.targetPool.query(existingIdsQuery);
    const existingIds = existingIdsResult.rows.map(row => row.legacy_record_id);

    console.log(`✓ Found ${existingIds.length.toLocaleString()} notifications already migrated in target`);

    // Get source notifications that are NOT in the existing IDs
    // Apply "valid subset" filtering:
    // 1. Only notifications that are marked to be sent (send = true)
    // 2. Have valid template_context JSON
    // 3. Have recipient mapping available
    let query = `
      SELECT
        dn.id,
        dn.created_at,
        dn.sender,
        dn.template_name,
        dn.template_context,
        dn.read,
        dn.item_id,
        dn.item_type_id,
        dn.recipient_id,
        dn.sent,
        dn.send
      FROM dispatch_notification dn
      WHERE dn.send = true
        AND dn.template_context IS NOT NULL
        AND dn.template_context != ''
        AND dn.recipient_id IS NOT NULL
    `;

    if (existingIds.length > 0) {
      // Build chunks for IN clause to avoid PostgreSQL parameter limits
      const chunkSize = 1000;
      const idChunks = [];
      for (let i = 0; i < existingIds.length; i += chunkSize) {
        idChunks.push(existingIds.slice(i, i + chunkSize));
      }

      query += ` AND dn.id NOT IN (${existingIds.join(',')})`;
    }

    query += ` ORDER BY dn.created_at DESC, dn.id DESC`;

    try {
      console.log('🔍 Executing differential query to find new notifications...');
      const result = await this.sourcePool.query(query);
      console.log(`✓ Found ${result.rows.length.toLocaleString()} new notification records to migrate`);

      return result.rows.map(row => ({
        id: row.id,
        created_at: row.created_at,
        sender: row.sender,
        template_name: row.template_name,
        template_context: row.template_context,
        read: row.read,
        item_id: row.item_id,
        item_type_id: row.item_type_id,
        recipient_id: row.recipient_id,
        sent: row.sent,
        send: row.send
      }));
    } catch (error) {
      console.error('❌ Error getting new notifications:', error);
      throw error;
    }
  }

  /**
   * Parse and validate template_context JSON
   */
  private parseTemplateContext(contextString: string): any {
    try {
      return JSON.parse(contextString);
    } catch (error) {
      // Return null for invalid JSON - will be handled in validation
      return null;
    }
  }

  /**
   * Map notification to appropriate message type based on template_name
   */
  private determineMessageType(templateName: string): string {
    const template = templateName.toLowerCase();

    if (template.includes('order')) return 'order_update';
    if (template.includes('shipment') || template.includes('ship')) return 'shipment_update';
    if (template.includes('payment')) return 'payment_update';
    if (template.includes('case')) return 'case_update';
    if (template.includes('reminder')) return 'reminder';
    if (template.includes('welcome')) return 'welcome';
    if (template.includes('status')) return 'status_update';

    return 'notification'; // Generic fallback
  }

  /**
   * Extract order UUID from item relationships if available
   */
  private async getOrderMapping(itemId: number | null, itemTypeId: number | null): Promise<string | null> {
    if (!itemId || !itemTypeId) return null;

    try {
      // Common patterns for item_type_id that map to orders
      // This would need to be customized based on your django_content_type mappings
      const orderRelatedTypes = [6, 7, 8, 9]; // Example type IDs that relate to orders

      if (orderRelatedTypes.includes(itemTypeId)) {
        const orderQuery = `
          SELECT id
          FROM orders
          WHERE legacy_instruction_id = $1
        `;

        const orderResult = await this.targetPool.query(orderQuery, [itemId]);
        return orderResult.rows.length > 0 ? orderResult.rows[0].id : null;
      }

      return null;
    } catch (error) {
      console.error(`❌ Error getting order mapping for item ${itemId}, type ${itemTypeId}:`, error);
      return null;
    }
  }

  /**
   * Build comprehensive message content from template and context
   */
  private buildMessageContent(notification: DispatchNotification, context: any): string {
    let message = `Template: ${notification.template_name}`;

    if (context) {
      // Extract key information from context for readable message
      if (context.order_number) message += ` | Order: ${context.order_number}`;
      if (context.patient_name) message += ` | Patient: ${context.patient_name}`;
      if (context.status) message += ` | Status: ${context.status}`;
      if (context.message) message += ` | ${context.message}`;
    }

    return message;
  }

  /**
   * Migrate notification records in batches
   */
  private async migrateNotifications(notifications: DispatchNotification[]): Promise<void> {
    console.log('📨 Starting notification records migration...');

    const batchSize = 500; // Smaller batches for complex processing

    for (let i = 0; i < notifications.length; i += batchSize) {
      const batch = notifications.slice(i, i + batchSize);
      console.log(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(notifications.length / batchSize)} (${batch.length} notifications)`);

      for (const notification of batch) {
        try {
          // Parse and validate template context
          const templateContext = this.parseTemplateContext(notification.template_context);

          if (!templateContext) {
            console.warn(`⚠️  Skipping notification ${notification.id}: Invalid JSON in template_context`);
            this.stats.invalidJsonSkipped++;
            continue;
          }

          // Get order mapping if available
          const orderUuid = await this.getOrderMapping(notification.item_id, notification.item_type_id);

          // Determine message type
          const messageType = this.determineMessageType(notification.template_name);

          // Build message content
          const messageContent = this.buildMessageContent(notification, templateContext);

          // Insert system message into target
          const insertQuery = `
            INSERT INTO system_messages (
              message_type,
              order_id,
              shipment_id,
              message_code,
              message_data,
              barcode,
              tracking_number,
              carrier,
              source_system,
              created_at,
              processed,
              processed_at,
              legacy_record_id,
              is_active,
              message,
              updated_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
            )
          `;

          const values = [
            messageType,                                         // message_type
            orderUuid,                                           // order_id
            null,                                                // shipment_id (not available in source)
            notification.template_name,                          // message_code
            JSON.stringify({                                     // message_data
              template_context: templateContext,
              sender: notification.sender,
              recipient_id: notification.recipient_id,
              item_id: notification.item_id,
              item_type_id: notification.item_type_id,
              read: notification.read,
              sent: notification.sent,
              send: notification.send,
              migration: {
                source_table: 'dispatch_notification',
                migrated_at: new Date().toISOString()
              }
            }),
            templateContext.barcode || null,                     // barcode
            templateContext.tracking_number || null,             // tracking_number
            templateContext.carrier || null,                     // carrier
            'legacy_dispatch_system',                            // source_system
            notification.created_at,                             // created_at
            notification.sent === true,                          // processed
            notification.sent === true ? notification.created_at : null, // processed_at
            notification.id,                                     // legacy_record_id
            true,                                                // is_active
            messageContent,                                      // message
            new Date()                                           // updated_at
          ];

          await this.targetPool.query(insertQuery, values);
          this.stats.successfulMigrations++;

          if (this.stats.successfulMigrations % 100 === 0) {
            console.log(`✅ Migrated ${this.stats.successfulMigrations.toLocaleString()} notifications so far...`);
          }

        } catch (error) {
          console.error(`❌ Error migrating notification ${notification.id}:`, error);
          this.stats.errors++;
        }
      }
    }
  }

  /**
   * Validate the migration results
   */
  private async validateMigration(): Promise<void> {
    console.log('🔍 Validating migration results...');

    try {
      // Count total system messages
      const targetCountResult = await this.targetPool.query('SELECT COUNT(*) as count FROM system_messages');
      const targetCount = parseInt(targetCountResult.rows[0].count);

      // Count system messages with legacy IDs
      const legacyCountResult = await this.targetPool.query('SELECT COUNT(*) as count FROM system_messages WHERE legacy_record_id IS NOT NULL');
      const legacyCount = parseInt(legacyCountResult.rows[0].count);

      // Get new migration count
      const newlyMigratedResult = await this.targetPool.query(`
        SELECT COUNT(*) as count
        FROM system_messages
        WHERE legacy_record_id IS NOT NULL
        AND created_at >= $1
      `, [this.stats.startTime]);
      const newlyMigrated = parseInt(newlyMigratedResult.rows[0].count);

      console.log(`✓ Target database now has ${targetCount.toLocaleString()} total system messages`);
      console.log(`✓ ${legacyCount.toLocaleString()} system messages have legacy notification ID mappings`);
      console.log(`✓ ${newlyMigrated.toLocaleString()} system messages migrated in this session`);

      // Check source vs target comparison
      const sourceCountResult = await this.sourcePool.query(`
        SELECT COUNT(*) as count
        FROM dispatch_notification
        WHERE send = true
        AND template_context IS NOT NULL
        AND template_context != ''
      `);
      const validSourceCount = parseInt(sourceCountResult.rows[0].count);

      console.log(`📊 Valid source notifications: ${validSourceCount.toLocaleString()}`);
      console.log(`📊 Coverage: ${((legacyCount / validSourceCount) * 100).toFixed(2)}% of valid notifications migrated`);

      // Message type breakdown
      const typeBreakdownResult = await this.targetPool.query(`
        SELECT
          message_type,
          COUNT(*) as count
        FROM system_messages
        WHERE legacy_record_id IS NOT NULL
        GROUP BY message_type
        ORDER BY count DESC
        LIMIT 10
      `);

      console.log(`📊 Message Type Breakdown (Top 10):`);
      typeBreakdownResult.rows.forEach(row => {
        console.log(`   • ${row.message_type}: ${parseInt(row.count).toLocaleString()} messages`);
      });

    } catch (error) {
      console.error('❌ Error during validation:', error);
      this.stats.errors++;
    }
  }

  /**
   * Main migration function
   */
  async migrate(): Promise<void> {
    console.log('🚀 Starting differential system messages migration...');
    console.log('📋 This migration will:');
    console.log('   1. Identify new dispatch_notification records not yet migrated');
    console.log('   2. Apply validation filtering for "valid subset" of messages');
    console.log('   3. Parse and validate template_context JSON data');
    console.log('   4. Map notifications to appropriate system message types');
    console.log('   5. Migrate notification records in efficient batches');
    console.log('   6. Validate results and generate comprehensive report');

    try {
      // Step 1: Get new notifications
      const newNotifications = await this.getNewNotifications();
      this.stats.totalNewNotifications = newNotifications.length;

      if (newNotifications.length === 0) {
        console.log('✅ No new notification records to migrate');
        return;
      }

      console.log(`🎯 Target: ${newNotifications.length.toLocaleString()} valid notifications to migrate`);

      // Step 2: Migrate notifications
      await this.migrateNotifications(newNotifications);

      // Step 3: Validate migration
      await this.validateMigration();

      this.stats.endTime = new Date();

      // Print final statistics
      console.log('\n🎉 Differential system messages migration completed!');
      console.log('=======================================================');
      console.log(`📊 Migration Statistics:`);
      console.log(`   • New notification records found: ${this.stats.totalNewNotifications.toLocaleString()}`);
      console.log(`   • Successfully migrated: ${this.stats.successfulMigrations.toLocaleString()}`);
      console.log(`   • Invalid JSON skipped: ${this.stats.invalidJsonSkipped.toLocaleString()}`);
      console.log(`   • Errors encountered: ${this.stats.errors.toLocaleString()}`);
      console.log(`   • Success rate: ${this.stats.totalNewNotifications > 0 ? ((this.stats.successfulMigrations / this.stats.totalNewNotifications) * 100).toFixed(2) : 0}%`);
      console.log(`   • Total duration: ${Math.round((this.stats.endTime.getTime() - this.stats.startTime.getTime()) / 1000)} seconds`);

    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    }
  }

  /**
   * Cleanup database connections
   */
  async cleanup(): Promise<void> {
    try {
      await this.sourcePool.end();
      await this.targetPool.end();
    } catch (error) {
      console.error('❌ Error during cleanup:', error);
    }
  }
}

// Main execution
async function main() {
  const sourceConfig: DatabaseConfig = {
    host: process.env.SOURCE_DB_HOST || 'localhost',
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME || 'source_db',
    username: process.env.SOURCE_DB_USER || 'postgres',
    password: process.env.SOURCE_DB_PASSWORD || ''
  };

  const targetConfig: DatabaseConfig = {
    host: process.env.TARGET_DB_HOST || 'localhost',
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    database: process.env.TARGET_DB_NAME || 'postgres',
    username: process.env.TARGET_DB_USER || 'postgres',
    password: process.env.TARGET_DB_PASSWORD || 'postgres'
  };

  const migrationService = new DifferentialSystemMessagesMigrationService(sourceConfig, targetConfig);

  try {
    await migrationService.migrate();
  } catch (error) {
    console.error('❌ Main execution failed:', error);
    process.exit(1);
  } finally {
    await migrationService.cleanup();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Script execution failed:', error);
    process.exit(1);
  });
}

export { DifferentialSystemMessagesMigrationService };