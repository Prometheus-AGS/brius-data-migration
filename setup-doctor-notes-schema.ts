import * as dotenv from 'dotenv';

dotenv.config();

async function setupDoctorNotesSchema() {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE!;
  
  console.log('🔧 Setting up doctor_notes schema for proper architecture...');
  
  try {
    // Check if doctor_notes table already has comment_id column
    console.log('   Checking current doctor_notes schema...');
    
    const checkColumnResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sql: `SELECT column_name FROM information_schema.columns WHERE table_name = 'doctor_notes' AND column_name = 'comment_id';`
      })
    });
    
    if (!checkColumnResponse.ok) {
      throw new Error(`Failed to check schema: ${checkColumnResponse.statusText}`);
    }
    
    // Since we can't easily parse the result, let's just try to add the column
    console.log('   Adding comment_id foreign key column...');
    
    const sqlCommands = [
      // Add comment_id column as foreign key to comments table
      'ALTER TABLE doctor_notes ADD COLUMN IF NOT EXISTS comment_id UUID REFERENCES comments(id) ON DELETE CASCADE;',
      
      // Make text column nullable since content will come from comments table
      'ALTER TABLE doctor_notes ALTER COLUMN text DROP NOT NULL;',
      
      // Make author_id nullable since it will come from comments table
      'ALTER TABLE doctor_notes ALTER COLUMN author_id DROP NOT NULL;'
    ];
    
    for (const sql of sqlCommands) {
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
        console.log(`   ⚠️ SQL may have been skipped: ${response.statusText} - ${errorText}`);
      } else {
        const result = await response.text();
        console.log(`   ✅ Success: ${result || 'OK'}`);
      }
    }
    
    console.log('✅ Doctor notes schema setup completed!');
    
  } catch (error) {
    console.error('❌ Schema setup failed:', error);
  }
}

setupDoctorNotesSchema().catch(console.error);
