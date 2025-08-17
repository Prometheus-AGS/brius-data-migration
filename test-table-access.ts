import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE!
);

async function testTableAccess() {
  console.log('🔍 Testing table access and structure...\n');
  
  try {
    // Test comments table
    console.log('1️⃣ Testing comments table...');
    const { data: commentsTest, error: commentsError } = await supabase
      .from('comments')
      .select('*')
      .limit(1);
      
    if (commentsError) {
      console.error('❌ Comments table error:', commentsError);
    } else {
      console.log('✅ Comments table accessible, structure:', Object.keys(commentsTest?.[0] || {}));
    }
    
    // Test treatment_discussions table
    console.log('\n2️⃣ Testing treatment_discussions table...');
    const { data: discussionsTest, error: discussionsError } = await supabase
      .from('treatment_discussions')
      .select('*')
      .limit(1);
      
    if (discussionsError) {
      console.error('❌ Treatment discussions table error:', discussionsError);
    } else {
      console.log('✅ Treatment discussions table accessible, structure:', Object.keys(discussionsTest?.[0] || {}));
    }
    
    // Test a simple insert to see if execSQL works
    console.log('\n3️⃣ Testing execSQL function...');
    
    async function execSQL(sql: string) {
      const { data, error } = await supabase.rpc('exec_sql', { sql });
      if (error) {
        console.error('SQL execution error:', error);
        throw error;
      }
      return data;
    }
    
    try {
      const testResult = await execSQL(`
        INSERT INTO comments (id, content, created_at, updated_at, legacy_table, legacy_id)
        VALUES (gen_random_uuid(), 'Test comment', NOW(), NOW(), 'test', 999999);
      `);
      console.log('✅ Test insert result:', testResult);
      
      // Check if it was inserted
      const { data: checkData, error: checkError } = await supabase
        .from('comments')
        .select('*')
        .eq('legacy_id', 999999);
        
      if (checkError) {
        console.error('❌ Error checking test insert:', checkError);
      } else {
        console.log('📝 Test comment found:', checkData?.length > 0 ? 'YES' : 'NO');
        if (checkData && checkData.length > 0) {
          // Clean up test data
          await supabase.from('comments').delete().eq('legacy_id', 999999);
          console.log('🧹 Test data cleaned up');
        }
      }
    } catch (execError) {
      console.error('❌ execSQL test failed:', execError);
    }
    
  } catch (error) {
    console.error('❌ General error:', error);
  }
}

testTableAccess().catch(console.error);
