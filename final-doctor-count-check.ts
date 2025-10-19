import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function checkDoctorCounts() {
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
    console.log('📊 Checking doctor counts...\n');

    // Count unique doctors by user_id in dispatch_office_doctors
    const sourceResult = await sourcePool.query('SELECT COUNT(DISTINCT user_id) as count FROM dispatch_office_doctors');
    const sourceCount = parseInt(sourceResult.rows[0].count);
    console.log(`📋 Source Database (dispatch_office_doctors): ${sourceCount} unique doctors`);

    // Count doctors in target
    const targetResult = await targetPool.query('SELECT COUNT(*) as count FROM doctors');
    const targetCount = parseInt(targetResult.rows[0].count);
    console.log(`🎯 Target Database (doctors): ${targetCount} doctors`);

    // Count profiles in target (doctors should also have profiles)
    const profileResult = await targetPool.query(`SELECT COUNT(*) as count FROM profiles WHERE profile_type = 'doctor'`);
    const profileCount = parseInt(profileResult.rows[0].count);
    console.log(`👤 Target Database (doctor profiles): ${profileCount} doctor profiles`);

    console.log('\n📈 Comparison:');
    if (sourceCount === targetCount) {
      console.log('✅ Doctor counts match perfectly!');
    } else {
      const difference = sourceCount - targetCount;
      console.log(`❌ Doctor count mismatch: ${difference > 0 ? '+' : ''}${difference}`);
      console.log(`   Source: ${sourceCount}, Target: ${targetCount}`);
    }
    
    if (targetCount === profileCount) {
      console.log('✅ Doctors and profiles match!');
    } else {
      console.log(`⚠️  Profile mismatch: ${targetCount} doctors vs ${profileCount} profiles`);
    }

    const migrationRate = sourceCount > 0 ? ((targetCount / sourceCount) * 100).toFixed(2) : '0.00';
    console.log(`\n📈 Migration Rate: ${migrationRate}%`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

checkDoctorCounts();