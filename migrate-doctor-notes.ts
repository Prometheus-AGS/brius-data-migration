import { Client as PgClient } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

// Source database configuration
const sourceDb = new PgClient({
  host: process.env.SOURCE_DB_HOST!,
  port: parseInt(process.env.SOURCE_DB_PORT!),
  user: process.env.SOURCE_DB_USER!,
  password: process.env.SOURCE_DB_PASSWORD!,
  database: process.env.SOURCE_DB_NAME!,
});

// Target database configuration
const targetDb = new PgClient({
  host: process.env.TARGET_DB_HOST || 'localhost',
  port: parseInt(process.env.TARGET_DB_PORT || '5432'),
  user: process.env.TARGET_DB_USER || 'postgres',
  password: process.env.TARGET_DB_PASSWORD!,
  database: process.env.TARGET_DB_NAME || 'postgres',
});

interface SourceNote {
  id: number;
  created_at: string;
  text: string;
  author_id: number | null;
  doctor_id: number;
}

interface AuthorLookup {
  [legacyUserId: number]: string; // legacy_user_id -> profile_id
}

interface DoctorLookup {
  [legacyDoctorId: number]: string; // legacy_user_id -> profile_id (doctors are also in profiles)
}

async function migrateDoctorNotes() {
  console.log('🔄 Migrating dispatch_note → comments + doctor_notes (proper architecture)...\n');

  try {
    // Connect to both databases
    await sourceDb.connect();
    await targetDb.connect();
    
    console.log('✅ Connected to source and target databases');

    // 1. Build author lookup map (legacy_user_id -> profile.id)
    console.log('1️⃣ Building author lookup map...');
    
    const authorQuery = `
      SELECT id, legacy_user_id
      FROM profiles 
      WHERE legacy_user_id IS NOT NULL
    `;
    
    const authorResult = await targetDb.query(authorQuery);
    const authorLookup: AuthorLookup = {};
    
    authorResult.rows.forEach(row => {
      authorLookup[row.legacy_user_id] = row.id;
    });
    
    console.log(`   👤 Loaded ${Object.keys(authorLookup).length} author mappings`);

    // 2. Build doctor lookup map (same as author lookup since doctors are in profiles too)
    const doctorLookup: DoctorLookup = { ...authorLookup };
    console.log(`   👩‍⚕️ Doctor lookup uses same profile mappings: ${Object.keys(doctorLookup).length} mappings`);

    // 3. Get source notes
    console.log('2️⃣ Fetching source notes...');
    const sourceNotesQuery = `
      SELECT id, created_at, text, author_id, doctor_id
      FROM dispatch_note
      WHERE text IS NOT NULL AND TRIM(text) != ''
      ORDER BY created_at;
    `;
    
    const sourceNotesResult = await sourceDb.query(sourceNotesQuery);
    const sourceNotes: SourceNote[] = sourceNotesResult.rows;
    
    console.log(`   📝 Found ${sourceNotes.length} notes to migrate`);

    // 4. Clear any existing migrated data
    console.log('3️⃣ Cleaning up any existing migration data...');
    
    // First delete doctor_notes that link to migrated comments
    const cleanupNotes = await targetDb.query(`
      DELETE FROM doctor_notes 
      WHERE comment_id IN (
        SELECT id FROM comments 
        WHERE legacy_table = 'dispatch_note'
      )
    `);
    console.log(`   🧹 Cleaned up ${cleanupNotes.rowCount} doctor_notes`);
    
    // Then delete the comments themselves
    const cleanupComments = await targetDb.query(`
      DELETE FROM comments 
      WHERE legacy_table = 'dispatch_note'
    `);
    console.log(`   🧹 Cleaned up ${cleanupComments.rowCount} comments`);

    // 5. Process notes in batches
    console.log('4️⃣ Migrating notes with proper architecture...\n');
    
    const batchSize = 100;
    const totalBatches = Math.ceil(sourceNotes.length / batchSize);
    let successfulMigrations = 0;
    let skippedNotes = 0;
    let errors = 0;
    let authorMappingMisses = 0;
    let doctorMappingMisses = 0;

    for (let i = 0; i < totalBatches; i++) {
      const batchStart = i * batchSize;
      const batchEnd = Math.min((i + 1) * batchSize, sourceNotes.length);
      const batch = sourceNotes.slice(batchStart, batchEnd);
      
      console.log(`   📦 Processing batch ${i + 1}/${totalBatches} (${batch.length} notes)...`);

      for (const note of batch) {
        try {
          // Resolve doctor ID - required for doctor_notes
          const doctorId = doctorLookup[note.doctor_id];
          if (!doctorId) {
            console.log(`   👩‍⚕️ No doctor mapping for legacy doctor ID ${note.doctor_id} (note ${note.id}) - skipping`);
            doctorMappingMisses++;
            skippedNotes++;
            continue;
          }

          // Resolve author ID - can be null
          let authorId: string | null = null;
          if (note.author_id !== null) {
            authorId = authorLookup[note.author_id] || null;
            if (!authorId) {
              authorMappingMisses++;
              console.log(`   👤 No author mapping for legacy user ID ${note.author_id} (note ${note.id}) - will set to null`);
            }
          }

          // Step 1: Insert into comments table
          const insertCommentQuery = `
            INSERT INTO comments (id, content, comment_type, author_id, created_at, updated_at, legacy_table, legacy_id)
            VALUES (gen_random_uuid(), $1, 'doctor_note', $2, $3, $3, 'dispatch_note', $4)
            RETURNING id;
          `;
          
          const commentResult = await targetDb.query(insertCommentQuery, [
            note.text,           // content
            authorId,            // author_id (mapped from legacy author_id or null)
            note.created_at,     // created_at
            note.id              // legacy_id
          ]);
          
          const newCommentId = commentResult.rows[0].id;

          // Step 2: Insert into doctor_notes table with comment_id foreign key
          const insertDoctorNoteQuery = `
            INSERT INTO doctor_notes (
              id, 
              doctor_id, 
              comment_id, 
              created_at, 
              legacy_note_id
            )
            VALUES (
              gen_random_uuid(), 
              $1, 
              $2, 
              $3, 
              $4
            );
          `;
          
          await targetDb.query(insertDoctorNoteQuery, [
            doctorId,           // doctor_id (mapped from legacy doctor_id)
            newCommentId,       // comment_id (foreign key to comments table)
            note.created_at,    // created_at
            note.id             // legacy_note_id
          ]);

          successfulMigrations++;

        } catch (error) {
          errors++;
          console.log(`   ❌ Error migrating note ${note.id}:`, error);
        }
      }

      // Progress update
      const progressPercent = Math.round((i + 1) / totalBatches * 100);
      console.log(`   📊 Progress: ${progressPercent}% (${successfulMigrations} successful, ${skippedNotes} skipped, ${errors} errors)`);
      
      // Brief pause between batches
      if (i < totalBatches - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log('\n✅ Doctor notes migration completed with proper architecture!');
    console.log(`📊 Final results:`);
    console.log(`  • Notes migrated: ${successfulMigrations}`);
    console.log(`  • Doctor notes created: ${successfulMigrations}`);
    console.log(`  • Notes skipped (no doctor mapping): ${doctorMappingMisses}`);
    console.log(`  • Notes with missing author mapping: ${authorMappingMisses}`);
    console.log(`  • Errors: ${errors}`);
    console.log(`  • Success rate: ${Math.round((successfulMigrations / sourceNotes.length) * 100)}%`);

    // Final verification
    console.log('\n🔍 Verification:');
    const finalCommentCount = await targetDb.query(`
      SELECT COUNT(*) as count FROM comments 
      WHERE legacy_table = 'dispatch_note'
    `);
    const finalNoteCount = await targetDb.query(`
      SELECT COUNT(*) as count FROM doctor_notes 
      WHERE comment_id IS NOT NULL
    `);
    
    console.log(`   Comments in database: ${finalCommentCount.rows[0].count}`);
    console.log(`   Doctor notes with comment_id: ${finalNoteCount.rows[0].count}`);

  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await sourceDb.end();
    await targetDb.end();
  }
}

// Run migration
migrateDoctorNotes().catch(console.error);
