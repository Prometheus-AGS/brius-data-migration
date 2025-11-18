/**
 * Investigate source database schema and table relationships
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function investigateSourceSchema() {
  const sourcePool = new Pool({
    host: process.env.SOURCE_DB_HOST,
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME,
    user: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASSWORD,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  try {
    console.log('🔍 Investigating source database schema...');

    // Get all dispatch-related tables
    const tablesResult = await sourcePool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name LIKE 'dispatch_%'
      ORDER BY table_name;
    `);

    console.log('\n📋 Available dispatch_* tables:');
    tablesResult.rows.forEach(row => {
      console.log(`   ${row.table_name}`);
    });

    // Check dispatch_patient structure
    console.log('\n🔍 Checking dispatch_patient table structure...');
    const patientSchemaResult = await sourcePool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'dispatch_patient'
      ORDER BY ordinal_position;
    `);

    console.log('✅ dispatch_patient columns:');
    patientSchemaResult.rows.forEach(row => {
      console.log(`   ${row.column_name}: ${row.data_type} ${row.is_nullable === 'NO' ? 'NOT NULL' : 'NULLABLE'}`);
    });

    // Get sample dispatch_patient data
    const patientSampleResult = await sourcePool.query(`
      SELECT dp.id, dp.user_id
      FROM dispatch_patient dp
      WHERE dp.id IN (531647, 531648, 531649)
      ORDER BY dp.id;
    `);

    console.log('\n📋 Sample dispatch_patient records (matching instruction patients):');
    patientSampleResult.rows.forEach(row => {
      console.log(`   Patient ID ${row.id} -> User ID ${row.user_id}`);
    });

    // Check if there are auth_user tables
    const authUserResult = await sourcePool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name LIKE '%user%'
      ORDER BY table_name;
    `);

    console.log('\n👤 User-related tables:');
    authUserResult.rows.forEach(row => {
      console.log(`   ${row.table_name}`);
    });

    // Check dispatch_user_profile if it exists
    try {
      const profileResult = await sourcePool.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'dispatch_user_profile';
      `);

      if (profileResult.rows.length > 0) {
        console.log('\n🔍 Checking dispatch_user_profile structure...');
        const profileSchemaResult = await sourcePool.query(`
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'dispatch_user_profile'
          ORDER BY ordinal_position;
        `);

        console.log('✅ dispatch_user_profile columns:');
        profileSchemaResult.rows.forEach(row => {
          console.log(`   ${row.column_name}: ${row.data_type} ${row.is_nullable === 'NO' ? 'NOT NULL' : 'NULLABLE'}`);
        });
      }
    } catch (error) {
      console.log('⚠️  dispatch_user_profile table not found');
    }

    // Check how patients relate to doctors in our sample data
    console.log('\n🔍 Investigating patient-doctor relationships...');
    try {
      const relationResult = await sourcePool.query(`
        SELECT
          dp.id as patient_id,
          dp.user_id,
          au.username,
          au.email
        FROM dispatch_patient dp
        JOIN auth_user au ON dp.user_id = au.id
        WHERE dp.id IN (531647, 531648, 531649)
        ORDER BY dp.id;
      `);

      console.log('✅ Patient-User relationships:');
      relationResult.rows.forEach(row => {
        console.log(`   Patient ${row.patient_id}: User ${row.user_id} (${row.username}, ${row.email})`);
      });
    } catch (error) {
      console.log('⚠️  Could not resolve patient-user relationships:', error instanceof Error ? error.message : 'Unknown error');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await sourcePool.end();
  }
}

investigateSourceSchema().catch(console.error);