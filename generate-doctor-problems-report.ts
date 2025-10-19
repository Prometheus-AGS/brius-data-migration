import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function generateDoctorProblemsReport() {
  const sourcePool = new Pool({
    host: process.env.SOURCE_DB_HOST,
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME,
    user: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false }
  });

  const targetPool = new Pool({
    host: process.env.TARGET_DB_HOST,
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    database: process.env.TARGET_DB_NAME,
    user: process.env.TARGET_DB_USER,
    password: process.env.TARGET_DB_PASSWORD
  });

  try {
    console.log('📋 COMPREHENSIVE DOCTOR RECORDS PROBLEM ANALYSIS REPORT');
    console.log('='.repeat(70));
    console.log();

    // 1. Schema Analysis
    console.log('🗄️  1. TARGET SCHEMA ANALYSIS');
    console.log('-'.repeat(40));
    const targetSchemaResult = await targetPool.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'doctors' 
      ORDER BY ordinal_position
    `);
    
    console.log('   Target doctors table structure:');
    targetSchemaResult.rows.forEach(row => {
      console.log(`     - ${row.column_name}: ${row.data_type} (${row.is_nullable === 'YES' ? 'nullable' : 'required'})`);
    });

    // 2. Total Universe Analysis
    console.log('\n📊 2. TOTAL UNIVERSE ANALYSIS');
    console.log('-'.repeat(40));
    
    const universeAnalysis = await sourcePool.query(`
      SELECT 
        COUNT(DISTINCT au.id) as total_users_in_system,
        COUNT(DISTINCT CASE WHEN dus.user_id IS NOT NULL THEN au.id END) as users_with_settings,
        COUNT(DISTINCT CASE WHEN dod.user_id IS NOT NULL THEN au.id END) as users_with_office_assignments,
        COUNT(DISTINCT CASE WHEN dus.user_id IS NOT NULL OR dod.user_id IS NOT NULL THEN au.id END) as potential_doctors,
        COUNT(DISTINCT CASE WHEN patient_stats.doctor_id IS NOT NULL THEN au.id END) as users_with_patients
      FROM auth_user au
      LEFT JOIN dispatch_usersetting dus ON au.id = dus.user_id
      LEFT JOIN dispatch_office_doctors dod ON au.id = dod.user_id
      LEFT JOIN (SELECT DISTINCT doctor_id FROM dispatch_patient) patient_stats ON au.id = patient_stats.doctor_id
    `);

    const universe = universeAnalysis.rows[0];
    console.log(`   Total users in auth_user: ${universe.total_users_in_system.toLocaleString()}`);
    console.log(`   Users with doctor settings: ${universe.users_with_settings.toLocaleString()}`);
    console.log(`   Users with office assignments: ${universe.users_with_office_assignments.toLocaleString()}`);
    console.log(`   Potential doctors (settings OR office): ${universe.potential_doctors.toLocaleString()}`);
    console.log(`   Users with actual patients: ${universe.users_with_patients.toLocaleString()}`);

    // 3. Data Quality Issues
    console.log('\n⚠️  3. DATA QUALITY ISSUES');
    console.log('-'.repeat(40));

    // Inactive doctors
    const activityAnalysis = await sourcePool.query(`
      SELECT 
        COUNT(*) as total_potential_doctors,
        COUNT(CASE WHEN au.is_active = true THEN 1 END) as active_doctors,
        COUNT(CASE WHEN au.is_active = false THEN 1 END) as inactive_doctors,
        COUNT(CASE WHEN au.last_login IS NULL THEN 1 END) as never_logged_in,
        COUNT(CASE WHEN au.last_login < NOW() - INTERVAL '1 year' THEN 1 END) as inactive_1year,
        COUNT(CASE WHEN au.last_login > NOW() - INTERVAL '90 days' THEN 1 END) as active_90days
      FROM auth_user au
      LEFT JOIN dispatch_usersetting dus ON au.id = dus.user_id
      LEFT JOIN dispatch_office_doctors dod ON au.id = dod.user_id
      WHERE (dus.user_id IS NOT NULL OR dod.user_id IS NOT NULL)
    `);

    const activity = activityAnalysis.rows[0];
    console.log('   Activity Status:');
    console.log(`     Active (is_active=true): ${activity.active_doctors} (${((activity.active_doctors/activity.total_potential_doctors)*100).toFixed(1)}%)`);
    console.log(`     Inactive (is_active=false): ${activity.inactive_doctors} (${((activity.inactive_doctors/activity.total_potential_doctors)*100).toFixed(1)}%)`);
    console.log(`     Never logged in: ${activity.never_logged_in} (${((activity.never_logged_in/activity.total_potential_doctors)*100).toFixed(1)}%)`);
    console.log(`     Inactive >1 year: ${activity.inactive_1year} (${((activity.inactive_1year/activity.total_potential_doctors)*100).toFixed(1)}%)`);
    console.log(`     Active last 90 days: ${activity.active_90days} (${((activity.active_90days/activity.total_potential_doctors)*100).toFixed(1)}%)`);

    // Test accounts
    const testAccountsAnalysis = await sourcePool.query(`
      SELECT 
        COUNT(*) as total_test_accounts,
        COUNT(CASE WHEN LOWER(au.email) LIKE '%test%' THEN 1 END) as email_contains_test,
        COUNT(CASE WHEN LOWER(au.email) LIKE '%demo%' THEN 1 END) as email_contains_demo,
        COUNT(CASE WHEN au.email LIKE '%brius.com' THEN 1 END) as brius_emails,
        COUNT(CASE WHEN au.email LIKE '%mechanodontics.com' THEN 1 END) as mechano_emails,
        COUNT(CASE WHEN LOWER(au.first_name) LIKE '%test%' OR LOWER(au.last_name) LIKE '%test%' THEN 1 END) as name_contains_test
      FROM auth_user au
      LEFT JOIN dispatch_usersetting dus ON au.id = dus.user_id
      LEFT JOIN dispatch_office_doctors dod ON au.id = dod.user_id
      WHERE (dus.user_id IS NOT NULL OR dod.user_id IS NOT NULL)
      AND (
        LOWER(au.email) LIKE '%test%' OR
        LOWER(au.email) LIKE '%demo%' OR
        LOWER(au.first_name) LIKE '%test%' OR
        LOWER(au.last_name) LIKE '%test%' OR
        au.email LIKE '%brius.com' OR
        au.email LIKE '%mechanodontics.com'
      )
    `);

    const testAccounts = testAccountsAnalysis.rows[0];
    console.log('\n   Test/Development Accounts:');
    console.log(`     Total test accounts: ${testAccounts.total_test_accounts}`);
    console.log(`     Email contains "test": ${testAccounts.email_contains_test}`);
    console.log(`     Email contains "demo": ${testAccounts.email_contains_demo}`);
    console.log(`     Brius.com emails: ${testAccounts.brius_emails}`);
    console.log(`     Mechanodontics.com emails: ${testAccounts.mechano_emails}`);
    console.log(`     Name contains "test": ${testAccounts.name_contains_test}`);

    // 4. Duplication Analysis
    console.log('\n🔄 4. DUPLICATION ANALYSIS');
    console.log('-'.repeat(40));

    // Email duplicates
    const emailDuplicates = await sourcePool.query(`
      SELECT 
        COUNT(*) as duplicate_email_groups,
        SUM(doc_count - 1) as excess_records_by_email,
        MAX(doc_count) as max_duplicates_per_email
      FROM (
        SELECT au.email, COUNT(*) as doc_count
        FROM auth_user au
        LEFT JOIN dispatch_usersetting dus ON au.id = dus.user_id
        LEFT JOIN dispatch_office_doctors dod ON au.id = dod.user_id
        WHERE (dus.user_id IS NOT NULL OR dod.user_id IS NOT NULL)
        AND au.email IS NOT NULL AND au.email != ''
        GROUP BY au.email
        HAVING COUNT(*) > 1
      ) email_dups
    `);

    const emailDup = emailDuplicates.rows[0];
    console.log('   Email Duplicates:');
    console.log(`     Groups with duplicate emails: ${emailDup.duplicate_email_groups}`);
    console.log(`     Excess records due to email duplication: ${emailDup.excess_records_by_email}`);
    console.log(`     Maximum duplicates for single email: ${emailDup.max_duplicates_per_email}`);

    // Name duplicates
    const nameDuplicates = await sourcePool.query(`
      SELECT 
        COUNT(*) as duplicate_name_groups,
        SUM(doc_count - 1) as excess_records_by_name,
        MAX(doc_count) as max_duplicates_per_name
      FROM (
        SELECT 
          TRIM(LOWER(au.first_name)) || ' ' || TRIM(LOWER(au.last_name)) as full_name,
          COUNT(*) as doc_count
        FROM auth_user au
        LEFT JOIN dispatch_usersetting dus ON au.id = dus.user_id
        LEFT JOIN dispatch_office_doctors dod ON au.id = dod.user_id
        WHERE (dus.user_id IS NOT NULL OR dod.user_id IS NOT NULL)
        AND au.first_name IS NOT NULL AND au.first_name != ''
        AND au.last_name IS NOT NULL AND au.last_name != ''
        GROUP BY TRIM(LOWER(au.first_name)), TRIM(LOWER(au.last_name))
        HAVING COUNT(*) > 1
      ) name_dups
    `);

    const nameDup = nameDuplicates.rows[0];
    console.log('\n   Name Duplicates:');
    console.log(`     Groups with duplicate names: ${nameDup.duplicate_name_groups}`);
    console.log(`     Excess records due to name duplication: ${nameDup.excess_records_by_name}`);
    console.log(`     Maximum duplicates for single name: ${nameDup.max_duplicates_per_name}`);

    // 5. Patient Relationship Analysis
    console.log('\n🏥 5. PATIENT RELATIONSHIP ANALYSIS');
    console.log('-'.repeat(40));

    const patientAnalysis = await sourcePool.query(`
      SELECT 
        COUNT(DISTINCT dp.doctor_id) as doctors_with_any_patients,
        COUNT(DISTINCT CASE WHEN dp.archived = false OR dp.archived IS NULL THEN dp.doctor_id END) as doctors_with_active_patients,
        COUNT(*) as total_patient_records,
        COUNT(CASE WHEN dp.archived = false OR dp.archived IS NULL THEN 1 END) as active_patient_records,
        AVG(CASE WHEN dp.archived = false OR dp.archived IS NULL THEN 1.0 ELSE 0 END) as active_patient_ratio
      FROM dispatch_patient dp
    `);

    const patients = patientAnalysis.rows[0];
    console.log(`   Total patient records: ${patients.total_patient_records.toLocaleString()}`);
    console.log(`   Active patient records: ${patients.active_patient_records.toLocaleString()} (${(patients.active_patient_ratio*100).toFixed(1)}%)`);
    console.log(`   Doctors with any patients: ${patients.doctors_with_any_patients}`);
    console.log(`   Doctors with active patients: ${patients.doctors_with_active_patients}`);

    // Patient distribution
    const patientDistribution = await sourcePool.query(`
      SELECT 
        COUNT(*) as doctors_with_patients,
        AVG(patient_count) as avg_patients,
        MIN(patient_count) as min_patients,
        MAX(patient_count) as max_patients,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY patient_count) as median_patients
      FROM (
        SELECT doctor_id, COUNT(*) as patient_count
        FROM dispatch_patient
        WHERE archived = false OR archived IS NULL
        GROUP BY doctor_id
      ) doc_patients
    `);

    const dist = patientDistribution.rows[0];
    console.log(`   Average patients per doctor: ${Math.round(dist.avg_patients)}`);
    console.log(`   Median patients per doctor: ${Math.round(dist.median_patients)}`);
    console.log(`   Range: ${dist.min_patients} - ${dist.max_patients} patients`);

    // 6. Migration Impact Analysis
    console.log('\n📈 6. MIGRATION IMPACT ANALYSIS');
    console.log('-'.repeat(40));

    const cleanDataAnalysis = await sourcePool.query(`
      WITH clean_doctors AS (
        SELECT DISTINCT ON (
          CASE 
            WHEN au.email IS NOT NULL AND au.email != '' 
            THEN TRIM(LOWER(au.email))
            ELSE CONCAT(TRIM(LOWER(COALESCE(au.first_name, ''))), '_', TRIM(LOWER(COALESCE(au.last_name, ''))))
          END
        ) au.id
        FROM auth_user au
        LEFT JOIN dispatch_usersetting dus ON au.id = dus.user_id
        LEFT JOIN dispatch_office_doctors dod ON au.id = dod.user_id
        LEFT JOIN (
          SELECT doctor_id, COUNT(*) as patient_count
          FROM dispatch_patient
          WHERE archived = false OR archived IS NULL
          GROUP BY doctor_id
        ) patient_stats ON au.id = patient_stats.doctor_id
        WHERE (dus.user_id IS NOT NULL OR dod.user_id IS NOT NULL)
        AND au.is_active = true
        AND COALESCE(patient_stats.patient_count, 0) > 0
        AND NOT (
          LOWER(au.email) LIKE '%test%' OR
          LOWER(au.email) LIKE '%demo%' OR
          LOWER(au.first_name) LIKE '%test%' OR
          LOWER(au.last_name) LIKE '%test%' OR
          au.email LIKE '%brius.com' OR
          au.email LIKE '%mechanodontics.com'
        )
        ORDER BY 
          CASE 
            WHEN au.email IS NOT NULL AND au.email != '' 
            THEN TRIM(LOWER(au.email))
            ELSE CONCAT(TRIM(LOWER(COALESCE(au.first_name, ''))), '_', TRIM(LOWER(COALESCE(au.last_name, ''))))
          END,
          COALESCE(patient_stats.patient_count, 0) DESC,
          au.last_login DESC NULLS LAST,
          au.id ASC
      )
      SELECT COUNT(*) as clean_migrable_doctors FROM clean_doctors
    `);

    const cleanCount = cleanDataAnalysis.rows[0].clean_migrable_doctors;

    console.log('   Data Quality Summary:');
    console.log(`     Raw potential doctors: ${universe.potential_doctors.toLocaleString()}`);
    console.log(`     After removing inactive: ${activity.active_doctors} (-${universe.potential_doctors - activity.active_doctors})`);
    console.log(`     After removing test accounts: ~${activity.active_doctors - testAccounts.total_test_accounts} (-${testAccounts.total_test_accounts})`);
    console.log(`     After deduplication: ~${cleanCount} (-${(activity.active_doctors - testAccounts.total_test_accounts) - cleanCount})`);
    console.log(`     With actual patients: ${cleanCount}`);
    
    const dataLossPercentage = ((universe.potential_doctors - cleanCount) / universe.potential_doctors * 100).toFixed(1);
    console.log(`     Total data loss: ${universe.potential_doctors - cleanCount} records (${dataLossPercentage}%)`);

    // 7. Analysis Impact
    console.log('\n🎯 7. ANALYSIS IMPACT ASSESSMENT');
    console.log('-'.repeat(40));
    console.log('   Problems affecting analysis accuracy:');
    console.log(`     ❌ ${((activity.inactive_doctors/universe.potential_doctors)*100).toFixed(1)}% of records are inactive doctors`);
    console.log(`     ❌ ${((testAccounts.total_test_accounts/universe.potential_doctors)*100).toFixed(1)}% are test/development accounts`);
    console.log(`     ❌ ${emailDup.excess_records_by_email} excess records from email duplication`);
    console.log(`     ❌ ${nameDup.excess_records_by_name} excess records from name duplication`);
    console.log(`     ❌ ${universe.potential_doctors - universe.users_with_patients} doctors have no patients`);
    
    console.log('\n   Migration reliability:');
    if (cleanCount > 0) {
      console.log(`     ✅ ${cleanCount} high-quality doctor records identified`);
      console.log(`     ✅ All have active patients (average ${Math.round(dist.avg_patients)} patients each)`);
      console.log(`     ✅ Deduplicated and filtered for production use`);
    } else {
      console.log('     ❌ No clean doctor records found - data quality issues too severe');
    }

    // 8. Recommendations
    console.log('\n💡 8. RECOMMENDATIONS');
    console.log('-'.repeat(40));
    console.log('   Immediate actions:');
    console.log('     1. Fix target database schema (add missing columns)');
    console.log('     2. Implement strict filtering: active + has patients + not test account');
    console.log('     3. Use email-based deduplication with patient count prioritization');
    console.log('     4. Archive/flag inactive and test accounts in source system');
    
    console.log('\n   Data governance:');
    console.log('     1. Implement unique constraints on email addresses');
    console.log('     2. Add data validation rules for new doctor accounts');
    console.log('     3. Regular cleanup of test/development data');
    console.log('     4. Patient relationship validation before doctor activation');

    console.log('\n' + '='.repeat(70));
    console.log(`📊 SUMMARY: ${dataLossPercentage}% data loss due to quality issues, but ${cleanCount} high-quality records available for migration`);
    console.log('='.repeat(70));

  } catch (error: any) {
    console.error('❌ Error generating report:', error.message);
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

generateDoctorProblemsReport();
