import { Client as PgClient } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function findDispatchTables() {
  console.log('🔍 Searching for dispatch-related tables...\n');

  const sourceDb = new PgClient({
    host: process.env.SOURCE_DB_HOST!,
    port: parseInt(process.env.SOURCE_DB_PORT!),
    user: process.env.SOURCE_DB_USER!,
    password: process.env.SOURCE_DB_PASSWORD!,
    database: process.env.SOURCE_DB_NAME!,
  });

  try {
    await sourceDb.connect();
    
    // 1. Find all tables with "dispatch" in the name
    console.log('📋 Tables containing "dispatch":');
    const dispatchTables = await sourceDb.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name LIKE '%dispatch%'
      ORDER BY table_name;
    `);
    
    dispatchTables.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });
    
    // 2. Find all tables with "record" in the name
    console.log('\n📋 Tables containing "record":');
    const recordTables = await sourceDb.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name LIKE '%record%'
      ORDER BY table_name;
    `);
    
    recordTables.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });
    
    // 3. Let's also check for Django content type table
    console.log('\n📋 Django content type related tables:');
    const djangoTables = await sourceDb.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND (table_name LIKE '%content%type%' OR table_name LIKE '%django%')
      ORDER BY table_name;
    `);
    
    djangoTables.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });
    
    // 4. Show a broader search for any tables that might be related
    console.log('\n📋 All tables in database (sample):');
    const allTables = await sourceDb.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
      LIMIT 50;
    `);
    
    allTables.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });
    
    const totalTables = await sourceDb.query(`
      SELECT COUNT(*) as count
      FROM information_schema.tables 
      WHERE table_schema = 'public';
    `);
    
    console.log(`\n📊 Total tables in database: ${totalTables.rows[0].count} (showing first 50)`);
    
  } catch (error) {
    console.error('❌ Search failed:', error);
  } finally {
    await sourceDb.end();
  }
}

findDispatchTables().catch(console.error);
