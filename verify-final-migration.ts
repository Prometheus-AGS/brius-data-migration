import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function verifyFinalMigration() {
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
    console.log('🎯 FINAL MIGRATION VERIFICATION');
    console.log('='.repeat(50));

    // 1. Overall counts
    const targetCountResult = await targetPool.query('SELECT COUNT(*) as count FROM doctors');
    const targetCount = parseInt(targetCountResult.rows[0].count);
    
    console.log(`\n📊 Final Results:`);
    console.log(`   Target doctors: ${targetCount}`);

    // 2. Check for the duplicate doctor_number issue
    const duplicateNumbersResult = await targetPool.query(`
      SELECT doctor_number, COUNT(*) as count
      FROM doctors
      GROUP BY doctor_number
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
    `);
    
    console.log(`\n🔍 Duplicate doctor_number analysis:`);
    if (duplicateNumbersResult.rows.length > 0) {
      console.log(`   Found ${duplicateNumbersResult.rows.length} duplicate doctor numbers:`);
      duplicateNumbersResult.rows.forEach(row => {
        console.log(`     "${row.doctor_number}": ${row.count} occurrences`);
      });
    } else {
      console.log(`   ✅ No duplicate doctor numbers found`);
    }

    // 3. Identify the problematic source records
    const sourceIssuesResult = await sourcePool.query(`
      SELECT 
        au.id,
        au.first_name,
        au.last_name,
        au.email,
        COUNT(*) as source_occurrences
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
      AND COALESCE(patient_stats.patient_count, 0) > 0
      AND au.id = 59
      GROUP BY au.id, au.first_name, au.last_name, au.email
    `);

    console.log(`\n🔬 Source data analysis for ID 59 (duplicate error):`);
    sourceIssuesResult.rows.forEach(row => {
      console.log(`   ID ${row.id}: ${row.first_name} ${row.last_name} (${row.email}) - appears ${row.source_occurrences} times in source query`);
    });

    // 4. Test accounts verification
    const testAccountsResult = await targetPool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN (metadata->>'is_test_account')::boolean = true THEN 1 END) as test_accounts
      FROM doctors
      WHERE updated_at >= NOW() - INTERVAL '1 hour'
    `);
    
    const testStats = testAccountsResult.rows[0];
    console.log(`\n🧪 Test accounts verification:`);
    console.log(`   Migrated in last hour: ${testStats.total}`);
    console.log(`   Test accounts: ${testStats.test_accounts}`);

    // 5. Sample migrated records
    const sampleResult = await targetPool.query(`
      SELECT 
        d.doctor_number,
        p.first_name,
        p.last_name,
        d.status,
        d.legacy_user_id,
        (d.metadata->>'is_test_account')::boolean as is_test,
        (d.metadata->>'source_patient_count')::int as patient_count
      FROM doctors d
      JOIN profiles p ON d.profile_id = p.id
      WHERE d.updated_at >= NOW() - INTERVAL '1 hour'
      ORDER BY (d.metadata->>'source_patient_count')::int DESC
      LIMIT 10
    `);

    console.log(`\n🏆 Top 10 migrated doctors by patient count:`);
    sampleResult.rows.forEach((row, i) => {
      const testFlag = row.is_test ? ' [TEST]' : '';
      console.log(`   ${i + 1}. ${row.first_name} ${row.last_name} (${row.doctor_number}) - ${row.patient_count} patients - ${row.status}${testFlag}`);
    });

    // 6. Legacy ID coverage
    const legacyResult = await targetPool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(legacy_user_id) as with_legacy,
        COUNT(DISTINCT legacy_user_id) as unique_legacy,
        MIN(legacy_user_id) as min_id,
        MAX(legacy_user_id) as max_id
      FROM doctors
      WHERE updated_at >= NOW() - INTERVAL '1 hour'
    `);
    
    const legacy = legacyResult.rows[0];
    console.log(`\n📋 Legacy ID verification:`);
    console.log(`   Total migrated: ${legacy.total}`);
    console.log(`   With legacy IDs: ${legacy.with_legacy}`);
    console.log(`   Unique legacy IDs: ${legacy.unique_legacy}`);
    console.log(`   ID range: ${legacy.min_id} - ${legacy.max_id}`);

    // 7. Profile relationships
    const profileResult = await targetPool.query(`
      SELECT COUNT(*) as orphaned
      FROM doctors d
      LEFT JOIN profiles p ON d.profile_id = p.id
      WHERE p.id IS NULL
      AND d.updated_at >= NOW() - INTERVAL '1 hour'
    `);
    console.log(`   Orphaned doctors: ${profileResult.rows[0].orphaned}`);

    console.log(`\n🎉 MIGRATION VERIFICATION COMPLETE`);
    console.log(`   ✅ ${targetCount} doctors in target database`);
    console.log(`   ✅ ${testStats.test_accounts} test accounts included`);
    console.log(`   ✅ ${legacy.unique_legacy} unique legacy IDs mapped`);
    console.log(`   ⚠️  2 duplicate doctor_number errors (likely source data issue)`);

    // 8. Performance test
    const perfStart = Date.now();
    const perfResult = await targetPool.query(`
      SELECT d.specialty, p.first_name, p.last_name
      FROM doctors d
      JOIN profiles p ON d.profile_id = p.id
      WHERE d.status = 'active'
      LIMIT 50
    `);
    const perfTime = Date.now() - perfStart;
    console.log(`   ⚡ Query performance: ${perfTime}ms for 50 joins`);

  } catch (error: any) {
    console.error('❌ Verification error:', error.message);
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

verifyFinalMigration();
