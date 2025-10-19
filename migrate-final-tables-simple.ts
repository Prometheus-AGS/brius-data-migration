#!/usr/bin/env npx ts-node

/**
 * Simple Final Tables Migration
 * Direct migration approach for the remaining tables without complex interfaces
 */

import { Client } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Simple interfaces
interface MigrationResult {
  table: string;
  sourceRecords: number;
  targetRecords: number;
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

class SimpleFinalMigration {
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
      port: parseInt(process.env.TARGET_DB_PORT || '54322'),
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

  // Build simple lookup mapping
  async buildLookupMap(sourceTable: string, sourceField: string, targetTable: string): Promise<Map<number, string>> {
    const lookupMap = new Map<number, string>();

    try {
      const result = await this.targetClient.query(`
        SELECT id, ${sourceField}
        FROM ${targetTable}
        WHERE ${sourceField} IS NOT NULL
      `);

      for (const row of result.rows) {
        lookupMap.set(row[sourceField], row.id);
      }

      console.log(`📊 Built lookup map for ${targetTable}: ${lookupMap.size} entries`);
      return lookupMap;
    } catch (error) {
      console.error(`❌ Failed to build lookup map for ${targetTable}:`, error);
      return lookupMap;
    }
  }

  // Migrate technicians table
  async migrateTechnicians(): Promise<MigrationResult> {
    console.log('🏢 Migrating technicians...');

    const result: MigrationResult = {
      table: 'technicians',
      sourceRecords: 0,
      targetRecords: 0,
      errors: [],
      success: false
    };

    try {
      // Build profile mapping
      const profileMapping = await this.buildLookupMap('dispatch_user', 'legacy_user_id', 'profiles');

      // Get source count
      const sourceCountResult = await this.sourceClient.query('SELECT COUNT(*) as count FROM dispatch_technician');
      result.sourceRecords = parseInt(sourceCountResult.rows[0].count);

      // Get source data
      const sourceResult = await this.sourceClient.query(`
        SELECT
          id, user_id, employee_id, department, position, hire_date,
          phone, email, status, emergency_contact_name, emergency_contact_phone,
          emergency_contact_relation, created_at, updated_at
        FROM dispatch_technician
        ORDER BY id
      `);

      let successful = 0;
      let skipped = 0;

      for (const sourceRecord of sourceResult.rows) {
        try {
          // Find profile ID
          let profile_id = null;
          if (sourceRecord.user_id) {
            profile_id = profileMapping.get(sourceRecord.user_id);
          }

          if (!profile_id) {
            console.warn(`⚠️ No profile found for technician ${sourceRecord.id}, skipping`);
            skipped++;
            continue;
          }

          // Build emergency contact
          const emergency_contact = (sourceRecord.emergency_contact_name || sourceRecord.emergency_contact_phone) ? {
            name: sourceRecord.emergency_contact_name,
            phone: sourceRecord.emergency_contact_phone,
            relation: sourceRecord.emergency_contact_relation
          } : null;

          // Normalize status
          const status = sourceRecord.status?.toLowerCase() === 'inactive' ? 'inactive' : 'active';

          // Insert technician
          await this.targetClient.query(`
            INSERT INTO technicians (
              profile_id, employee_id, department, position, hire_date,
              status, phone, email, emergency_contact,
              created_at, updated_at, legacy_technician_id, legacy_user_id, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          `, [
            profile_id,
            sourceRecord.employee_id,
            sourceRecord.department,
            sourceRecord.position,
            sourceRecord.hire_date,
            status,
            sourceRecord.phone,
            sourceRecord.email,
            emergency_contact ? JSON.stringify(emergency_contact) : null,
            sourceRecord.created_at,
            sourceRecord.updated_at,
            sourceRecord.id,
            sourceRecord.user_id,
            JSON.stringify({
              migrationDate: new Date().toISOString(),
              sourceTable: 'dispatch_technician'
            })
          ]);

          successful++;

        } catch (error: any) {
          result.errors.push(`Technician ${sourceRecord.id}: ${error.message}`);
        }
      }

      // Get final count
      const targetCountResult = await this.targetClient.query('SELECT COUNT(*) as count FROM technicians');
      result.targetRecords = parseInt(targetCountResult.rows[0].count);

      result.success = result.errors.length === 0;
      console.log(`✅ Technicians migration: ${successful} successful, ${skipped} skipped, ${result.errors.length} errors`);

    } catch (error: any) {
      result.errors.push(`Migration failed: ${error.message}`);
      result.success = false;
    }

    return result;
  }

  // Migrate technician roles
  async migrateTechnicianRoles(): Promise<MigrationResult> {
    console.log('👥 Migrating technician roles...');

    const result: MigrationResult = {
      table: 'technician_roles',
      sourceRecords: 0,
      targetRecords: 0,
      errors: [],
      success: false
    };

    try {
      // Build technician mapping
      const technicianMapping = await this.buildLookupMap('dispatch_technician', 'legacy_technician_id', 'technicians');

      // Get source count
      const sourceCountResult = await this.sourceClient.query('SELECT COUNT(*) as count FROM dispatch_technician_role');
      result.sourceRecords = parseInt(sourceCountResult.rows[0].count);

      // Get source data
      const sourceResult = await this.sourceClient.query(`
        SELECT
          id, technician_id, role_name, role_type, permissions, scope_type, scope_id,
          effective_date, expiry_date, is_active, created_at, updated_at
        FROM dispatch_technician_role
        ORDER BY id
      `);

      let successful = 0;
      let skipped = 0;

      for (const sourceRecord of sourceResult.rows) {
        try {
          // Find technician ID
          const technician_id = technicianMapping.get(sourceRecord.technician_id);
          if (!technician_id) {
            console.warn(`⚠️ No technician found for role ${sourceRecord.id}, skipping`);
            skipped++;
            continue;
          }

          // Parse permissions
          let permissions = [];
          if (sourceRecord.permissions) {
            try {
              permissions = JSON.parse(sourceRecord.permissions);
            } catch {
              permissions = sourceRecord.permissions.split(',').map((p: string) => p.trim());
            }
          }

          // Insert technician role
          await this.targetClient.query(`
            INSERT INTO technician_roles (
              technician_id, role_name, role_type, permissions, scope_type, scope_id,
              effective_date, expiry_date, is_active,
              created_at, updated_at, legacy_role_id, legacy_technician_id, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          `, [
            technician_id,
            sourceRecord.role_name,
            sourceRecord.role_type,
            JSON.stringify(permissions),
            sourceRecord.scope_type,
            sourceRecord.scope_id,
            sourceRecord.effective_date,
            sourceRecord.expiry_date,
            sourceRecord.is_active,
            sourceRecord.created_at,
            sourceRecord.updated_at,
            sourceRecord.id,
            sourceRecord.technician_id,
            JSON.stringify({
              migrationDate: new Date().toISOString(),
              sourceTable: 'dispatch_technician_role'
            })
          ]);

          successful++;

        } catch (error: any) {
          result.errors.push(`Technician role ${sourceRecord.id}: ${error.message}`);
        }
      }

      // Get final count
      const targetCountResult = await this.targetClient.query('SELECT COUNT(*) as count FROM technician_roles');
      result.targetRecords = parseInt(targetCountResult.rows[0].count);

      result.success = result.errors.length === 0;
      console.log(`✅ Technician roles migration: ${successful} successful, ${skipped} skipped, ${result.errors.length} errors`);

    } catch (error: any) {
      result.errors.push(`Migration failed: ${error.message}`);
      result.success = false;
    }

    return result;
  }

  // Migrate message attachments
  async migrateMessageAttachments(): Promise<MigrationResult> {
    console.log('📎 Migrating message attachments...');

    const result: MigrationResult = {
      table: 'message_attachments',
      sourceRecords: 0,
      targetRecords: 0,
      errors: [],
      success: false
    };

    try {
      // Build mappings
      const messageMapping = await this.buildLookupMap('dispatch_record', 'legacy_record_id', 'messages');
      const fileMapping = await this.buildLookupMap('dispatch_file', 'legacy_file_id', 'files');

      // Get source count
      const sourceCountResult = await this.sourceClient.query(`
        SELECT COUNT(*) as count
        FROM dispatch_file df
        JOIN dispatch_record dr ON df.record_id = dr.id
      `);
      result.sourceRecords = parseInt(sourceCountResult.rows[0].count);

      // Get source data
      const sourceResult = await this.sourceClient.query(`
        SELECT
          df.id as file_id, df.record_id, df.filename, df.original_filename,
          df.file_size, df.mime_type, df.file_type, df.upload_date,
          df.created_at, df.updated_at
        FROM dispatch_file df
        JOIN dispatch_record dr ON df.record_id = dr.id
        ORDER BY df.id
      `);

      let successful = 0;
      let skipped = 0;

      for (const sourceRecord of sourceResult.rows) {
        try {
          // Find message and file IDs
          const message_id = messageMapping.get(sourceRecord.record_id);
          const file_id = fileMapping.get(sourceRecord.file_id);

          if (!message_id || !file_id) {
            console.warn(`⚠️ Missing mappings for attachment ${sourceRecord.file_id}, skipping`);
            skipped++;
            continue;
          }

          // Determine attachment type
          let attachment_type = 'attachment';
          if (sourceRecord.file_type?.toLowerCase().includes('image')) {
            attachment_type = 'image';
          } else if (sourceRecord.mime_type?.toLowerCase().includes('pdf')) {
            attachment_type = 'document';
          }

          // Insert message attachment
          await this.targetClient.query(`
            INSERT INTO message_attachments (
              message_id, file_id, attachment_type, display_name, file_size, mime_type,
              attached_at, created_at, updated_at,
              legacy_file_id, legacy_dispatch_record_id, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          `, [
            message_id,
            file_id,
            attachment_type,
            sourceRecord.original_filename || sourceRecord.filename,
            sourceRecord.file_size,
            sourceRecord.mime_type,
            sourceRecord.upload_date || sourceRecord.created_at,
            sourceRecord.created_at,
            sourceRecord.updated_at,
            sourceRecord.file_id,
            sourceRecord.record_id,
            JSON.stringify({
              migrationDate: new Date().toISOString(),
              sourceTable: 'dispatch_file'
            })
          ]);

          successful++;

        } catch (error: any) {
          result.errors.push(`Message attachment ${sourceRecord.file_id}: ${error.message}`);
        }
      }

      // Get final count
      const targetCountResult = await this.targetClient.query('SELECT COUNT(*) as count FROM message_attachments');
      result.targetRecords = parseInt(targetCountResult.rows[0].count);

      result.success = result.errors.length === 0;
      console.log(`✅ Message attachments migration: ${successful} successful, ${skipped} skipped, ${result.errors.length} errors`);

    } catch (error: any) {
      result.errors.push(`Migration failed: ${error.message}`);
      result.success = false;
    }

    return result;
  }

  // Run all migrations
  async runMigrations(): Promise<void> {
    console.log('🚀 Starting final tables migration...\n');

    try {
      await this.connect();

      const results: MigrationResult[] = [];

      // Run migrations in dependency order
      results.push(await this.migrateTechnicians());
      results.push(await this.migrateTechnicianRoles());
      results.push(await this.migrateMessageAttachments());

      // Generate summary
      console.log('\n=== MIGRATION SUMMARY ===');
      let totalSuccess = 0;
      let totalErrors = 0;

      for (const result of results) {
        const status = result.success ? '✅' : '❌';
        console.log(`${status} ${result.table}: ${result.targetRecords} records migrated`);

        if (result.success) {
          totalSuccess++;
        } else {
          totalErrors += result.errors.length;
        }

        if (result.errors.length > 0) {
          console.log(`   Errors (${result.errors.length}):`);
          result.errors.slice(0, 5).forEach((error, i) => {
            console.log(`     ${i + 1}. ${error}`);
          });
          if (result.errors.length > 5) {
            console.log(`     ... and ${result.errors.length - 5} more errors`);
          }
        }
      }

      const totalRecords = results.reduce((sum, r) => sum + r.targetRecords, 0);

      console.log('\n=== FINAL RESULTS ===');
      console.log(`Tables migrated: ${totalSuccess}/${results.length}`);
      console.log(`Total records: ${totalRecords.toLocaleString()}`);
      console.log(`Status: ${totalErrors === 0 ? '✅ SUCCESS' : '⚠️ PARTIAL SUCCESS'}`);

      if (totalErrors === 0) {
        console.log('\n🎉 All final tables migrated successfully!');
        console.log('✅ System is ready for production use');
      } else {
        console.log(`\n⚠️ Migration completed with ${totalErrors} errors`);
        console.log('🔧 Review errors above and consider re-running failed migrations');
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
  const migration = new SimpleFinalMigration();
  await migration.runMigrations();
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { SimpleFinalMigration };