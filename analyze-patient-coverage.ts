import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function analyzePatientCoverage() {
  const sourcePool = new Pool({
    host: process.env.SOURCE_DB_HOST,
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME,
    user: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false }
  });

  const targetPool = new Pool({
    host: process.env.TARGET_DB_HOST,
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    database: process.env.TARGET_DB_NAME,
    user: process.env.TARGET_DB_USER,
    password: process.env.TARGET_DB_PASSWORD,
  });

  try {
    console.log('🔍 PATIENT COVERAGE ANALYSIS');
    console.log('='.repeat(50));

    // Check target patient table structure
    console.log('\n📋 Target Patient Table Structure:');
    const targetSchema = await targetPool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'patients' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);

    console.log('Target patients table columns:');
    targetSchema.rows.forEach(row => {
      console.log(`   ${row.column_name}: ${row.data_type} (${row.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
    });

    // Check current target patient coverage
    console.log('\n📊 Target Database Patient Coverage:');
    const targetCoverage = await targetPool.query(`
      SELECT
        'Total Patients' as metric,
        COUNT(*) as count
      FROM patients
      UNION ALL
      SELECT
        'Patients with Legacy ID',
        COUNT(*)
      FROM patients
      WHERE legacy_patient_id IS NOT NULL
      UNION ALL
      SELECT
        'Profiles (Patient Type)',
        COUNT(*)
      FROM profiles
      WHERE profile_type = 'patient'
    `);

    targetCoverage.rows.forEach(row => {
      console.log(`   ${row.metric}: ${row.count}`);
    });

    // Check source patient data
    console.log('\n📊 Source Database Patient Analysis:');
    const sourceCoverage = await sourcePool.query(`
      SELECT
        'Total Source Patients' as metric,
        COUNT(*) as count
      FROM dispatch_patient
      UNION ALL
      SELECT
        'Active Source Patients',
        COUNT(*)
      FROM dispatch_patient
      WHERE archived = false OR archived IS NULL
      UNION ALL
      SELECT
        'Patients with Offices',
        COUNT(*)
      FROM dispatch_patient dp
      JOIN dispatch_office office ON dp.office_id = office.id
      WHERE office.country IS NOT NULL
        AND (dp.archived = false OR dp.archived IS NULL)
    `);

    sourceCoverage.rows.forEach(row => {
      console.log(`   ${row.metric}: ${row.count}`);
    });

    // Check patient distribution by country (via office)
    console.log('\n🌍 Source Patients by Country (via Office):');
    const sourcePatientsByCountry = await sourcePool.query(`
      SELECT
        office.country,
        COUNT(*) as patient_count,
        COUNT(*) * 100.0 / (
          SELECT COUNT(*)
          FROM dispatch_patient dp2
          JOIN dispatch_office office2 ON dp2.office_id = office2.id
          WHERE office2.country IS NOT NULL
            AND (dp2.archived = false OR dp2.archived IS NULL)
        ) as percentage
      FROM dispatch_patient dp
      JOIN dispatch_office office ON dp.office_id = office.id
      WHERE office.country IS NOT NULL
        AND (dp.archived = false OR dp.archived IS NULL)
      GROUP BY office.country
      ORDER BY patient_count DESC
    `);

    sourcePatientsByCountry.rows.forEach(row => {
      console.log(`   ${row.country}: ${row.patient_count} patients (${parseFloat(row.percentage).toFixed(1)}%)`);
    });

    // Check patient-doctor relationships in source
    console.log('\n👨‍⚕️ Source Patient-Doctor Relationships:');
    const sourceDoctorRelationships = await sourcePool.query(`
      SELECT
        office.country,
        COUNT(DISTINCT dp.doctor_id) as unique_doctors,
        COUNT(*) as patient_count,
        COUNT(*) * 1.0 / COUNT(DISTINCT dp.doctor_id) as patients_per_doctor
      FROM dispatch_patient dp
      JOIN dispatch_office office ON dp.office_id = office.id
      WHERE office.country IS NOT NULL
        AND (dp.archived = false OR dp.archived IS NULL)
        AND dp.doctor_id IS NOT NULL
      GROUP BY office.country
      ORDER BY patient_count DESC
    `);

    sourceDoctorRelationships.rows.forEach(row => {
      console.log(`   ${row.country}: ${row.patient_count} patients, ${row.unique_doctors} doctors (${parseFloat(row.patients_per_doctor).toFixed(1)} patients/doctor)`);
    });

    // Check for missing patients (source vs target)
    console.log('\n🔍 Missing Patient Analysis:');
    const missingPatients = await targetPool.query(`
      SELECT COUNT(*) as patients_with_legacy_mapping
      FROM patients
      WHERE legacy_patient_id IS NOT NULL
    `);

    const sourceActivePatients = await sourcePool.query(`
      SELECT COUNT(*) as active_source_patients
      FROM dispatch_patient dp
      JOIN dispatch_office office ON dp.office_id = office.id
      WHERE office.country IS NOT NULL
        AND (dp.archived = false OR dp.archived IS NULL)
    `);

    const targetMapped = parseInt(missingPatients.rows[0].patients_with_legacy_mapping);
    const sourceActive = parseInt(sourceActivePatients.rows[0].active_source_patients);
    const missing = sourceActive - targetMapped;

    console.log(`   Source Active Patients: ${sourceActive}`);
    console.log(`   Target Mapped Patients: ${targetMapped}`);
    console.log(`   Missing Patients: ${missing}`);
    console.log(`   Coverage: ${((targetMapped / sourceActive) * 100).toFixed(1)}%`);

    // Check patient relationships in target
    console.log('\n🔗 Target Patient Relationships:');

    // Check if patients_doctors_offices table exists
    const relationshipTable = await targetPool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('patients_doctors_offices', 'patient_doctors', 'patient_offices')
    `);

    if (relationshipTable.rows.length > 0) {
      const tableName = relationshipTable.rows[0].table_name;
      console.log(`   Using relationship table: ${tableName}`);

      const relationshipCoverage = await targetPool.query(`
        SELECT COUNT(*) as relationship_count
        FROM ${tableName}
      `);

      console.log(`   Total relationships: ${relationshipCoverage.rows[0].relationship_count}`);
    } else {
      console.log('   No patient relationship table found');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await Promise.all([
      sourcePool.end(),
      targetPool.end()
    ]);
  }
}

analyzePatientCoverage();