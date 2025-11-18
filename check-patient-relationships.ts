import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function checkPatientRelationships() {
  const targetPool = new Pool({
    host: process.env.TARGET_DB_HOST,
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    database: process.env.TARGET_DB_NAME,
    user: process.env.TARGET_DB_USER,
    password: process.env.TARGET_DB_PASSWORD,
  });

  try {
    console.log('🔍 PATIENT RELATIONSHIP COVERAGE ANALYSIS');
    console.log('='.repeat(60));

    // Check patient relationships by country
    console.log('\n🌍 Patient Relationships by Country (via Office):');
    const relationshipsByCountry = await targetPool.query(`
      SELECT
        o.country,
        COUNT(DISTINCT pdo.patient_id) as patients_with_relationships,
        COUNT(DISTINCT pdo.doctor_id) as doctors_with_relationships,
        COUNT(DISTINCT pdo.office_id) as offices_with_relationships,
        COUNT(*) as total_relationships
      FROM patients_doctors_offices pdo
      JOIN offices o ON pdo.office_id = o.id
      WHERE o.legacy_office_id IS NOT NULL
      GROUP BY o.country
      ORDER BY total_relationships DESC
    `);

    relationshipsByCountry.rows.forEach(row => {
      console.log(`   ${row.country}: ${row.total_relationships} relationships (${row.patients_with_relationships} patients, ${row.doctors_with_relationships} doctors, ${row.offices_with_relationships} offices)`);
    });

    // Check patients WITHOUT relationships
    console.log('\n❌ Patients Missing Relationships:');
    const missingRelationships = await targetPool.query(`
      SELECT
        COUNT(*) as patients_without_relationships
      FROM patients p
      LEFT JOIN patients_doctors_offices pdo ON p.id = pdo.patient_id
      WHERE pdo.patient_id IS NULL
        AND p.legacy_patient_id IS NOT NULL
    `);

    console.log(`   Patients without relationships: ${missingRelationships.rows[0].patients_without_relationships}`);

    // Check offices WITHOUT patient relationships
    console.log('\n🏢 Office Coverage Analysis:');
    const officeCoverage = await targetPool.query(`
      SELECT
        o.country,
        COUNT(DISTINCT o.id) as total_offices,
        COUNT(DISTINCT pdo.office_id) as offices_with_patients,
        COUNT(DISTINCT o.id) - COUNT(DISTINCT pdo.office_id) as offices_without_patients
      FROM offices o
      LEFT JOIN patients_doctors_offices pdo ON o.id = pdo.office_id
      WHERE o.legacy_office_id IS NOT NULL
      GROUP BY o.country
      ORDER BY total_offices DESC
    `);

    officeCoverage.rows.forEach(row => {
      const coverage = ((row.offices_with_patients / row.total_offices) * 100).toFixed(1);
      console.log(`   ${row.country}: ${row.offices_with_patients}/${row.total_offices} offices have patients (${coverage}%) - ${row.offices_without_patients} missing`);
    });

    // Check for patients with assigned_office_id but no relationships
    console.log('\n🔗 Patient Assignment Analysis:');
    const assignmentAnalysis = await targetPool.query(`
      SELECT
        COUNT(*) as patients_with_assigned_office,
        COUNT(CASE WHEN pdo.patient_id IS NOT NULL THEN 1 END) as patients_with_relationships,
        COUNT(*) - COUNT(CASE WHEN pdo.patient_id IS NOT NULL THEN 1 END) as patients_missing_relationships
      FROM patients p
      LEFT JOIN patients_doctors_offices pdo ON p.id = pdo.patient_id
      WHERE p.assigned_office_id IS NOT NULL
        AND p.legacy_patient_id IS NOT NULL
    `);

    const assignment = assignmentAnalysis.rows[0];
    console.log(`   Patients with assigned office: ${assignment.patients_with_assigned_office}`);
    console.log(`   Patients with relationships: ${assignment.patients_with_relationships}`);
    console.log(`   Patients missing relationships: ${assignment.patients_missing_relationships}`);

    // Check patient-doctor assignment consistency
    console.log('\n👨‍⚕️ Doctor Assignment Consistency:');
    const doctorConsistency = await targetPool.query(`
      SELECT
        COUNT(*) as patients_with_primary_doctor,
        COUNT(CASE WHEN pdo.patient_id IS NOT NULL THEN 1 END) as patients_with_doctor_relationship,
        COUNT(*) - COUNT(CASE WHEN pdo.patient_id IS NOT NULL THEN 1 END) as patients_missing_doctor_relationship
      FROM patients p
      LEFT JOIN patients_doctors_offices pdo ON p.id = pdo.patient_id AND p.primary_doctor_id = pdo.doctor_id
      WHERE p.primary_doctor_id IS NOT NULL
        AND p.legacy_patient_id IS NOT NULL
    `);

    const doctor = doctorConsistency.rows[0];
    console.log(`   Patients with primary doctor: ${doctor.patients_with_primary_doctor}`);
    console.log(`   Patients with doctor relationship: ${doctor.patients_with_doctor_relationship}`);
    console.log(`   Patients missing doctor relationship: ${doctor.patients_missing_doctor_relationship}`);

    // Check suffix preservation for international patients
    console.log('\n📋 Patient Suffix Analysis:');
    const suffixAnalysis = await targetPool.query(`
      SELECT
        CASE
          WHEN p.suffix IS NOT NULL AND p.suffix != '' THEN 'Has Suffix'
          ELSE 'Missing Suffix'
        END as suffix_status,
        COUNT(*) as patient_count
      FROM patients p
      WHERE p.legacy_patient_id IS NOT NULL
      GROUP BY
        CASE
          WHEN p.suffix IS NOT NULL AND p.suffix != '' THEN 'Has Suffix'
          ELSE 'Missing Suffix'
        END
      ORDER BY patient_count DESC
    `);

    suffixAnalysis.rows.forEach(row => {
      console.log(`   ${row.suffix_status}: ${row.patient_count} patients`);
    });

    // Sample of patients missing relationships by country
    console.log('\n🔍 Sample Missing Relationships by Country:');
    const missingByCountry = await targetPool.query(`
      SELECT
        COALESCE(o.country, 'Unknown') as country,
        COUNT(*) as missing_count
      FROM patients p
      LEFT JOIN patients_doctors_offices pdo ON p.id = pdo.patient_id
      LEFT JOIN offices o ON p.assigned_office_id = o.id
      WHERE pdo.patient_id IS NULL
        AND p.legacy_patient_id IS NOT NULL
      GROUP BY o.country
      ORDER BY missing_count DESC
    `);

    missingByCountry.rows.forEach(row => {
      console.log(`   ${row.country}: ${row.missing_count} patients missing relationships`);
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await targetPool.end();
  }
}

checkPatientRelationships();