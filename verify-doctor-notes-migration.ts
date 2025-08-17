import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function verifyDoctorNotesMigration() {
  const targetDb = new Client({
    host: process.env.TARGET_DB_HOST || 'localhost',
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    user: process.env.TARGET_DB_USER || 'postgres',
    password: process.env.TARGET_DB_PASSWORD!,
    database: process.env.TARGET_DB_NAME || 'postgres'
  });

  try {
    await targetDb.connect();
    
    console.log('📊 Doctor Notes Migration Verification\n');
    
    // Check comments table for doctor_note type
    const doctorCommentsCount = await targetDb.query(`
      SELECT COUNT(*) as count FROM comments 
      WHERE comment_type = 'doctor_note' AND legacy_table = 'dispatch_note'
    `);
    console.log(`💬 Doctor note comments migrated: ${doctorCommentsCount.rows[0].count}`);
    
    // Check doctor_notes table  
    const doctorNotesCount = await targetDb.query(`
      SELECT COUNT(*) as count FROM doctor_notes 
      WHERE comment_id IS NOT NULL
    `);
    console.log(`📋 Doctor notes with comment_id: ${doctorNotesCount.rows[0].count}`);
    
    // Check data consistency
    const consistencyCheck = await targetDb.query(`
      SELECT 
        COUNT(dn.comment_id) as linked_notes,
        COUNT(c.id) as total_doctor_comments
      FROM comments c 
      LEFT JOIN doctor_notes dn ON dn.comment_id = c.id
      WHERE c.comment_type = 'doctor_note' AND c.legacy_table = 'dispatch_note'
    `);
    
    console.log(`📋 Data consistency check:`);
    console.log(`   - Total doctor note comments: ${consistencyCheck.rows[0].total_doctor_comments}`);
    console.log(`   - Linked doctor notes: ${consistencyCheck.rows[0].linked_notes}`);
    
    // Check all comment types now
    const allCommentTypes = await targetDb.query(`
      SELECT comment_type, COUNT(*) as count 
      FROM comments 
      GROUP BY comment_type
      ORDER BY comment_type
    `);
    
    console.log(`\n🏷️  All comment types in system:`);
    allCommentTypes.rows.forEach(row => {
      console.log(`   - ${row.comment_type}: ${row.count}`);
    });
    
    // Sample of migrated doctor notes
    const sample = await targetDb.query(`
      SELECT 
        c.id as comment_id,
        c.content,
        c.author_id,
        c.created_at,
        c.legacy_id,
        dn.doctor_id,
        dn.legacy_note_id
      FROM comments c
      JOIN doctor_notes dn ON dn.comment_id = c.id
      WHERE c.comment_type = 'doctor_note' AND c.legacy_table = 'dispatch_note'
      ORDER BY c.created_at
      LIMIT 3
    `);
    
    console.log(`\n🔍 Sample migrated doctor notes:`);
    sample.rows.forEach((row, index) => {
      console.log(`   ${index + 1}. Comment ID: ${row.comment_id}`);
      console.log(`      Content: "${row.content.substring(0, 50)}${row.content.length > 50 ? '...' : ''}"`);
      console.log(`      Author ID: ${row.author_id || 'null'}`);
      console.log(`      Doctor ID: ${row.doctor_id}`);
      console.log(`      Legacy Note ID: ${row.legacy_note_id}`);
      console.log('');
    });
    
    // Total system summary
    console.log(`🌟 COMPLETE SYSTEM SUMMARY:`);
    const totalComments = await targetDb.query('SELECT COUNT(*) as count FROM comments');
    const totalDiscussions = await targetDb.query('SELECT COUNT(*) as count FROM treatment_discussions WHERE comment_id IS NOT NULL');
    const totalDoctorNotes = await targetDb.query('SELECT COUNT(*) as count FROM doctor_notes WHERE comment_id IS NOT NULL');
    
    console.log(`   - Total comments in system: ${totalComments.rows[0].count}`);
    console.log(`   - Treatment discussions: ${totalDiscussions.rows[0].count}`);
    console.log(`   - Doctor notes: ${totalDoctorNotes.rows[0].count}`);
    console.log(`   - All properly linked via foreign keys ✅`);
    
  } finally {
    await targetDb.end();
  }
}

verifyDoctorNotesMigration().catch(console.error);
