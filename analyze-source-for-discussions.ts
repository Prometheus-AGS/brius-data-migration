import { Client as PgClient } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

// Source database configuration
const sourceDb = new PgClient({
  host: process.env.SOURCE_DB_HOST!,
  port: parseInt(process.env.SOURCE_DB_PORT!),
  user: process.env.SOURCE_DB_USER!,
  password: process.env.SOURCE_DB_PASSWORD!,
  database: process.env.SOURCE_DB_NAME!,
});

async function analyzeSourceForDiscussions() {
  console.log('🔍 Analyzing source tables that might map to treatment_discussions...\n');

  try {
    await sourceDb.connect();

    // Look for tables with discussion, comment, note, conversation, message, etc.
    const tablesQuery = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        AND (
          table_name ILIKE '%comment%' OR
          table_name ILIKE '%discussion%' OR
          table_name ILIKE '%note%' OR
          table_name ILIKE '%message%' OR
          table_name ILIKE '%conversation%' OR
          table_name ILIKE '%communication%' OR
          table_name ILIKE '%chat%' OR
          table_name ILIKE '%feedback%' OR
          table_name ILIKE '%review%'
        )
      ORDER BY table_name;
    `;

    const tablesResult = await sourceDb.query(tablesQuery);
    
    console.log('📋 Source tables that might contain discussion/communication data:');
    if (tablesResult.rows.length === 0) {
      console.log('  No obvious discussion-related tables found.');
    } else {
      for (const row of tablesResult.rows) {
        // Get record count for each table
        try {
          const countResult = await sourceDb.query(`SELECT COUNT(*) FROM ${row.table_name}`);
          const count = countResult.rows[0].count;
          console.log(`  • ${row.table_name}: ${count} records`);
        } catch (error) {
          console.log(`  • ${row.table_name}: (unable to count records)`);
        }
      }
    }

    // Look for dispatch_* tables that might have comments/notes
    console.log('\n📝 Checking dispatch_* tables for comment/note fields...');
    const dispatchTablesQuery = `
      SELECT 
        t.table_name,
        c.column_name,
        c.data_type
      FROM information_schema.tables t
      JOIN information_schema.columns c ON t.table_name = c.table_name
      WHERE t.table_schema = 'public' 
        AND t.table_type = 'BASE TABLE'
        AND t.table_name LIKE 'dispatch_%'
        AND (
          c.column_name ILIKE '%comment%' OR
          c.column_name ILIKE '%note%' OR
          c.column_name ILIKE '%message%' OR
          c.column_name ILIKE '%discussion%' OR
          c.column_name ILIKE '%feedback%' OR
          c.column_name = 'notes'
        )
      ORDER BY t.table_name, c.column_name;
    `;

    const dispatchResult = await sourceDb.query(dispatchTablesQuery);
    
    if (dispatchResult.rows.length === 0) {
      console.log('  No comment/note fields found in dispatch_* tables.');
    } else {
      let currentTable = '';
      for (const row of dispatchResult.rows) {
        if (row.table_name !== currentTable) {
          console.log(`\n  ${row.table_name}:`);
          currentTable = row.table_name;
        }
        console.log(`    • ${row.column_name} (${row.data_type})`);
      }
    }

    // Check dispatch_comment table specifically if it exists
    console.log('\n💬 Checking for dispatch_comment table...');
    const commentTableQuery = `
      SELECT COUNT(*) as record_count 
      FROM dispatch_comment 
      WHERE 1=1;
    `;
    
    try {
      const commentResult = await sourceDb.query(commentTableQuery);
      const count = commentResult.rows[0].record_count;
      console.log(`  dispatch_comment table found: ${count} records`);
      
      if (count > 0) {
        // Get sample structure
        const structureQuery = `
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns 
          WHERE table_name = 'dispatch_comment'
          ORDER BY ordinal_position;
        `;
        const structureResult = await sourceDb.query(structureQuery);
        
        console.log('\n  dispatch_comment table structure:');
        structureResult.rows.forEach(row => {
          console.log(`    • ${row.column_name}: ${row.data_type} ${row.is_nullable === 'YES' ? '(nullable)' : '(not null)'}`);
        });

        // Get sample data
        const sampleQuery = `SELECT * FROM dispatch_comment LIMIT 3;`;
        const sampleResult = await sourceDb.query(sampleQuery);
        console.log('\n  Sample records:');
        console.log('  ', sampleResult.rows);
      }
    } catch (error) {
      console.log('  dispatch_comment table not found or inaccessible');
    }

  } catch (error) {
    console.error('❌ Error analyzing source tables:', error);
  } finally {
    await sourceDb.end();
  }
}

analyzeSourceForDiscussions().catch(console.error);
