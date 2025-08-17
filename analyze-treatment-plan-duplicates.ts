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

async function analyzeTreatmentPlanDuplicates() {
  console.log('🔍 Analyzing treatment plan duplicate issues...\n');

  try {
    await sourceDb.connect();

    // 1. Check current treatment_plans table state
    console.log('1️⃣ Checking current treatment_plans state...');
    const currentCount = await execSQL('SELECT COUNT(*) as count FROM treatment_plans;');
    console.log(`   📊 Current treatment_plans: ${Array.isArray(currentCount) ? currentCount[0]?.count || 0 : 0} records`);

    // 2. Analyze project_id duplicates in dispatch_plan
    console.log('\n2️⃣ Analyzing project_id duplicates in dispatch_plan...');
    const duplicateProjectQuery = `
      SELECT 
        project_id,
        COUNT(*) as plan_count,
        array_agg(id ORDER BY created_at) as plan_ids,
        MIN(created_at) as first_created,
        MAX(created_at) as last_created
      FROM dispatch_plan 
      GROUP BY project_id
      HAVING COUNT(*) > 1
      ORDER BY plan_count DESC, project_id
      LIMIT 10;
    `;
    
    const duplicates = await sourceDb.query(duplicateProjectQuery);
    console.log(`   📊 Projects with multiple plans: ${duplicates.rows.length} examples (showing top 10)`);
    
    if (duplicates.rows.length > 0) {
      console.log('\n   Top duplicate examples:');
      duplicates.rows.forEach((row, index) => {
        console.log(`   ${index + 1}. Project ${row.project_id}: ${row.plan_count} plans (IDs: ${row.plan_ids.slice(0, 3).join(', ')}${row.plan_ids.length > 3 ? '...' : ''})`);
      });
    }

    // 3. Get total duplicate statistics
    const duplicateStatsQuery = `
      WITH duplicate_projects AS (
        SELECT project_id, COUNT(*) as plan_count
        FROM dispatch_plan 
        GROUP BY project_id
        HAVING COUNT(*) > 1
      )
      SELECT 
        COUNT(*) as projects_with_duplicates,
        SUM(plan_count) as total_duplicate_plans,
        MAX(plan_count) as max_plans_per_project,
        AVG(plan_count)::numeric(10,2) as avg_plans_per_duplicate_project
      FROM duplicate_projects;
    `;
    
    const dupStats = await sourceDb.query(duplicateStatsQuery);
    const stats = dupStats.rows[0];
    console.log('\n   Duplicate Statistics:');
    console.log(`   📊 Projects with duplicates: ${stats.projects_with_duplicates}`);
    console.log(`   📊 Total plans from duplicates: ${stats.total_duplicate_plans}`);
    console.log(`   📊 Max plans per project: ${stats.max_plans_per_project}`);
    console.log(`   📊 Avg plans per duplicate project: ${stats.avg_plans_per_duplicate_project}`);

    // 4. Check which approach would work best
    console.log('\n3️⃣ Analyzing resolution strategies...');
    
    // Strategy 1: Keep most recent plan per project
    const mostRecentQuery = `
      WITH ranked_plans AS (
        SELECT 
          *,
          ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at DESC, id DESC) as rn
        FROM dispatch_plan
      )
      SELECT COUNT(*) as plans_to_keep
      FROM ranked_plans 
      WHERE rn = 1;
    `;
    
    const mostRecentResult = await sourceDb.query(mostRecentQuery);
    console.log(`   Strategy 1 (Most Recent): Keep ${mostRecentResult.rows[0].plans_to_keep} plans`);

    // Strategy 2: Keep oldest plan per project
    const oldestQuery = `
      WITH ranked_plans AS (
        SELECT 
          *,
          ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at ASC, id ASC) as rn
        FROM dispatch_plan
      )
      SELECT COUNT(*) as plans_to_keep
      FROM ranked_plans 
      WHERE rn = 1;
    `;
    
    const oldestResult = await sourceDb.query(oldestQuery);
    console.log(`   Strategy 2 (Oldest): Keep ${oldestResult.rows[0].plans_to_keep} plans`);

    // 5. Check which plans have comments (most important to preserve)
    console.log('\n4️⃣ Analyzing plan importance (which have comments)...');
    const planImportanceQuery = `
      WITH plan_importance AS (
        SELECT 
          dp.project_id,
          dp.id as plan_id,
          dp.created_at,
          COUNT(dc.id) as comment_count,
          CASE WHEN COUNT(dc.id) > 0 THEN 1 ELSE 0 END as has_comments
        FROM dispatch_plan dp
        LEFT JOIN dispatch_comment dc ON dp.id = dc.plan_id
        GROUP BY dp.project_id, dp.id, dp.created_at
      ),
      project_plan_summary AS (
        SELECT 
          project_id,
          COUNT(*) as total_plans,
          SUM(has_comments) as plans_with_comments,
          SUM(comment_count) as total_comments,
          MAX(comment_count) as max_comments_per_plan
        FROM plan_importance
        GROUP BY project_id
        HAVING COUNT(*) > 1
      )
      SELECT 
        COUNT(*) as projects_analyzed,
        SUM(CASE WHEN plans_with_comments > 0 THEN 1 ELSE 0 END) as projects_with_commented_plans,
        SUM(CASE WHEN plans_with_comments = total_plans THEN 1 ELSE 0 END) as projects_all_plans_commented,
        SUM(total_comments) as total_comments_on_duplicate_projects
      FROM project_plan_summary;
    `;
    
    const importance = await sourceDb.query(planImportanceQuery);
    const impStats = importance.rows[0];
    console.log(`   📊 Projects analyzed: ${impStats.projects_analyzed}`);
    console.log(`   📊 Projects with commented plans: ${impStats.projects_with_commented_plans}`);
    console.log(`   📊 Projects where all plans have comments: ${impStats.projects_all_plans_commented}`);
    console.log(`   📊 Total comments on duplicate projects: ${impStats.total_comments_on_duplicate_projects}`);

    // 6. Recommend strategy
    console.log('\n5️⃣ Strategy Recommendation:');
    if (parseInt(impStats.projects_with_commented_plans) > 0) {
      console.log('   ✅ RECOMMENDED: Keep plan with most comments per project');
      console.log('   📋 Fallback: If tied, keep most recent plan');
      console.log('   🎯 This preserves maximum comment data while resolving duplicates');
    } else {
      console.log('   ✅ RECOMMENDED: Keep most recent plan per project');
      console.log('   📋 Simple deduplication by timestamp');
    }

    // 7. Show sample resolution for top duplicate
    if (duplicates.rows.length > 0) {
      const topDupe = duplicates.rows[0];
      console.log(`\n6️⃣ Sample resolution for project ${topDupe.project_id}:`);
      
      const sampleResolutionQuery = `
        SELECT 
          dp.id as plan_id,
          dp.created_at,
          COUNT(dc.id) as comment_count,
          CASE 
            WHEN COUNT(dc.id) > 0 THEN 'HAS_COMMENTS'
            ELSE 'NO_COMMENTS'
          END as status
        FROM dispatch_plan dp
        LEFT JOIN dispatch_comment dc ON dp.id = dc.plan_id
        WHERE dp.project_id = $1
        GROUP BY dp.id, dp.created_at
        ORDER BY COUNT(dc.id) DESC, dp.created_at DESC;
      `;
      
      const sampleResult = await sourceDb.query(sampleResolutionQuery, [topDupe.project_id]);
      sampleResult.rows.forEach((row, index) => {
        const marker = index === 0 ? '👑 KEEP' : '❌ DELETE';
        console.log(`   ${marker} Plan ${row.plan_id}: ${row.comment_count} comments (${row.created_at.toISOString().split('T')[0]}) - ${row.status}`);
      });
    }

  } catch (error) {
    console.error('❌ Analysis failed:', error);
  } finally {
    await sourceDb.end();
  }
}

analyzeTreatmentPlanDuplicates().catch(console.error);
