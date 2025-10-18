import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function analyzePatientSource() {
  const sourcePool = new Pool({
    host: process.env.SOURCE_DB_HOST,
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME,
    user: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔍 ANALYZING SOURCE PATIENT DATA');
    console.log('='.repeat(50));

    // 1. Analyze dispatch_patient table structure
    console.log('\n📋 dispatch_patient table structure:');
    const patientSchemaResult = await sourcePool.query(`
      SELECT 
        column_name, 
        data_type, 
        is_nullable,
        column_default
      FROM information_schema.columns 
      WHERE table_name = 'dispatch_patient' 
      AND table_schema = 'public'
      ORDER BY ordinal_position
    `);

    patientSchemaResult.rows.forEach(col => {
      const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
      const defaultVal = col.column_default ? ` DEFAULT ${col.column_default}` : '';
      console.log(`   ${col.column_name}: ${col.data_type} ${nullable}${defaultVal}`);
    });

    // 2. Count total patients and active patients
    console.log('\n📊 Patient counts:');
    const totalPatientsResult = await sourcePool.query('SELECT COUNT(*) as count FROM dispatch_patient');
    const activePatientsResult = await sourcePool.query('SELECT COUNT(*) as count FROM dispatch_patient WHERE archived = false OR archived IS NULL');
    console.log(`   Total patients: ${totalPatientsResult.rows[0].count}`);
    console.log(`   Active patients: ${activePatientsResult.rows[0].count}`);

    // 3. Analyze doctor relationships
    console.log('\n🏥 Doctor relationships:');
    const doctorRelationResult = await sourcePool.query(`
      SELECT 
        COUNT(*) as total_patients,
        COUNT(CASE WHEN doctor_id IS NOT NULL THEN 1 END) as patients_with_doctor,
        COUNT(DISTINCT doctor_id) as unique_doctors_with_patients
      FROM dispatch_patient
    `);
    
    const doctorRel = doctorRelationResult.rows[0];
    console.log(`   Patients with doctor: ${doctorRel.patients_with_doctor}/${doctorRel.total_patients}`);
    console.log(`   Unique doctors with patients: ${doctorRel.unique_doctors_with_patients}`);

    // 4. Sample patient data
    console.log('\n📋 Sample patient records:');
    const sampleResult = await sourcePool.query('SELECT * FROM dispatch_patient LIMIT 3');
    sampleResult.rows.forEach((row, i) => {
      console.log(`   ${i + 1}. Patient ID: ${row.patient_id || row.id}, Doctor: ${row.doctor_id}, Office: ${row.office_id}, Active: ${!row.archived}`);
    });

    // 5. Check for potential issues
    console.log('\n⚠️  Potential migration issues:');
    
    // Patients without doctors
    const orphanPatientsResult = await sourcePool.query('SELECT COUNT(*) as count FROM dispatch_patient WHERE doctor_id IS NULL');
    console.log(`   Patients without doctors: ${orphanPatientsResult.rows[0].count}`);

    // Duplicate patient numbers/identifiers
    const duplicatePatientResult = await sourcePool.query(`
      SELECT patient_id, COUNT(*) as count
      FROM dispatch_patient 
      WHERE patient_id IS NOT NULL
      GROUP BY patient_id 
      HAVING COUNT(*) > 1
      LIMIT 5
    `);
    console.log(`   Duplicate patient IDs found: ${duplicatePatientResult.rows.length}`);

    return {
      totalPatients: parseInt(totalPatientsResult.rows[0].count),
      activePatients: parseInt(activePatientsResult.rows[0].count),
      patientsWithDoctor: parseInt(doctorRel.patients_with_doctor),
      uniqueDoctors: parseInt(doctorRel.unique_doctors_with_patients),
      orphanPatients: parseInt(orphanPatientsResult.rows[0].count)
    };

  } catch (error: any) {
    console.error('❌ Source analysis error:', error.message);
    return null;
  } finally {
    await sourcePool.end();
  }
}

analyzePatientSource().then(result => {
  if (result) {
    console.log('\n🎯 ANALYSIS SUMMARY:');
    console.log(`   Ready to migrate: ${result.patientsWithDoctor} patients with doctor relationships`);
    console.log(`   Orphaned patients: ${result.orphanPatients} (will need special handling)`);
  }
});
