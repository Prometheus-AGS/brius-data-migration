import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

async function findAllDoctors() {
  const sourcePool = new Pool({
    host: process.env.SOURCE_DB_HOST,
    port: parseInt(process.env.SOURCE_DB_PORT || "5432"),
    database: process.env.SOURCE_DB_NAME,
    user: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log("🔍 Searching for all doctor data sources...\n");

    const officeDocsResult = await sourcePool.query("SELECT COUNT(DISTINCT user_id) as count FROM dispatch_office_doctors");
    console.log(`📋 1. dispatch_office_doctors: ${officeDocsResult.rows[0].count} unique doctors`);

    const totalUsersResult = await sourcePool.query("SELECT COUNT(*) as count FROM auth_user");
    const staffUsersResult = await sourcePool.query("SELECT COUNT(*) as count FROM auth_user WHERE is_staff = true");
    console.log(`\n👤 2. auth_user: ${totalUsersResult.rows[0].count} total, ${staffUsersResult.rows[0].count} staff`);

    const crossRefResult = await sourcePool.query(`
      SELECT COUNT(DISTINCT au.id) as count 
      FROM auth_user au 
      INNER JOIN dispatch_office_doctors dod ON au.id = dod.user_id
    `);
    console.log(`\n🔗 3. Cross-verified doctors: ${crossRefResult.rows[0].count}`);

    const doctorSettingsResult = await sourcePool.query("SELECT COUNT(DISTINCT user_id) as count FROM dispatch_doctorsetting");
    console.log(`\n⚙️ 4. dispatch_doctorsetting unique users: ${doctorSettingsResult.rows[0].count}`);

    const sampleResult = await sourcePool.query("SELECT user_id, COUNT(*) as office_count FROM dispatch_office_doctors GROUP BY user_id ORDER BY office_count DESC LIMIT 5");
    console.log("\n📊 5. Top doctors by office count:");
    sampleResult.rows.forEach(row => {
      console.log(`     User ID ${row.user_id}: ${row.office_count} office(s)`);
    });

    console.log("\n" + "=".repeat(50));
    console.log("📈 FINAL ANSWER:");
    console.log(`   Source database has ${officeDocsResult.rows[0].count} unique doctors`);
    console.log(`   (Cross-verified: ${crossRefResult.rows[0].count} exist in auth_user)`);
    
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await sourcePool.end();
  }
}

findAllDoctors();