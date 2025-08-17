import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE!
);

async function checkMigrationResults() {
  console.log('🔍 Checking comment migration results...\n');
  
  try {
    // 1. Count total migrated comments
    const { count: commentsCount, error: commentsError } = await supabase
      .from('comments')
      .select('*', { count: 'exact', head: true })
      .eq('legacy_table', 'dispatch_comment');
      
    if (commentsError) {
      console.error('❌ Error counting comments:', commentsError);
      return;
    }
    
    console.log(`✅ Total migrated comments: ${commentsCount}`);
    
    // 2. Count treatment discussions
    const { count: discussionsCount, error: discussionsError } = await supabase
      .from('treatment_discussions')
      .select('*', { count: 'exact', head: true });
      
    if (discussionsError) {
      console.error('❌ Error counting treatment discussions:', discussionsError);
      return;
    }
    
    console.log(`✅ Total treatment discussions created: ${discussionsCount}`);
    
    // 3. Sample migrated comments
    const { data: sampleComments, error: sampleError } = await supabase
      .from('comments')
      .select('id, content, author_id, created_at, legacy_id')
      .eq('legacy_table', 'dispatch_comment')
      .limit(5);
      
    if (sampleError) {
      console.error('❌ Error fetching sample comments:', sampleError);
      return;
    }
    
    console.log('\n📋 Sample migrated comments:');
    sampleComments?.forEach((comment: any, index: number) => {
      const preview = comment.content.substring(0, 60) + (comment.content.length > 60 ? '...' : '');
      console.log(`  ${index + 1}. Legacy ID: ${comment.legacy_id}, Content: "${preview}"`);
    });
    
    // 4. Check treatment discussions with linkage
    const { data: linkedDiscussions, error: linkError } = await supabase
      .from('treatment_discussions')
      .select(`
        id,
        comment_id,
        treatment_plan_id,
        comments!inner(legacy_id, content),
        treatment_plans!inner(legacy_plan_id)
      `)
      .limit(5);
      
    if (linkError) {
      console.error('❌ Error fetching linked discussions:', linkError);
      return;
    }
    
    console.log('\n🔗 Sample treatment discussions with linkage:');
    linkedDiscussions?.forEach((discussion: any, index: number) => {
      const preview = discussion.comments.content.substring(0, 40) + '...';
      console.log(`  ${index + 1}. Comment Legacy ID: ${discussion.comments.legacy_id}, Treatment Plan Legacy ID: ${discussion.treatment_plans.legacy_plan_id}, Content: "${preview}"`);
    });
    
    // 5. Check for any orphaned comments (comments without discussions)
    const { count: orphanedCount, error: orphanedError } = await supabase
      .from('comments')
      .select('*', { count: 'exact', head: true })
      .eq('legacy_table', 'dispatch_comment')
      .not('id', 'in', `(SELECT comment_id FROM treatment_discussions)`);
      
    if (!orphanedError) {
      console.log(`\n⚠️  Orphaned comments (without treatment discussions): ${orphanedCount || 0}`);
    }
    
    // 6. Summary statistics
    console.log('\n📊 Migration Summary:');
    console.log(`  • Comments migrated: ${commentsCount}`);
    console.log(`  • Treatment discussions created: ${discussionsCount}`);
    console.log(`  • Success rate: ${discussionsCount && commentsCount ? Math.round((discussionsCount / commentsCount) * 100) : 0}%`);
    
  } catch (error) {
    console.error('❌ Error checking results:', error);
  }
}

checkMigrationResults().catch(console.error);
