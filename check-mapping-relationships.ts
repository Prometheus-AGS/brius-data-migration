import { Client as PgClient } from 'pg';
import { createClient } from '@supabase/supabase-js';
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

// Target database configuration (Supabase)
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE!;

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  global: {
    headers: {
      'Authorization': `Bearer ${supabaseServiceKey}`
    }
  }
});

async function execSQL(sql: string): Promise<any> {
  const { data, error } = await supabase.rpc('exec_sql', { sql });
  if (error) throw error;
  return data;
}

async function checkMappingRelationships() {
  console.log('🔍 Checking mapping relationships for comment migration...\n');

  try {
    await sourceDb.connect();

    // 1. Check if treatment_plans exist and their structure
    console.log('1️⃣ Checking target treatment_plans...');
    const treatmentPlansResult = await execSQL(`
      SELECT COUNT(*) as count, 
             COUNT(DISTINCT project_id) as projects,
             MIN(created_at) as earliest,
             MAX(created_at) as latest
      FROM treatment_plans;
    `);
    
    if (Array.isArray(treatmentPlansResult) && treatmentPlansResult.length > 0) {
      const stats = treatmentPlansResult[0];
      console.log(`   📊 Treatment plans: ${stats.count} records`);
      console.log(`   📊 Linked projects: ${stats.projects} unique`);
      console.log(`   📊 Date range: ${stats.earliest} to ${stats.latest}`);
    }

    // 2. Check projects table and legacy_id mapping
    console.log('\n2️⃣ Checking projects with legacy mapping...');
    const projectsResult = await execSQL(`
      SELECT COUNT(*) as total,
             COUNT(legacy_id) as with_legacy,
             MIN(legacy_id) as min_legacy_id,
             MAX(legacy_id) as max_legacy_id
      FROM projects;
    `);
    
    if (Array.isArray(projectsResult) && projectsResult.length > 0) {
      const stats = projectsResult[0];
      console.log(`   📊 Projects total: ${stats.total}`);
      console.log(`   📊 Projects with legacy_id: ${stats.with_legacy}`);
      console.log(`   📊 Legacy ID range: ${stats.min_legacy_id} to ${stats.max_legacy_id}`);
    }

    // 3. Check source dispatch_plan structure and relationship
    console.log('\n3️⃣ Checking source dispatch_plan structure...');
    const sourcePlanQuery = `
      SELECT 
        COUNT(*) as total_plans,
        COUNT(DISTINCT project_id) as unique_projects,
        MIN(id) as min_plan_id,
        MAX(id) as max_plan_id,
        MIN(project_id) as min_project_id,
        MAX(project_id) as max_project_id
      FROM dispatch_plan;
    `;
    
    const sourcePlanResult = await sourceDb.query(sourcePlanQuery);
    const planStats = sourcePlanResult.rows[0];
    console.log(`   📊 Source dispatch_plan: ${planStats.total_plans} records`);
    console.log(`   📊 Unique projects: ${planStats.unique_projects}`);
    console.log(`   📊 Plan ID range: ${planStats.min_plan_id} to ${planStats.max_plan_id}`);
    console.log(`   📊 Project ID range: ${planStats.min_project_id} to ${planStats.max_project_id}`);

    // 4. Check dispatch_comment plan_id range
    console.log('\n4️⃣ Checking dispatch_comment plan_id range...');
    const commentPlanQuery = `
      SELECT 
        COUNT(*) as total_comments,
        COUNT(DISTINCT plan_id) as unique_plan_ids,
        MIN(plan_id) as min_plan_id,
        MAX(plan_id) as max_plan_id
      FROM dispatch_comment;
    `;
    
    const commentPlanResult = await sourceDb.query(commentPlanQuery);
    const commentStats = commentPlanResult.rows[0];
    console.log(`   📊 Comments: ${commentStats.total_comments} records`);
    console.log(`   📊 Unique plan IDs: ${commentStats.unique_plan_ids}`);
    console.log(`   📊 Plan ID range: ${commentStats.min_plan_id} to ${commentStats.max_plan_id}`);

    // 5. Check overlap between dispatch_comment.plan_id and dispatch_plan.id
    console.log('\n5️⃣ Checking plan_id overlap...');
    const overlapQuery = `
      SELECT 
        'in_both' as category,
        COUNT(*) as count
      FROM dispatch_comment dc
      WHERE EXISTS (SELECT 1 FROM dispatch_plan dp WHERE dp.id = dc.plan_id)
      
      UNION ALL
      
      SELECT 
        'comment_only' as category,
        COUNT(*) as count
      FROM dispatch_comment dc
      WHERE NOT EXISTS (SELECT 1 FROM dispatch_plan dp WHERE dp.id = dc.plan_id)
      
      UNION ALL
      
      SELECT 
        'plan_only' as category,
        COUNT(*) as count
      FROM dispatch_plan dp
      WHERE NOT EXISTS (SELECT 1 FROM dispatch_comment dc WHERE dc.plan_id = dp.id);
    `;
    
    const overlapResult = await sourceDb.query(overlapQuery);
    console.log('\n   Plan ID Overlap Analysis:');
    overlapResult.rows.forEach(row => {
      console.log(`   📊 ${row.category}: ${row.count} records`);
    });

    // 6. Test the actual mapping logic
    console.log('\n6️⃣ Testing mapping logic...');
    const mappingTestQuery = `
      SELECT 
        tp.id as treatment_plan_uuid,
        p.legacy_id as project_legacy_id,
        dp.id as dispatch_plan_id
      FROM treatment_plans tp
      JOIN projects p ON tp.project_id = p.id
      JOIN (SELECT id, project_id FROM dispatch_plan LIMIT 5) dp ON dp.project_id = p.legacy_id
      LIMIT 5;
    `;
    
    try {
      // Get sample mapping data from target
      const targetSampleResult = await execSQL(`
        SELECT 
          tp.id as treatment_plan_uuid,
          p.legacy_id as project_legacy_id
        FROM treatment_plans tp
        JOIN projects p ON tp.project_id = p.id
        WHERE p.legacy_id IS NOT NULL
        LIMIT 5;
      `);

      console.log('\n   Sample target mappings:');
      if (Array.isArray(targetSampleResult)) {
        targetSampleResult.forEach((row: any) => {
          console.log(`   🔗 Project legacy_id ${row.project_legacy_id} → Treatment plan ${row.treatment_plan_uuid}`);
        });
      }

      // Get sample source data
      const sourceSampleQuery = `
        SELECT id, project_id 
        FROM dispatch_plan 
        WHERE project_id IN (SELECT legacy_id FROM (${targetSampleResult.map((r: any) => r.project_legacy_id).join(', ')}) AS t(id))
        LIMIT 5;
      `;
      
      if (Array.isArray(targetSampleResult) && targetSampleResult.length > 0) {
        const sourceSampleResult = await sourceDb.query(sourceSampleQuery);
        console.log('\n   Source dispatch_plan matching:');
        sourceSampleResult.rows.forEach(row => {
          console.log(`   📋 Plan ID ${row.id} → Project ${row.project_id}`);
        });
      }

    } catch (error) {
      console.log(`   ⚠️ Mapping test failed: ${error}`);
    }

    // 7. Show the correct mapping strategy
    console.log('\n7️⃣ Correct mapping strategy:');
    console.log('   dispatch_comment.plan_id → dispatch_plan.id → dispatch_plan.project_id → projects.legacy_id → projects.id → treatment_plans.project_id → treatment_plans.id');
    
    console.log('\n✅ Analysis complete. Use this information to fix the migration script.');

  } catch (error) {
    console.error('❌ Analysis failed:', error);
  } finally {
    await sourceDb.end();
  }
}

checkMappingRelationships().catch(console.error);
