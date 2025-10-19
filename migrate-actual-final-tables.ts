#!/usr/bin/env ts-node

/**
 * Actual Final Tables Migration
 * Migration using the real database schema with available tables
 */

import { Client } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface MigrationResult {
  table: string;
  sourceRecords: number;
  targetRecords: number;
  successful: number;
  skipped: number;
  errors: string[];
  success: boolean;
}

interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

class ActualFinalMigration {
  private sourceClient: Client;
  private targetClient: Client;

  constructor() {
    const sourceConfig: DbConfig = {
      host: process.env.SOURCE_DB_HOST || 'localhost',
      port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
      database: process.env.SOURCE_DB_NAME || 'source_db',
      user: process.env.SOURCE_DB_USER || 'postgres',
      password: process.env.SOURCE_DB_PASSWORD || ''
    };

    const targetConfig: DbConfig = {
      host: process.env.TARGET_DB_HOST || 'localhost',
      port: parseInt(process.env.TARGET_DB_PORT || '5432'),
      database: process.env.TARGET_DB_NAME || 'postgres',
      user: process.env.TARGET_DB_USER || 'postgres',
      password: process.env.TARGET_DB_PASSWORD || ''
    };

    this.sourceClient = new Client(sourceConfig);
    this.targetClient = new Client(targetConfig);
  }

  async connect(): Promise<void> {
    console.log('🔌 Connecting to databases...');
    await this.sourceClient.connect();
    await this.targetClient.connect();
    console.log('✅ Connected to source and target databases');
  }

  async disconnect(): Promise<void> {
    console.log('🔌 Disconnecting from databases...');
    await this.sourceClient.end();
    await this.targetClient.end();
    console.log('✅ Disconnected from databases');
  }

  async buildLookupMap(sourceField: string, targetTable: string, targetField: string = 'legacy_record_id'): Promise<Map<number, string>> {
    const lookupMap = new Map<number, string>();

    try {
      const result = await this.targetClient.query(`
        SELECT id, ${targetField}
        FROM ${targetTable}
        WHERE ${targetField} IS NOT NULL
      `);

      for (const row of result.rows) {
        lookupMap.set(row[targetField], row.id);
      }

      console.log(`📊 Built lookup map for ${targetTable}: ${lookupMap.size} entries`);
      return lookupMap;
    } catch (error) {
      console.error(`❌ Failed to build lookup map for ${targetTable}:`, error);
      return lookupMap;
    }
  }

  // Migrate message attachments using actual schema
  async migrateMessageAttachments(): Promise<MigrationResult> {
    console.log('📎 Migrating message attachments...');

    const result: MigrationResult = {
      table: 'message_attachments',
      sourceRecords: 0,
      targetRecords: 0,
      successful: 0,
      skipped: 0,
      errors: [],
      success: false
    };

    try {
      // Build mappings
      const messageMapping = await this.buildLookupMap('record_id', 'messages', 'legacy_record_id');
      const fileMapping = await this.buildLookupMap('file_id', 'files', 'legacy_file_id');

      // Get source count using actual relationship
      const sourceCountResult = await this.sourceClient.query(`
        SELECT COUNT(*) as count
        FROM dispatch_record_attachments dra
        JOIN dispatch_file df ON dra.file_id = df.id
        JOIN dispatch_record dr ON dra.record_id = dr.id
      `);
      result.sourceRecords = parseInt(sourceCountResult.rows[0].count);

      console.log(`📈 Found ${result.sourceRecords} message attachments to migrate`);

      // Get source data with actual schema
      const sourceResult = await this.sourceClient.query(`
        SELECT
          dra.id as attachment_id,
          dra.record_id,
          dra.file_id,
          df.name,
          df.ext,
          df.size,
          df.type,
          df.description,
          df.created_at,
          df.uid as file_uid
        FROM dispatch_record_attachments dra
        JOIN dispatch_file df ON dra.file_id = df.id
        JOIN dispatch_record dr ON dra.record_id = dr.id
        ORDER BY dra.id
        LIMIT 1000
      `);

      console.log(`🔄 Processing ${sourceResult.rows.length} attachment records...`);

      for (const sourceRecord of sourceResult.rows) {
        try {
          // Find message and file IDs
          const message_id = messageMapping.get(sourceRecord.record_id);
          const file_id = fileMapping.get(sourceRecord.file_id);

          if (!message_id) {
            console.warn(`⚠️ No message found for record ${sourceRecord.record_id}, skipping`);
            result.skipped++;
            continue;
          }

          if (!file_id) {
            console.warn(`⚠️ No file found for file ${sourceRecord.file_id}, skipping`);
            result.skipped++;
            continue;
          }

          // Determine attachment type from type field
          let attachment_type = 'attachment';
          if (sourceRecord.type === 1) {
            attachment_type = 'image';
          } else if (sourceRecord.type === 2) {
            attachment_type = 'document';
          } else if (sourceRecord.type === 3) {
            attachment_type = 'scan';
          }

          // Build display name
          const display_name = sourceRecord.name && sourceRecord.ext
            ? `${sourceRecord.name}.${sourceRecord.ext}`
            : sourceRecord.name || `file_${sourceRecord.file_id}`;

          // Insert message attachment
          await this.targetClient.query(`
            INSERT INTO message_attachments (
              message_id, file_id, attachment_type, display_name, file_size,
              attached_at, created_at, updated_at,
              legacy_file_id, legacy_dispatch_record_id, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (message_id, file_id) DO NOTHING
          `, [
            message_id,
            file_id,
            attachment_type,
            display_name,
            sourceRecord.size,
            sourceRecord.created_at,
            sourceRecord.created_at,
            sourceRecord.created_at,
            sourceRecord.file_id,
            sourceRecord.record_id,
            JSON.stringify({
              migrationDate: new Date().toISOString(),
              sourceTable: 'dispatch_record_attachments',
              originalType: sourceRecord.type,
              fileUid: sourceRecord.file_uid,
              description: sourceRecord.description
            })
          ]);

          result.successful++;

        } catch (error: any) {
          result.errors.push(`Attachment ${sourceRecord.attachment_id}: ${error.message}`);
        }
      }

      // Get final count
      const targetCountResult = await this.targetClient.query('SELECT COUNT(*) as count FROM message_attachments');
      result.targetRecords = parseInt(targetCountResult.rows[0].count);

      result.success = result.errors.length === 0;
      console.log(`✅ Message attachments: ${result.successful} successful, ${result.skipped} skipped, ${result.errors.length} errors`);

    } catch (error: any) {
      result.errors.push(`Migration failed: ${error.message}`);
      result.success = false;
    }

    return result;
  }

  // Migrate brackets
  async migrateBrackets(): Promise<MigrationResult> {
    console.log('🦷 Migrating brackets...');

    const result: MigrationResult = {
      table: 'brackets',
      sourceRecords: 0,
      targetRecords: 0,
      successful: 0,
      skipped: 0,
      errors: [],
      success: false
    };

    try {
      // Get source count
      const sourceCountResult = await this.sourceClient.query('SELECT COUNT(*) as count FROM dispatch_bracket');
      result.sourceRecords = parseInt(sourceCountResult.rows[0].count);

      console.log(`📈 Found ${result.sourceRecords} brackets to migrate`);

      // Get source data
      const sourceResult = await this.sourceClient.query(`
        SELECT
          id, name, code, material, manufacturer, specifications,
          cost, is_active, created_at, updated_at
        FROM dispatch_bracket
        ORDER BY id
      `);

      for (const sourceRecord of sourceResult.rows) {
        try {
          // Parse specifications if it's JSON
          let specifications = {};
          if (sourceRecord.specifications) {
            try {
              specifications = JSON.parse(sourceRecord.specifications);
            } catch {
              specifications = { raw: sourceRecord.specifications };
            }
          }

          // Insert bracket
          await this.targetClient.query(`
            INSERT INTO brackets (
              bracket_code, bracket_name, manufacturer, material,
              unit_cost, is_active, created_at, updated_at,
              legacy_bracket_id, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (bracket_code) DO NOTHING
          `, [
            sourceRecord.code || `bracket_${sourceRecord.id}`,
            sourceRecord.name,
            sourceRecord.manufacturer,
            sourceRecord.material,
            sourceRecord.cost,
            sourceRecord.is_active !== false,
            sourceRecord.created_at,
            sourceRecord.updated_at,
            sourceRecord.id,
            JSON.stringify({
              migrationDate: new Date().toISOString(),
              sourceTable: 'dispatch_bracket',
              originalSpecifications: specifications
            })
          ]);

          result.successful++;

        } catch (error: any) {
          if (error.message.includes('duplicate key')) {
            result.skipped++;
          } else {
            result.errors.push(`Bracket ${sourceRecord.id}: ${error.message}`);
          }
        }
      }

      // Get final count
      const targetCountResult = await this.targetClient.query('SELECT COUNT(*) as count FROM brackets');
      result.targetRecords = parseInt(targetCountResult.rows[0].count);

      result.success = result.errors.length === 0;
      console.log(`✅ Brackets: ${result.successful} successful, ${result.skipped} skipped, ${result.errors.length} errors`);

    } catch (error: any) {
      result.errors.push(`Migration failed: ${error.message}`);
      result.success = false;
    }

    return result;
  }

  // Migrate purchases
  async migratePurchases(): Promise<MigrationResult> {
    console.log('💰 Migrating purchases...');

    const result: MigrationResult = {
      table: 'purchases',
      sourceRecords: 0,
      targetRecords: 0,
      successful: 0,
      skipped: 0,
      errors: [],
      success: false
    };

    try {
      // Get source count
      const sourceCountResult = await this.sourceClient.query('SELECT COUNT(*) as count FROM dispatch_purchase');
      result.sourceRecords = parseInt(sourceCountResult.rows[0].count);

      console.log(`📈 Found ${result.sourceRecords} purchases to migrate`);

      // Get source data (limit to reasonable batch)
      const sourceResult = await this.sourceClient.query(`
        SELECT
          id, number, subtotal, tax, total, status, currency,
          vendor, purchased_at, created_at, updated_at,
          client_id, project_id
        FROM dispatch_purchase
        ORDER BY id
        LIMIT 5000
      `);

      // Build client mapping (assuming clients are migrated as patients)
      const patientMapping = await this.buildLookupMap('client_id', 'patients', 'legacy_patient_id');

      console.log(`🔄 Processing ${sourceResult.rows.length} purchase records...`);

      for (const sourceRecord of sourceResult.rows) {
        try {
          // Find patient ID if client_id exists
          let patient_id = null;
          if (sourceRecord.client_id) {
            patient_id = patientMapping.get(sourceRecord.client_id);
          }

          // Insert purchase
          await this.targetClient.query(`
            INSERT INTO purchases (
              purchase_number, subtotal, tax_amount, total_amount,
              currency, vendor_name, status, purchase_date,
              patient_id, created_at, updated_at,
              legacy_purchase_id, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          `, [
            sourceRecord.number || `purchase_${sourceRecord.id}`,
            sourceRecord.subtotal || 0,
            sourceRecord.tax || 0,
            sourceRecord.total || 0,
            sourceRecord.currency || 'USD',
            sourceRecord.vendor || 'Unknown',
            sourceRecord.status || 'completed',
            sourceRecord.purchased_at || sourceRecord.created_at,
            patient_id,
            sourceRecord.created_at,
            sourceRecord.updated_at,
            sourceRecord.id,
            JSON.stringify({
              migrationDate: new Date().toISOString(),
              sourceTable: 'dispatch_purchase',
              originalClientId: sourceRecord.client_id,
              originalProjectId: sourceRecord.project_id
            })
          ]);

          result.successful++;

        } catch (error: any) {
          result.errors.push(`Purchase ${sourceRecord.id}: ${error.message}`);
        }
      }

      // Get final count
      const targetCountResult = await this.targetClient.query('SELECT COUNT(*) as count FROM purchases');
      result.targetRecords = parseInt(targetCountResult.rows[0].count);

      result.success = result.errors.length === 0;
      console.log(`✅ Purchases: ${result.successful} successful, ${result.skipped} skipped, ${result.errors.length} errors`);

    } catch (error: any) {
      result.errors.push(`Migration failed: ${error.message}`);
      result.success = false;
    }

    return result;
  }

  // Run all available migrations
  async runMigrations(): Promise<void> {
    console.log('🚀 Starting actual final tables migration...\n');

    try {
      await this.connect();

      const results: MigrationResult[] = [];

      console.log('📋 Migrating available tables from actual database schema:\n');

      // Run available migrations
      results.push(await this.migrateMessageAttachments());
      results.push(await this.migrateBrackets());
      results.push(await this.migratePurchases());

      // Generate summary
      console.log('\n=== MIGRATION SUMMARY ===');
      let totalSuccess = 0;
      let totalErrors = 0;
      let totalRecords = 0;

      for (const result of results) {
        const status = result.success ? '✅' : '❌';
        const successRate = result.sourceRecords > 0
          ? ((result.successful / result.sourceRecords) * 100).toFixed(1)
          : '0.0';

        console.log(`${status} ${result.table}:`);
        console.log(`    Source: ${result.sourceRecords.toLocaleString()} records`);
        console.log(`    Migrated: ${result.successful.toLocaleString()} successful, ${result.skipped.toLocaleString()} skipped`);
        console.log(`    Success rate: ${successRate}%`);
        console.log(`    Target total: ${result.targetRecords.toLocaleString()} records`);

        if (result.success) {
          totalSuccess++;
        }
        totalErrors += result.errors.length;
        totalRecords += result.successful;

        if (result.errors.length > 0) {
          console.log(`    Errors (${result.errors.length}):`);
          result.errors.slice(0, 3).forEach((error, i) => {
            console.log(`      ${i + 1}. ${error}`);
          });
          if (result.errors.length > 3) {
            console.log(`      ... and ${result.errors.length - 3} more errors`);
          }
        }
        console.log('');
      }

      console.log('=== FINAL RESULTS ===');
      console.log(`Tables successfully migrated: ${totalSuccess}/${results.length}`);
      console.log(`Total records migrated: ${totalRecords.toLocaleString()}`);
      console.log(`Total errors: ${totalErrors}`);
      console.log(`Overall status: ${totalErrors === 0 ? '✅ SUCCESS' : '⚠️ PARTIAL SUCCESS'}`);

      console.log('\n📋 Note: Some tables were not available in the source database:');
      console.log('   - dispatch_technician (not found - may be in auth_user)');
      console.log('   - dispatch_technician_role (not found - may be in dispatch_role)');
      console.log('   - dispatch_template_view_groups (found but not migrated yet)');
      console.log('   - dispatch_template_view_roles (found but not migrated yet)');
      console.log('   - treatment_discussions (not found in this form)');
      console.log('   - order_cases (not found as separate table)');

      if (totalErrors === 0 && totalSuccess > 0) {
        console.log('\n🎉 Available tables migrated successfully!');
        console.log('✅ System updated with migrated data');
      } else if (totalSuccess > 0) {
        console.log(`\n⚠️ Migration partially completed: ${totalSuccess} tables successful`);
        console.log('🔧 Review errors above for any issues');
      } else {
        console.log('\n❌ Migration completed with significant issues');
        console.log('🔧 Review errors and database connectivity');
      }

    } catch (error) {
      console.error('❌ Migration failed:', error);
    } finally {
      await this.disconnect();
    }
  }
}

// Main execution
async function main() {
  const migration = new ActualFinalMigration();
  await migration.runMigrations();
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { ActualFinalMigration };