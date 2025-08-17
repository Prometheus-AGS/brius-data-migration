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

async function findMissingDoctorNote() {
  try {
    await sourceClient.connect();
    
    // Get all source dispatch_note IDs
    const sourceIds = await sourceClient.query('SELECT id FROM dispatch_note ORDER BY id');
    const sourceIdSet = new Set(sourceIds.rows.map(row => row.id));
    
    console.log(`Source dispatch_note IDs: ${sourceIdSet.size} total`);
    
    // Get all migrated legacy_note_ids from comments
    const { data: migratedComments } = await supabase
      .from('comments')
      .select('metadata')
      .eq('comment_type', 'doctor_note');
      
    if (!migratedComments) {
      console.log('Error fetching migrated comments');
      return;
    }
    
    const migratedIds = new Set();
    migratedComments.forEach((comment: any) => {
      const legacyId = comment.metadata?.legacy_note_id;
      if (legacyId) {
        migratedIds.add(legacyId);
      }
    });
    
    console.log(`Migrated doctor note IDs: ${migratedIds.size} total`);
    
    // Find missing IDs
    const missingIds: number[] = [];
    sourceIdSet.forEach(id => {
      if (!migratedIds.has(id)) {
        missingIds.push(id);
      }
    });
    
    console.log(`Missing doctor note IDs: ${missingIds.length} total`);
    
    if (missingIds.length > 0) {
      console.log('Missing IDs:', missingIds);
      
      // Get details of missing notes
      for (const missingId of missingIds) {
        const noteDetail = await sourceClient.query(
          'SELECT id, text, author_id, created_at FROM dispatch_note WHERE id = $1',
          [missingId]
        );
        
        if (noteDetail.rows.length > 0) {
          const note = noteDetail.rows[0];
          console.log(`\nMissing note ${note.id}:`);
          console.log(`  Author ID: ${note.author_id}`);
          console.log(`  Created: ${note.created_at}`);
          console.log(`  Text: ${note.text.substring(0, 100)}...`);
        }
      }
    }
    
    console.log('\n=== Summary ===');
    console.log(`Doctor notes migration: ${migratedIds.size}/${sourceIdSet.size} complete`);
    console.log(`Missing: ${missingIds.length} doctor notes`);
    
  } catch (error) {
    console.error('Error finding missing doctor note:', error);
  } finally {
    await sourceClient.end();
  }
}

findMissingDoctorNote().catch(console.error);
