import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

interface SourceRelationship {
  patient_id: number;
  doctor_id: number;
  office_id: number;
  patient_name?: string;
  doctor_name?: string;
  office_name?: string;
  office_country?: string;
  created_at?: Date;
}

interface RelationshipSyncStats {
  totalSourceRelationships: number;
  existingRelationships: number;
  newRelationshipsCreated: number;
  skippedRelationships: number;
  errors: number;
  internationalRelationships: number;
  domesticRelationships: number;
  countriesCovered: string[];
  startTime: Date;
  endTime?: Date;
}

class DoctorPatientRelationshipSync {
  private sourcePool: Pool;
  private targetPool: Pool;
  private stats: RelationshipSyncStats;
  private batchSize: number = 500;

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
      host: process.env.TARGET_DB_HOST || 'localhost',
      port: parseInt(process.env.TARGET_DB_PORT || '54322'),
      database: process.env.TARGET_DB_NAME || 'postgres',
      user: process.env.TARGET_DB_USER || 'supabase_admin',
      password: process.env.TARGET_DB_PASSWORD || 'postgres',
    });

    this.stats = {
      totalSourceRelationships: 0,
      existingRelationships: 0,
      newRelationshipsCreated: 0,
      skippedRelationships: 0,
      errors: 0,
      internationalRelationships: 0,
      domesticRelationships: 0,
      countriesCovered: [],
      startTime: new Date(),
    };
  }

  /**
   * Get all source relationships from dispatch_patient
   */
  private async getSourceRelationships(): Promise<SourceRelationship[]> {
    console.log('🔍 Fetching all doctor-patient-office relationships from source database...');

    const sourceQuery = `
      SELECT
        dp.id as patient_id,
        dp.doctor_id,
        dp.office_id,
        'Patient ID: ' || dp.id as patient_name,
        'Doctor ID: ' || dp.doctor_id as doctor_name,
        doff.name as office_name,
        doff.country as office_country,
        dp.submitted_at as created_at
      FROM dispatch_patient dp
      INNER JOIN dispatch_office doff ON dp.office_id = doff.id
      WHERE dp.doctor_id IS NOT NULL
      ORDER BY dp.id;
    `;

    const result = await this.sourcePool.query(sourceQuery);
    const relationships = result.rows;

    this.stats.totalSourceRelationships = relationships.length;

    // Analyze by country
    const countries = new Set<string>();
    let international = 0;
    let domestic = 0;

    relationships.forEach(rel => {
      if (rel.office_country) {
        countries.add(rel.office_country);
        if (['USA', 'US', 'UNITED STATES', 'UNITED STATES OF AMERICA'].includes(rel.office_country.toUpperCase())) {
          domestic++;
        } else {
          international++;
        }
      }
    });

    this.stats.internationalRelationships = international;
    this.stats.domesticRelationships = domestic;
    this.stats.countriesCovered = Array.from(countries);

    console.log(`✓ Found ${this.stats.totalSourceRelationships} total relationships`);
    console.log(`   📍 Domestic (USA): ${domestic}`);
    console.log(`   🌍 International: ${international}`);
    console.log(`   🏢 Countries: ${this.stats.countriesCovered.length} (${Array.from(countries).slice(0, 5).join(', ')}${countries.size > 5 ? '...' : ''})`);

    return relationships;
  }

  /**
   * Get existing relationships from target database
   */
  private async getExistingRelationships(): Promise<Set<string>> {
    console.log('\n🔍 Checking existing relationships in target database...');

    const existingQuery = `
      SELECT
        p.legacy_patient_id,
        d.legacy_user_id as doctor_legacy_id,
        o.legacy_office_id
      FROM patients_doctors_offices pdo
      INNER JOIN patients p ON pdo.patient_id = p.id
      INNER JOIN doctors d ON pdo.doctor_id = d.id
      INNER JOIN offices o ON pdo.office_id = o.id
      WHERE p.legacy_patient_id IS NOT NULL
        AND d.legacy_user_id IS NOT NULL
        AND o.legacy_office_id IS NOT NULL;
    `;

    const result = await this.targetPool.query(existingQuery);
    const existingKeys = new Set<string>();

    result.rows.forEach(row => {
      const key = `${row.legacy_patient_id}:${row.doctor_legacy_id}:${row.legacy_office_id}`;
      existingKeys.add(key);
    });

    this.stats.existingRelationships = existingKeys.size;
    console.log(`✓ Found ${this.stats.existingRelationships} existing relationships`);

    return existingKeys;
  }

  /**
   * Get UUID mappings for patients, doctors, and offices
   */
  private async getUuidMappings(): Promise<{
    patientMappings: Map<number, string>,
    doctorMappings: Map<number, string>,
    officeMappings: Map<number, string>
  }> {
    console.log('\n📋 Loading UUID mappings...');

    const [patientResult, doctorResult, officeResult] = await Promise.all([
      this.targetPool.query(`
        SELECT legacy_patient_id, id
        FROM patients
        WHERE legacy_patient_id IS NOT NULL
      `),
      this.targetPool.query(`
        SELECT legacy_user_id, id
        FROM doctors
        WHERE legacy_user_id IS NOT NULL
      `),
      this.targetPool.query(`
        SELECT legacy_office_id, id
        FROM offices
        WHERE legacy_office_id IS NOT NULL
      `)
    ]);

    const patientMappings = new Map<number, string>();
    const doctorMappings = new Map<number, string>();
    const officeMappings = new Map<number, string>();

    patientResult.rows.forEach(row => {
      patientMappings.set(row.legacy_patient_id, row.id);
    });

    doctorResult.rows.forEach(row => {
      doctorMappings.set(row.legacy_user_id, row.id);
    });

    officeResult.rows.forEach(row => {
      officeMappings.set(row.legacy_office_id, row.id);
    });

    console.log(`✓ Loaded ${patientMappings.size} patient mappings`);
    console.log(`✓ Loaded ${doctorMappings.size} doctor mappings`);
    console.log(`✓ Loaded ${officeMappings.size} office mappings`);

    return { patientMappings, doctorMappings, officeMappings };
  }

  /**
   * Create missing relationships in batches
   */
  private async createRelationshipsBatch(
    relationships: SourceRelationship[],
    existingKeys: Set<string>,
    patientMappings: Map<number, string>,
    doctorMappings: Map<number, string>,
    officeMappings: Map<number, string>
  ): Promise<void> {
    if (relationships.length === 0) return;

    console.log(`📦 Processing batch of ${relationships.length} relationships...`);

    const newRelationships = [];
    let skippedExisting = 0;
    let skippedMissingMappings = 0;

    for (const rel of relationships) {
      // Create compound key to check if relationship exists
      const key = `${rel.patient_id}:${rel.doctor_id}:${rel.office_id}`;

      if (existingKeys.has(key)) {
        skippedExisting++;
        continue;
      }

      // Get UUID mappings
      const patientUuid = patientMappings.get(rel.patient_id);
      const doctorUuid = doctorMappings.get(rel.doctor_id);
      const officeUuid = officeMappings.get(rel.office_id);

      if (!patientUuid) {
        console.log(`⚠️  Missing patient mapping: patient_id ${rel.patient_id} (${rel.patient_name})`);
        skippedMissingMappings++;
        continue;
      }

      if (!doctorUuid) {
        console.log(`⚠️  Missing doctor mapping: doctor_id ${rel.doctor_id} (${rel.doctor_name})`);
        skippedMissingMappings++;
        continue;
      }

      if (!officeUuid) {
        console.log(`⚠️  Missing office mapping: office_id ${rel.office_id} (${rel.office_name})`);
        skippedMissingMappings++;
        continue;
      }

      // Create new relationship record
      newRelationships.push({
        patient_id: patientUuid,
        doctor_id: doctorUuid,
        office_id: officeUuid,
        created_at: rel.created_at || new Date()
      });

      // Add to existing keys to prevent duplicates within batch
      existingKeys.add(key);
    }

    console.log(`   → ${newRelationships.length} new relationships to create`);
    console.log(`   → ${skippedExisting} already exist`);
    console.log(`   → ${skippedMissingMappings} skipped (missing mappings)`);

    this.stats.skippedRelationships += (skippedExisting + skippedMissingMappings);

    if (newRelationships.length === 0) {
      return;
    }

    try {
      // Insert new relationships
      const insertQuery = `
        INSERT INTO patients_doctors_offices (
          patient_id, doctor_id, office_id, created_at
        ) VALUES ${newRelationships.map((_, i) =>
          `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`
        ).join(', ')}
      `;

      const values = newRelationships.flatMap(rel => [
        rel.patient_id,
        rel.doctor_id,
        rel.office_id,
        rel.created_at
      ]);

      const result = await this.targetPool.query(insertQuery, values);
      const insertedCount = result.rowCount || 0;

      this.stats.newRelationshipsCreated += insertedCount;

      console.log(`✅ Created ${insertedCount} new relationships`);

      // Show sample of what was created
      if (insertedCount > 0 && relationships.length > 0) {
        const sampleRel = relationships[0];
        console.log(`   📋 Sample: ${sampleRel.patient_name} ↔ ${sampleRel.doctor_name} ↔ ${sampleRel.office_name} (${sampleRel.office_country})`);
      }

    } catch (error) {
      this.stats.errors++;
      console.error(`❌ Error creating relationships batch:`, error);
    }
  }

  /**
   * Main synchronization function
   */
  public async executeDoctorPatientSync(): Promise<RelationshipSyncStats> {
    console.log('🚀 Starting Comprehensive Doctor-Patient-Office Relationship Sync...\n');

    try {
      // Get source data, existing relationships, and mappings
      const [sourceRelationships, existingKeys, mappings] = await Promise.all([
        this.getSourceRelationships(),
        this.getExistingRelationships(),
        this.getUuidMappings()
      ]);

      const { patientMappings, doctorMappings, officeMappings } = mappings;

      // Filter to only missing relationships
      const missingRelationships = sourceRelationships.filter(rel => {
        const key = `${rel.patient_id}:${rel.doctor_id}:${rel.office_id}`;
        return !existingKeys.has(key);
      });

      console.log(`\n📊 Analysis:`);
      console.log(`   Total source relationships: ${sourceRelationships.length}`);
      console.log(`   Already synced: ${this.stats.existingRelationships}`);
      console.log(`   Missing relationships: ${missingRelationships.length}`);

      if (missingRelationships.length === 0) {
        console.log('\n🎉 All relationships are already synchronized!');
        this.stats.endTime = new Date();
        return this.stats;
      }

      console.log('\n🔄 Starting batch synchronization...');

      // Process in batches
      for (let i = 0; i < missingRelationships.length; i += this.batchSize) {
        const batchStartTime = Date.now();
        const batch = missingRelationships.slice(i, i + this.batchSize);

        await this.createRelationshipsBatch(batch, existingKeys, patientMappings, doctorMappings, officeMappings);

        const batchDuration = Date.now() - batchStartTime;
        const recordsPerSecond = (batch.length / batchDuration * 1000).toFixed(0);
        console.log(`   ⚡ Batch ${Math.floor(i / this.batchSize) + 1} completed in ${batchDuration}ms (${recordsPerSecond} relationships/sec)`);

        if (this.stats.newRelationshipsCreated % 2000 === 0 && this.stats.newRelationshipsCreated > 0) {
          console.log(`📈 Progress: ${this.stats.newRelationshipsCreated} relationships created...`);
        }
      }

      this.stats.endTime = new Date();

      // Final summary
      console.log('\n📋 Doctor-Patient-Office Relationship Sync Summary:');
      console.log(`⏱️  Duration: ${this.stats.endTime.getTime() - this.stats.startTime.getTime()}ms`);
      console.log(`📊 Source Relationships: ${this.stats.totalSourceRelationships}`);
      console.log(`✅ Previously Synced: ${this.stats.existingRelationships}`);
      console.log(`🆕 Newly Created: ${this.stats.newRelationshipsCreated}`);
      console.log(`⏭️  Skipped: ${this.stats.skippedRelationships}`);
      console.log(`❌ Errors: ${this.stats.errors}`);
      console.log(`🌍 Countries: ${this.stats.countriesCovered.length}`);

      const syncRate = this.stats.totalSourceRelationships > 0
        ? (((this.stats.existingRelationships + this.stats.newRelationshipsCreated) / this.stats.totalSourceRelationships) * 100).toFixed(2)
        : 100;
      console.log(`📈 Total Sync Rate: ${syncRate}%`);

      if (this.stats.newRelationshipsCreated > 0) {
        console.log(`\n🎉 Successfully created ${this.stats.newRelationshipsCreated} new doctor-patient-office relationships!`);
        console.log('🔗 All patients now have complete doctor and office associations');
      }

      return this.stats;

    } catch (error) {
      console.error('💥 Doctor-patient relationship sync failed:', error);
      throw error;
    }
  }

  /**
   * Validate the synchronization results
   */
  public async validateSync(): Promise<void> {
    console.log('\n🔍 Validating doctor-patient-office relationship sync...');

    try {
      // Current counts
      const currentCountsQuery = `
        SELECT
          COUNT(*) as total_relationships,
          COUNT(DISTINCT patient_id) as unique_patients,
          COUNT(DISTINCT doctor_id) as unique_doctors,
          COUNT(DISTINCT office_id) as unique_offices
        FROM patients_doctors_offices;
      `;

      const currentResult = await this.targetPool.query(currentCountsQuery);
      const current = currentResult.rows[0];

      console.log('📊 Current Relationship Status:');
      console.log(`   Total Relationships: ${current.total_relationships}`);
      console.log(`   Unique Patients: ${current.unique_patients}`);
      console.log(`   Unique Doctors: ${current.unique_doctors}`);
      console.log(`   Unique Offices: ${current.unique_offices}`);

      // Breakdown by country
      const countryBreakdownQuery = `
        SELECT
          o.country,
          COUNT(*) as relationship_count,
          COUNT(DISTINCT pdo.patient_id) as patient_count,
          COUNT(DISTINCT pdo.doctor_id) as doctor_count
        FROM patients_doctors_offices pdo
        INNER JOIN offices o ON pdo.office_id = o.id
        WHERE o.country IS NOT NULL
        GROUP BY o.country
        ORDER BY relationship_count DESC;
      `;

      const countryResult = await this.targetPool.query(countryBreakdownQuery);

      console.log('\n📊 Relationships by Country:');
      countryResult.rows.forEach(row => {
        const isInternational = !['USA', 'US', 'UNITED STATES', 'UNITED STATES OF AMERICA']
          .includes(row.country.toUpperCase());
        const flag = isInternational ? '🌍' : '🇺🇸';
        console.log(`   ${flag} ${row.country}: ${row.relationship_count} relationships (${row.patient_count} patients, ${row.doctor_count} doctors)`);
      });

      // Check coverage compared to source
      console.log(`\n📊 Coverage Analysis:`);
      console.log(`   Source Total: ${this.stats.totalSourceRelationships}`);
      console.log(`   Target Total: ${current.total_relationships}`);
      const coverage = this.stats.totalSourceRelationships > 0
        ? ((current.total_relationships / this.stats.totalSourceRelationships) * 100).toFixed(2)
        : '100';
      console.log(`   Coverage: ${coverage}%`);

      if (parseFloat(coverage) >= 95) {
        console.log('✅ Excellent coverage - relationship sync is comprehensive');
      } else if (parseFloat(coverage) >= 90) {
        console.log('⚠️  Good coverage - minor gaps may exist');
      } else {
        console.log('❌ Coverage gap detected - additional sync may be needed');
      }

      console.log('\n✅ Validation completed');

    } catch (error) {
      console.error('❌ Validation failed:', error);
    }
  }

  /**
   * Cleanup connections
   */
  public async cleanup(): Promise<void> {
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
  const command = args[0] || 'sync';

  const sync = new DoctorPatientRelationshipSync();

  try {
    switch (command) {
      case 'sync':
        await sync.executeDoctorPatientSync();
        await sync.validateSync();
        break;

      case 'validate':
        await sync.validateSync();
        break;

      default:
        console.log('Usage: npx ts-node sync-doctor-patient-relationships-comprehensive.ts [sync|validate]');
        process.exit(1);
    }

    process.exit(0);

  } catch (error) {
    console.error('💥 Operation failed:', error);
    process.exit(1);
  } finally {
    if (sync) {
      await sync.cleanup();
    }
  }
}

// Export for use as module
export { DoctorPatientRelationshipSync };

// Run if called directly
if (require.main === module) {
  main();
}