import dotenv from 'dotenv';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function investigateProjectRelationships() {
  console.log('🔍 Investigating project relationships for bracket migration...\n');
  
  const sourceClient = new Client({
    host: process.env.SOURCE_DB_HOST!,
    port: parseInt(process.env.SOURCE_DB_PORT!),
    user: process.env.SOURCE_DB_USER!,
    password: process.env.SOURCE_DB_PASSWORD!,
    database: process.env.SOURCE_DB_NAME!,
  });
  
  try {
    await sourceClient.connect();
    
    // 1. Check if there's a dispatch_project table
    console.log('📋 Step 1: Looking for project-related tables...');
    
    const projectTables = await sourceClient.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name LIKE '%project%'
      ORDER BY table_name;
    `);
    
    projectTables.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });
    
    // 2. If dispatch_project exists, analyze it
    const hasDispatchProject = projectTables.rows.some(row => row.table_name === 'dispatch_project');
    
    if (hasDispatchProject) {
      console.log('\n📋 Step 2: Analyzing dispatch_project table...');
      
      const projectStructure = await sourceClient.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'dispatch_project' AND table_schema = 'public'
        ORDER BY ordinal_position;
      `);
      
      console.log('dispatch_project structure:');
      projectStructure.rows.forEach(col => {
        console.log(`  - ${col.column_name}: ${col.data_type}`);
      });
      
      // Count records
      const projectCount = await sourceClient.query('SELECT COUNT(*) as count FROM dispatch_project');
      console.log(`\nTotal projects: ${projectCount.rows[0].count}`);
      
      // Sample projects
      const sampleProjects = await sourceClient.query(`
        SELECT * FROM dispatch_project
        ORDER BY id
        LIMIT 5;
      `);
      
      console.log('\nSample projects:');
      sampleProjects.rows.forEach((row, index) => {
        console.log(`${index + 1}.`, JSON.stringify(row, null, 2));
      });
      
      // 3. Check how projects relate to cases/orders
      console.log('\n📋 Step 3: Checking project relationships...');
      
      const availableProjectCols = projectStructure.rows.map(col => col.column_name);
      
      // Check for relationship columns
      ['case_id', 'order_id', 'instruction_id', 'patient_id'].forEach(col => {
        if (availableProjectCols.includes(col)) {
          console.log(`✅ Found ${col} in dispatch_project`);
        } else {
          console.log(`❌ No ${col} in dispatch_project`);
        }
      });
      
      // 4. Check if cases/orders have project references
      console.log('\n📋 Step 4: Checking if cases/orders reference projects...');
      
      try {
        const caseProjectRefs = await sourceClient.query(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_name = 'dispatch_case' AND table_schema = 'public'
          AND column_name LIKE '%project%';
        `);
        
        if (caseProjectRefs.rows.length > 0) {
          console.log('Found project references in dispatch_case:');
          caseProjectRefs.rows.forEach(row => {
            console.log(`  - ${row.column_name}`);
          });
        } else {
          console.log('No project references in dispatch_case');
        }
      } catch (e) {
        console.log('Error checking dispatch_case for project refs');
      }
      
      try {
        const orderProjectRefs = await sourceClient.query(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_name = 'dispatch_order' AND table_schema = 'public'
          AND column_name LIKE '%project%';
        `);
        
        if (orderProjectRefs.rows.length > 0) {
          console.log('Found project references in dispatch_order:');
          orderProjectRefs.rows.forEach(row => {
            console.log(`  - ${row.column_name}`);
          });
        } else {
          console.log('No project references in dispatch_order');
        }
      } catch (e) {
        console.log('Error checking dispatch_order for project refs');
      }
      
      // 5. Test actual relationships if possible
      if (availableProjectCols.includes('case_id')) {
        console.log('\n📊 Testing project-case relationships...');
        
        const projectCaseLinks = await sourceClient.query(`
          SELECT COUNT(*) as count
          FROM dispatch_project dp
          JOIN dispatch_case dc ON dp.case_id = dc.id
          WHERE dp.case_id IS NOT NULL;
        `);
        
        console.log(`Projects linked to cases: ${projectCaseLinks.rows[0].count}`);
        
        // Get sample project-bracket relationships
        const projectBracketSample = await sourceClient.query(`
          SELECT 
            dp.id as project_id,
            dc.id as case_id,
            db.name as bracket_name
          FROM dispatch_project dp
          JOIN dispatch_case dc ON dp.case_id = dc.id
          JOIN dispatch_bracket db ON db.project_id = dp.id
          WHERE dp.case_id IS NOT NULL
          LIMIT 5;
        `);
        
        if (projectBracketSample.rows.length > 0) {
          console.log('\nSample project-case-bracket relationships:');
          projectBracketSample.rows.forEach((row, index) => {
            console.log(`${index + 1}. Project ${row.project_id} → Case ${row.case_id} → Bracket "${row.bracket_name}"`);
          });
        }
      }
      
    } else {
      console.log('\n❌ No dispatch_project table found');
      
      // Try to find alternative relationships
      console.log('\n🔍 Looking for alternative bracket relationships...');
      
      // Check all tables for project_id columns
      const allTables = await sourceClient.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name;
      `);
      
      for (const table of allTables.rows.slice(0, 10)) { // Check first 10 tables
        try {
          const hasProjectId = await sourceClient.query(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = $1 AND table_schema = 'public'
            AND column_name = 'project_id';
          `, [table.table_name]);
          
          if (hasProjectId.rows.length > 0) {
            console.log(`  ✅ ${table.table_name} has project_id column`);
          }
        } catch (e) {
          // Skip inaccessible tables
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error investigating project relationships:', error);
  } finally {
    await sourceClient.end();
  }
  
  // 6. Check target database for any existing bracket or project data
  console.log('\n📋 Step 5: Checking target database for existing relationships...');
  
  // Check if target has any project-related tables
  const { data: targetTables } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name LIKE '%project%'
      ORDER BY table_name;
    `
  });
  
  if (targetTables && Array.isArray(targetTables) && targetTables.length > 0) {
    console.log('Found project-related tables in target:');
    targetTables.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });
  } else {
    console.log('No project-related tables found in target database');
  }
  
  // Check if orders/cases have any project references
  const { data: orderSample } = await supabase
    .from('orders')
    .select('*')
    .limit(1);
    
  if (orderSample && orderSample[0]) {
    const orderKeys = Object.keys(orderSample[0]);
    const projectKeys = orderKeys.filter(key => key.toLowerCase().includes('project'));
    
    if (projectKeys.length > 0) {
      console.log('Found project-related fields in target orders:');
      projectKeys.forEach(key => console.log(`  - ${key}`));
    } else {
      console.log('No project-related fields in target orders');
    }
  }
}

investigateProjectRelationships().catch(console.error);
