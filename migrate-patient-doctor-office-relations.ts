import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

async function migratePatientDoctorOfficeRelations() {
  const targetDb = new Pool({ host: process.env.TARGET_DB_HOST, port: parseInt(process.env.TARGET_DB_PORT || '5432'), database: process.env.TARGET_DB_NAME, user: process.env.TARGET_DB_USER, password: process.env.TARGET_DB_PASSWORD });
  try {
    console.log('🔄 Migrating patient-doctor-office relations...');
    const patients = await targetDb.query(`
      SELECT pt.id as patient_id, pr.metadata->'migration'->'patient_data'->>'doctor_id' as legacy_doctor_id,
        pr.metadata->'migration'->'patient_data'->>'office_id' as legacy_office_id
      FROM patients pt JOIN profiles pr ON pt.profile_id = pr.id
      WHERE pr.metadata->'migration'->'patient_data'->>'doctor_id' IS NOT NULL
        AND pr.metadata->'migration'->'patient_data'->>'office_id' IS NOT NULL
    `);
    console.log(`Found ${patients.rows.length} patients with doctor/office data`);
    let success = 0, missing_doctor = 0, missing_office = 0, skipped = 0;
    for (const p of patients.rows) {
      try {
        const doc = await targetDb.query('SELECT d.id FROM doctors d JOIN profiles pr ON d.profile_id = pr.id WHERE pr.legacy_user_id = $1', [p.legacy_doctor_id]);
        if (!doc.rows[0]) { missing_doctor++; continue; }
        const off = await targetDb.query('SELECT id FROM offices WHERE legacy_office_id = $1', [p.legacy_office_id]);
        if (!off.rows[0]) { missing_office++; continue; }
        const exists = await targetDb.query('SELECT 1 FROM patients_doctors_offices WHERE patient_id = $1 AND doctor_id = $2 AND office_id = $3', [p.patient_id, doc.rows[0].id, off.rows[0].id]);
        if (exists.rows[0]) { skipped++; continue; }
        await targetDb.query('INSERT INTO patients_doctors_offices (patient_id, doctor_id, office_id) VALUES ($1, $2, $3)', [p.patient_id, doc.rows[0].id, off.rows[0].id]);
        success++; if (success % 500 === 0) console.log(`Progress: ${success}...`);
      } catch (err: any) { console.error(`Error for patient ${p.patient_id}:`, err?.message || err); }
    }
    const total = await targetDb.query('SELECT COUNT(*) as total FROM patients_doctors_offices');
    console.log(`\n✅ Created: ${success}, Skipped: ${skipped}, Missing doctors: ${missing_doctor}, Missing offices: ${missing_office}`);
    console.log(`📈 Total relations: ${total.rows[0].total}`);
  } finally { await targetDb.end(); }
}
migratePatientDoctorOfficeRelations();
