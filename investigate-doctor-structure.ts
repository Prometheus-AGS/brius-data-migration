/**
 * Investigate doctor structure in source database
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function investigateDoctorStructure() {
  const sourcePool = new Pool({
    host: process.env.SOURCE_DB_HOST,
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME,
    user: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASSWORD,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  try {
    console.log('🔍 Investigating doctor structure...');

    // Check dispatch_office_doctors structure
    console.log('\n🔍 Checking dispatch_office_doctors table structure...');
    const officeDocorsSchemaResult = await sourcePool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'dispatch_office_doctors'
      ORDER BY ordinal_position;
    `);

    console.log('✅ dispatch_office_doctors columns:');
    officeDocorsSchemaResult.rows.forEach(row => {
      console.log(`   ${row.column_name}: ${row.data_type} ${row.is_nullable === 'NO' ? 'NOT NULL' : 'NULLABLE'}`);
    });

    // Get sample dispatch_office_doctors data
    const officeDoctorsSampleResult = await sourcePool.query(`
      SELECT *
      FROM dispatch_office_doctors
      LIMIT 5;
    `);

    console.log('\n📋 Sample dispatch_office_doctors records:');
    officeDoctorsSampleResult.rows.forEach((row, i) => {
      console.log(`   Record ${i + 1}: doctor_id=${row.doctor_id}, office_id=${row.office_id}`);
    });

    // Get patient-doctor relationships for our sample patients
    console.log('\n🔍 Patient-doctor relationships for sample patients...');
    const patientDoctorResult = await sourcePool.query(`
      SELECT
        dp.id as patient_id,
        dp.doctor_id,
        dp.office_id,
        dp.user_id
      FROM dispatch_patient dp
      WHERE dp.id IN (531647, 531648, 531649)
      ORDER BY dp.id;
    `);

    console.log('✅ Patient-doctor relationships:');
    patientDoctorResult.rows.forEach(row => {
      console.log(`   Patient ${row.patient_id}: doctor_id=${row.doctor_id}, office_id=${row.office_id}, user_id=${row.user_id}`);
    });

    // Check if we can find the actual doctor information
    console.log('\n🔍 Investigating doctor information...');
    const uniqueDoctorIds = [...new Set(patientDoctorResult.rows.map(row => row.doctor_id).filter(id => id))];

    if (uniqueDoctorIds.length > 0) {
      console.log(`Found doctor IDs: ${uniqueDoctorIds.join(', ')}`);

      // Try to find doctor information through dispatch_office_doctors
      const doctorInfoResult = await sourcePool.query(`
        SELECT DISTINCT doctor_id, office_id
        FROM dispatch_office_doctors
        WHERE doctor_id = ANY($1)
        ORDER BY doctor_id;
      `, [uniqueDoctorIds]);

      console.log('✅ Doctor-office relationships:');
      doctorInfoResult.rows.forEach(row => {
        console.log(`   Doctor ${row.doctor_id} -> Office ${row.office_id}`);
      });
    } else {
      console.log('⚠️  No doctor_ids found in sample patients');
    }

    // Check auth_user table for doctor users
    console.log('\n🔍 Checking for doctor users in auth_user...');
    try {
      const doctorUsersResult = await sourcePool.query(`
        SELECT DISTINCT
          au.id,
          au.username,
          au.email,
          au.is_staff,
          au.is_superuser
        FROM auth_user au
        WHERE au.id IN (
          SELECT DISTINCT doctor_id
          FROM dispatch_office_doctors
          WHERE doctor_id IS NOT NULL
        )
        LIMIT 10;
      `);

      console.log('✅ Sample doctor users:');
      doctorUsersResult.rows.forEach(row => {
        console.log(`   User ${row.id}: ${row.username} (${row.email}) - staff: ${row.is_staff}, super: ${row.is_superuser}`);
      });
    } catch (error) {
      console.log('⚠️  Could not get doctor user information');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await sourcePool.end();
  }
}

investigateDoctorStructure().catch(console.error);