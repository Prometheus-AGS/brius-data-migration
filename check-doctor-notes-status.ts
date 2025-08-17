import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

const supabase = createClient(
  'http://localhost:8000', 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
);

// Source database connection
const sourceClient = new Client({
  host: 'test.brius.com',
  port: 5432,
  database: 'mdw_db',
  user: 'mdw_ai',
  password: 'xGXmckHY',
});

async function checkDoctorNotesStatus() {
  try {
    await sourceClient.connect();
    console.log('=== Doctor Notes Migration Status ===\n');
    
    // Check source dispatch_note table
    const sourceNoteCount = await sourceClient.query('SELECT COUNT(*) as total FROM dispatch_note');
    console.log(`Source (dispatch_note) records: ${sourceNoteCount.rows[0].total}`);
    
    // Sample source data
    const sourceSample = await sourceClient.query(`
      SELECT id, text, author_id, created_at 
      FROM dispatch_note 
      ORDER BY created_at DESC 
      LIMIT 3
    `);
    
    console.log('\nSample dispatch_note records:');
    sourceSample.rows.forEach((row, i) => {
      console.log(`  ${i + 1}. ID: ${row.id}, Author: ${row.author_id}, Text: ${row.text.substring(0, 50)}...`);
    });
    
    // Check target tables
    
    // Check comments table for doctor_notes
    const { count: commentCount, error: commentError } = await supabase
      .from('comments')
      .select('*', { count: 'exact', head: true })
      .eq('comment_type', 'doctor_note');
      
    if (commentError) {
      console.log('\nError checking comments table:', commentError.message);
    } else {
      console.log(`\nTarget (comments with type='doctor_note'): ${commentCount || 0}`);
    }
    
    // Check doctor_notes table
    const { count: doctorNotesCount, error: doctorNotesError } = await supabase
      .from('doctor_notes')
      .select('*', { count: 'exact', head: true });
      
    if (doctorNotesError) {
      console.log('Error checking doctor_notes table:', doctorNotesError.message);
    } else {
      console.log(`Target (doctor_notes): ${doctorNotesCount || 0}`);
    }
    
    // Check if doctor_notes table exists
    const { data: tableExists } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'doctor_notes'
        );
      `
    });
    
    console.log(`\nDoctor_notes table exists: ${tableExists === 'OK' ? 'Unknown (RPC issue)' : tableExists}`);
    
    // Sample migrated data if any exists
    const { data: sampleComments, error: sampleError } = await supabase
      .from('comments')
      .select('*')
      .eq('comment_type', 'doctor_note')
      .limit(3);
      
    if (!sampleError && sampleComments && sampleComments.length > 0) {
      console.log('\nSample migrated doctor note comments:');
      sampleComments.forEach((comment, i) => {
        console.log(`  ${i + 1}. ID: ${comment.id}, Content: ${comment.content.substring(0, 50)}...`);
      });
    } else if (!sampleError) {
      console.log('\nNo doctor note comments found in target.');
    }
    
    // Migration assessment
    const sourceTotal = parseInt(sourceNoteCount.rows[0].total);
    const targetTotal = (commentCount || 0);
    
    console.log('\n=== Migration Assessment ===');
    if (sourceTotal === 0) {
      console.log('✅ No doctor notes to migrate (source table empty)');
    } else if (targetTotal === 0) {
      console.log('❌ Doctor notes NOT migrated yet');
      console.log(`📋 ${sourceTotal} doctor notes pending migration`);
    } else if (targetTotal < sourceTotal) {
      console.log('⚠️  Doctor notes PARTIALLY migrated');
      console.log(`📋 ${sourceTotal - targetTotal} doctor notes still pending`);
    } else {
      console.log('✅ Doctor notes migration appears complete');
    }
    
  } catch (error) {
    console.error('Error checking doctor notes status:', error);
  } finally {
    await sourceClient.end();
  }
}

checkDoctorNotesStatus().catch(console.error);
