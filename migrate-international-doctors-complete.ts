import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

interface SourceDoctor {
  user_id: number;
  first_name: string;
  last_name: string;
  email: string;
  username: string;
  is_active: boolean;
  date_joined: Date;
  last_login?: Date;
  patient_count: number;
  countries: string[];
  office_count: number;
}

interface SourceDoctorOffice {
  id: number;
  office_id: number;
  user_id: number;
  country: string;
  office_name: string;
}

interface MigrationStats {
  doctorsProcessed: number;
  doctorsInserted: number;
  doctorsSkipped: number;
  doctorOfficesProcessed: number;
  doctorOfficesInserted: number;
  doctorOfficesSkipped: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
}

class InternationalDoctorMigration {
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
      doctorsProcessed: 0,
      doctorsInserted: 0,
      doctorsSkipped: 0,
      doctorOfficesProcessed: 0,
      doctorOfficesInserted: 0,
      doctorOfficesSkipped: 0,
      errors: 0,
      startTime: new Date(),
    };
  }

  /**
   * Get all doctors associated with offices (including international)
   */
  private async getSourceDoctors(): Promise<SourceDoctor[]> {
    const query = `
      WITH doctor_office_stats AS (
        SELECT
          dod.user_id,
          array_agg(DISTINCT office.country) as countries,
          COUNT(DISTINCT dod.office_id) as office_count
        FROM dispatch_office_doctors dod
        JOIN dispatch_office office ON dod.office_id = office.id
        WHERE office.country IS NOT NULL
        GROUP BY dod.user_id
      )
      SELECT
        au.id as user_id,
        COALESCE(au.first_name, '') as first_name,
        COALESCE(au.last_name, '') as last_name,
        COALESCE(au.email, '') as email,
        au.username,
        au.is_active,
        au.date_joined,
        au.last_login,
        COALESCE(patient_stats.patient_count, 0) as patient_count,
        dos.countries,
        dos.office_count
      FROM auth_user au
      JOIN doctor_office_stats dos ON au.id = dos.user_id
      LEFT JOIN (
        SELECT doctor_id, COUNT(*) as patient_count
        FROM dispatch_patient
        WHERE archived = false OR archived IS NULL
        GROUP BY doctor_id
      ) patient_stats ON au.id = patient_stats.doctor_id
      WHERE au.is_active = true
        AND NOT (
          LOWER(COALESCE(au.email, '')) LIKE '%test%' OR
          LOWER(COALESCE(au.email, '')) LIKE '%demo%' OR
          LOWER(COALESCE(au.first_name, '')) LIKE '%test%' OR
          LOWER(COALESCE(au.last_name, '')) LIKE '%test%' OR
          COALESCE(au.email, '') LIKE '%brius.com' OR
          COALESCE(au.email, '') LIKE '%mechanodontics.com'
        )
      ORDER BY
        array_length(dos.countries, 1) DESC,
        dos.office_count DESC,
        COALESCE(patient_stats.patient_count, 0) DESC,
        au.id ASC
    `;

    try {
      const result = await this.sourcePool.query(query);
      console.log(`✓ Found ${result.rows.length} doctors with office assignments across all countries`);

      // Show country breakdown
      const countryBreakdown = result.rows.reduce((acc: any, doctor: any) => {
        doctor.countries.forEach((country: string) => {
          acc[country] = (acc[country] || 0) + 1;
        });
        return acc;
      }, {});

      console.log('📊 Doctors by country:');
      Object.entries(countryBreakdown).forEach(([country, count]) => {
        console.log(`   ${country}: ${count} doctors`);
      });

      return result.rows;
    } catch (error) {
      console.error('❌ Error fetching source doctors:', error);
      throw error;
    }
  }

  /**
   * Get all doctor-office relationships
   */
  private async getSourceDoctorOffices(): Promise<SourceDoctorOffice[]> {
    const query = `
      SELECT
        dod.id,
        dod.office_id,
        dod.user_id,
        office.country,
        COALESCE(office.name, 'Office ' || office.id) as office_name
      FROM dispatch_office_doctors dod
      JOIN dispatch_office office ON dod.office_id = office.id
      WHERE office.country IS NOT NULL
      ORDER BY office.country, dod.office_id, dod.user_id
    `;

    try {
      const result = await this.sourcePool.query(query);
      console.log(`✓ Found ${result.rows.length} doctor-office relationships`);

      return result.rows;
    } catch (error) {
      console.error('❌ Error fetching doctor-office relationships:', error);
      throw error;
    }
  }

  /**
   * Get existing mappings from target database
   */
  private async getExistingMappings(): Promise<{
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

    console.log(`✓ Found ${doctorMap.size} existing doctor mappings`);
    console.log(`✓ Found ${officeMap.size} existing office mappings`);

    return { doctorMap, officeMap };
  }

  /**
   * Create doctor profile in target database
   */
  private async createDoctorProfile(doctor: SourceDoctor): Promise<{ success: boolean; id?: string; error?: string }> {
    const profileId = uuidv4();

    // Generate username if needed
    const generateUsername = (firstName: string, lastName: string, email: string) => {
      if (email && email.includes('@')) {
        return email.split('@')[0];
      }
      const first = firstName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const last = lastName.toLowerCase().replace(/[^a-z0-9]/g, '');
      return `${first}_${last}_${doctor.user_id}`.substring(0, 30);
    };

    const username = doctor.username || generateUsername(doctor.first_name, doctor.last_name, doctor.email);
    const email = doctor.email || `${username}@placeholder.com`;

    const insertQuery = `
      INSERT INTO profiles (
        id, profile_type, first_name, last_name, email, username,
        is_active, date_joined, last_login, metadata, legacy_user_id,
        created_at, updated_at
      ) VALUES (
        $1, 'doctor', $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW()
      )
      RETURNING id
    `;

    const metadata = {
      migration: {
        source_table: 'auth_user',
        migrated_at: new Date().toISOString(),
        patient_count: doctor.patient_count,
        countries: doctor.countries,
        office_count: doctor.office_count,
        migration_type: 'international_doctor_complete'
      }
    };

    const values = [
      profileId, doctor.first_name, doctor.last_name, email, username,
      doctor.is_active, doctor.date_joined, doctor.last_login,
      JSON.stringify(metadata), doctor.user_id
    ];

    try {
      await this.targetPool.query(insertQuery, values);
      return { success: true, id: profileId };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Create doctor-office relationship
   */
  private async createDoctorOfficeRelationship(
    doctorId: string,
    officeId: string,
    sourceRelationship: SourceDoctorOffice
  ): Promise<boolean> {
    const query = `
      INSERT INTO doctor_offices (doctor_id, office_id, is_primary, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      ON CONFLICT (doctor_id, office_id) DO NOTHING
    `;

    try {
      const result = await this.targetPool.query(query, [doctorId, officeId, false, true]);
      return result.rowCount === 1;
    } catch (error) {
      console.error(`❌ Error creating doctor-office relationship:`, error);
      return false;
    }
  }

  /**
   * Record migration mapping
   */
  private async recordMapping(legacyId: number, newId: string, entityType: string): Promise<void> {
    const query = `
      INSERT INTO migration_mappings (
        entity_type, legacy_id, new_id, migrated_at, migration_batch
      ) VALUES (
        $1, $2, $3, NOW(), 'international_doctors_' || TO_CHAR(NOW(), 'YYYYMMDD_HH24MISS')
      )
      ON CONFLICT (entity_type, legacy_id) DO UPDATE SET
        new_id = $3,
        migrated_at = NOW(),
        migration_batch = 'international_doctors_' || TO_CHAR(NOW(), 'YYYYMMDD_HH24MISS')
    `;

    try {
      await this.targetPool.query(query, [entityType, legacyId, newId]);
    } catch (error) {
      console.error(`⚠️  Warning: Could not record mapping for ${entityType} ${legacyId}:`, error);
    }
  }

  /**
   * Main migration function
   */
  public async migrateDoctorNetwork(): Promise<MigrationStats> {
    console.log('🚀 Starting International Doctor Network Migration...\n');

    try {
      // Get source data
      const [sourceDoctors, sourceDoctorOffices, { doctorMap, officeMap }] = await Promise.all([
        this.getSourceDoctors(),
        this.getSourceDoctorOffices(),
        this.getExistingMappings()
      ]);

      console.log('\n🔄 Phase 1: Migrating Missing Doctors...');

      // Migrate missing doctors
      for (const doctor of sourceDoctors) {
        try {
          this.stats.doctorsProcessed++;

          if (doctorMap.has(doctor.user_id)) {
            this.stats.doctorsSkipped++;
            console.log(`⏭️  Doctor already exists: ${doctor.first_name} ${doctor.last_name} (${doctor.user_id})`);
            continue;
          }

          console.log(`🆕 Creating doctor: ${doctor.first_name} ${doctor.last_name} from ${doctor.countries.join(', ')}`);

          const createResult = await this.createDoctorProfile(doctor);

          if (createResult.success) {
            this.stats.doctorsInserted++;
            doctorMap.set(doctor.user_id, createResult.id!);
            await this.recordMapping(doctor.user_id, createResult.id!, 'doctor');
            console.log(`✅ Created doctor: ${doctor.first_name} ${doctor.last_name} (${doctor.user_id} → ${createResult.id})`);
          } else {
            this.stats.errors++;
            console.log(`❌ Failed to create doctor ${doctor.user_id}: ${createResult.error}`);
          }

        } catch (error) {
          this.stats.errors++;
          console.error(`❌ Error processing doctor ${doctor.user_id}:`, error);
        }
      }

      console.log('\n🔄 Phase 2: Creating Doctor-Office Relationships...');

      // Create doctor-office relationships
      for (const relationship of sourceDoctorOffices) {
        try {
          this.stats.doctorOfficesProcessed++;

          const doctorId = doctorMap.get(relationship.user_id);
          const officeId = officeMap.get(relationship.office_id);

          if (!doctorId) {
            console.log(`⏭️  Skipping relationship: Doctor ${relationship.user_id} not found in mappings`);
            this.stats.doctorOfficesSkipped++;
            continue;
          }

          if (!officeId) {
            console.log(`⏭️  Skipping relationship: Office ${relationship.office_id} not found in mappings`);
            this.stats.doctorOfficesSkipped++;
            continue;
          }

          const success = await this.createDoctorOfficeRelationship(doctorId, officeId, relationship);

          if (success) {
            this.stats.doctorOfficesInserted++;
            console.log(`✅ Created relationship: Doctor ${relationship.user_id} ↔ Office ${relationship.office_id} (${relationship.country})`);
          } else {
            this.stats.doctorOfficesSkipped++;
            console.log(`⏭️  Relationship already exists: Doctor ${relationship.user_id} ↔ Office ${relationship.office_id}`);
          }

        } catch (error) {
          this.stats.errors++;
          console.error(`❌ Error processing relationship ${relationship.id}:`, error);
        }
      }

      this.stats.endTime = new Date();

      // Final summary
      console.log('\n📋 Migration Summary:');
      console.log(`⏱️  Duration: ${this.stats.endTime.getTime() - this.stats.startTime.getTime()}ms`);
      console.log(`\n👨‍⚕️ DOCTORS:`);
      console.log(`   📊 Processed: ${this.stats.doctorsProcessed}`);
      console.log(`   ✅ Inserted: ${this.stats.doctorsInserted}`);
      console.log(`   ⏭️  Skipped: ${this.stats.doctorsSkipped}`);
      console.log(`\n🏢 DOCTOR-OFFICE RELATIONSHIPS:`);
      console.log(`   📊 Processed: ${this.stats.doctorOfficesProcessed}`);
      console.log(`   ✅ Inserted: ${this.stats.doctorOfficesInserted}`);
      console.log(`   ⏭️  Skipped: ${this.stats.doctorOfficesSkipped}`);
      console.log(`\n❌ Total Errors: ${this.stats.errors}`);

      return this.stats;

    } catch (error) {
      console.error('💥 Migration failed:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Validate the migration results
   */
  public async validateMigration(): Promise<void> {
    console.log('\n🔍 Validating migration results...');

    try {
      // Check doctor counts by country
      const doctorsByCountry = await this.targetPool.query(`
        SELECT
          regexp_split_to_table(metadata->>'migration'->>'countries', ',') as country,
          COUNT(*) as doctor_count
        FROM profiles
        WHERE profile_type = 'doctor'
          AND metadata->>'migration'->>'countries' IS NOT NULL
        GROUP BY country
        ORDER BY doctor_count DESC
      `);

      console.log('📊 Doctors by country in destination:');
      doctorsByCountry.rows.forEach((row: any) => {
        const country = row.country.replace(/[\[\]"]/g, '').trim();
        console.log(`   ${country}: ${row.doctor_count} doctors`);
      });

      // Check doctor-office relationship counts
      const relationshipCounts = await this.targetPool.query(`
        SELECT
          COUNT(*) as total_relationships,
          COUNT(DISTINCT doctor_id) as unique_doctors,
          COUNT(DISTINCT office_id) as unique_offices
        FROM doctor_offices
      `);

      console.log('\n🔗 Doctor-Office Relationships:');
      const rel = relationshipCounts.rows[0];
      console.log(`   Total relationships: ${rel.total_relationships}`);
      console.log(`   Unique doctors: ${rel.unique_doctors}`);
      console.log(`   Unique offices: ${rel.unique_offices}`);

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
  const command = args[0] || 'migrate';

  const migration = new InternationalDoctorMigration();

  try {
    switch (command) {
      case 'migrate':
        await migration.migrateDoctorNetwork();
        await migration.validateMigration();
        break;

      case 'validate':
        await migration.validateMigration();
        break;

      default:
        console.log('Usage: npx ts-node migrate-international-doctors-complete.ts [migrate|validate]');
        process.exit(1);
    }

    process.exit(0);

  } catch (error) {
    console.error('💥 Operation failed:', error);
    process.exit(1);
  }
}

// Export for use as module
export { InternationalDoctorMigration };

// Run if called directly
if (require.main === module) {
  main();
}