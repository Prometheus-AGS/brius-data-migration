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

    const sourceResult = await sourcePool.query('SELECT COUNT(*) as count FROM dispatch_doctor');
    const sourceCount = parseInt(sourceResult.rows[0].count);
    console.log(`📋 Source Database: ${sourceCount} doctors`);

    const targetResult = await targetPool.query('SELECT COUNT(*) as count FROM doctors');
    const targetCount = parseInt(targetResult.rows[0].count);
    console.log(`🎯 Target Database: ${targetCount} doctors`);

    console.log('\n📈 Comparison:');
    if (sourceCount === targetCount) {
      console.log('✅ Doctor counts match perfectly!');
    } else {
      const difference = sourceCount - targetCount;
      console.log(`❌ Mismatch: ${difference > 0 ? '+' : ''}${difference}`);
    }

    const migrationRate = sourceCount > 0 ? ((targetCount / sourceCount) * 100).toFixed(2) : '0.00';
    console.log(`📈 Migration Rate: ${migrationRate}%`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

checkDoctorCounts();