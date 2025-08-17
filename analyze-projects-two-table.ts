import { createClient } from '@supabase/supabase-js';
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

async function analyzeProjectsAndPlans() {
  console.log('🔍 Analyzing dispatch_project and dispatch_plan for two-table migration...\n');

  try {
    await sourceDb.connect();

    // =================
    // DISPATCH_PROJECT ANALYSIS
    // =================
    console.log('📊 DISPATCH_PROJECT Analysis:');
    
    const projectStatsQuery = `
      SELECT 
        COUNT(*) as total_projects,
        COUNT(DISTINCT creator_id) as unique_creators,
        COUNT(CASE WHEN creator_id IS NULL THEN 1 END) as projects_without_creator,
        COUNT(CASE WHEN public = true THEN 1 END) as public_projects,
        AVG(size) as avg_size_bytes
      FROM dispatch_project;
    `;

    const projectStats = await sourceDb.query(projectStatsQuery);
    const pStats = projectStats.rows[0];

    console.log(`Total projects: ${pStats.total_projects}`);
    console.log(`Unique creators: ${pStats.unique_creators}`);  
    console.log(`Projects without creator: ${pStats.projects_without_creator}`);
    console.log(`Public projects: ${pStats.public_projects}`);
    console.log(`Average file size: ${Math.round(pStats.avg_size_bytes / 1024)} KB\n`);

    // Project type distribution
    const typeDistQuery = `
      SELECT 
        type,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
      FROM dispatch_project 
      GROUP BY type 
      ORDER BY count DESC;
    `;

    const typeResult = await sourceDb.query(typeDistQuery);
    console.log('Project Type Distribution:');
    typeResult.rows.forEach(row => {
      console.log(`  Type ${row.type}: ${row.count} projects (${row.percentage}%)`);
    });

    // Project status distribution
    const statusDistQuery = `
      SELECT 
        status,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
      FROM dispatch_project 
      GROUP BY status 
      ORDER BY count DESC;
    `;

    const statusResult = await sourceDb.query(statusDistQuery);
    console.log('\nProject Status Distribution:');
    statusResult.rows.forEach(row => {
      console.log(`  Status ${row.status}: ${row.count} projects (${row.percentage}%)`);
    });

    // =================
    // DISPATCH_PLAN ANALYSIS
    // =================
    console.log('\n📋 DISPATCH_PLAN Analysis:');
    
    const planStatsQuery = `
      SELECT 
        COUNT(*) as total_plans,
        COUNT(CASE WHEN original = true THEN 1 END) as original_plans,
        COUNT(CASE WHEN original = false THEN 1 END) as revision_plans,
        COUNT(DISTINCT instruction_id) as unique_instructions,
        COUNT(CASE WHEN instruction_id IS NULL THEN 1 END) as plans_without_instruction
      FROM dispatch_plan;
    `;

    const planStats = await sourceDb.query(planStatsQuery);
    const plStats = planStats.rows[0];

    console.log(`Total plans: ${plStats.total_plans}`);
    console.log(`Original plans: ${plStats.original_plans}`);
    console.log(`Revision plans: ${plStats.revision_plans}`);
    console.log(`Unique instructions: ${plStats.unique_instructions}`);
    console.log(`Plans without instruction: ${plStats.plans_without_instruction}\n`);

    // =================
    // RELATIONSHIP ANALYSIS  
    // =================
    console.log('🔗 Relationship Analysis:');
    
    const relationshipQuery = `
      SELECT 
        COUNT(DISTINCT proj.id) as total_projects,
        COUNT(DISTINCT plan.project_id) as projects_with_plans,
        COUNT(DISTINCT plan.id) as total_plans,
        COUNT(DISTINCT proj.id) - COUNT(DISTINCT plan.project_id) as projects_without_plans
      FROM dispatch_project proj
      LEFT JOIN dispatch_plan plan ON proj.id = plan.project_id;
    `;

    const relResult = await sourceDb.query(relationshipQuery);
    const rel = relResult.rows[0];

    console.log(`Projects total: ${rel.total_projects}`);
    console.log(`Projects with treatment plans: ${rel.projects_with_plans}`);
    console.log(`Projects without treatment plans: ${rel.projects_without_plans}`);
    console.log(`Total treatment plans: ${rel.total_plans}`);

    // Sample combined data
    const sampleQuery = `
      SELECT 
        proj.id as project_id,
        proj.name as project_name,
        proj.type,
        proj.status,
        proj.public,
        proj.creator_id,
        plan.id as plan_id,
        plan.name as plan_name,
        plan.original,
        plan.number as plan_number,
        plan.instruction_id,
        CASE 
          WHEN LENGTH(plan.notes) > 30 THEN LEFT(plan.notes, 30) || '...'
          ELSE plan.notes
        END as plan_notes_preview
      FROM dispatch_project proj
      LEFT JOIN dispatch_plan plan ON proj.id = plan.project_id
      ORDER BY proj.id
      LIMIT 8;
    `;

    const sampleResult = await sourceDb.query(sampleQuery);
    console.log('\n📋 Sample Data (Project + Plan):');
    console.log('ProjID | Type | Status | Creator | PlanID | Original | PlanNum | InstrID | Notes');
    console.log('-------|------|--------|---------|--------|----------|---------|---------|-------');
    
    sampleResult.rows.forEach(row => {
      const projId = String(row.project_id).padStart(6);
      const type = String(row.type || '').padStart(4);
      const status = String(row.status || '').padStart(6);
      const creator = String(row.creator_id || '').padStart(7);
      const planId = String(row.plan_id || '').padStart(6);
      const original = row.original ? 'Yes' : 'No ';
      const planNum = String(row.plan_number || '').padStart(7);
      const instrId = String(row.instruction_id || '').padStart(7);
      const notes = (row.plan_notes_preview || '').substring(0, 7);
      
      console.log(`${projId} | ${type} | ${status} | ${creator} | ${planId} | ${original}    | ${planNum} | ${instrId} | ${notes}`);
    });

    console.log('\n🎯 Migration Strategy Summary:');
    console.log('=================================');
    console.log(`1. PROJECTS TABLE: Migrate ${rel.total_projects} dispatch_project records`);
    console.log(`   - All project types (${typeResult.rows.length} different types)`);
    console.log(`   - Map creator_id to profile UUIDs`);
    console.log(`   - Map type/status codes to enums`);
    console.log('');
    console.log(`2. TREATMENT_PLANS TABLE: Migrate ${rel.total_plans} dispatch_plan records`);
    console.log(`   - Link to projects via project_id`);
    console.log(`   - Map instruction_id to order UUIDs`);
    console.log(`   - Extract patient/doctor from orders`);
    console.log(`   - Handle ${plStats.original_plans} original + ${plStats.revision_plans} revision plans`);

  } catch (error) {
    console.error('❌ Error analyzing project and plan data:', error);
  } finally {
    await sourceDb.end();
  }
}

analyzeProjectsAndPlans().catch(console.error);
