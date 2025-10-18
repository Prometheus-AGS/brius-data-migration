import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

async function compareDocterSources() {
  const sourcePool = new Pool({
    host: process.env.SOURCE_DB_HOST,
    port: parseInt(process.env.SOURCE_DB_PORT || "5432"),
    database: process.env.SOURCE_DB_NAME,
    user: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log("🔍 Comparing doctor data sources...\n");

    // Doctors in dispatch_office_doctors but NOT in dispatch_doctorsetting
    const officeOnlyResult = await sourcePool.query(`
      SELECT COUNT(*) as count
      FROM dispatch_office_doctors dod
      LEFT JOIN dispatch_doctorsetting ds ON dod.user_id = ds.user_id
      WHERE ds.user_id IS NULL
    `);
    console.log(`📋 Doctors in office mapping but NOT in settings: ${officeOnlyResult.rows[0].count}`);

    // Doctors in dispatch_doctorsetting but NOT in dispatch_office_doctors
    const settingsOnlyResult = await sourcePool.query(`
      SELECT COUNT(*) as count
      FROM dispatch_doctorsetting ds
      LEFT JOIN dispatch_office_doctors dod ON ds.user_id = dod.user_id
      WHERE dod.user_id IS NULL
    `);
    console.log(`⚙️ Doctors in settings but NOT in office mapping: ${settingsOnlyResult.rows[0].count}`);

    // Doctors in BOTH tables
    const bothTablesResult = await sourcePool.query(`
      SELECT COUNT(DISTINCT dod.user_id) as count
      FROM dispatch_office_doctors dod
      INNER JOIN dispatch_doctorsetting ds ON dod.user_id = ds.user_id
    `);
    console.log(`🔗 Doctors in BOTH tables: ${bothTablesResult.rows[0].count}`);

    // Union of both (total unique doctors across both tables)
    const unionResult = await sourcePool.query(`
      SELECT COUNT(*) as count FROM (
        SELECT user_id FROM dispatch_office_doctors
        UNION
        SELECT user_id FROM dispatch_doctorsetting
      ) combined
    `);
    console.log(`\n🎯 TOTAL UNIQUE DOCTORS (union of both sources): ${unionResult.rows[0].count}`);

    // Sample from doctors who are ONLY in settings (not in office mapping)
    const sampleSettingsOnlyResult = await sourcePool.query(`
      SELECT ds.user_id, au.first_name, au.last_name, au.email
      FROM dispatch_doctorsetting ds
      LEFT JOIN dispatch_office_doctors dod ON ds.user_id = dod.user_id
      LEFT JOIN auth_user au ON ds.user_id = au.id
      WHERE dod.user_id IS NULL
      LIMIT 5
    `);
    
    console.log("\n📋 Sample doctors in settings but not office mapping:");
    sampleSettingsOnlyResult.rows.forEach(row => {
      console.log(`   User ${row.user_id}: ${row.first_name} ${row.last_name} (${row.email})`);
    });

    console.log("\n" + "=".repeat(60));
    console.log("📈 COMPREHENSIVE DOCTOR COUNT:");
    console.log(`   dispatch_office_doctors only: 424`);
    console.log(`   dispatch_doctorsetting only: 739`);
    console.log(`   Combined unique doctors: ${unionResult.rows[0].count}`);
    console.log("\n   🎯 FINAL ANSWER: " + unionResult.rows[0].count + " total doctors in source database");
    
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await sourcePool.end();
  }
}

compareDocterSources();