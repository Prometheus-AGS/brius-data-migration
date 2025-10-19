import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

async function migrateDoctorOfficeRelations() {
  const sourceDb = new Pool({ host: process.env.SOURCE_DB_HOST, port: parseInt(process.env.SOURCE_DB_PORT || '5432'), database: process.env.SOURCE_DB_NAME, user: process.env.SOURCE_DB_USER, password: process.env.SOURCE_DB_PASSWORD });
  const targetDb = new Pool({ host: process.env.TARGET_DB_HOST, port: parseInt(process.env.TARGET_DB_PORT || '5432'), database: process.env.TARGET_DB_NAME, user: process.env.TARGET_DB_USER, password: process.env.TARGET_DB_PASSWORD });
  try {
    console.log('🔄 Migrating doctor-office relations...');
    const source = await sourceDb.query('SELECT office_id, user_id FROM dispatch_office_doctors');
    console.log(`Found ${source.rows.length} relations`);
    let success = 0, missing_doctor = 0, missing_office = 0;
    for (const r of source.rows) {
      const doc = await targetDb.query('SELECT id FROM profiles WHERE legacy_user_id = $1 AND profile_type IN ($2, $3)', [r.user_id, 'doctor', 'master']);
      if (!doc.rows[0]) { missing_doctor++; continue; }
      const off = await targetDb.query('SELECT id FROM offices WHERE legacy_office_id = $1', [r.office_id]);
      if (!off.rows[0]) { missing_office++; continue; }
      const exists = await targetDb.query('SELECT 1 FROM doctor_offices WHERE doctor_id = $1 AND office_id = $2', [doc.rows[0].id, off.rows[0].id]);
      if (exists.rows[0]) continue;
      await targetDb.query('INSERT INTO doctor_offices (doctor_id, office_id, is_active) VALUES ($1, $2, true)', [doc.rows[0].id, off.rows[0].id]);
      success++; if (success % 50 === 0) console.log(`Progress: ${success}...`);
    }
    console.log(`✅ Created: ${success}, Missing doctors: ${missing_doctor}, Missing offices: ${missing_office}`);
  } finally { await sourceDb.end(); await targetDb.end(); }
}
migrateDoctorOfficeRelations();
