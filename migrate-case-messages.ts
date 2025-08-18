import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const sourcePool = new Pool({
  host: process.env.SOURCE_DB_HOST!,
  port: parseInt(process.env.SOURCE_DB_PORT!),
  user: process.env.SOURCE_DB_USER!,
  password: process.env.SOURCE_DB_PASSWORD!,
  database: process.env.SOURCE_DB_NAME!
});

const targetPool = new Pool({
  host: process.env.TARGET_DB_HOST!,
  port: parseInt(process.env.TARGET_DB_PORT!),
  user: process.env.TARGET_DB_USER!,
  password: process.env.TARGET_DB_PASSWORD!,
  database: process.env.TARGET_DB_NAME!
});

interface SourceComment {
  id: number;
  created_at: Date;
  text: string;
  author_id: number | null;
  plan_id: number;
}

async function migrateCaseMessages() {
  let migrationStats = {
    commentsProcessed: 0,
    commentsSkipped: 0,
    commentsMigrated: 0,
    plansWithoutCases: 0,
    authorsWithoutProfiles: 0
  };

  try {
    console.log('🚀 Starting Case Messages Migration...\n');

    // Step 1: Build mapping tables
    console.log('📋 Step 1: Building mapping tables...');
    
    // Map plan_id → case_id via treatment_plans → orders → cases
    const caseMappings = new Map<number, string>();
    const caseMappingQuery = await targetPool.query(`
      SELECT 
        tp.legacy_plan_id,
        c.id as case_id
      FROM treatment_plans tp
      JOIN orders o ON tp.order_id = o.id
      JOIN cases c ON o.patient_id = c.patient_id
      WHERE tp.legacy_plan_id IS NOT NULL
    `);
    
    caseMappingQuery.rows.forEach(row => {
      caseMappings.set(row.legacy_plan_id, row.case_id);
    });
    
    console.log(`Found ${caseMappings.size} plan → case mappings`);

    // Map author_id → profile_id
    const profileMappings = new Map<number, string>();
    const profileMappingQuery = await targetPool.query(`
      SELECT legacy_user_id, id as profile_id
      FROM profiles
      WHERE legacy_user_id IS NOT NULL
    `);
    
    profileMappingQuery.rows.forEach(row => {
      profileMappings.set(row.legacy_user_id, row.profile_id);
    });
    
    console.log(`Found ${profileMappings.size} author → profile mappings`);

    // Step 2: Process source comments
    console.log('\n📊 Step 2: Processing dispatch_comment records...');
    
    const sourceComments = await sourcePool.query<SourceComment>(`
      SELECT id, created_at, text, author_id, plan_id
      FROM dispatch_comment 
      ORDER BY created_at ASC
    `);

    console.log(`Processing ${sourceComments.rows.length} comment records...`);

    for (const sourceComment of sourceComments.rows) {
      migrationStats.commentsProcessed++;
      
      try {
        // Find corresponding case
        const caseId = caseMappings.get(sourceComment.plan_id);
        if (!caseId) {
          migrationStats.plansWithoutCases++;
          if (migrationStats.commentsProcessed % 1000 === 0) {
            console.log(`⚠️  Processed ${migrationStats.commentsProcessed} comments, ${migrationStats.plansWithoutCases} without case mapping...`);
          }
          continue;
        }

        // Find sender profile
        let senderProfileId = null;
        if (sourceComment.author_id) {
          senderProfileId = profileMappings.get(sourceComment.author_id);
          if (!senderProfileId) {
            migrationStats.authorsWithoutProfiles++;
          }
        }

        // Classify message type based on content analysis
        let messageType = 'clinical_note'; // Default
        const text = sourceComment.text?.toLowerCase() || '';
        
        if (text.includes('approve') || text.includes('looks good')) {
          messageType = 'doctor_response';
        } else if (text.includes('question') || text.includes('please') || text.includes('?')) {
          messageType = 'patient_question';
        } else if (text.includes('treatment') || text.includes('plan')) {
          messageType = 'treatment_update';
        } else if (text.includes('note') || text.includes('correction')) {
          messageType = 'clinical_note';
        }

        // Create subject from first 50 characters
        const subject = sourceComment.text 
          ? sourceComment.text.substring(0, 50).trim() + (sourceComment.text.length > 50 ? '...' : '')
          : 'Treatment Plan Comment';

        // Insert case message
        await targetPool.query(`
          INSERT INTO case_messages (
            case_id,
            sender_id,
            recipient_id,
            message_type,
            subject,
            content,
            priority,
            is_urgent,
            requires_response,
            is_confidential,
            sent_at,
            metadata,
            legacy_record_id,
            legacy_message_id
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
          )
        `, [
          caseId,
          senderProfileId,
          null, // No specific recipient for treatment plan comments
          messageType,
          subject,
          sourceComment.text || '',
          1, // Normal priority
          false, // Not urgent
          messageType === 'patient_question', // Questions require response
          false, // Not confidential
          sourceComment.created_at,
          JSON.stringify({
            source_comment_id: sourceComment.id,
            source_author_id: sourceComment.author_id,
            source_plan_id: sourceComment.plan_id,
            migration_source: 'dispatch_comment',
            message_classification: messageType
          }),
          sourceComment.id, // legacy_record_id
          sourceComment.id  // legacy_message_id
        ]);

        migrationStats.commentsMigrated++;
        
        if (migrationStats.commentsMigrated % 500 === 0) {
          console.log(`✅ Migrated ${migrationStats.commentsMigrated} case messages so far...`);
        }

      } catch (error: any) {
        console.error(`❌ Error migrating comment ${sourceComment.id}:`, error.message);
        migrationStats.commentsSkipped++;
      }
    }

    console.log(`\n✅ Case messages migration complete: ${migrationStats.commentsMigrated}/${migrationStats.commentsProcessed} migrated`);

    // Step 3: Validation
    console.log('\n🔍 Step 3: Validation...');
    
    const finalMessagesCount = await targetPool.query('SELECT COUNT(*) as count FROM case_messages');
    console.log(`Final case_messages count: ${finalMessagesCount.rows[0].count}`);

    const messagesByType = await targetPool.query(`
      SELECT message_type, COUNT(*) as count
      FROM case_messages
      WHERE legacy_record_id IS NOT NULL
      GROUP BY message_type
      ORDER BY count DESC
    `);
    console.log('\nMessages by type:');
    messagesByType.rows.forEach(row => {
      console.log(`  ${row.message_type}: ${row.count}`);
    });

    // Check foreign key integrity
    const orphanedMessages = await targetPool.query(`
      SELECT COUNT(*) as count 
      FROM case_messages cm
      WHERE cm.case_id NOT IN (SELECT id FROM cases)
    `);
    console.log(`Orphaned case_messages: ${orphanedMessages.rows[0].count}`);

    // Timeline analysis
    const timelineStats = await targetPool.query(`
      SELECT 
        DATE_TRUNC('year', sent_at) as year,
        COUNT(*) as count
      FROM case_messages 
      WHERE legacy_record_id IS NOT NULL
      GROUP BY year 
      ORDER BY year
    `);
    
    console.log('\nMessages by year:');
    timelineStats.rows.forEach(row => {
      console.log(`  ${row.year.getFullYear()}: ${row.count} messages`);
    });

    // Sample migrated data
    console.log('\n📋 Sample migrated data:');
    const sampleMessages = await targetPool.query(`
      SELECT 
        id,
        message_type,
        subject,
        LENGTH(content) as content_length,
        sent_at,
        legacy_record_id
      FROM case_messages 
      WHERE legacy_record_id IS NOT NULL
      ORDER BY sent_at DESC
      LIMIT 3
    `);
    console.log('Sample case_messages:', sampleMessages.rows);

    console.log('\n📊 MIGRATION SUMMARY:');
    console.log('='.repeat(50));
    console.log(`Comments processed: ${migrationStats.commentsProcessed}`);
    console.log(`Messages migrated: ${migrationStats.commentsMigrated}`);
    console.log(`Comments skipped: ${migrationStats.commentsSkipped}`);
    console.log(`Plans without cases: ${migrationStats.plansWithoutCases}`);
    console.log(`Authors without profiles: ${migrationStats.authorsWithoutProfiles}`);
    console.log(`Success rate: ${((migrationStats.commentsMigrated / migrationStats.commentsProcessed) * 100).toFixed(2)}%`);
    console.log('='.repeat(50));

    console.log('\n🎉 Case messages migration completed successfully!');

  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

// Run the migration
if (require.main === module) {
  migrateCaseMessages().catch(console.error);
}

export { migrateCaseMessages };
