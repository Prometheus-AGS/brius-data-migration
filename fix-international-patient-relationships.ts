import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

interface PatientRelationship {
  sourcePatientId: number;
  sourceDoctorId: number;
  sourceOfficeId: number;
  targetPatientId: string;
  targetDoctorId: string;
  targetOfficeId: string;
  country: string;
  patientName?: string;
  doctorName?: string;
  officeName?: string;
}

interface MigrationStats {
  relationshipsProcessed: number;
  relationshipsCreated: number;
  relationshipsSkipped: number;
  patientAssignmentsUpdated: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
}

class InternationalPatientRelationshipFix {
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
      patientAssignmentsUpdated: 0,
      errors: 0,
      startTime: new Date(),
    };
  }

  /**
   * Get all patient-doctor-office relationships from source
   */
  private async getSourcePatientRelationships(): Promise<any[]> {
    const query = `
      SELECT
        dp.id as source_patient_id,
        dp.doctor_id as source_doctor_id,
        dp.office_id as source_office_id,
        office.country,
        office.name as office_name,
        COALESCE(NULLIF(au.first_name, ''), '') || ' ' || COALESCE(NULLIF(au.last_name, ''), '') as doctor_name,
        COALESCE(NULLIF(pu.first_name, ''), '') || ' ' || COALESCE(NULLIF(pu.last_name, ''), '') as patient_name
      FROM dispatch_patient dp
      JOIN dispatch_office office ON dp.office_id = office.id
      JOIN auth_user au ON dp.doctor_id = au.id
      JOIN auth_user pu ON dp.user_id = pu.id
      WHERE office.country IS NOT NULL
        AND (dp.archived = false OR dp.archived IS NULL)
        AND dp.doctor_id IS NOT NULL
      ORDER BY office.country, office.id, dp.id
    `;

    try {
      const result = await this.sourcePool.query(query);
      console.log(`✓ Found ${result.rows.length} patient relationships in source`);

      // Show breakdown by country
      const countryBreakdown = result.rows.reduce((acc: any, row: any) => {
        acc[row.country] = (acc[row.country] || 0) + 1;
        return acc;
      }, {});

      console.log('📊 Patient relationships by country:');
      Object.entries(countryBreakdown).forEach(([country, count]) => {
        console.log(`   ${country}: ${count} relationships`);
      });

      return result.rows;
    } catch (error) {
      console.error('❌ Error fetching source relationships:', error);
      throw error;
    }
  }

  /**
   * Get target mappings for patients, doctors and offices
   */
  private async getTargetMappings(): Promise<{
    patientMap: Map<number, string>,
    doctorMap: Map<number, string>,
    officeMap: Map<number, string>
  }> {
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

    const patientMap = new Map<number, string>();
    const doctorMap = new Map<number, string>();
    const officeMap = new Map<number, string>();

    patientResult.rows.forEach(row => {
      patientMap.set(row.legacy_patient_id, row.id);
    });

    doctorResult.rows.forEach(row => {
      doctorMap.set(row.legacy_user_id, row.id);
    });

    officeResult.rows.forEach(row => {
      officeMap.set(row.legacy_office_id, row.id);
    });

    console.log(`✓ Found ${patientMap.size} patient mappings`);
    console.log(`✓ Found ${doctorMap.size} doctor mappings`);
    console.log(`✓ Found ${officeMap.size} office mappings`);

    return { patientMap, doctorMap, officeMap };
  }

  /**
   * Build complete relationship mappings
   */
  private async getMissingPatientRelationships(): Promise<PatientRelationship[]> {
    try {
      const [sourceRelationships, { patientMap, doctorMap, officeMap }] = await Promise.all([
        this.getSourcePatientRelationships(),
        this.getTargetMappings()
      ]);

      const relationships: PatientRelationship[] = [];
      let skipped = 0;

      for (const sourceRel of sourceRelationships) {
        const patientId = patientMap.get(sourceRel.source_patient_id);
        const doctorId = doctorMap.get(sourceRel.source_doctor_id);
        const officeId = officeMap.get(sourceRel.source_office_id);

        if (!patientId || !doctorId || !officeId) {
          skipped++;
          continue;
        }

        relationships.push({
          sourcePatientId: sourceRel.source_patient_id,
          sourceDoctorId: sourceRel.source_doctor_id,
          sourceOfficeId: sourceRel.source_office_id,
          targetPatientId: patientId,
          targetDoctorId: doctorId,
          targetOfficeId: officeId,
          country: sourceRel.country,
          patientName: sourceRel.patient_name,
          doctorName: sourceRel.doctor_name,
          officeName: sourceRel.office_name
        });
      }

      console.log(`✓ Built ${relationships.length} relationship mappings (${skipped} skipped due to missing mappings)`);

      return relationships;
    } catch (error) {
      console.error('❌ Error building relationship mappings:', error);
      throw error;
    }
  }

  /**
   * Check if relationship already exists
   */
  private async relationshipExists(patientId: string, doctorId: string, officeId: string): Promise<boolean> {
    const query = `
      SELECT 1 FROM patients_doctors_offices
      WHERE patient_id = $1 AND doctor_id = $2 AND office_id = $3
      LIMIT 1
    `;

    try {
      const result = await this.targetPool.query(query, [patientId, doctorId, officeId]);
      return result.rows.length > 0;
    } catch (error) {
      console.error(`❌ Error checking relationship existence:`, error);
      return false;
    }
  }

  /**
   * Create patient-doctor-office relationship
   */
  private async createRelationship(relationship: PatientRelationship): Promise<boolean> {
    const query = `
      INSERT INTO patients_doctors_offices (patient_id, doctor_id, office_id, created_at)
      VALUES ($1, $2, $3, NOW())
    `;

    try {
      await this.targetPool.query(query, [
        relationship.targetPatientId,
        relationship.targetDoctorId,
        relationship.targetOfficeId
      ]);
      return true;
    } catch (error) {
      console.error(`❌ Error creating relationship:`, error);
      return false;
    }
  }

  /**
   * Update patient assignments (office and doctor)
   */
  private async updatePatientAssignments(relationship: PatientRelationship): Promise<boolean> {
    const query = `
      UPDATE patients
      SET
        assigned_office_id = $1,
        primary_doctor_id = $2,
        updated_at = NOW()
      WHERE id = $3
        AND (assigned_office_id IS NULL OR primary_doctor_id IS NULL)
    `;

    try {
      const result = await this.targetPool.query(query, [
        relationship.targetOfficeId,
        relationship.targetDoctorId,
        relationship.targetPatientId
      ]);
      return (result.rowCount || 0) > 0;
    } catch (error) {
      console.error(`❌ Error updating patient assignments:`, error);
      return false;
    }
  }

  /**
   * Main migration function
   */
  public async fixPatientRelationships(): Promise<MigrationStats> {
    console.log('🚀 Starting International Patient Relationship Fix...\n');

    try {
      const missingRelationships = await this.getMissingPatientRelationships();

      console.log('\n🔄 Creating missing patient relationships...');

      for (const relationship of missingRelationships) {
        try {
          this.stats.relationshipsProcessed++;

          // Check if relationship already exists
          const exists = await this.relationshipExists(
            relationship.targetPatientId,
            relationship.targetDoctorId,
            relationship.targetOfficeId
          );

          if (exists) {
            this.stats.relationshipsSkipped++;
            console.log(`⏭️  Relationship exists: ${relationship.patientName?.trim()} ↔ ${relationship.doctorName?.trim()} ↔ ${relationship.officeName} (${relationship.country})`);
            continue;
          }

          // Create the relationship
          const relationshipSuccess = await this.createRelationship(relationship);

          if (relationshipSuccess) {
            this.stats.relationshipsCreated++;

            // Update patient assignments if needed
            const assignmentSuccess = await this.updatePatientAssignments(relationship);
            if (assignmentSuccess) {
              this.stats.patientAssignmentsUpdated++;
            }

            console.log(`✅ Created: ${relationship.patientName?.trim()} ↔ ${relationship.doctorName?.trim()} ↔ ${relationship.officeName} (${relationship.country})`);
          } else {
            this.stats.errors++;
            console.log(`❌ Failed: ${relationship.patientName?.trim()} ↔ ${relationship.doctorName?.trim()} ↔ ${relationship.officeName} (${relationship.country})`);
          }

        } catch (error) {
          this.stats.errors++;
          console.error(`❌ Error processing relationship for patient ${relationship.sourcePatientId}:`, error);
        }
      }

      this.stats.endTime = new Date();

      // Final summary
      console.log('\n📋 Patient Relationship Fix Summary:');
      console.log(`⏱️  Duration: ${this.stats.endTime.getTime() - this.stats.startTime.getTime()}ms`);
      console.log(`📊 Processed: ${this.stats.relationshipsProcessed}`);
      console.log(`✅ Created: ${this.stats.relationshipsCreated}`);
      console.log(`⏭️  Already Existed: ${this.stats.relationshipsSkipped}`);
      console.log(`👤 Patient Assignments Updated: ${this.stats.patientAssignmentsUpdated}`);
      console.log(`❌ Errors: ${this.stats.errors}`);

      return this.stats;

    } catch (error) {
      console.error('💥 Patient relationship fix failed:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Validate the fix results
   */
  public async validateFix(): Promise<void> {
    console.log('\n🔍 Validating patient relationship fix results...');

    try {
      // Check relationships by country
      const relationshipsByCountry = await this.targetPool.query(`
        SELECT
          COALESCE(o.country, 'Unknown') as country,
          COUNT(*) as relationship_count,
          COUNT(DISTINCT pdo.patient_id) as unique_patients,
          COUNT(DISTINCT pdo.doctor_id) as unique_doctors,
          COUNT(DISTINCT pdo.office_id) as unique_offices
        FROM patients_doctors_offices pdo
        JOIN offices o ON pdo.office_id = o.id
        WHERE o.legacy_office_id IS NOT NULL
        GROUP BY o.country
        ORDER BY relationship_count DESC
      `);

      console.log('📊 Patient Relationships by Country:');
      relationshipsByCountry.rows.forEach((row: any) => {
        console.log(`   ${row.country}: ${row.relationship_count} relationships (${row.unique_patients} patients, ${row.unique_doctors} doctors, ${row.unique_offices} offices)`);
      });

      // Check remaining missing relationships
      const stillMissing = await this.targetPool.query(`
        SELECT COUNT(*) as patients_still_missing_relationships
        FROM patients p
        LEFT JOIN patients_doctors_offices pdo ON p.id = pdo.patient_id
        WHERE pdo.patient_id IS NULL
          AND p.legacy_patient_id IS NOT NULL
      `);

      console.log(`\n📈 Patients still missing relationships: ${stillMissing.rows[0].patients_still_missing_relationships}`);

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

  const relationshipFix = new InternationalPatientRelationshipFix();

  try {
    switch (command) {
      case 'fix':
        await relationshipFix.fixPatientRelationships();
        await relationshipFix.validateFix();
        break;

      case 'validate':
        await relationshipFix.validateFix();
        break;

      default:
        console.log('Usage: npx ts-node fix-international-patient-relationships.ts [fix|validate]');
        process.exit(1);
    }

    process.exit(0);

  } catch (error) {
    console.error('💥 Operation failed:', error);
    process.exit(1);
  }
}

// Export for use as module
export { InternationalPatientRelationshipFix };

// Run if called directly
if (require.main === module) {
  main();
}