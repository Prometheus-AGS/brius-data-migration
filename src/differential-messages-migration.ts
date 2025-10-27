/**
 * Differential Messages Migration Service
 * Migrates new messages from dispatch_record to messages table
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

interface DispatchRecord {
  id: number;
  target_id: number;
  type: number;
  created_at: Date;
  text: string;
  author_id: number | null;
  target_type_id: number | null;
  group_id: number | null;
  public: boolean | null;
}

interface MigrationStats {
  totalNewMessages: number;
  successfulMigrations: number;
  errors: number;
  skipped: number;
  startTime: Date;
  endTime?: Date;
}

class DifferentialMessagesMigrationService {
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
      totalNewMessages: 0,
      successfulMigrations: 0,
      errors: 0,
      skipped: 0,
      startTime: new Date()
    };
  }

  /**
   * Get new messages from dispatch_record that haven't been migrated
   */
  private async getNewMessages(): Promise<DispatchRecord[]> {
    console.log('🔍 Identifying new messages in source database...');

    // First, get all legacy_record_ids that already exist in target
    const existingIdsQuery = `
      SELECT legacy_record_id
      FROM messages
      WHERE legacy_record_id IS NOT NULL
    `;

    const existingIdsResult = await this.targetPool.query(existingIdsQuery);
    const existingIds = existingIdsResult.rows.map(row => row.legacy_record_id);

    console.log(`✓ Found ${existingIds.length} messages already migrated in target`);

    // Now get source messages that are NOT in the existing IDs
    let query = `
      SELECT
        dr.id,
        dr.target_id,
        dr.type,
        dr.created_at,
        dr.text,
        dr.author_id,
        dr.target_type_id,
        dr.group_id,
        dr.public
      FROM dispatch_record dr
    `;

    if (existingIds.length > 0) {
      query += ` WHERE dr.id NOT IN (${existingIds.join(',')})`;
    }

    query += ` ORDER BY dr.created_at DESC`;

    try {
      const result = await this.sourcePool.query(query);
      console.log(`✓ Found ${result.rows.length} new messages to migrate`);

      return result.rows.map(row => ({
        id: row.id,
        target_id: row.target_id,
        type: row.type,
        created_at: row.created_at,
        text: row.text,
        author_id: row.author_id,
        target_type_id: row.target_type_id,
        group_id: row.group_id,
        public: row.public
      }));
    } catch (error) {
      console.error('❌ Error getting new messages:', error);
      throw error;
    }
  }

  /**
   * Get sender profile UUID from author_id
   */
  private async getSenderMapping(authorId: number | null): Promise<string | null> {
    if (!authorId) return null;

    try {
      // Map author_id (from auth_user) to profile UUID
      const profileQuery = `
        SELECT id
        FROM profiles
        WHERE legacy_user_id = $1
      `;

      const profileResult = await this.targetPool.query(profileQuery, [authorId]);
      return profileResult.rows.length > 0 ? profileResult.rows[0].id : null;
    } catch (error) {
      console.error(`❌ Error getting sender mapping for author ${authorId}:`, error);
      return null;
    }
  }

  /**
   * Map message type from integer to string
   */
  private mapMessageType(type: number | null): string {
    // Based on common message types - may need adjustment
    const typeMap: { [key: number]: string } = {
      1: 'notification',
      2: 'update',
      3: 'comment',
      4: 'system',
      5: 'alert'
    };

    return typeMap[type || 1] || 'notification';
  }

  /**
   * Determine recipient type and ID based on target_type_id and target_id
   */
  private async getRecipientInfo(targetTypeId: number | null, targetId: number): Promise<{
    recipientType: string;
    recipientId: string | null;
  }> {
    // Default values
    let recipientType = 'system';
    let recipientId: string | null = null;

    try {
      // Based on common target types - this may need refinement
      if (targetTypeId === 1) {
        // Assuming targetTypeId 1 = patient
        const patientQuery = `
          SELECT p.id
          FROM profiles p
          WHERE p.profile_type = 'patient' AND p.legacy_user_id IN (
            SELECT dp.user_id FROM dispatch_patient dp WHERE dp.id = $1
          )
        `;
        const result = await this.sourcePool.query(patientQuery, [targetId]);

        if (result.rows.length > 0) {
          recipientType = 'patient';
          recipientId = result.rows[0].id;
        }
      } else if (targetTypeId === 2) {
        // Assuming targetTypeId 2 = doctor
        const doctorQuery = `
          SELECT p.id
          FROM profiles p
          WHERE p.profile_type = 'doctor' AND p.legacy_user_id IN (
            SELECT dd.user_id FROM dispatch_doctor dd WHERE dd.id = $1
          )
        `;
        const result = await this.sourcePool.query(doctorQuery, [targetId]);

        if (result.rows.length > 0) {
          recipientType = 'doctor';
          recipientId = result.rows[0].id;
        }
      }
      // Add more target type mappings as needed

    } catch (error) {
      console.error(`❌ Error getting recipient info for target ${targetId}:`, error);
    }

    return { recipientType, recipientId };
  }

  /**
   * Generate title from message content
   */
  private generateTitle(text: string): string {
    // Create a title from the first line or first 50 characters
    const firstLine = text.split('\n')[0].trim();
    return firstLine.length > 50
      ? firstLine.substring(0, 47) + '...'
      : firstLine || 'Message';
  }

  /**
   * Migrate messages in batches
   */
  private async migrateMessages(messages: DispatchRecord[]): Promise<void> {
    console.log('💬 Starting message migration...');

    const batchSize = 100;

    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);
      console.log(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(messages.length / batchSize)} (${batch.length} messages)`);

      for (const message of batch) {
        try {
          // Get UUID mappings
          const senderUuid = await this.getSenderMapping(message.author_id);
          const { recipientType, recipientId } = await this.getRecipientInfo(message.target_type_id, message.target_id);

          // Insert message into target
          const insertQuery = `
            INSERT INTO messages (
              message_type,
              title,
              content,
              sender_id,
              recipient_type,
              recipient_id,
              metadata,
              is_read,
              created_at,
              updated_at,
              legacy_record_id,
              subject
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
            )
          `;

          const values = [
            this.mapMessageType(message.type),               // message_type
            this.generateTitle(message.text),                // title
            message.text,                                    // content
            senderUuid,                                      // sender_id
            recipientType,                                   // recipient_type
            recipientId,                                     // recipient_id
            JSON.stringify({                                 // metadata
              migration: {
                source_table: 'dispatch_record',
                migrated_at: new Date().toISOString(),
                legacy_data: {
                  target_id: message.target_id,
                  type: message.type,
                  target_type_id: message.target_type_id,
                  group_id: message.group_id,
                  public: message.public
                }
              }
            }),
            false,                                           // is_read
            message.created_at,                              // created_at
            message.created_at,                              // updated_at
            message.id,                                      // legacy_record_id
            this.generateTitle(message.text)                 // subject
          ];

          await this.targetPool.query(insertQuery, values);
          this.stats.successfulMigrations++;

          console.log(`✅ Migrated message: ${message.id} - "${this.generateTitle(message.text)}"`);

        } catch (error) {
          console.error(`❌ Error migrating message ${message.id}:`, error);
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
      // Count total messages in target
      const targetCountResult = await this.targetPool.query('SELECT COUNT(*) as count FROM messages');
      const targetCount = parseInt(targetCountResult.rows[0].count);

      // Count messages with legacy IDs
      const legacyCountResult = await this.targetPool.query('SELECT COUNT(*) as count FROM messages WHERE legacy_record_id IS NOT NULL');
      const legacyCount = parseInt(legacyCountResult.rows[0].count);

      console.log(`✓ Target database now has ${targetCount.toLocaleString()} total messages`);
      console.log(`✓ ${legacyCount.toLocaleString()} messages have legacy record ID mappings`);

      // Check for missing messages
      const sourceCountResult = await this.sourcePool.query('SELECT COUNT(*) as count FROM dispatch_record');
      const sourceCount = parseInt(sourceCountResult.rows[0].count);
      const missingCount = sourceCount - legacyCount;

      if (missingCount > 0) {
        console.warn(`⚠️  ${missingCount} source records still not migrated`);
      } else {
        console.log(`✅ All source records have been successfully migrated to messages`);
      }

    } catch (error) {
      console.error('❌ Error during validation:', error);
      this.stats.errors++;
    }
  }

  /**
   * Main migration function
   */
  async migrate(): Promise<void> {
    console.log('🚀 Starting differential messages migration...');
    console.log('📋 This migration will:');
    console.log('   1. Identify new dispatch_record entries');
    console.log('   2. Map author_id to sender profile UUIDs');
    console.log('   3. Determine recipient type and ID');
    console.log('   4. Migrate messages in batches');
    console.log('   5. Validate results');

    try {
      // Step 1: Get new messages
      const newMessages = await this.getNewMessages();
      this.stats.totalNewMessages = newMessages.length;

      if (newMessages.length === 0) {
        console.log('✅ No new messages to migrate');
        return;
      }

      // Step 2: Migrate messages
      await this.migrateMessages(newMessages);

      // Step 3: Validate migration
      await this.validateMigration();

      this.stats.endTime = new Date();

      // Print final statistics
      console.log('\n🎉 Differential messages migration completed!');
      console.log('==========================================');
      console.log(`📊 Migration Statistics:`);
      console.log(`   • New messages found: ${this.stats.totalNewMessages}`);
      console.log(`   • Successfully migrated: ${this.stats.successfulMigrations}`);
      console.log(`   • Skipped (missing dependencies): ${this.stats.skipped}`);
      console.log(`   • Errors encountered: ${this.stats.errors}`);
      console.log(`   • Success rate: ${this.stats.totalNewMessages > 0 ? ((this.stats.successfulMigrations / this.stats.totalNewMessages) * 100).toFixed(2) : 0}%`);
      console.log(`   • Total duration: ${this.stats.endTime.getTime() - this.stats.startTime.getTime()}ms`);

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
    port: parseInt(process.env.TARGET_DB_PORT || '54322'),
    database: process.env.TARGET_DB_NAME || 'postgres',
    username: process.env.TARGET_DB_USER || 'postgres',
    password: process.env.TARGET_DB_PASSWORD || 'postgres'
  };

  const migrationService = new DifferentialMessagesMigrationService(sourceConfig, targetConfig);

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

export { DifferentialMessagesMigrationService };