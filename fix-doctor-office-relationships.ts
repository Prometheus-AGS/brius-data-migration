import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

interface DoctorOfficeMapping {
  sourceRelationshipId: number;
  sourceDoctorId: number;
  sourceOfficeId: number;
  doctorProfileId: string;
  officeId: string;
  country: string;
  doctorName: string;
  officeName: string;
}

interface MigrationStats {
  relationshipsProcessed: number;
  relationshipsCreated: number;
  relationshipsSkipped: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
}

class DoctorOfficeRelationshipFix {
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
      relationshipsProcessed: 0,
      relationshipsCreated: 0,
      relationshipsSkipped: 0,
      errors: 0,
      startTime: new Date(),
    };
  }

  /**
   * Get all doctor-office relationships from source
   */
  private async getSourceRelationships(): Promise<any[]> {
    const query = `
      SELECT
        dod.id as source_relationship_id,
        dod.user_id as source_doctor_id,
        dod.office_id as source_office_id,
        office_source.country,
        COALESCE(NULLIF(au.first_name, ''), '') || ' ' || COALESCE(NULLIF(au.last_name, ''), '') as doctor_name,
        COALESCE(office_source.name, 'Office ' || office_source.id) as office_name
      FROM dispatch_office_doctors dod
      JOIN dispatch_office office_source ON dod.office_id = office_source.id
      JOIN auth_user au ON dod.user_id = au.id
      WHERE office_source.country IS NOT NULL
        AND au.is_active = true
        AND NOT (
          LOWER(COALESCE(au.email, '')) LIKE '%test%' OR
          LOWER(COALESCE(au.email, '')) LIKE '%demo%' OR
          LOWER(COALESCE(au.first_name, '')) LIKE '%test%' OR
          LOWER(COALESCE(au.last_name, '')) LIKE '%test%' OR
          COALESCE(au.email, '') LIKE '%brius.com' OR
          COALESCE(au.email, '') LIKE '%mechanodontics.com'
        )
      ORDER BY office_source.country, office_source.id, au.id
    `;

    try {
      const result = await this.sourcePool.query(query);
      console.log(`✓ Found ${result.rows.length} doctor-office relationships in source`);
      return result.rows;
    } catch (error) {
      console.error('❌ Error fetching source relationships:', error);
      throw error;
    }
  }

  /**
   * Get target mappings for doctors and offices
   */
  private async getTargetMappings(): Promise<{
    doctorMap: Map<number, string>,
    officeMap: Map<number, string>
  }> {
    const [doctorResult, officeResult] = await Promise.all([
      this.targetPool.query(`
        SELECT legacy_user_id, id
        FROM profiles
        WHERE legacy_user_id IS NOT NULL AND profile_type = 'doctor'
      `),
      this.targetPool.query(`
        SELECT legacy_office_id, id
        FROM offices
        WHERE legacy_office_id IS NOT NULL
      `)
    ]);

    const doctorMap = new Map<number, string>();
    const officeMap = new Map<number, string>();

    doctorResult.rows.forEach(row => {
      doctorMap.set(row.legacy_user_id, row.id);
    });

    officeResult.rows.forEach(row => {
      officeMap.set(row.legacy_office_id, row.id);
    });

    console.log(`✓ Found ${doctorMap.size} doctor mappings`);
    console.log(`✓ Found ${officeMap.size} office mappings`);

    return { doctorMap, officeMap };
  }

  /**
   * Build complete relationship mappings
   */
  private async getMissingRelationships(): Promise<DoctorOfficeMapping[]> {
    try {
      const [sourceRelationships, { doctorMap, officeMap }] = await Promise.all([
        this.getSourceRelationships(),
        this.getTargetMappings()
      ]);

      const mappings: DoctorOfficeMapping[] = [];
      let skipped = 0;

      for (const sourceRel of sourceRelationships) {
        const doctorId = doctorMap.get(sourceRel.source_doctor_id);
        const officeId = officeMap.get(sourceRel.source_office_id);

        if (!doctorId || !officeId) {
          skipped++;
          continue;
        }

        mappings.push({
          sourceRelationshipId: sourceRel.source_relationship_id,
          sourceDoctorId: sourceRel.source_doctor_id,
          sourceOfficeId: sourceRel.source_office_id,
          doctorProfileId: doctorId,
          officeId: officeId,
          country: sourceRel.country,
          doctorName: sourceRel.doctor_name,
          officeName: sourceRel.office_name
        });
      }

      console.log(`✓ Built ${mappings.length} relationship mappings (${skipped} skipped due to missing mappings)`);

      // Show breakdown by country
      const countryBreakdown = mappings.reduce((acc: any, mapping: any) => {
        acc[mapping.country] = (acc[mapping.country] || 0) + 1;
        return acc;
      }, {});

      console.log('📊 Relationships by country:');
      Object.entries(countryBreakdown).forEach(([country, count]) => {
        console.log(`   ${country}: ${count} relationships`);
      });

      return mappings;
    } catch (error) {
      console.error('❌ Error building relationship mappings:', error);
      throw error;
    }
  }

  /**
   * Check if relationship already exists
   */
  private async relationshipExists(doctorId: string, officeId: string): Promise<boolean> {
    const query = `
      SELECT 1 FROM doctor_offices
      WHERE doctor_id = $1 AND office_id = $2
      LIMIT 1
    `;

    try {
      const result = await this.targetPool.query(query, [doctorId, officeId]);
      return result.rows.length > 0;
    } catch (error) {
      console.error(`❌ Error checking relationship existence:`, error);
      return false;
    }
  }

  /**
   * Get actual doctor_offices table schema
   */
  private async getDoctorOfficesSchema(): Promise<string[]> {
    const query = `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'doctor_offices'
        AND table_schema = 'public'
      ORDER BY ordinal_position
    `;

    try {
      const result = await this.targetPool.query(query);
      const columns = result.rows.map(row => row.column_name);
      console.log(`✓ doctor_offices table columns: ${columns.join(', ')}`);
      return columns;
    } catch (error) {
      console.error('❌ Error getting table schema:', error);
      throw error;
    }
  }

  /**
   * Create doctor-office relationship
   */
  private async createRelationship(mapping: DoctorOfficeMapping, tableColumns: string[]): Promise<boolean> {
    // Build dynamic query based on available columns
    const columns = ['doctor_id', 'office_id'];
    const values: any[] = [mapping.doctorProfileId, mapping.officeId];
    let paramIndex = 3;

    // Add optional columns if they exist
    if (tableColumns.includes('is_primary')) {
      columns.push('is_primary');
      values.push(false);
      paramIndex++;
    }

    if (tableColumns.includes('is_active')) {
      columns.push('is_active');
      values.push(true);
      paramIndex++;
    }

    if (tableColumns.includes('created_at')) {
      columns.push('created_at');
      values.push('NOW()');
    }

    if (tableColumns.includes('updated_at')) {
      columns.push('updated_at');
      values.push('NOW()');
    }

    // Build the query
    const placeholders = values.map((val, idx) => {
      if (val === 'NOW()') return 'NOW()';
      return `$${idx + 1}`;
    });

    const query = `
      INSERT INTO doctor_offices (${columns.join(', ')})
      VALUES (${placeholders.join(', ')})
    `;

    // Filter out NOW() from values array for query parameters
    const queryParams = values.filter(val => val !== 'NOW()');

    try {
      await this.targetPool.query(query, queryParams);
      return true;
    } catch (error) {
      console.error(`❌ Error creating relationship:`, error);
      return false;
    }
  }

  /**
   * Main function to fix all missing relationships
   */
  public async fixAllRelationships(): Promise<MigrationStats> {
    console.log('🚀 Starting Doctor-Office Relationship Fix...\n');

    try {
      const [missingRelationships, tableColumns] = await Promise.all([
        this.getMissingRelationships(),
        this.getDoctorOfficesSchema()
      ]);

      console.log('\n🔄 Creating missing relationships...');

      for (const mapping of missingRelationships) {
        try {
          this.stats.relationshipsProcessed++;

          // Check if relationship already exists
          const exists = await this.relationshipExists(mapping.doctorProfileId, mapping.officeId);

          if (exists) {
            this.stats.relationshipsSkipped++;
            console.log(`⏭️  Relationship exists: ${mapping.doctorName.trim()} ↔ ${mapping.officeName} (${mapping.country})`);
            continue;
          }

          // Create the relationship
          const success = await this.createRelationship(mapping, tableColumns);

          if (success) {
            this.stats.relationshipsCreated++;
            console.log(`✅ Created: ${mapping.doctorName.trim()} ↔ ${mapping.officeName} (${mapping.country})`);
          } else {
            this.stats.errors++;
            console.log(`❌ Failed: ${mapping.doctorName.trim()} ↔ ${mapping.officeName} (${mapping.country})`);
          }

        } catch (error) {
          this.stats.errors++;
          console.error(`❌ Error processing relationship ${mapping.sourceRelationshipId}:`, error);
        }
      }

      this.stats.endTime = new Date();

      // Final summary
      console.log('\n📋 Relationship Fix Summary:');
      console.log(`⏱️  Duration: ${this.stats.endTime.getTime() - this.stats.startTime.getTime()}ms`);
      console.log(`📊 Processed: ${this.stats.relationshipsProcessed}`);
      console.log(`✅ Created: ${this.stats.relationshipsCreated}`);
      console.log(`⏭️  Already Existed: ${this.stats.relationshipsSkipped}`);
      console.log(`❌ Errors: ${this.stats.errors}`);

      return this.stats;

    } catch (error) {
      console.error('💥 Relationship fix failed:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Validate the fix results
   */
  public async validateFix(): Promise<void> {
    console.log('\n🔍 Validating relationship fix results...');

    try {
      // Check total relationships by country
      const relationshipsByCountry = await this.targetPool.query(`
        SELECT
          COALESCE(o.country, 'Unknown') as country,
          COUNT(*) as relationship_count,
          COUNT(DISTINCT do_rel.doctor_id) as unique_doctors,
          COUNT(DISTINCT do_rel.office_id) as unique_offices
        FROM doctor_offices do_rel
        JOIN offices o ON do_rel.office_id = o.id
        WHERE o.legacy_office_id IS NOT NULL
        GROUP BY o.country
        ORDER BY relationship_count DESC
      `);

      console.log('📊 Doctor-Office Relationships by Country:');
      relationshipsByCountry.rows.forEach((row: any) => {
        console.log(`   ${row.country}: ${row.relationship_count} relationships (${row.unique_doctors} doctors, ${row.unique_offices} offices)`);
      });

      // Check overall coverage
      const coverageStats = await this.targetPool.query(`
        SELECT
          COUNT(DISTINCT o.id) as total_offices,
          COUNT(DISTINCT do_rel.office_id) as offices_with_doctors,
          COUNT(*) as total_relationships,
          COUNT(DISTINCT do_rel.doctor_id) as total_doctors_with_offices
        FROM offices o
        LEFT JOIN doctor_offices do_rel ON o.id = do_rel.office_id
        WHERE o.legacy_office_id IS NOT NULL
      `);

      const coverage = coverageStats.rows[0];
      console.log('\n📈 Overall Coverage:');
      console.log(`   Total Offices: ${coverage.total_offices}`);
      console.log(`   Offices with Doctors: ${coverage.offices_with_doctors}`);
      console.log(`   Total Relationships: ${coverage.total_relationships}`);
      console.log(`   Doctors with Offices: ${coverage.total_doctors_with_offices}`);
      console.log(`   Office Coverage: ${((coverage.offices_with_doctors / coverage.total_offices) * 100).toFixed(1)}%`);

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
  const command = args[0] || 'fix';

  const relationshipFix = new DoctorOfficeRelationshipFix();

  try {
    switch (command) {
      case 'fix':
        await relationshipFix.fixAllRelationships();
        await relationshipFix.validateFix();
        break;

      case 'validate':
        await relationshipFix.validateFix();
        break;

      default:
        console.log('Usage: npx ts-node fix-doctor-office-relationships.ts [fix|validate]');
        process.exit(1);
    }

    process.exit(0);

  } catch (error) {
    console.error('💥 Operation failed:', error);
    process.exit(1);
  }
}

// Export for use as module
export { DoctorOfficeRelationshipFix };

// Run if called directly
if (require.main === module) {
  main();
}