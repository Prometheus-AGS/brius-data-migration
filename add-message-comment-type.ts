import * as dotenv from 'dotenv';

dotenv.config();

async function addMessageCommentType() {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE!;
  
  console.log('🔧 Adding "message" to comment_type enum...');
  
  try {
    const sql = `ALTER TYPE comment_type_enum ADD VALUE IF NOT EXISTS 'message';`;
    
    console.log(`   Executing: ${sql}`);
    
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sql: sql
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.log(`   ⚠️  Response: ${response.statusText} - ${errorText}`);
    } else {
      const result = await response.text();
      console.log(`   ✅ Success: ${result || 'OK'}`);
    }
    
    // Test the new enum value
    console.log('🧪 Testing the new "message" comment_type...');
    
    const testSql = `
      BEGIN;
      INSERT INTO comments (id, content, comment_type, created_at, updated_at) 
      VALUES (gen_random_uuid(), 'test message type', 'message', NOW(), NOW());
      ROLLBACK;
    `;
    
    const testResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sql: testSql
      })
    });
    
    if (!testResponse.ok) {
      const errorText = await testResponse.text();
      console.log(`   ❌ Test failed: ${testResponse.statusText} - ${errorText}`);
    } else {
      console.log('   ✅ Test successful - "message" comment_type is now available');
    }
    
    console.log('✅ Comment type enum setup completed!');
    
  } catch (error) {
    console.error('❌ Setup failed:', error);
  }
}

addMessageCommentType().catch(console.error);
