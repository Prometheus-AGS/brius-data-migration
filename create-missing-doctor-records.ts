import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

async function createMissingDoctorRecords() {
  const db = new Pool({ host: process.env.TARGET_DB_HOST, port: parseInt(process.env.TARGET_DB_PORT || '5432'), database: process.env.TARGET_DB_NAME, user: process.env.TARGET_DB_USER, password: process.env.TARGET_DB_PASSWORD });
  try {
    console.log('🔄 Creating missing doctor records for doctor profiles...');
    const missingProfiles = await db.query(`
      SELECT pr.id, pr.first_name, pr.last_name, pr.legacy_user_id
      FROM profiles pr
      WHERE pr.profile_type = 'doctor'
        AND NOT EXISTS (SELECT 1 FROM doctors d WHERE d.profile_id = pr.id)
    `);
    console.log(`Found ${missingProfiles.rows.length} doctor profiles without doctor records`);
    let created = 0;
    for (const profile of missingProfiles.rows) {
      const doctorNumber = `DOC-${String(profile.legacy_user_id).padStart(6, '0')}`;
      await db.query(`
        INSERT INTO doctors (profile_id, doctor_number, legacy_user_id, status)
        VALUES ($1, $2, $3, 'active')
        ON CONFLICT DO NOTHING
      `, [profile.id, doctorNumber, profile.legacy_user_id]);
      created++;
      if (created % 100 === 0) console.log(`Progress: ${created}...`);
    }
    const finalCount = await db.query('SELECT COUNT(*) as total FROM doctors');
    console.log(`\\n✅ Created ${created} doctor records`);
    console.log(`📈 Total doctors: ${finalCount.rows[0].total}`);
  } finally { await db.end(); }
}
createMissingDoctorRecords();
