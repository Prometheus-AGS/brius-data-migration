import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function checkProfiles() {
  const targetDb = new Client({
    host: process.env.TARGET_DB_HOST || 'localhost',
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    user: process.env.TARGET_DB_USER || 'postgres',
    password: process.env.TARGET_DB_PASSWORD!,
    database: process.env.TARGET_DB_NAME || 'postgres'
  });

  try {
    await targetDb.connect();
    
    // Check if profiles table exists
    const tableCheck = await targetDb.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'profiles'
      );
    `);
    
    if (!tableCheck.rows[0].exists) {
      console.log('❌ Profiles table does not exist');
      return;
    }
    
    console.log('✅ Profiles table exists');
    
    // Get profiles schema
    const schemaResult = await targetDb.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'profiles'
      ORDER BY ordinal_position;
    `);
    
    console.log('\nProfiles table schema:');
    schemaResult.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
    });
    
    // Check if there are any profiles with legacy mappings
    const profileCount = await targetDb.query('SELECT COUNT(*) as count FROM profiles');
    console.log(`\nTotal profiles: ${profileCount.rows[0].count}`);
    
    const legacyProfiles = await targetDb.query(`
      SELECT COUNT(*) as count FROM profiles 
      WHERE legacy_id IS NOT NULL
    `);
    console.log(`Profiles with legacy_id: ${legacyProfiles.rows[0].count}`);
    
    // Show some sample profiles with legacy IDs
    if (parseInt(legacyProfiles.rows[0].count) > 0) {
      const samples = await targetDb.query(`
        SELECT id, legacy_id, first_name, last_name 
        FROM profiles 
        WHERE legacy_id IS NOT NULL 
        LIMIT 5
      `);
      
      console.log('\nSample profiles with legacy mapping:');
      samples.rows.forEach(row => {
        console.log(`  ID: ${row.id} -> Legacy ID: ${row.legacy_id} (${row.first_name} ${row.last_name})`);
      });
    }
    
  } finally {
    await targetDb.end();
  }
}

checkProfiles().catch(console.error);
