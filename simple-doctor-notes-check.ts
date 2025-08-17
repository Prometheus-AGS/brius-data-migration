import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'http://localhost:8000', 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
);

async function checkDoctorNotesSimple() {
  console.log('=== Doctor Notes Status Check ===\n');
  
  try {
    // Check comments table for doctor_note entries
    const { count: commentsCount } = await supabase
      .from('comments')
      .select('*', { count: 'exact', head: true })
      .eq('comment_type', 'doctor_note');
      
    console.log(`Comments with type='doctor_note': ${commentsCount || 0}`);
    
    // Check doctor_notes table
    const { count: doctorNotesCount } = await supabase
      .from('doctor_notes') 
      .select('*', { count: 'exact', head: true });
      
    console.log(`Doctor_notes table entries: ${doctorNotesCount || 0}`);
    
    // Get sample data from comments
    const { data: sampleComments } = await supabase
      .from('comments')
      .select('id, content, created_at, metadata')
      .eq('comment_type', 'doctor_note')
      .limit(2);
      
    if (sampleComments && sampleComments.length > 0) {
      console.log('\nSample doctor note comments:');
      sampleComments.forEach((comment, i) => {
        console.log(`  ${i + 1}. Created: ${comment.created_at}`);
        console.log(`     Content: ${comment.content.substring(0, 60)}...`);
        console.log(`     Legacy Note ID: ${comment.metadata?.legacy_note_id || 'N/A'}`);
      });
    }
    
    // Get sample data from doctor_notes
    const { data: sampleDoctorNotes } = await supabase
      .from('doctor_notes')
      .select('id, comment_id, doctor_id, created_at')
      .limit(2);
      
    if (sampleDoctorNotes && sampleDoctorNotes.length > 0) {
      console.log('\nSample doctor_notes entries:');
      sampleDoctorNotes.forEach((note, i) => {
        console.log(`  ${i + 1}. Doctor ID: ${note.doctor_id}`);
        console.log(`     Comment ID: ${note.comment_id}`);
        console.log(`     Created: ${note.created_at}`);
      });
    }
    
    // Overall status
    if ((commentsCount || 0) > 0 && (doctorNotesCount || 0) > 0) {
      console.log('\n✅ Doctor notes appear to be migrated');
      if (commentsCount === doctorNotesCount) {
        console.log('✅ Comment and doctor_note counts match');
      } else {
        console.log(`⚠️ Count mismatch: ${commentsCount} comments vs ${doctorNotesCount} doctor_notes`);
      }
    } else {
      console.log('\n❌ Doctor notes do not appear to be migrated');
    }
    
  } catch (error) {
    console.error('Error checking doctor notes:', error);
  }
}

checkDoctorNotesSimple().catch(console.error);
