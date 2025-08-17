import { Client as PgClient } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const sourceDb = new PgClient({
  host: process.env.SOURCE_DB_HOST!,
  port: parseInt(process.env.SOURCE_DB_PORT!),
  user: process.env.SOURCE_DB_USER!,
  password: process.env.SOURCE_DB_PASSWORD!,
  database: process.env.SOURCE_DB_NAME!,
});

async function checkDispatchPlanStructure() {
  console.log('🔍 Checking dispatch_plan table structure...\n');

  try {
    await sourceDb.connect();

    // Check table structure
    const structureQuery = `
      SELECT 
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns 
      WHERE table_name = 'dispatch_plan'
      ORDER BY ordinal_position;
    `;
    
    const structure = await sourceDb.query(structureQuery);
    console.log('dispatch_plan table structure:');
    structure.rows.forEach(row => {
      console.log(`  • ${row.column_name}: ${row.data_type} ${row.is_nullable === 'YES' ? '(nullable)' : '(required)'} ${row.column_default ? `default: ${row.column_default}` : ''}`);
    });

    // Sample data
    const sampleQuery = `SELECT * FROM dispatch_plan LIMIT 5;`;
    const sample = await sourceDb.query(sampleQuery);
    console.log('\nSample records:');
    sample.rows.forEach((row, index) => {
      console.log(`  ${index + 1}.`, row);
    });

    // Check duplicates by project_id
    const duplicateQuery = `
      SELECT 
        project_id,
        COUNT(*) as plan_count,
        array_agg(id) as plan_ids
      FROM dispatch_plan 
      GROUP BY project_id
      HAVING COUNT(*) > 1
      ORDER BY plan_count DESC
      LIMIT 10;
    `;
    
    const duplicates = await sourceDb.query(duplicateQuery);
    console.log(`\nProjects with duplicate plans: ${duplicates.rows.length}`);
    if (duplicates.rows.length > 0) {
      duplicates.rows.forEach((row, index) => {
        console.log(`  ${index + 1}. Project ${row.project_id}: ${row.plan_count} plans (${row.plan_ids.slice(0, 3).join(', ')}${row.plan_ids.length > 3 ? '...' : ''})`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await sourceDb.end();
  }
}

checkDispatchPlanStructure().catch(console.error);
