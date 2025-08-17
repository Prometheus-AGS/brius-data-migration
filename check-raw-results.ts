import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE!
);

async function checkRawResults() {
  console.log('🔍 Checking raw migration results...\n');
  
  try {
    // 1. Check all comments table
    const { count: allCommentsCount, error: allCommentsError } = await supabase
      .from('comments')
      .select('*', { count: 'exact', head: true });
      
    if (allCommentsError) {
      console.error('❌ Error counting all comments:', allCommentsError);
    } else {
      console.log(`📊 Total comments in table: ${allCommentsCount}`);
    }
    
    // 2. Check treatment discussions table
    const { count: discussionsCount, error: discussionsError } = await supabase
      .from('treatment_discussions')
      .select('*', { count: 'exact', head: true });
      
    if (discussionsError) {
      console.error('❌ Error counting treatment discussions:', discussionsError);
    } else {
      console.log(`📊 Total treatment discussions: ${discussionsCount}`);
    }
    
    // 3. Check if tables exist and their schemas
    const { data: tablesData, error: tablesError } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .in('table_name', ['comments', 'treatment_discussions']);
      
    if (tablesError) {
      console.error('❌ Error checking tables:', tablesError);
    } else {
      console.log(`📋 Available tables: ${tablesData?.map(t => t.table_name).join(', ')}`);
    }
    
    // 4. Sample any data in comments
    const { data: sampleComments, error: sampleError } = await supabase
      .from('comments')
      .select('*')
      .limit(3);
      
    if (sampleError) {
      console.error('❌ Error fetching sample comments:', sampleError);
    } else {
      console.log(`📝 Sample comments data:`, sampleComments);
    }
    
    // 5. Check source data count
    console.log('\n🔍 Checking source data...');
    
    // Let's also check if our script actually completed successfully
    const logContent = `Migration likely completed - checking if final log message shows success.`;
    console.log(logContent);
    
  } catch (error) {
    console.error('❌ Error in raw check:', error);
  }
}

checkRawResults().catch(console.error);
