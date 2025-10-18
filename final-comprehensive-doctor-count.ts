import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

async function finalDoctorAnalysis() {
  const sourcePool = new Pool({
    host: process.env.SOURCE_DB_HOST,
    port: parseInt(process.env.SOURCE_DB_PORT || "5432"),
    database: process.env.SOURCE_DB_NAME,
    user: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log("🎯 FINAL COMPREHENSIVE DOCTOR COUNT ANALYSIS\n");

    // 1. dispatch_office has doctor_id - count unique doctors there
    const officeBasedDoctors = await sourcePool.query("SELECT COUNT(DISTINCT doctor_id) as count FROM dispatch_office WHERE doctor_id IS NOT NULL");
    console.log(`📋 1. Unique doctors in dispatch_office: ${officeBasedDoctors.rows[0].count}`);

    // 2. dispatch_office_doctors user_id count
    const officeUserDoctors = await sourcePool.query("SELECT COUNT(DISTINCT user_id) as count FROM dispatch_office_doctors");
    console.log(`🏢 2. Unique doctors in dispatch_office_doctors: ${officeUserDoctors.rows[0].count}`);

    // 3. dispatch_usersetting user_id count
    const userSettingDoctors = await sourcePool.query("SELECT COUNT(DISTINCT user_id) as count FROM dispatch_usersetting");
    console.log(`⚙️ 3. Users in dispatch_usersetting: ${userSettingDoctors.rows[0].count}`);

    // 4. Cross-reference analysis based on migration notes logic
    // auth_user + dispatch_usersetting + dispatch_office_doctors
    const comprehensiveAnalysis = await sourcePool.query(`
      SELECT 
        COUNT(DISTINCT au.id) as total_auth_users,
        COUNT(DISTINCT CASE WHEN dus.user_id IS NOT NULL THEN au.id END) as users_with_settings,
        COUNT(DISTINCT CASE WHEN dod.user_id IS NOT NULL THEN au.id END) as users_in_office_doctors,
        COUNT(DISTINCT CASE WHEN dus.user_id IS NOT NULL OR dod.user_id IS NOT NULL THEN au.id END) as potential_doctors
      FROM auth_user au
      LEFT JOIN dispatch_usersetting dus ON au.id = dus.user_id
      LEFT JOIN dispatch_office_doctors dod ON au.id = dod.user_id
    `);

    const analysis = comprehensiveAnalysis.rows[0];
    console.log(`\n🔗 4. Comprehensive cross-reference:`);
    console.log(`   Total auth_users: ${analysis.total_auth_users}`);
    console.log(`   Users with settings: ${analysis.users_with_settings}`);
    console.log(`   Users in office_doctors: ${analysis.users_in_office_doctors}`);
    console.log(`   Potential doctors (settings OR office): ${analysis.potential_doctors}`);

    // 5. Check if dispatch_office.doctor_id maps to auth_user.id
    const doctorIdCheck = await sourcePool.query(`
      SELECT COUNT(DISTINCT do.doctor_id) as office_doctors,
             COUNT(DISTINCT CASE WHEN au.id IS NOT NULL THEN do.doctor_id END) as doctors_in_auth_user
      FROM dispatch_office do
      LEFT JOIN auth_user au ON do.doctor_id = au.id
      WHERE do.doctor_id IS NOT NULL
    `);

    console.log(`\n🔍 5. dispatch_office.doctor_id validation:`);
    console.log(`   Unique doctor_ids in dispatch_office: ${doctorIdCheck.rows[0].office_doctors}`);
    console.log(`   doctor_ids that exist in auth_user: ${doctorIdCheck.rows[0].doctors_in_auth_user}`);

    console.log("\n" + "=".repeat(70));
    console.log("📈 MIGRATION NOTES RECONCILIATION:");
    console.log(`   - Profiles Migration: 9,086/9,117 from auth_user + dispatch_usersetting`);
    console.log(`   - Doctors Migration: 1,213 claimed from dispatch_office`);
    console.log(`   - But dispatch_office.doctor_id shows ${officeBasedDoctors.rows[0].count} unique doctors`);
    console.log(`   - dispatch_office_doctors shows ${officeUserDoctors.rows[0].count} unique doctors`);
    console.log(`   - Combined approach (settings OR office): ${analysis.potential_doctors} doctors`);

    console.log("\n🎯 FINAL ANSWER:");
    console.log(`   Based on migration logic (auth_user + dispatch_usersetting + dispatch_office_doctors):`);
    console.log(`   
   **${analysis.potential_doctors} doctors** in source database`);

  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await sourcePool.end();
  }
}

finalDoctorAnalysis();
