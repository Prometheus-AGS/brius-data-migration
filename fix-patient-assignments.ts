import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

interface AssignmentUpdate {
  patientId: string;
  currentOfficeId: string | null;
  currentDoctorId: string | null;
  newOfficeId: string;
  newDoctorId: string;
  patientName?: string;
  officeName?: string;
  doctorName?: string;
}

interface AssignmentStats {
  patientsProcessed: number;
  officeAssignmentsUpdated: number;
  doctorAssignmentsUpdated: number;
  patientsAlreadyAssigned: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
}

class PatientAssignmentFix {
  private targetPool: Pool;
  private stats: AssignmentStats;

  constructor() {
    this.targetPool = new Pool({
      host: process.env.TARGET_DB_HOST,
      port: parseInt(process.env.TARGET_DB_PORT || '5432'),
      database: process.env.TARGET_DB_NAME,
      user: process.env.TARGET_DB_USER,
      password: process.env.TARGET_DB_PASSWORD,
    });

    this.stats = {
      patientsProcessed: 0,
      officeAssignmentsUpdated: 0,
      doctorAssignmentsUpdated: 0,
      patientsAlreadyAssigned: 0,
      errors: 0,
      startTime: new Date(),
    };
  }

  /**
   * Get patients missing office or doctor assignments
   */
  private async getPatientsNeedingAssignments(): Promise<any[]> {
    const query = `
      SELECT
        p.id as patient_id,
        p.assigned_office_id,
        p.primary_doctor_id,
        pp.first_name || ' ' || pp.last_name as patient_name,
        -- Get first relationship for this patient (there should be at least one)
        pdo.office_id as relationship_office_id,
        pdo.doctor_id as relationship_doctor_id,
        o.name as office_name,
        dp.first_name || ' ' || dp.last_name as doctor_name,
        pdo.created_at
      FROM patients p
      JOIN profiles pp ON p.profile_id = pp.id
      JOIN patients_doctors_offices pdo ON p.id = pdo.patient_id
      JOIN offices o ON pdo.office_id = o.id
      JOIN doctors d ON pdo.doctor_id = d.id
      JOIN profiles dp ON d.profile_id = dp.id
      WHERE p.legacy_patient_id IS NOT NULL
        AND (p.assigned_office_id IS NULL OR p.primary_doctor_id IS NULL)
      ORDER BY p.id, pdo.created_at
    `;

    try {
      const result = await this.targetPool.query(query);
      console.log(`✓ Found ${result.rows.length} patients needing assignment updates`);

      // Group by patient to get the first relationship for each patient
      const patientMap = new Map();
      result.rows.forEach(row => {
        if (!patientMap.has(row.patient_id)) {
          patientMap.set(row.patient_id, row);
        }
      });

      const uniquePatients = Array.from(patientMap.values());
      console.log(`✓ ${uniquePatients.length} unique patients need assignment updates`);

      // Show breakdown by missing assignment type
      const missingOffice = uniquePatients.filter(p => !p.assigned_office_id).length;
      const missingDoctor = uniquePatients.filter(p => !p.primary_doctor_id).length;

      console.log(`   Missing office assignments: ${missingOffice}`);
      console.log(`   Missing doctor assignments: ${missingDoctor}`);

      return uniquePatients;
    } catch (error) {
      console.error('❌ Error fetching patients needing assignments:', error);
      throw error;
    }
  }

  /**
   * Update patient assignments
   */
  private async updatePatientAssignments(patient: any): Promise<boolean> {
    const needsOfficeUpdate = !patient.assigned_office_id;
    const needsDoctorUpdate = !patient.primary_doctor_id;

    if (!needsOfficeUpdate && !needsDoctorUpdate) {
      this.stats.patientsAlreadyAssigned++;
      return true;
    }

    let query = 'UPDATE patients SET ';
    const updates = [];
    const params = [];
    let paramCount = 1;

    if (needsOfficeUpdate) {
      updates.push(`assigned_office_id = $${paramCount}`);
      params.push(patient.relationship_office_id);
      paramCount++;
    }

    if (needsDoctorUpdate) {
      updates.push(`primary_doctor_id = $${paramCount}`);
      params.push(patient.relationship_doctor_id);
      paramCount++;
    }

    updates.push(`updated_at = NOW()`);
    query += updates.join(', ');
    query += ` WHERE id = $${paramCount}`;
    params.push(patient.patient_id);

    try {
      const result = await this.targetPool.query(query, params);

      if ((result.rowCount || 0) > 0) {
        if (needsOfficeUpdate) this.stats.officeAssignmentsUpdated++;
        if (needsDoctorUpdate) this.stats.doctorAssignmentsUpdated++;
        return true;
      }
      return false;
    } catch (error) {
      console.error(`❌ Error updating patient ${patient.patient_id}:`, error);
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Main assignment fix function
   */
  public async fixPatientAssignments(): Promise<AssignmentStats> {
    console.log('🚀 Starting Patient Assignment Fix...\n');

    try {
      const patientsNeedingUpdates = await this.getPatientsNeedingAssignments();

      console.log('\n🔄 Updating patient assignments...');

      for (const patient of patientsNeedingUpdates) {
        try {
          this.stats.patientsProcessed++;

          const needsOfficeUpdate = !patient.assigned_office_id;
          const needsDoctorUpdate = !patient.primary_doctor_id;

          if (!needsOfficeUpdate && !needsDoctorUpdate) {
            this.stats.patientsAlreadyAssigned++;
            console.log(`⏭️  Already assigned: ${patient.patient_name?.trim()}`);
            continue;
          }

          const success = await this.updatePatientAssignments(patient);

          if (success) {
            const updates = [];
            if (needsOfficeUpdate) updates.push(`Office: ${patient.office_name}`);
            if (needsDoctorUpdate) updates.push(`Doctor: ${patient.doctor_name}`);

            console.log(`✅ Updated: ${patient.patient_name?.trim()} → ${updates.join(', ')}`);
          } else {
            console.log(`❌ Failed: ${patient.patient_name?.trim()}`);
          }

        } catch (error) {
          this.stats.errors++;
          console.error(`❌ Error processing patient ${patient.patient_id}:`, error);
        }
      }

      this.stats.endTime = new Date();

      // Final summary
      console.log('\n📋 Patient Assignment Fix Summary:');
      console.log(`⏱️  Duration: ${this.stats.endTime.getTime() - this.stats.startTime.getTime()}ms`);
      console.log(`📊 Processed: ${this.stats.patientsProcessed}`);
      console.log(`🏢 Office Assignments Updated: ${this.stats.officeAssignmentsUpdated}`);
      console.log(`👨‍⚕️ Doctor Assignments Updated: ${this.stats.doctorAssignmentsUpdated}`);
      console.log(`⏭️  Already Assigned: ${this.stats.patientsAlreadyAssigned}`);
      console.log(`❌ Errors: ${this.stats.errors}`);

      return this.stats;

    } catch (error) {
      console.error('💥 Patient assignment fix failed:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Validate the assignment fix results
   */
  public async validateFix(): Promise<void> {
    console.log('\n🔍 Validating patient assignment fix results...');

    try {
      const assignmentStatus = await this.targetPool.query(`
        SELECT
          'FINAL ASSIGNMENT STATUS' as status,
          COUNT(*) as total_patients,
          COUNT(assigned_office_id) as patients_with_office,
          COUNT(primary_doctor_id) as patients_with_doctor,
          COUNT(*) - COUNT(assigned_office_id) as missing_office_assignments,
          COUNT(*) - COUNT(primary_doctor_id) as missing_doctor_assignments
        FROM patients
        WHERE legacy_patient_id IS NOT NULL
      `);

      const result = assignmentStatus.rows[0];
      console.log('📊 Final Assignment Status:');
      console.log(`   Total Patients: ${result.total_patients}`);
      console.log(`   Patients with Office: ${result.patients_with_office}`);
      console.log(`   Patients with Doctor: ${result.patients_with_doctor}`);
      console.log(`   Missing Office Assignments: ${result.missing_office_assignments}`);
      console.log(`   Missing Doctor Assignments: ${result.missing_doctor_assignments}`);

      // Calculate completion percentages
      const officeCompletion = ((result.patients_with_office / result.total_patients) * 100).toFixed(2);
      const doctorCompletion = ((result.patients_with_doctor / result.total_patients) * 100).toFixed(2);

      console.log(`   Office Assignment Completion: ${officeCompletion}%`);
      console.log(`   Doctor Assignment Completion: ${doctorCompletion}%`);

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
      await this.targetPool.end();
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

  const assignmentFix = new PatientAssignmentFix();

  try {
    switch (command) {
      case 'fix':
        await assignmentFix.fixPatientAssignments();
        await assignmentFix.validateFix();
        break;

      case 'validate':
        await assignmentFix.validateFix();
        break;

      default:
        console.log('Usage: npx ts-node fix-patient-assignments.ts [fix|validate]');
        process.exit(1);
    }

    process.exit(0);

  } catch (error) {
    console.error('💥 Operation failed:', error);
    process.exit(1);
  }
}

// Export for use as module
export { PatientAssignmentFix };

// Run if called directly
if (require.main === module) {
  main();
}