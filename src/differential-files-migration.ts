/**
 * Differential Files Migration Service
 * Migrates new files from production source to target with proper column mapping
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

interface FileMapping {
  id: number;
  uid: string;
  name: string;
  ext: string;
  size: number;
  type: number;
  instruction_id: number | null;
  created_at: Date;
  description: string | null;
  product_id: number | null;
  parameters: string;
  record_id: number | null;
  status: number;
}

interface MigrationStats {
  totalNewFiles: number;
  successfulMigrations: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
}

class DifferentialFilesMigrationService {
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
      totalNewFiles: 0,
      successfulMigrations: 0,
      errors: 0,
      startTime: new Date()
    };
  }

  /**
   * Get files that exist in source but not in target
   */
  private async getNewFiles(): Promise<FileMapping[]> {
    console.log('🔍 Identifying new files in source database...');

    // First, get all legacy_file_ids that already exist in target
    const existingIdsQuery = `
      SELECT legacy_file_id
      FROM files
      WHERE legacy_file_id IS NOT NULL
    `;

    const existingIdsResult = await this.targetPool.query(existingIdsQuery);
    const existingIds = existingIdsResult.rows.map(row => row.legacy_file_id);

    console.log(`✓ Found ${existingIds.length} files already migrated in target`);

    // Now get source files that are NOT in the existing IDs
    let query = `
      SELECT
        df.id,
        df.uid,
        df.name,
        df.ext,
        df.size,
        df.type,
        df.instruction_id,
        df.created_at,
        df.description,
        df.product_id,
        df.parameters,
        df.record_id,
        df.status
      FROM dispatch_file df
    `;

    if (existingIds.length > 0) {
      query += ` WHERE df.id NOT IN (${existingIds.join(',')})`;
    }

    query += ` ORDER BY df.created_at DESC`;

    try {
      const result = await this.sourcePool.query(query);
      console.log(`✓ Found ${result.rows.length} new files to migrate`);

      return result.rows.map(row => ({
        id: row.id,
        uid: row.uid,
        name: row.name,
        ext: row.ext,
        size: row.size,
        type: row.type,
        instruction_id: row.instruction_id,
        created_at: row.created_at,
        description: row.description,
        product_id: row.product_id,
        parameters: row.parameters,
        record_id: row.record_id,
        status: row.status
      }));
    } catch (error) {
      console.error('❌ Error getting new files:', error);
      throw error;
    }
  }

  /**
   * Get order UUID mapping for instruction_id
   */
  private async getOrderMapping(instructionId: number): Promise<string | null> {
    try {
      const query = `
        SELECT id
        FROM orders
        WHERE legacy_instruction_id = $1
      `;

      const result = await this.targetPool.query(query, [instructionId]);
      return result.rows.length > 0 ? result.rows[0].id : null;
    } catch (error) {
      console.error(`❌ Error getting order mapping for instruction ${instructionId}:`, error);
      return null;
    }
  }

  /**
   * Get uploaded_by profile UUID (assuming system upload for now)
   */
  private async getSystemProfileId(): Promise<string | null> {
    try {
      const query = `
        SELECT id
        FROM profiles
        WHERE email = 'system@company.com' OR email ILIKE '%system%'
        LIMIT 1
      `;

      const result = await this.targetPool.query(query);
      return result.rows.length > 0 ? result.rows[0].id : null;
    } catch (error) {
      console.error('❌ Error getting system profile ID:', error);
      return null;
    }
  }

  /**
   * Migrate files in batches
   */
  private async migrateFiles(files: FileMapping[]): Promise<void> {
    console.log('📁 Starting file migration...');

    const batchSize = 100;
    const systemProfileId = await this.getSystemProfileId();

    if (!systemProfileId) {
      console.warn('⚠️  No system profile found, files will be uploaded without uploaded_by reference');
    }

    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      console.log(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(files.length / batchSize)} (${batch.length} files)`);

      for (const file of batch) {
        try {
          // Get order UUID if instruction_id exists
          let orderUuid: string | null = null;
          if (file.instruction_id) {
            orderUuid = await this.getOrderMapping(file.instruction_id);
          }

          // Determine MIME type from extension
          const mimeType = this.getMimeTypeFromExtension(file.ext);

          // Insert file into target
          const insertQuery = `
            INSERT INTO files (
              file_uid,
              order_id,
              uploaded_by,
              filename,
              file_type,
              file_size_bytes,
              mime_type,
              storage_path,
              checksum,
              uploaded_at,
              metadata,
              legacy_file_id
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
            )
          `;

          const values = [
            file.uid,                                    // file_uid
            orderUuid,                                   // order_id (mapped from instruction_id)
            systemProfileId,                             // uploaded_by
            file.name || 'unknown',                      // filename
            file.ext,                                    // file_type
            file.size,                                   // file_size_bytes
            mimeType,                                    // mime_type
            null,                                        // storage_path (not in source)
            null,                                        // checksum (not in source)
            file.created_at,                             // uploaded_at (mapped from created_at)
            JSON.stringify({                             // metadata
              legacy_type: file.type,
              legacy_description: file.description,
              legacy_parameters: file.parameters,
              legacy_record_id: file.record_id,
              legacy_status: file.status,
              legacy_product_id: file.product_id
            }),
            file.id                                      // legacy_file_id
          ];

          await this.targetPool.query(insertQuery, values);
          this.stats.successfulMigrations++;

          console.log(`✅ Migrated file: ${file.name} (ID: ${file.id})`);

        } catch (error) {
          console.error(`❌ Error migrating file ${file.id} (${file.name}):`, error);
          this.stats.errors++;
        }
      }
    }
  }

  /**
   * Get MIME type from file extension
   */
  private getMimeTypeFromExtension(ext: string | null): string {
    if (!ext) return 'application/octet-stream';

    const mimeMap: { [key: string]: string } = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.txt': 'text/plain',
      '.zip': 'application/zip',
      '.rar': 'application/vnd.rar'
    };

    const normalizedExt = ext.toLowerCase().startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
    return mimeMap[normalizedExt] || 'application/octet-stream';
  }

  /**
   * Validate the migration results
   */
  private async validateMigration(): Promise<void> {
    console.log('🔍 Validating migration results...');

    try {
      // Count total files in target
      const targetCountResult = await this.targetPool.query('SELECT COUNT(*) as count FROM files');
      const targetCount = parseInt(targetCountResult.rows[0].count);

      // Count files with legacy IDs
      const legacyCountResult = await this.targetPool.query('SELECT COUNT(*) as count FROM files WHERE legacy_file_id IS NOT NULL');
      const legacyCount = parseInt(legacyCountResult.rows[0].count);

      console.log(`✓ Target database now has ${targetCount.toLocaleString()} total files`);
      console.log(`✓ ${legacyCount.toLocaleString()} files have legacy ID mappings`);

      // Check for missing files by getting all source IDs and checking against target
      const sourceIdsQuery = `SELECT COUNT(*) as total_source FROM dispatch_file`;
      const sourceIdsResult = await this.sourcePool.query(sourceIdsQuery);
      const totalSourceFiles = parseInt(sourceIdsResult.rows[0].total_source);

      // Get count of migrated files in target
      const migratedQuery = `
        SELECT COUNT(*) as migrated_count
        FROM files
        WHERE legacy_file_id IS NOT NULL
      `;

      const migratedResult = await this.targetPool.query(migratedQuery);
      const migratedCount = parseInt(migratedResult.rows[0].migrated_count);
      const missingCount = totalSourceFiles - migratedCount;

      if (missingCount > 0) {
        console.warn(`⚠️  ${missingCount} source files still not migrated`);
      } else {
        console.log(`✅ All source files have been successfully migrated`);
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
    console.log('🚀 Starting differential files migration...');
    console.log('📋 This migration will:');
    console.log('   1. Identify new files in source database');
    console.log('   2. Map foreign keys (instruction_id → order_id)');
    console.log('   3. Map timestamps (created_at → uploaded_at)');
    console.log('   4. Migrate files in batches');
    console.log('   5. Validate results');

    try {
      // Step 1: Get new files
      const newFiles = await this.getNewFiles();
      this.stats.totalNewFiles = newFiles.length;

      if (newFiles.length === 0) {
        console.log('✅ No new files to migrate');
        return;
      }

      // Step 2: Migrate files
      await this.migrateFiles(newFiles);

      // Step 3: Validate migration
      await this.validateMigration();

      this.stats.endTime = new Date();

      // Print final statistics
      console.log('\n🎉 Differential files migration completed!');
      console.log('==========================================');
      console.log(`📊 Migration Statistics:`);
      console.log(`   • New files found: ${this.stats.totalNewFiles}`);
      console.log(`   • Successfully migrated: ${this.stats.successfulMigrations}`);
      console.log(`   • Errors encountered: ${this.stats.errors}`);
      console.log(`   • Success rate: ${this.stats.totalNewFiles > 0 ? ((this.stats.successfulMigrations / this.stats.totalNewFiles) * 100).toFixed(2) : 0}%`);
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

  const migrationService = new DifferentialFilesMigrationService(sourceConfig, targetConfig);

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

export { DifferentialFilesMigrationService };