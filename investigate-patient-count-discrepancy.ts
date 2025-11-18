import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function investigatePatientCounts() {
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
    console.log('🔍 PATIENT COUNT DISCREPANCY INVESTIGATION');
    console.log('='.repeat(60));

    // Detailed source patient analysis
    console.log('\n📊 DETAILED SOURCE PATIENT ANALYSIS:');
    const sourceAnalysis = await sourcePool.query(`
      SELECT
        'Total Patients' as category,
        COUNT(*) as count
      FROM dispatch_patient
      UNION ALL
      SELECT
        'Non-Archived Patients',
        COUNT(*)
      FROM dispatch_patient
      WHERE archived = false OR archived IS NULL
      UNION ALL
      SELECT
        'Patients with Offices',
        COUNT(*)
      FROM dispatch_patient dp
      JOIN dispatch_office office ON dp.office_id = office.id
      UNION ALL
      SELECT
        'Patients with Offices + Non-Archived',
        COUNT(*)
      FROM dispatch_patient dp
      JOIN dispatch_office office ON dp.office_id = office.id
      WHERE dp.archived = false OR dp.archived IS NULL
      UNION ALL
      SELECT
        'Patients with Country Offices + Non-Archived',
        COUNT(*)
      FROM dispatch_patient dp
      JOIN dispatch_office office ON dp.office_id = office.id
      WHERE office.country IS NOT NULL
        AND (dp.archived = false OR dp.archived IS NULL)
      UNION ALL
      SELECT
        'Patients with Doctors + Country Offices + Non-Archived',
        COUNT(*)
      FROM dispatch_patient dp
      JOIN dispatch_office office ON dp.office_id = office.id
      WHERE office.country IS NOT NULL
        AND (dp.archived = false OR dp.archived IS NULL)
        AND dp.doctor_id IS NOT NULL
    `);

    sourceAnalysis.rows.forEach(row => {
      console.log(`   ${row.category}: ${row.count}`);
    });

    // Check what criteria were likely used in original migration
    console.log('\n📊 PROBABLE MIGRATION CRITERIA ANALYSIS:');
    const migrationCriteriaAnalysis = await sourcePool.query(`
      SELECT
        'All Patients (no filters)' as criteria,
        COUNT(*) as source_count
      FROM dispatch_patient
      UNION ALL
      SELECT
        'Non-Archived Only',
        COUNT(*)
      FROM dispatch_patient
      WHERE archived = false OR archived IS NULL
      UNION ALL
      SELECT
        'With Office Assignment',
        COUNT(*)
      FROM dispatch_patient
      WHERE office_id IS NOT NULL
      UNION ALL
      SELECT
        'With Doctor Assignment',
        COUNT(*)
      FROM dispatch_patient
      WHERE doctor_id IS NOT NULL
      UNION ALL
      SELECT
        'Non-Archived + Office + Doctor',
        COUNT(*)
      FROM dispatch_patient
      WHERE (archived = false OR archived IS NULL)
        AND office_id IS NOT NULL
        AND doctor_id IS NOT NULL
    `);

    migrationCriteriaAnalysis.rows.forEach(row => {
      console.log(`   ${row.criteria}: ${row.source_count}`);
    });

    // Check target patient analysis
    console.log('\n📊 DETAILED TARGET PATIENT ANALYSIS:');
    const targetAnalysis = await targetPool.query(`
      SELECT
        'Total Patients' as category,
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
        'Non-Archived Patients',
        COUNT(*)
      FROM patients
      WHERE archived = false OR archived IS NULL
      UNION ALL
      SELECT
        'Patients with Office Assignment',
        COUNT(*)
      FROM patients
      WHERE assigned_office_id IS NOT NULL
      UNION ALL
      SELECT
        'Patients with Doctor Assignment',
        COUNT(*)
      FROM patients
      WHERE primary_doctor_id IS NOT NULL
      UNION ALL
      SELECT
        'Patients with Both Office + Doctor',
        COUNT(*)
      FROM patients
      WHERE assigned_office_id IS NOT NULL
        AND primary_doctor_id IS NOT NULL
    `);

    targetAnalysis.rows.forEach(row => {
      console.log(`   ${row.category}: ${row.count}`);
    });

    // Check for potential duplicates or issues
    console.log('\n🔍 POTENTIAL ISSUES ANALYSIS:');

    // Check for duplicate legacy IDs
    const duplicateCheck = await targetPool.query(`
      SELECT
        legacy_patient_id,
        COUNT(*) as duplicate_count
      FROM patients
      WHERE legacy_patient_id IS NOT NULL
      GROUP BY legacy_patient_id
      HAVING COUNT(*) > 1
      ORDER BY duplicate_count DESC
      LIMIT 10
    `);

    if (duplicateCheck.rows.length > 0) {
      console.log('   ❌ DUPLICATE LEGACY PATIENT IDs FOUND:');
      duplicateCheck.rows.forEach(row => {
        console.log(`      Legacy ID ${row.legacy_patient_id}: ${row.duplicate_count} duplicates`);
      });
    } else {
      console.log('   ✅ No duplicate legacy patient IDs found');
    }

    // Check archived status comparison
    const archivedComparison = await targetPool.query(`
      SELECT
        archived,
        COUNT(*) as patient_count
      FROM patients
      WHERE legacy_patient_id IS NOT NULL
      GROUP BY archived
      ORDER BY patient_count DESC
    `);

    console.log('\n📋 Target Archived Status Distribution:');
    archivedComparison.rows.forEach(row => {
      const archivedStatus = row.archived === null ? 'NULL' : (row.archived ? 'TRUE' : 'FALSE');
      console.log(`   Archived ${archivedStatus}: ${row.patient_count} patients`);
    });

    // Find which source patients are missing from target
    console.log('\n🔍 MISSING PATIENTS ANALYSIS:');

    // Get a sample of source patients that might be missing
    const missingPatients = await sourcePool.query(`
      SELECT
        dp.id,
        dp.archived,
        dp.office_id,
        dp.doctor_id,
        office.country,
        CASE
          WHEN dp.archived IS NULL THEN 'NULL'
          WHEN dp.archived = true THEN 'TRUE'
          ELSE 'FALSE'
        END as archived_status
      FROM dispatch_patient dp
      LEFT JOIN dispatch_office office ON dp.office_id = office.id
      ORDER BY dp.id
      LIMIT 10
    `);

    console.log('   Sample source patients (first 10):');
    missingPatients.rows.forEach(row => {
      console.log(`      ID: ${row.id}, Archived: ${row.archived_status}, Office: ${row.office_id}, Doctor: ${row.doctor_id}, Country: ${row.country || 'NULL'}`);
    });

    // Check if any of these are in target
    const sourceIds = missingPatients.rows.map(row => row.id);
    const foundInTarget = await targetPool.query(`
      SELECT legacy_patient_id
      FROM patients
      WHERE legacy_patient_id = ANY($1::int[])
    `, [sourceIds]);

    const foundIds = foundInTarget.rows.map(row => row.legacy_patient_id);
    console.log(`   Found in target: ${foundIds.join(', ')}`);

    const notFoundIds = sourceIds.filter(id => !foundIds.includes(id));
    if (notFoundIds.length > 0) {
      console.log(`   NOT found in target: ${notFoundIds.join(', ')}`);
    }

    // Summary comparison
    console.log('\n📊 SUMMARY COMPARISON:');
    const summary = await Promise.all([
      sourcePool.query('SELECT COUNT(*) as total_source FROM dispatch_patient'),
      targetPool.query('SELECT COUNT(*) as total_target FROM patients WHERE legacy_patient_id IS NOT NULL'),
      sourcePool.query('SELECT COUNT(*) as source_with_office FROM dispatch_patient WHERE office_id IS NOT NULL'),
      sourcePool.query('SELECT COUNT(*) as source_non_archived FROM dispatch_patient WHERE archived = false OR archived IS NULL')
    ]);

    const totalSource = parseInt(summary[0].rows[0].total_source);
    const totalTarget = parseInt(summary[1].rows[0].total_target);
    const sourceWithOffice = parseInt(summary[2].rows[0].source_with_office);
    const sourceNonArchived = parseInt(summary[3].rows[0].source_non_archived);

    console.log(`   Total Source Patients: ${totalSource}`);
    console.log(`   Total Target Patients: ${totalTarget}`);
    console.log(`   Difference: ${totalTarget - totalSource} (${((totalTarget / totalSource - 1) * 100).toFixed(1)}%)`);
    console.log(`   Source with Office: ${sourceWithOffice}`);
    console.log(`   Source Non-Archived: ${sourceNonArchived}`);

    if (totalTarget > totalSource) {
      console.log('\n🚨 CRITICAL ISSUE: Target has MORE patients than source!');
      console.log('   This suggests either:');
      console.log('   1. Duplicate migrations');
      console.log('   2. Incorrect migration criteria');
      console.log('   3. Data integrity issues');
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

investigatePatientCounts();