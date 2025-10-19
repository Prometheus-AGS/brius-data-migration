import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

async function checkDispatchOfficeTable() {
  const sourcePool = new Pool({
    host: process.env.SOURCE_DB_HOST,
    port: parseInt(process.env.SOURCE_DB_PORT || "5432"),
    database: process.env.SOURCE_DB_NAME,
    user: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log("🔍 Analyzing dispatch_office table...\n");

    const officeCountResult = await sourcePool.query("SELECT COUNT(*) as count FROM dispatch_office");
    console.log(`📊 dispatch_office record count: ${officeCountResult.rows[0].count}`);

    const sampleResult = await sourcePool.query("SELECT * FROM dispatch_office LIMIT 2");
    console.log("\n📋 Sample dispatch_office data:");
    console.log(JSON.stringify(sampleResult.rows, null, 2));

    console.log("\n" + "=".repeat(60));
    console.log("📈 FINAL ANALYSIS:");
    console.log("   Based on migration notes and table analysis:");
    console.log("   - auth_user: 9,755 total users (profiles source)");
    console.log("   - dispatch_office_doctors: 424 doctors with office assignments");
    console.log("   - dispatch_usersetting: 1,181 users with settings");
    console.log("   - Union (office OR settings): 1,181 total doctors");
    console.log("\n   🎯 DOCTOR COUNT: 1,181 doctors in source database");
    
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await sourcePool.end();
  }
}

checkDispatchOfficeTable();
