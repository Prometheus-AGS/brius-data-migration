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

// Supabase client configuration
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE!
);

async function debugMappings() {
  await sourceDb.connect();
  
  console.log('🔍 Debugging treatment plan mappings...\n');
  
  // 1. Check treatment_plans directly
  console.log('1️⃣ Checking treatment plans in Supabase:');
  const { data: treatmentPlans, error: tpError } = await supabase
    .from('treatment_plans')
    .select('id, project_id, legacy_plan_id')
    .limit(5);
    
  if (tpError) {
    console.error('❌ Error fetching treatment plans:', tpError);
  } else {
    console.log('✅ Sample treatment plans:');
    treatmentPlans?.forEach((tp: any, i: number) => {
      console.log(`  ${i + 1}. TP ID: ${tp.id}, Legacy Plan ID: ${tp.legacy_plan_id}, Project ID: ${tp.project_id}`);
    });
  }
  
  // 2. Check projects table
  console.log('\n2️⃣ Checking projects in Supabase:');
  const { data: projects, error: projectError } = await supabase
    .from('projects')
    .select('id, legacy_id')
    .limit(5);
    
  if (projectError) {
    console.error('❌ Error fetching projects:', projectError);
  } else {
    console.log('✅ Sample projects:');
    projects?.forEach((p: any, i: number) => {
      console.log(`  ${i + 1}. Project ID: ${p.id}, Legacy ID: ${p.legacy_id}`);
    });
  }
  
  // 3. Check dispatch_plan in source database
  console.log('\n3️⃣ Checking dispatch_plan in source DB:');
  const planQuery = `SELECT id as plan_id, project_id FROM dispatch_plan LIMIT 5`;
  const planResult = await sourceDb.query(planQuery);
  console.log('✅ Sample dispatch_plan records:');
  planResult.rows.forEach((plan: any, i: number) => {
    console.log(`  ${i + 1}. Plan ID: ${plan.plan_id}, Project ID: ${plan.project_id}`);
  });
  
  // 4. Build the lookup using legacy_plan_id directly (simplest approach)
  console.log('\n4️⃣ Building direct lookup using legacy_plan_id:');
  const lookup: Record<number, string> = {};
  
  if (treatmentPlans) {
    treatmentPlans.forEach((tp: any) => {
      const legacyPlanId = tp.legacy_plan_id;
      if (legacyPlanId) {
        lookup[legacyPlanId] = tp.id;
        console.log(`  Mapping: legacy_plan_id ${legacyPlanId} -> treatment_plan_id ${tp.id}`);
      }
    });
  }
  
  console.log(`\n✅ Built ${Object.keys(lookup).length} direct mappings using legacy_plan_id`);
  
  // 5. Test with a few dispatch_comment records
  console.log('\n5️⃣ Testing with dispatch_comment records:');
  const commentQuery = `SELECT id, plan_id FROM dispatch_comment LIMIT 5`;
  const commentResult = await sourceDb.query(commentQuery);
  
  commentResult.rows.forEach((comment: any, i: number) => {
    const treatmentPlanId = lookup[comment.plan_id];
    console.log(`  ${i + 1}. Comment ${comment.id} -> Plan ID ${comment.plan_id} -> Treatment Plan ID: ${treatmentPlanId || 'NOT FOUND'}`);
  });
  
  await sourceDb.end();
}

debugMappings().catch(console.error);
