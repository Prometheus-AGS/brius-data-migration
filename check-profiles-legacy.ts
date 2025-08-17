import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function checkProfilesLegacy() {
  const targetDb = new Client({
    host: process.env.TARGET_DB_HOST || 'localhost',
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    user: process.env.TARGET_DB_USER || 'postgres',
    password: process.env.TARGET_DB_PASSWORD!,
    database: process.env.TARGET_DB_NAME || 'postgres'
  });

  try {
    await targetDb.connect();
    
    // Check profiles with legacy user mapping
    const legacyProfiles = await targetDb.query(`
      SELECT COUNT(*) as count FROM profiles 
      WHERE legacy_user_id IS NOT NULL
    `);
    console.log(`Profiles with legacy_user_id: ${legacyProfiles.rows[0].count}`);
    
    // Show some sample profiles with legacy user IDs
    if (parseInt(legacyProfiles.rows[0].count) > 0) {
      const samples = await targetDb.query(`
        SELECT id, legacy_user_id, first_name, last_name, profile_type
        FROM profiles 
        WHERE legacy_user_id IS NOT NULL 
        ORDER BY legacy_user_id
        LIMIT 10
      `);
      
      console.log('\nSample profiles with legacy user mapping:');
      samples.rows.forEach(row => {
        console.log(`  Legacy User ID: ${row.legacy_user_id} -> Profile ID: ${row.id} (${row.first_name} ${row.last_name}, ${row.profile_type})`);
      });
    }
    
    // Now let's check what legacy user IDs we have in dispatch_comment.author_id
    const sourceDb = new Client({
      host: process.env.SOURCE_DB_HOST!,
      port: parseInt(process.env.SOURCE_DB_PORT!),
      user: process.env.SOURCE_DB_USER!,
      password: process.env.SOURCE_DB_PASSWORD!,
      database: process.env.SOURCE_DB_NAME!,
    });
    
    await sourceDb.connect();
    
    const authorIds = await sourceDb.query(`
      SELECT DISTINCT author_id, COUNT(*) as comment_count
      FROM dispatch_comment 
      WHERE author_id IS NOT NULL
      GROUP BY author_id
      ORDER BY author_id
      LIMIT 10
    `);
    
    console.log('\nDistinct author_ids from dispatch_comment (sample):');
    authorIds.rows.forEach(row => {
      console.log(`  Author ID: ${row.author_id} (${row.comment_count} comments)`);
    });
    
    await sourceDb.end();
    
  } finally {
    await targetDb.end();
  }
}

checkProfilesLegacy().catch(console.error);
