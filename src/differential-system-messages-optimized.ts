/**
 * Optimized Differential System Messages Migration Service
 * Memory-efficient approach using database-side filtering instead of IN-memory arrays
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

interface MigrationStats {
  totalProcessed: number;
  successfulMigrations: number;
  errors: number;
  skipped: number;
  invalidJsonSkipped: number;
  startTime: Date;
  endTime?: Date;
}

class OptimizedDifferentialSystemMessagesMigrationService {
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
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    this.targetPool = new Pool({
      host: targetConfig.host,
      port: targetConfig.port,
      database: targetConfig.database,
      user: targetConfig.username,
      password: targetConfig.password,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    this.stats = {
      totalProcessed: 0,
      successfulMigrations: 0,
      errors: 0,
      skipped: 0,
      invalidJsonSkipped: 0,
      startTime: new Date()
    };
  }

  /**
   * Get count of new notifications using efficient approach
   */
  private async getNewNotificationCount(): Promise<number> {
    console.log('📊 Checking for new notifications...');

    // Use a more memory-efficient approach with MAX(legacy_record_id)
    const maxMigratedIdQuery = 'SELECT COALESCE(MAX(legacy_record_id), 0) as max_id FROM system_messages WHERE legacy_record_id IS NOT NULL';
    const maxMigratedResult = await this.targetPool.query(maxMigratedIdQuery);
    const maxMigratedId = maxMigratedResult.rows[0].max_id;

    console.log(`✓ Latest migrated notification ID: ${maxMigratedId}`);

    // Check for new notifications beyond the max migrated ID
    const newCountQuery = `
      SELECT COUNT(*) as new_count
      FROM dispatch_notification
      WHERE id > $1
        AND send = true
        AND template_context IS NOT NULL
        AND template_context != ''
        AND recipient_id IS NOT NULL
    `;

    const newCountResult = await this.sourcePool.query(newCountQuery, [maxMigratedId]);
    const newCount = parseInt(newCountResult.rows[0].new_count);

    console.log(`✓ Found ${newCount.toLocaleString()} new notifications to process`);
    return newCount;
  }

  /**
   * Process notifications in batches starting from the last migrated ID
   */
  private async processNotificationsBatched(): Promise<void> {
    console.log('📨 Starting batched notification processing...');

    // Get the max migrated ID as starting point
    const maxMigratedIdQuery = 'SELECT COALESCE(MAX(legacy_record_id), 0) as max_id FROM system_messages WHERE legacy_record_id IS NOT NULL';
    const maxMigratedResult = await this.targetPool.query(maxMigratedIdQuery);
    let currentId = maxMigratedResult.rows[0].max_id;

    console.log(`🚀 Starting from notification ID: ${currentId + 1}`);

    const batchSize = 1000;
    let batchNumber = 1;
    let hasMoreData = true;

    while (hasMoreData) {
      const batchQuery = `
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
        WHERE dn.id > $1
          AND dn.send = true
          AND dn.template_context IS NOT NULL
          AND dn.template_context != ''
          AND dn.recipient_id IS NOT NULL
        ORDER BY dn.id ASC
        LIMIT $2
      `;

      try {
        const batchResult = await this.sourcePool.query(batchQuery, [currentId, batchSize]);
        const notifications = batchResult.rows;

        if (notifications.length === 0) {
          hasMoreData = false;
          break;
        }

        console.log(`📦 Processing batch ${batchNumber} (${notifications.length} notifications, IDs ${notifications[0].id} - ${notifications[notifications.length - 1].id})`);

        // Process each notification in the batch
        for (const notification of notifications) {
          await this.processNotification(notification);
          this.stats.totalProcessed++;

          if (this.stats.totalProcessed % 1000 === 0) {
            console.log(`✅ Processed ${this.stats.totalProcessed.toLocaleString()} notifications so far...`);
          }
        }

        // Update currentId to the last processed ID
        currentId = notifications[notifications.length - 1].id;
        batchNumber++;

        // Small delay to prevent overwhelming the database
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`❌ Error processing batch starting at ID ${currentId}:`, error);
        this.stats.errors++;
        break;
      }
    }
  }

  /**
   * Process individual notification
   */
  private async processNotification(notification: any): Promise<void> {
    try {
      // Parse and validate template context
      let templateContext;
      try {
        templateContext = JSON.parse(notification.template_context);
      } catch (error) {
        console.warn(`⚠️  Skipping notification ${notification.id}: Invalid JSON in template_context`);
        this.stats.invalidJsonSkipped++;
        return;
      }

      // Determine message type
      const messageType = this.determineMessageType(notification.template_name);

      // Build message content
      const messageContent = this.buildMessageContent(notification, templateContext);

      // Get order mapping if available (simplified approach)
      const orderUuid = await this.getOrderMapping(notification.item_id, notification.item_type_id);

      // Insert system message into target
      const insertQuery = `
        INSERT INTO system_messages (
          message_type,
          order_id,
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
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
        )
      `;

      const values = [
        messageType,                                         // message_type
        orderUuid,                                           // order_id
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

    } catch (error) {
      if (error instanceof Error && error.message && error.message.includes('duplicate key')) {
        // Skip duplicates silently - they're already migrated
        this.stats.skipped++;
      } else {
        console.error(`❌ Error migrating notification ${notification.id}:`, error instanceof Error ? error.message : 'Unknown error');
        this.stats.errors++;
      }
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
   * Build comprehensive message content from template and context
   */
  private buildMessageContent(notification: any, context: any): string {
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
   * Extract order UUID from item relationships if available (simplified)
   */
  private async getOrderMapping(itemId: number | null, itemTypeId: number | null): Promise<string | null> {
    if (!itemId || !itemTypeId) return null;

    try {
      // Simplified approach - only try common order-related types
      if (itemTypeId >= 6 && itemTypeId <= 15) {
        const orderQuery = `
          SELECT id
          FROM orders
          WHERE legacy_instruction_id = $1
          LIMIT 1
        `;

        const orderResult = await this.targetPool.query(orderQuery, [itemId]);
        return orderResult.rows.length > 0 ? orderResult.rows[0].id : null;
      }

      return null;
    } catch (error) {
      // Silently skip order mapping errors to keep migration running
      return null;
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

      console.log(`✓ Target database now has ${targetCount.toLocaleString()} total system messages`);
      console.log(`✓ ${legacyCount.toLocaleString()} system messages have legacy notification ID mappings`);

      // Get max migrated ID
      const maxMigratedResult = await this.targetPool.query('SELECT MAX(legacy_record_id) as max_id FROM system_messages WHERE legacy_record_id IS NOT NULL');
      const maxMigrated = maxMigratedResult.rows[0].max_id;

      console.log(`✓ Latest migrated notification ID: ${maxMigrated}`);

      // Message type breakdown (top 10)
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
    console.log('🚀 Starting optimized differential system messages migration...');
    console.log('📋 This migration uses memory-efficient batched processing:');
    console.log('   1. Process notifications in sequential ID-based batches');
    console.log('   2. Apply validation filtering for "valid subset" of messages');
    console.log('   3. Parse and validate template_context JSON data');
    console.log('   4. Map notifications to appropriate system message types');
    console.log('   5. Skip duplicates and handle errors gracefully');
    console.log('   6. Validate results and generate comprehensive report');

    try {
      // Step 1: Check new notification count
      const newCount = await this.getNewNotificationCount();

      if (newCount === 0) {
        console.log('✅ No new notification records to migrate');
        return;
      }

      console.log(`🎯 Target: ${newCount.toLocaleString()} potential notifications to process`);

      // Step 2: Process notifications in batches
      await this.processNotificationsBatched();

      // Step 3: Validate migration
      await this.validateMigration();

      this.stats.endTime = new Date();

      // Print final statistics
      console.log('\n🎉 Optimized differential system messages migration completed!');
      console.log('===============================================================');
      console.log(`📊 Migration Statistics:`);
      console.log(`   • Total notifications processed: ${this.stats.totalProcessed.toLocaleString()}`);
      console.log(`   • Successfully migrated: ${this.stats.successfulMigrations.toLocaleString()}`);
      console.log(`   • Skipped (duplicates): ${this.stats.skipped.toLocaleString()}`);
      console.log(`   • Invalid JSON skipped: ${this.stats.invalidJsonSkipped.toLocaleString()}`);
      console.log(`   • Errors encountered: ${this.stats.errors.toLocaleString()}`);
      console.log(`   • Success rate: ${this.stats.totalProcessed > 0 ? ((this.stats.successfulMigrations / this.stats.totalProcessed) * 100).toFixed(2) : 0}%`);
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

  const migrationService = new OptimizedDifferentialSystemMessagesMigrationService(sourceConfig, targetConfig);

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

export { OptimizedDifferentialSystemMessagesMigrationService };