import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function investigateDatabaseSchema() {
  const targetPool = new Pool({
    host: process.env.TARGET_DB_HOST,
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    database: process.env.TARGET_DB_NAME,
    user: process.env.TARGET_DB_USER,
    password: process.env.TARGET_DB_PASSWORD,
  });

  try {
    console.log('🔍 DATABASE SCHEMA INVESTIGATION');
    console.log('='.repeat(50));

    // Check if doctors table exists
    console.log('\n📋 Available Tables:');
    const tables = await targetPool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name IN ('doctors', 'profiles', 'patients', 'offices', 'patients_doctors_offices')
      ORDER BY table_name
    `);

    tables.rows.forEach(row => {
      console.log(`   ✓ ${row.table_name}`);
    });

    // Check doctors table structure if it exists
    if (tables.rows.some(row => row.table_name === 'doctors')) {
      console.log('\n📊 DOCTORS Table Structure:');
      const doctorsSchema = await targetPool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'doctors' AND table_schema = 'public'
        ORDER BY ordinal_position
      `);

      doctorsSchema.rows.forEach(row => {
        console.log(`   ${row.column_name}: ${row.data_type} (${row.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
      });

      // Check doctors table content
      const doctorsCount = await targetPool.query(`SELECT COUNT(*) as count FROM doctors`);
      console.log(`   Records: ${doctorsCount.rows[0].count}`);

      if (parseInt(doctorsCount.rows[0].count) > 0) {
        const sampleDoctors = await targetPool.query(`
          SELECT id, legacy_user_id, profile_id
          FROM doctors
          ORDER BY id
          LIMIT 5
        `);
        console.log('   Sample records:');
        sampleDoctors.rows.forEach(row => {
          console.log(`      ID: ${row.id}, Legacy: ${row.legacy_user_id}, Profile: ${row.profile_id}`);
        });
      }
    }

    // Check patients_doctors_offices foreign key constraints
    console.log('\n🔗 patients_doctors_offices Foreign Key Constraints:');
    const constraints = await targetPool.query(`
      SELECT
        kcu.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = 'patients_doctors_offices'
    `);

    constraints.rows.forEach(row => {
      console.log(`   ${row.column_name} → ${row.foreign_table_name}.${row.foreign_column_name} (${row.constraint_name})`);
    });

    // Check profiles vs doctors comparison
    console.log('\n👨‍⚕️ Doctors Comparison:');
    const profileDoctors = await targetPool.query(`
      SELECT COUNT(*) as count FROM profiles WHERE profile_type = 'doctor'
    `);
    console.log(`   Profiles (doctor type): ${profileDoctors.rows[0].count}`);

    if (tables.rows.some(row => row.table_name === 'doctors')) {
      const doctorsTableCount = await targetPool.query(`SELECT COUNT(*) as count FROM doctors`);
      console.log(`   Doctors table: ${doctorsTableCount.rows[0].count}`);
    }

    // Check existing relationships in patients_doctors_offices
    console.log('\n🔗 Existing Relationships Analysis:');
    const existingRelationships = await targetPool.query(`
      SELECT COUNT(*) as total_relationships
      FROM patients_doctors_offices
    `);
    console.log(`   Total existing relationships: ${existingRelationships.rows[0].total_relationships}`);

    if (parseInt(existingRelationships.rows[0].total_relationships) > 0) {
      // Sample existing relationships to see what doctor IDs are actually used
      const sampleRelationships = await targetPool.query(`
        SELECT
          patient_id,
          doctor_id,
          office_id
        FROM patients_doctors_offices
        ORDER BY patient_id
        LIMIT 5
      `);

      console.log('   Sample existing relationships:');
      sampleRelationships.rows.forEach(row => {
        console.log(`      Patient: ${row.patient_id}, Doctor: ${row.doctor_id}, Office: ${row.office_id}`);
      });

      // Check if these doctor IDs exist in doctors table
      if (tables.rows.some(row => row.table_name === 'doctors')) {
        const doctorIds = sampleRelationships.rows.map(row => row.doctor_id);
        const doctorCheck = await targetPool.query(`
          SELECT id FROM doctors WHERE id = ANY($1::uuid[])
        `, [doctorIds]);

        console.log(`   Doctor IDs found in doctors table: ${doctorCheck.rows.length}/${doctorIds.length}`);
      }
    }

    // Check if there's a relationship between profiles and doctors tables
    if (tables.rows.some(row => row.table_name === 'doctors')) {
      console.log('\n🔗 Profile-Doctor Relationship Analysis:');
      const profileDoctorMapping = await targetPool.query(`
        SELECT
          COUNT(*) as profiles_with_doctor_match
        FROM profiles p
        JOIN doctors d ON p.id = d.profile_id
        WHERE p.profile_type = 'doctor'
      `);

      console.log(`   Profiles with matching doctors record: ${profileDoctorMapping.rows[0].profiles_with_doctor_match}`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await targetPool.end();
  }
}

investigateDatabaseSchema();