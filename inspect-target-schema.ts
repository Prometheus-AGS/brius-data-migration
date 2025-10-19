import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function inspectTargetSchema() {
  const targetPool = new Pool({
    host: process.env.TARGET_DB_HOST,
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    database: process.env.TARGET_DB_NAME,
    user: process.env.TARGET_DB_USER,
    password: process.env.TARGET_DB_PASSWORD
  });

  try {
    console.log('🔍 INSPECTING TARGET DATABASE SCHEMA');
    console.log('='.repeat(50));

    // 1. List all tables
    console.log('\n📋 All Tables in Public Schema:');
    const tablesResult = await targetPool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    
    tablesResult.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });

    // 2. Check if doctors table exists and get its structure
    console.log('\n🏥 DOCTORS Table Schema:');
    const doctorsColumnsResult = await targetPool.query(`
      SELECT 
        column_name, 
        data_type, 
        is_nullable,
        column_default,
        character_maximum_length
      FROM information_schema.columns 
      WHERE table_name = 'doctors' 
      AND table_schema = 'public'
      ORDER BY ordinal_position
    `);

    if (doctorsColumnsResult.rows.length === 0) {
      console.log('   ❌ DOCTORS table does not exist!');
    } else {
      console.log('   ✅ DOCTORS table found with columns:');
      doctorsColumnsResult.rows.forEach(col => {
        const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
        const length = col.character_maximum_length ? `(${col.character_maximum_length})` : '';
        const defaultVal = col.column_default ? ` DEFAULT ${col.column_default}` : '';
        console.log(`     ${col.column_name}: ${col.data_type}${length} ${nullable}${defaultVal}`);
      });
    }

    // 3. Check profiles table structure for comparison
    console.log('\n👤 PROFILES Table Schema:');
    const profilesColumnsResult = await targetPool.query(`
      SELECT 
        column_name, 
        data_type, 
        is_nullable,
        column_default
      FROM information_schema.columns 
      WHERE table_name = 'profiles' 
      AND table_schema = 'public'
      ORDER BY ordinal_position
    `);

    if (profilesColumnsResult.rows.length === 0) {
      console.log('   ❌ PROFILES table does not exist!');
    } else {
      console.log('   ✅ PROFILES table found with columns:');
      profilesColumnsResult.rows.forEach(col => {
        const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
        const defaultVal = col.column_default ? ` DEFAULT ${col.column_default}` : '';
        console.log(`     ${col.column_name}: ${col.data_type} ${nullable}${defaultVal}`);
      });
    }

    // 4. Check for existing data
    if (doctorsColumnsResult.rows.length > 0) {
      console.log('\n📊 Current Data Status:');
      const doctorCountResult = await targetPool.query('SELECT COUNT(*) as count FROM doctors');
      console.log(`   Doctors count: ${doctorCountResult.rows[0].count}`);
      
      if (parseInt(doctorCountResult.rows[0].count) > 0) {
        const sampleResult = await targetPool.query('SELECT * FROM doctors LIMIT 3');
        console.log('\n   Sample doctor records:');
        sampleResult.rows.forEach((row, i) => {
          console.log(`   ${i + 1}. ${JSON.stringify(row, null, 2)}`);
        });
      }
    }

    // 5. Check profiles count and sample for reference
    if (profilesColumnsResult.rows.length > 0) {
      const profileCountResult = await targetPool.query(`SELECT COUNT(*) as count FROM profiles WHERE profile_type = 'doctor'`);
      console.log(`\n   Doctor profiles count: ${profileCountResult.rows[0].count}`);
      
      if (parseInt(profileCountResult.rows[0].count) > 0) {
        const sampleProfilesResult = await targetPool.query(`
          SELECT id, first_name, last_name, email, legacy_user_id 
          FROM profiles 
          WHERE profile_type = 'doctor' 
          LIMIT 3
        `);
        console.log('\n   Sample doctor profiles:');
        sampleProfilesResult.rows.forEach((row, i) => {
          console.log(`   ${i + 1}. ID: ${row.id}, Name: ${row.first_name} ${row.last_name}, Email: ${row.email}, Legacy ID: ${row.legacy_user_id}`);
        });
      }
    }

    // 6. Check for foreign key constraints
    console.log('\n🔗 Foreign Key Constraints:');
    const constraintsResult = await targetPool.query(`
      SELECT
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        tc.constraint_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name IN ('doctors', 'profiles')
      ORDER BY tc.table_name, kcu.column_name
    `);

    constraintsResult.rows.forEach(row => {
      console.log(`   ${row.table_name}.${row.column_name} → ${row.foreign_table_name}.${row.foreign_column_name} (${row.constraint_name})`);
    });

  } catch (error: any) {
    console.error('❌ Schema inspection error:', error.message);
  } finally {
    await targetPool.end();
  }
}

inspectTargetSchema();
