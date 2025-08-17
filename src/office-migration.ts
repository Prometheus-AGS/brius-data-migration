import { Pool } from 'pg';
import { createHash } from 'crypto';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Configuration
interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

interface OfficeRecord {
  legacy_office_id: number;
  name: string;
  address?: string;
  apartment?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  country: string;
  phone?: string;
  tax_rate: number;
  square_customer_id?: string;
  is_active: boolean;
  email_notifications: boolean;
  metadata: any;
}

interface LegacyOffice {
  id: number;
  name: string;
  address?: string;
  apt?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  tax_rate?: number;
  valid: boolean;
  sq_customer_id?: string;
  emails: boolean;
}

interface MigrationStats {
  totalProcessed: number;
  inserted: number;
  duplicatesSkipped: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
}

class OfficeMigrationService {
  private sourcePool: Pool;
  private targetPool: Pool;
  private batchSize: number = 1000;
  private stats: MigrationStats;

  constructor(sourceConfig: DatabaseConfig, targetConfig: DatabaseConfig) {
    this.sourcePool = new Pool({
      host: sourceConfig.host,
      port: sourceConfig.port,
      database: sourceConfig.database,
      user: sourceConfig.username,
      password: sourceConfig.password,
    });

    this.targetPool = new Pool({
      host: targetConfig.host,
      port: targetConfig.port,
      database: targetConfig.database,
      user: targetConfig.username,
      password: targetConfig.password,
    });

    this.stats = {
      totalProcessed: 0,
      inserted: 0,
      duplicatesSkipped: 0,
      errors: 0,
      startTime: new Date(),
    };
  }

  /**
   * Extract offices from legacy database
   */
  private async extractLegacyOffices(): Promise<LegacyOffice[]> {
    const query = `
      SELECT 
        o.id,
        o.name,
        o.address,
        o.apt,
        o.city,
        o.state,
        o.zip,
        o.phone,
        o.tax_rate,
        o.valid,
        o.sq_customer_id,
        o.emails
      FROM dispatch_office o 
      WHERE o.valid IS TRUE
      ORDER BY o.id
    `;

    try {
      const result = await this.sourcePool.query(query);
      console.log(`✓ Extracted ${result.rows.length} offices from source database`);
      return result.rows;
    } catch (error) {
      console.error('❌ Error extracting legacy offices:', error);
      throw error;
    }
  }

  /**
   * Transform legacy office to target format
   */
  private transformOffice(legacyOffice: LegacyOffice): OfficeRecord {
    // Text normalization as per mapping spec
    const normalizeText = (text?: string): string => {
      if (!text) return '';
      return text.trim().toLowerCase().replace(/\s+/g, ' ');
    };

    const normalizePhone = (phone?: string): string => {
      if (!phone) return '';
      return phone.replace(/[^0-9]/g, '');
    };

    const normalizeZip = (zip?: string): string => {
      if (!zip) return '';
      return zip.replace(/[^0-9]/g, '');
    };

    // Fix tax_rate to fit target schema constraints (numeric(5,4) = max 9.9999)
    const normalizeTaxRate = (rate?: number): number => {
      if (!rate || rate === null || rate === undefined) return 0.0000;
      // Target schema has numeric(5,4) which means max value is 9.9999
      // Source data shows values like 10.2500 which exceed this
      // Convert percentages to decimal format if they appear to be percentages
      if (rate > 1) {
        // Assume it's a percentage, convert to decimal
        const decimal = rate / 100;
        return Math.min(decimal, 0.9999); // Cap at 99.99%
      }
      return Math.min(rate, 0.9999);
    };

    return {
      legacy_office_id: legacyOffice.id,
      name: normalizeText(legacyOffice.name) || `Office ${legacyOffice.id}`,
      address: legacyOffice.address ? normalizeText(legacyOffice.address) : undefined,
      apartment: legacyOffice.apt ? legacyOffice.apt.trim() : undefined,
      city: legacyOffice.city ? normalizeText(legacyOffice.city) : undefined,
      state: legacyOffice.state ? legacyOffice.state.trim().toUpperCase() : undefined,
      zip_code: normalizeZip(legacyOffice.zip),
      country: 'US', // Default as per mapping spec
      phone: normalizePhone(legacyOffice.phone),
      tax_rate: normalizeTaxRate(legacyOffice.tax_rate),
      square_customer_id: legacyOffice.sq_customer_id || undefined,
      is_active: true, // Default active for valid offices
      email_notifications: legacyOffice.emails || true, // Use source value or default true
      metadata: {
        migration: {
          source_table: 'dispatch_office',
          migrated_at: new Date().toISOString(),
          original_valid: legacyOffice.valid,
          original_tax_rate: legacyOffice.tax_rate // Preserve original value
        }
      }
    };
  }

  /**
   * Generate deduplication key as per mapping spec
   */
  private generateDedupeKey(office: OfficeRecord): string {
    const parts = [
      office.name || '',
      office.address || '',
      office.city || '',
      office.state || '',
      office.zip_code || ''
    ];
    return parts.join('|').toLowerCase();
  }

  /**
   * Check if office already exists in target database
   */
  private async checkExistingOffice(office: OfficeRecord): Promise<string | null> {
    const query = `
      SELECT id 
      FROM offices 
      WHERE name = $1 
        AND COALESCE(address, '') = $2 
        AND COALESCE(city, '') = $3 
        AND COALESCE(state, '') = $4 
        AND COALESCE(zip_code, '') = $5
    `;

    try {
      const result = await this.targetPool.query(query, [
        office.name,
        office.address || '',
        office.city || '',
        office.state || '',
        office.zip_code || ''
      ]);

      return result.rows.length > 0 ? result.rows[0].id : null;
    } catch (error) {
      console.error('❌ Error checking existing office:', error);
      return null;
    }
  }

  /**
   * Insert office into target database
   */
  private async insertOffice(office: OfficeRecord): Promise<{ success: boolean; id?: string; error?: string }> {
    const insertQuery = `
      INSERT INTO offices (
        name, address, apartment, city, state, zip_code, country,
        phone, tax_rate, square_customer_id, is_active, email_notifications,
        metadata, legacy_office_id, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW()
      ) 
      RETURNING id
    `;

    const values = [
      office.name,
      office.address,
      office.apartment,
      office.city,
      office.state,
      office.zip_code,
      office.country,
      office.phone,
      office.tax_rate,
      office.square_customer_id,
      office.is_active,
      office.email_notifications,
      JSON.stringify(office.metadata),
      office.legacy_office_id
    ];

    try {
      const result = await this.targetPool.query(insertQuery, values);
      return { success: true, id: result.rows[0].id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Record lineage mapping - FIXED: Updated to match actual schema
   */
  private async recordLineage(legacyId: number, newId: string): Promise<void> {
    const lineageQuery = `
      INSERT INTO migration_mappings (
        entity_type, legacy_id, new_id, migrated_at, migration_batch
      ) VALUES (
        'office', $1, $2, NOW(), 'office_migration_' || TO_CHAR(NOW(), 'YYYYMMDD_HH24MISS')
      ) 
      ON CONFLICT (entity_type, legacy_id) DO NOTHING
    `;

    try {
      await this.targetPool.query(lineageQuery, [legacyId, newId]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`⚠️  Warning: Could not record lineage for office ${legacyId}:`, errorMessage);
    }
  }

  /**
   * Process offices in batches
   */
  private async processBatch(offices: OfficeRecord[]): Promise<void> {
    console.log(`📦 Processing batch of ${offices.length} offices...`);

    for (const office of offices) {
      try {
        this.stats.totalProcessed++;

        // Check for existing office (deduplication)
        const existingId = await this.checkExistingOffice(office);
        
        if (existingId) {
          this.stats.duplicatesSkipped++;
          await this.recordLineage(office.legacy_office_id, existingId);
          console.log(`⏭️  Skipped duplicate office: ${office.name} (Legacy ID: ${office.legacy_office_id})`);
          continue;
        }

        // Insert new office
        const insertResult = await this.insertOffice(office);
        
        if (insertResult.success) {
          this.stats.inserted++;
          await this.recordLineage(office.legacy_office_id, insertResult.id!);
          console.log(`✅ Inserted office: ${office.name} (Legacy ID: ${office.legacy_office_id} → ${insertResult.id})`);
        } else {
          this.stats.errors++;
          console.error(`❌ Failed to insert office ${office.legacy_office_id}: ${insertResult.error}`);
        }

      } catch (error) {
        this.stats.errors++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`❌ Error processing office ${office.legacy_office_id}:`, errorMessage);
      }
    }
  }

  /**
   * Main migration function
   */
  public async migrate(): Promise<MigrationStats> {
    console.log('🚀 Starting office migration...');
    console.log(`📊 Batch size: ${this.batchSize}`);

    try {
      // Extract legacy offices
      const legacyOffices = await this.extractLegacyOffices();
      
      if (legacyOffices.length === 0) {
        console.log('ℹ️  No offices found to migrate');
        return this.stats;
      }

      // Transform offices
      console.log('🔄 Transforming offices...');
      const transformedOffices = legacyOffices.map(office => this.transformOffice(office));

      // Process in batches
      for (let i = 0; i < transformedOffices.length; i += this.batchSize) {
        const batch = transformedOffices.slice(i, i + this.batchSize);
        await this.processBatch(batch);
        
        // Progress update
        const progress = Math.round(((i + batch.length) / transformedOffices.length) * 100);
        console.log(`📈 Progress: ${progress}% (${i + batch.length}/${transformedOffices.length})`);
      }

      this.stats.endTime = new Date();
      
      // Final summary
      console.log('\n📋 Migration Summary:');
      console.log(`⏱️  Duration: ${this.stats.endTime.getTime() - this.stats.startTime.getTime()}ms`);
      console.log(`📊 Total Processed: ${this.stats.totalProcessed}`);
      console.log(`✅ Successfully Inserted: ${this.stats.inserted}`);
      console.log(`⏭️  Duplicates Skipped: ${this.stats.duplicatesSkipped}`);
      console.log(`❌ Errors: ${this.stats.errors}`);

      return this.stats;

    } catch (error) {
      console.error('💥 Migration failed:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Validate migration results
   */
  public async validateMigration(): Promise<{ success: boolean; details: any }> {
    console.log('🔍 Validating migration results...');

    try {
      // Count source records
      const sourceCount = await this.sourcePool.query(
        'SELECT COUNT(*) as count FROM dispatch_office WHERE valid = true'
      );

      // Count target records
      const targetCount = await this.targetPool.query(
        'SELECT COUNT(*) as count FROM offices WHERE legacy_office_id IS NOT NULL'
      );

      // Check lineage mappings
      const lineageCount = await this.targetPool.query(
        "SELECT COUNT(*) as count FROM migration_mappings WHERE entity_type = 'office'"
      );

      // Check for duplicates in target
      const duplicateCheck = await this.targetPool.query(`
        SELECT name, address, city, state, zip_code, COUNT(*) as count
        FROM offices 
        WHERE legacy_office_id IS NOT NULL
        GROUP BY name, address, city, state, zip_code
        HAVING COUNT(*) > 1
      `);

      // Check tax_rate overflow cases
      const taxRateCheck = await this.targetPool.query(`
        SELECT COUNT(*) as count 
        FROM offices 
        WHERE legacy_office_id IS NOT NULL 
          AND tax_rate >= 0.9999
      `);

      const validation = {
        source_count: parseInt(sourceCount.rows[0].count),
        target_count: parseInt(targetCount.rows[0].count),
        lineage_count: parseInt(lineageCount.rows[0].count),
        duplicates_found: duplicateCheck.rows.length,
        tax_rate_capped_count: parseInt(taxRateCheck.rows[0].count),
        success: true
      };

      // Validation checks
      if (validation.target_count !== validation.lineage_count) {
        validation.success = false;
        console.log('⚠️  Warning: Target count does not match lineage mapping count');
      }

      if (validation.duplicates_found > 0) {
        console.log(`⚠️  Warning: Found ${validation.duplicates_found} potential duplicates`);
        console.log('Duplicate details:', duplicateCheck.rows);
      }

      if (validation.tax_rate_capped_count > 0) {
        console.log(`ℹ️  Info: ${validation.tax_rate_capped_count} offices had tax rates capped at 99.99% due to schema constraints`);
      }

      console.log('✅ Validation completed:', validation);
      return { success: validation.success, details: validation };

    } catch (error) {
      console.error('❌ Validation failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, details: { error: errorMessage } };
    }
  }

  /**
   * Cleanup database connections
   */
  private async cleanup(): Promise<void> {
    try {
      await this.sourcePool.end();
      await this.targetPool.end();
      console.log('🧹 Database connections closed');
    } catch (error) {
      console.error('⚠️  Error during cleanup:', error);
    }
  }

  /**
   * Rollback migration (for testing purposes)
   */
  public async rollback(): Promise<void> {
    console.log('🔄 Rolling back office migration...');
    
    try {
      await this.targetPool.query('BEGIN');
      
      // Delete lineage mappings
      await this.targetPool.query(
        "DELETE FROM migration_mappings WHERE entity_type = 'office'"
      );
      
      // Delete migrated offices
      await this.targetPool.query(
        'DELETE FROM offices WHERE legacy_office_id IS NOT NULL'
      );
      
      await this.targetPool.query('COMMIT');
      console.log('✅ Rollback completed successfully');
      
    } catch (error) {
      await this.targetPool.query('ROLLBACK');
      console.error('❌ Rollback failed:', error);
      throw error;
    }
  }
}

// Usage example and CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'migrate';

  // Database configuration from environment variables
  const sourceConfig: DatabaseConfig = {
    host: process.env.SOURCE_DB_HOST || 'localhost',
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME || 'brius_legacy',
    username: process.env.SOURCE_DB_USER || 'postgres',
    password: process.env.SOURCE_DB_PASSWORD || 'password'
  };

  const targetConfig: DatabaseConfig = {
    host: process.env.TARGET_DB_HOST || 'localhost',
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    database: process.env.TARGET_DB_NAME || 'brius_target',
    username: process.env.TARGET_DB_USER || 'postgres',
    password: process.env.TARGET_DB_PASSWORD || 'password'
  };

  const migrationService = new OfficeMigrationService(sourceConfig, targetConfig);

  try {
    switch (command) {
      case 'migrate':
        await migrationService.migrate();
        await migrationService.validateMigration();
        break;
        
      case 'validate':
        await migrationService.validateMigration();
        break;
        
      case 'rollback':
        await migrationService.rollback();
        break;
        
      default:
        console.log('Usage: npm run migrate:offices [migrate|validate|rollback]');
        process.exit(1);
    }
    
    process.exit(0);
    
  } catch (error) {
    console.error('💥 Operation failed:', error);
    process.exit(1);
  }
}

// Export for use as module
export { OfficeMigrationService, OfficeRecord, LegacyOffice, MigrationStats };

// Run if called directly
if (require.main === module) {
  main();
}
