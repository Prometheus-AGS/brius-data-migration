import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

interface SourceOffice {
  id: number;
  name: string;
  address?: string;
  apt?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  phone?: string;
  tax_rate?: number;
  valid: boolean;
  sq_customer_id?: string;
  emails: boolean;
}

interface MigrationStats {
  totalProcessed: number;
  existingUpdated: number;
  newlyInserted: number;
  skipped: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
}

class OfficeCountryFix {
  private sourcePool: Pool;
  private targetPool: Pool;
  private stats: MigrationStats;

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
      existingUpdated: 0,
      newlyInserted: 0,
      skipped: 0,
      errors: 0,
      startTime: new Date(),
    };
  }

  /**
   * Get all source offices with their actual country values
   */
  private async getSourceOffices(): Promise<SourceOffice[]> {
    const query = `
      SELECT
        id, name, address, apt, city, state, zip, country,
        phone, tax_rate, valid, sq_customer_id, emails
      FROM dispatch_office
      WHERE country IS NOT NULL
      ORDER BY id
    `;

    try {
      const result = await this.sourcePool.query(query);
      console.log(`✓ Found ${result.rows.length} valid offices in source database`);

      // Show country distribution
      const countryStats = result.rows.reduce((acc: any, office: any) => {
        const country = office.country || 'NULL';
        acc[country] = (acc[country] || 0) + 1;
        return acc;
      }, {});

      console.log('📊 Country distribution in source:');
      Object.entries(countryStats).forEach(([country, count]) => {
        console.log(`   ${country}: ${count} offices`);
      });

      return result.rows;
    } catch (error) {
      console.error('❌ Error fetching source offices:', error);
      throw error;
    }
  }

  /**
   * Get existing offices from target database
   */
  private async getExistingOffices(): Promise<Map<number, { id: string; country: string }>> {
    const query = `
      SELECT id, legacy_office_id, country
      FROM offices
      WHERE legacy_office_id IS NOT NULL
    `;

    try {
      const result = await this.targetPool.query(query);
      const mapping = new Map<number, { id: string; country: string }>();

      for (const row of result.rows) {
        mapping.set(row.legacy_office_id, {
          id: row.id,
          country: row.country
        });
      }

      console.log(`✓ Found ${mapping.size} existing offices in target database`);
      return mapping;
    } catch (error) {
      console.error('❌ Error fetching existing offices:', error);
      throw error;
    }
  }

  /**
   * Transform source office to target format
   */
  private transformOffice(sourceOffice: SourceOffice): any {
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

    const normalizeTaxRate = (rate?: number): number => {
      if (!rate || rate === null || rate === undefined) return 0.0000;
      if (rate > 1) {
        const decimal = rate / 100;
        return Math.min(decimal, 0.9999);
      }
      return Math.min(rate, 0.9999);
    };

    // Map country values properly - preserve ALL actual values from source
    const mapCountry = (sourceCountry?: string): string => {
      if (!sourceCountry) return 'US'; // Default for null/empty

      // Keep the actual country values from source exactly as they are
      const trimmed = sourceCountry.trim();

      // Only normalize USA variations, keep all other countries exactly as-is
      switch (trimmed.toLowerCase()) {
        case 'usa':
        case 'united states':
        case 'us':
          return 'USA';
        default:
          return trimmed; // Keep ALL other countries exactly as-is: India, Japan, Thailand, Vietnam, Australia, etc.
      }
    };

    return {
      legacy_office_id: sourceOffice.id,
      name: normalizeText(sourceOffice.name) || `Office ${sourceOffice.id}`,
      address: sourceOffice.address ? normalizeText(sourceOffice.address) : undefined,
      apartment: sourceOffice.apt ? sourceOffice.apt.trim() : undefined,
      city: sourceOffice.city ? normalizeText(sourceOffice.city) : undefined,
      state: sourceOffice.state ? sourceOffice.state.trim().toUpperCase() : undefined,
      zip_code: normalizeZip(sourceOffice.zip),
      country: mapCountry(sourceOffice.country),
      phone: normalizePhone(sourceOffice.phone),
      tax_rate: normalizeTaxRate(sourceOffice.tax_rate),
      square_customer_id: sourceOffice.sq_customer_id || undefined,
      is_active: true,
      email_notifications: sourceOffice.emails || true,
      metadata: {
        migration: {
          source_table: 'dispatch_office',
          migrated_at: new Date().toISOString(),
          original_country: sourceOffice.country,
          migration_type: 'country_fix',
          original_valid: sourceOffice.valid,
          original_tax_rate: sourceOffice.tax_rate
        }
      }
    };
  }

  /**
   * Update existing office country
   */
  private async updateOfficeCountry(officeId: string, newCountry: string, originalCountry: string): Promise<boolean> {
    const query = `
      UPDATE offices
      SET
        country = $1,
        metadata = jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{migration}',
          $3::jsonb
        ),
        updated_at = NOW()
      WHERE id = $2
    `;

    const metadataUpdate = JSON.stringify({
      country_corrected_at: new Date().toISOString(),
      original_country: originalCountry,
      country_fix_applied: true
    });

    try {
      const result = await this.targetPool.query(query, [newCountry, officeId, metadataUpdate]);
      return result.rowCount === 1;
    } catch (error) {
      console.error(`❌ Error updating office ${officeId}:`, error);
      return false;
    }
  }

  /**
   * Insert new office
   */
  private async insertOffice(office: any): Promise<{ success: boolean; id?: string; error?: string }> {
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
      office.name, office.address, office.apartment, office.city,
      office.state, office.zip_code, office.country, office.phone,
      office.tax_rate, office.square_customer_id, office.is_active,
      office.email_notifications, JSON.stringify(office.metadata),
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
   * Record migration mapping
   */
  private async recordMapping(legacyId: number, newId: string): Promise<void> {
    const query = `
      INSERT INTO migration_mappings (
        entity_type, legacy_id, new_id, migrated_at, migration_batch
      ) VALUES (
        'office', $1, $2, NOW(), 'office_country_fix_' || TO_CHAR(NOW(), 'YYYYMMDD_HH24MISS')
      )
      ON CONFLICT (entity_type, legacy_id) DO UPDATE SET
        new_id = $2,
        migrated_at = NOW(),
        migration_batch = 'office_country_fix_' || TO_CHAR(NOW(), 'YYYYMMDD_HH24MISS')
    `;

    try {
      await this.targetPool.query(query, [legacyId, newId]);
    } catch (error) {
      console.error(`⚠️  Warning: Could not record mapping for office ${legacyId}:`, error);
    }
  }

  /**
   * Main migration function
   */
  public async fixCountryMigration(): Promise<MigrationStats> {
    console.log('🚀 Starting office country migration fix...');

    try {
      // Get source and existing data
      const [sourceOffices, existingOffices] = await Promise.all([
        this.getSourceOffices(),
        this.getExistingOffices()
      ]);

      console.log('\n🔄 Processing offices...');

      for (const sourceOffice of sourceOffices) {
        try {
          this.stats.totalProcessed++;
          const transformed = this.transformOffice(sourceOffice);
          const existing = existingOffices.get(sourceOffice.id);

          if (existing) {
            // Office exists - check if country needs updating
            if (existing.country !== transformed.country) {
              console.log(`📝 Updating office ${sourceOffice.id}: "${existing.country}" → "${transformed.country}"`);

              const updated = await this.updateOfficeCountry(
                existing.id,
                transformed.country,
                sourceOffice.country || 'NULL'
              );

              if (updated) {
                this.stats.existingUpdated++;
                console.log(`✅ Updated country for office: ${transformed.name} (${sourceOffice.id})`);
              } else {
                this.stats.errors++;
                console.log(`❌ Failed to update office: ${transformed.name} (${sourceOffice.id})`);
              }
            } else {
              this.stats.skipped++;
              console.log(`⏭️  Office ${sourceOffice.id} already has correct country: ${existing.country}`);
            }
          } else {
            // Office doesn't exist - insert it
            console.log(`🆕 Inserting new office ${sourceOffice.id} from ${transformed.country}: ${transformed.name}`);

            const insertResult = await this.insertOffice(transformed);

            if (insertResult.success) {
              this.stats.newlyInserted++;
              await this.recordMapping(sourceOffice.id, insertResult.id!);
              console.log(`✅ Inserted new office: ${transformed.name} (${sourceOffice.id} → ${insertResult.id})`);
            } else {
              this.stats.errors++;
              console.log(`❌ Failed to insert office ${sourceOffice.id}: ${insertResult.error}`);
            }
          }

        } catch (error) {
          this.stats.errors++;
          console.error(`❌ Error processing office ${sourceOffice.id}:`, error);
        }
      }

      this.stats.endTime = new Date();

      // Final summary
      console.log('\n📋 Migration Fix Summary:');
      console.log(`⏱️  Duration: ${this.stats.endTime.getTime() - this.stats.startTime.getTime()}ms`);
      console.log(`📊 Total Processed: ${this.stats.totalProcessed}`);
      console.log(`📝 Existing Updated: ${this.stats.existingUpdated}`);
      console.log(`🆕 Newly Inserted: ${this.stats.newlyInserted}`);
      console.log(`⏭️  Skipped (Already Correct): ${this.stats.skipped}`);
      console.log(`❌ Errors: ${this.stats.errors}`);

      return this.stats;

    } catch (error) {
      console.error('💥 Migration fix failed:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Validate the fix results
   */
  public async validateFix(): Promise<void> {
    console.log('\n🔍 Validating country fix results...');

    try {
      // Check target country distribution
      const targetStats = await this.targetPool.query(`
        SELECT
          country,
          COUNT(*) as count,
          COUNT(*) * 100.0 / (SELECT COUNT(*) FROM offices WHERE legacy_office_id IS NOT NULL) as percentage
        FROM offices
        WHERE legacy_office_id IS NOT NULL
        GROUP BY country
        ORDER BY count DESC
      `);

      console.log('\n📊 Target database country distribution after fix:');
      targetStats.rows.forEach((row: any) => {
        console.log(`   ${row.country}: ${row.count} offices (${parseFloat(row.percentage).toFixed(1)}%)`);
      });

      // Check for missing offices
      const missingCheck = await this.sourcePool.query(`
        SELECT COUNT(*) as missing_count
        FROM dispatch_office so
        LEFT JOIN (
          SELECT legacy_office_id
          FROM offices
          WHERE legacy_office_id IS NOT NULL
        ) t ON so.id = t.legacy_office_id
        WHERE so.valid = true AND t.legacy_office_id IS NULL
      `);

      const missingCount = parseInt(missingCheck.rows[0].missing_count);
      if (missingCount > 0) {
        console.log(`⚠️  Warning: ${missingCount} offices from source are still missing in target`);
      } else {
        console.log('✅ All valid source offices are now present in target');
      }

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
  const command = args[0] || 'fix';

  const migrationFix = new OfficeCountryFix();

  try {
    switch (command) {
      case 'fix':
        await migrationFix.fixCountryMigration();
        await migrationFix.validateFix();
        break;

      case 'validate':
        await migrationFix.validateFix();
        break;

      default:
        console.log('Usage: npx ts-node fix-office-country-migration.ts [fix|validate]');
        process.exit(1);
    }

    process.exit(0);

  } catch (error) {
    console.error('💥 Operation failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { OfficeCountryFix };