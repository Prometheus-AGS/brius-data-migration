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
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVeCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
);

async function migrateFinalDoctorNote() {
  try {
    await sourceClient.connect();
    
    console.log('🔄 Migrating final missing doctor note (ID 973)...\n');
    
    // Get the missing doctor note
    const missingNote = await sourceClient.query(`
      SELECT id, text, author_id, doctor_id, created_at 
      FROM dispatch_note 
      WHERE id = 973
    `);
    
    if (missingNote.rows.length === 0) {
      console.log('❌ Doctor note ID 973 not found in source');
      return;
    }
    
    const note = missingNote.rows[0];
    console.log('Found missing doctor note:');
    console.log(`  ID: ${note.id}`);
    console.log(`  Author ID: ${note.author_id}`);
    console.log(`  Doctor ID: ${note.doctor_id}`);
    console.log(`  Created: ${note.created_at}`);
    console.log(`  Text: ${note.text.substring(0, 100)}...`);
    
    // Build lookup for author (legacy_user_id -> profile_id)
    const { data: authorProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('legacy_user_id', note.author_id)
      .single();
    
    // Build lookup for doctor (legacy_user_id -> profile_id)  
    const { data: doctorProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('legacy_user_id', note.doctor_id)
      .single();
    
    console.log(`\nAuthor profile found: ${authorProfile?.id || 'NOT FOUND'}`);
    console.log(`Doctor profile found: ${doctorProfile?.id || 'NOT FOUND'}`);
    
    if (!doctorProfile) {
      console.log('❌ Cannot migrate: doctor profile not found');
      return;
    }
    
    // Create comment
    const commentData = {
      comment_type: 'doctor_note',
      content: note.text,
      author_id: authorProfile?.id || null,
      metadata: {
        legacy_note_id: note.id,
        legacy_author_id: note.author_id,
        legacy_doctor_id: note.doctor_id
      },
      created_at: note.created_at,
      updated_at: note.created_at
    };
    
    const { data: insertedComment, error: commentError } = await supabase
      .from('comments')
      .insert(commentData)
      .select('id')
      .single();
    
    if (commentError) {
      console.error('❌ Error inserting comment:', commentError);
      return;
    }
    
    console.log(`✅ Comment created: ${insertedComment.id}`);
    
    // Create doctor_notes relationship
    const doctorNoteData = {
      comment_id: insertedComment.id,
      doctor_id: doctorProfile.id,
      created_at: note.created_at,
      updated_at: note.created_at
    };
    
    const { data: insertedDoctorNote, error: doctorNoteError } = await supabase
      .from('doctor_notes')
      .insert(doctorNoteData)
      .select('id')
      .single();
    
    if (doctorNoteError) {
      console.error('❌ Error inserting doctor_note relationship:', doctorNoteError);
      return;
    }
    
    console.log(`✅ Doctor note relationship created: ${insertedDoctorNote.id}`);
    
    // Final verification
    const { count: finalCount } = await supabase
      .from('comments')
      .select('*', { count: 'exact', head: true })
      .eq('comment_type', 'doctor_note');
    
    console.log(`\n🎉 Migration complete! Total doctor note comments: ${finalCount}`);
    
    if (finalCount === 963) {
      console.log('✅ Doctor notes migration is now 100% COMPLETE!');
    }
    
  } catch (error) {
    console.error('Error migrating final doctor note:', error);
  } finally {
    await sourceClient.end();
  }
}

migrateFinalDoctorNote().catch(console.error);
