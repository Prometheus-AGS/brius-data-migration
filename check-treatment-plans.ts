import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE!
);

async function checkTreatmentPlans() {
  console.log('🔍 Checking treatment plans migration results...');
  
  // Count total treatment plans
  const { count, error: countError } = await supabase
    .from('treatment_plans')
    .select('*', { count: 'exact', head: true });
    
  if (countError) {
    console.error('❌ Error counting treatment plans:', countError);
    return;
  }
  
  console.log(`✅ Total treatment plans migrated: ${count}`);
  
  // Check a few sample records
  const { data: sampleData, error: sampleError } = await supabase
    .from('treatment_plans')
    .select('id, legacy_plan_id, project_id, created_at')
    .limit(5);
    
  if (sampleError) {
    console.error('❌ Error fetching sample data:', sampleError);
    return;
  }
  
  console.log('\n📋 Sample treatment plans:');
  sampleData?.forEach((plan, index) => {
    console.log(`  ${index + 1}. ID: ${plan.id}, Legacy ID: ${plan.legacy_plan_id}, Project: ${plan.project_id}`);
  });
  
  // Test the lookup mapping - check projects table for reference
  const { count: projectsCount, error: projectsError } = await supabase
    .from('projects')
    .select('*', { count: 'exact', head: true });
    
  if (!projectsError) {
    console.log(`\n📦 Total projects available for mapping: ${projectsCount}`);
  }
}

checkTreatmentPlans().catch(console.error);
