import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

async function analyzeDoctorsFromMigrationNotes() {
  const sourcePool = new Pool({
    host: process.env.SOURCE_DB_HOST,
    port: parseInt(process.env.SOURCE_DB_PORT || "5432"),
    database: process.env.SOURCE_DB_NAME,
    user: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log("🔍 Analyzing doctors based on migration notes...\n");

    // Check if dispatch_usersetting exists (vs dispatch_doctorsetting)
    console.log("📋 1. Checking table existence:");
    const tableCheckResult = await sourcePool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('dispatch_usersetting', 'dispatch_doctorsetting', 'dispatch_office')
      ORDER BY table_name
    `);
    console.log("   Found tables:");
    tableCheckResult.rows.forEach(row => console.log(`     - ${row.table_name}`));

    // Check auth_user count (profiles source)
    const authUserResult = await sourcePool.query("SELECT COUNT(*) as count FROM auth_user");
    console.log(`\n👤 2. auth_user (profiles source): ${authUserResult.rows[0].count} users`);

    // Check dispatch_office_doctors count
    const officeDocsResult = await sourcePool.query("SELECT COUNT(DISTINCT user_id) as count FROM dispatch_office_doctors");
    console.log(`🏢 3. dispatch_office_doctors: ${officeDocsResult.rows[0].count} unique doctor-office associations`);

    // Try to check dispatch_usersetting if it exists
    try {
      const userSettingResult = await sourcePool.query("SELECT COUNT(DISTINCT user_id) as count FROM dispatch_usersetting");
      console.log(`⚙️ 4. dispatch_usersetting: ${userSettingResult.rows[0].count} users with settings`);

      // Cross-reference between auth_user, dispatch_usersetting, and dispatch_office_doctors
      const doctorAnalysisResult = await sourcePool.query(`
        SELECT 
          COUNT(DISTINCT au.id) as total_users,
          COUNT(DISTINCT CASE WHEN dod.user_id IS NOT NULL THEN au.id END) as users_with_office,
          COUNT(DISTINCT CASE WHEN dus.user_id IS NOT NULL THEN au.id END) as users_with_settings,
          COUNT(DISTINCT CASE WHEN dod.user_id IS NOT NULL AND dus.user_id IS NOT NULL THEN au.id END) as users_with_both
        FROM auth_user au
        LEFT JOIN dispatch_office_doctors dod ON au.id = dod.user_id
        LEFT JOIN dispatch_usersetting dus ON au.id = dus.user_id
      `);
      
      const analysis = doctorAnalysisResult.rows[0];
      console.log("\n🔗 5. Cross-reference analysis:");
      console.log(`   Total auth_users: ${analysis.total_users}`);
      console.log(`   Users with office assignments: ${analysis.users_with_office}`);
      console.log(`   Users with settings: ${analysis.users_with_settings}`);
      console.log(`   Users with both office + settings: ${analysis.users_with_both}`);
      
      // Determine doctors based on migration logic
      const potentialDoctorsResult = await sourcePool.query(`
        SELECT COUNT(DISTINCT au.id) as count
        FROM auth_user au
        LEFT JOIN dispatch_office_doctors dod ON au.id = dod.user_id
        LEFT JOIN dispatch_usersetting dus ON au.id = dus.user_id
        WHERE dod.user_id IS NOT NULL OR dus.user_id IS NOT NULL
      `);
      
      console.log(`\n🎯 6. Potential doctors (users in office OR settings): ${potentialDoctorsResult.rows[0].count}`);
      
    } catch (error) {
      console.log("⚠️  dispatch_usersetting table not found, using dispatch_doctorsetting instead");
      
      const doctorSettingResult = await sourcePool.query("SELECT COUNT(DISTINCT user_id) as count FROM dispatch_doctorsetting");
      console.log(`⚙️ 4. dispatch_doctorsetting: ${doctorSettingResult.rows[0].count} users with doctor settings`);
      
      // Use dispatch_doctorsetting instead
      const potentialDoctorsResult = await sourcePool.query(`
        SELECT COUNT(*) as count FROM (
          SELECT user_id FROM dispatch_office_doctors
          UNION
          SELECT user_id FROM dispatch_doctorsetting
        ) combined
      `);
      console.log(`\n🎯 6. Potential doctors (office OR doctorsetting): ${potentialDoctorsResult.rows[0].count}`);
    }

    console.log("\n" + "=".repeat(60));
    console.log("📈 ANALYSIS BASED ON MIGRATION NOTES:");
    console.log("   - Profiles migrated from auth_user + dispatch_*setting");
    console.log("   - Doctors identified through office assignments");
    console.log("   - Cross-referencing these sources gives the true doctor count");
    
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await sourcePool.end();
  }
}

analyzeDoctorsFromMigrationNotes();