import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

async function updatePatientFields() {
  const db = new Pool({ host: process.env.TARGET_DB_HOST, port: parseInt(process.env.TARGET_DB_PORT || '5432'), database: process.env.TARGET_DB_NAME, user: process.env.TARGET_DB_USER, password: process.env.TARGET_DB_PASSWORD });
  try {
    console.log('🔄 Updating patient fields from profiles...');
    console.log('\\n1️⃣  Updating sex and date_of_birth...');
    const result1 = await db.query(`
      UPDATE patients pt
      SET sex = CASE pr.gender
        WHEN 'male' THEN 'male'::gender
        WHEN 'female' THEN 'female'::gender
        WHEN 'other' THEN 'other'::gender
        ELSE 'unknown'::gender
      END,
      date_of_birth = pr.date_of_birth
      FROM profiles pr
      WHERE pt.profile_id = pr.id AND pr.profile_type = 'patient'
    `);
    console.log(`✅ Updated ${result1.rowCount} patients with sex and date_of_birth`);
    console.log('\\n2️⃣  Updating primary_doctor_id...');
    const result2 = await db.query(`
      UPDATE patients pt
      SET primary_doctor_id = d.id
      FROM profiles pr
      JOIN doctors d ON d.profile_id = (SELECT id FROM profiles WHERE legacy_user_id = (pr.metadata->'migration'->'patient_data'->>'doctor_id')::int AND profile_type IN ('doctor', 'master') LIMIT 1)
      WHERE pt.profile_id = pr.id
        AND pr.profile_type = 'patient'
        AND pr.metadata->'migration'->'patient_data'->>'doctor_id' IS NOT NULL
    `);
    console.log(`✅ Updated ${result2.rowCount} patients with primary_doctor_id`);
    console.log('\\n3️⃣  Updating assigned_office_id...');
    const result3 = await db.query(`
      UPDATE patients pt
      SET assigned_office_id = o.id
      FROM profiles pr
      JOIN offices o ON o.legacy_office_id = (pr.metadata->'migration'->'patient_data'->>'office_id')::int
      WHERE pt.profile_id = pr.id
        AND pr.profile_type = 'patient'
        AND pr.metadata->'migration'->'patient_data'->>'office_id' IS NOT NULL
    `);
    console.log(`✅ Updated ${result3.rowCount} patients with assigned_office_id`);
    const final = await db.query(`SELECT COUNT(*) as total, COUNT(sex) as with_sex, COUNT(date_of_birth) as with_dob, COUNT(primary_doctor_id) as with_doctor, COUNT(assigned_office_id) as with_office FROM patients`);
    console.log('\\n📊 Final statistics:');
    console.table(final.rows);
  } finally { await db.end(); }
}
updatePatientFields();
