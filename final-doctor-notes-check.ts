import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

const sourceClient = new Client({
  host: 'test.brius.com',
  port: 5432,
  database: 'mdw_db',
  user: 'mdw_ai',
  password: 'xGXmckHY',
});

const supabase = createClient(
  'http://localhost:8000', 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
);

async function finalDoctorNotesCheck() {
  try {
    await sourceClient.connect();
    
    // Get source count
    const sourceResult = await sourceClient.query('SELECT COUNT(*) as count FROM dispatch_note');
    const sourceCount = parseInt(sourceResult.rows[0].count);
    
    // Get target count
    const { count: targetCount } = await supabase
      .from('comments')
      .select('*', { count: 'exact', head: true })
      .eq('comment_type', 'doctor_note');
    
    console.log('=== Doctor Notes Migration Final Check ===');
    console.log(`Source (dispatch_note): ${sourceCount}`);
    console.log(`Target (comments): ${targetCount || 0}`);
    
    const missing = sourceCount - (targetCount || 0);
    console.log(`Missing: ${missing}`);
    
    if (missing === 0) {
      console.log('✅ Doctor notes migration is COMPLETE');
    } else if (missing === 1) {
      console.log('⚠️ Doctor notes migration is 99.9% complete (1 record missing)');
      
      // Try to find the missing record by looking at the latest ones
      const latestSource = await sourceClient.query(`
        SELECT id, text, author_id, created_at 
        FROM dispatch_note 
        ORDER BY id DESC 
        LIMIT 5
      `);
      
      console.log('\nLatest source records:');
      latestSource.rows.forEach(row => {
        console.log(`  ID: ${row.id}, Author: ${row.author_id}, Created: ${row.created_at}`);
      });
      
    } else {
      console.log(`❌ Doctor notes migration incomplete (${missing} records missing)`);
    }
    
    // Also check doctor_notes table to ensure referential integrity
    const { count: doctorNotesCount } = await supabase
      .from('doctor_notes')
      .select('*', { count: 'exact', head: true });
      
    console.log(`\nDoctor_notes relationship table: ${doctorNotesCount || 0} entries`);
    
    if ((targetCount || 0) === (doctorNotesCount || 0)) {
      console.log('✅ Comments and doctor_notes tables are in sync');
    } else {
      console.log('⚠️ Comments and doctor_notes tables have different counts');
    }
    
  } catch (error) {
    console.error('Error in final doctor notes check:', error);
  } finally {
    await sourceClient.end();
  }
}

finalDoctorNotesCheck().catch(console.error);
