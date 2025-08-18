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

async function validateCaseMessagessMigration() {
  try {
    console.log('🔍 CASE MESSAGES MIGRATION VALIDATION REPORT');
    console.log('============================================');

    // Source vs Target counts
    const sourceCount = await sourcePool.query('SELECT COUNT(*) as count FROM dispatch_comment');
    const targetCount = await targetPool.query('SELECT COUNT(*) as count FROM case_messages WHERE legacy_record_id IS NOT NULL');
    
    console.log('\n📊 RECORD COUNTS:');
    console.log(`Source dispatch_comment: ${sourceCount.rows[0].count}`);
    console.log(`Target case_messages (migrated): ${targetCount.rows[0].count}`);
    console.log(`Migration rate: ${((targetCount.rows[0].count / sourceCount.rows[0].count) * 100).toFixed(2)}%`);

    // Data integrity checks
    console.log('\n🔗 DATA INTEGRITY CHECKS:');
    
    // Check for duplicate legacy IDs
    const duplicateMessages = await targetPool.query(`
      SELECT legacy_record_id, COUNT(*) 
      FROM case_messages 
      WHERE legacy_record_id IS NOT NULL 
      GROUP BY legacy_record_id 
      HAVING COUNT(*) > 1
    `);
    console.log(`Duplicate legacy record IDs: ${duplicateMessages.rows.length}`);
    
    // Check foreign key relationships
    const orphanedMessages = await targetPool.query(`
      SELECT COUNT(*) as count 
      FROM case_messages 
      WHERE case_id NOT IN (SELECT id FROM cases)
    `);
    console.log(`Orphaned case_messages: ${orphanedMessages.rows[0].count}`);

    // Message type distribution
    console.log('\n📈 MESSAGE TYPE DISTRIBUTION:');
    const typeDistribution = await targetPool.query(`
      SELECT 
        message_type,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM case_messages WHERE legacy_record_id IS NOT NULL), 2) as percentage
      FROM case_messages 
      WHERE legacy_record_id IS NOT NULL
      GROUP BY message_type 
      ORDER BY count DESC
    `);
    
    typeDistribution.rows.forEach(row => {
      console.log(`  ${row.message_type}: ${row.count} (${row.percentage}%)`);
    });

    // Content analysis
    console.log('\n📝 CONTENT ANALYSIS:');
    const contentStats = await targetPool.query(`
      SELECT 
        COUNT(*) as total_messages,
        AVG(LENGTH(content)) as avg_content_length,
        MIN(LENGTH(content)) as min_content_length,
        MAX(LENGTH(content)) as max_content_length
      FROM case_messages 
      WHERE legacy_record_id IS NOT NULL
    `);
    
    const stats = contentStats.rows[0];
    console.log(`Total messages: ${stats.total_messages}`);
    console.log(`Average content length: ${Math.round(stats.avg_content_length)} characters`);
    console.log(`Content length range: ${stats.min_content_length} - ${stats.max_content_length} characters`);

    // Timeline analysis
    console.log('\n📅 TIMELINE ANALYSIS:');
    const yearlyStats = await targetPool.query(`
      SELECT 
        DATE_TRUNC('year', sent_at) as year,
        COUNT(*) as count,
        COUNT(sender_id) as messages_with_sender
      FROM case_messages 
      WHERE legacy_record_id IS NOT NULL
      GROUP BY year 
      ORDER BY year
    `);
    
    console.log('Messages by year (with sender attribution):');
    yearlyStats.rows.forEach(row => {
      const year = row.year.getFullYear();
      const senderRate = ((row.messages_with_sender / row.count) * 100).toFixed(1);
      console.log(`  ${year}: ${row.count} messages (${senderRate}% with sender)`);
    });

    // Sender mapping success
    console.log('\n👤 SENDER MAPPING ANALYSIS:');
    const senderStats = await targetPool.query(`
      SELECT 
        COUNT(*) as total_messages,
        COUNT(sender_id) as messages_with_sender,
        ROUND(COUNT(sender_id) * 100.0 / COUNT(*), 2) as sender_mapping_rate
      FROM case_messages 
      WHERE legacy_record_id IS NOT NULL
    `);
    
    const sStats = senderStats.rows[0];
    console.log(`Total migrated messages: ${sStats.total_messages}`);
    console.log(`Messages with sender mapping: ${sStats.messages_with_sender}`);
    console.log(`Sender mapping success rate: ${sStats.sender_mapping_rate}%`);

    // Case distribution
    console.log('\n📊 CASE DISTRIBUTION:');
    const caseStats = await targetPool.query(`
      SELECT 
        COUNT(DISTINCT case_id) as unique_cases,
        COUNT(*) as total_messages,
        ROUND(COUNT(*) * 1.0 / COUNT(DISTINCT case_id), 2) as avg_messages_per_case
      FROM case_messages 
      WHERE legacy_record_id IS NOT NULL
    `);
    
    const cStats = caseStats.rows[0];
    console.log(`Messages distributed across ${cStats.unique_cases} unique cases`);
    console.log(`Average messages per case: ${cStats.avg_messages_per_case}`);

    // Top cases by message count
    const topCases = await targetPool.query(`
      SELECT 
        case_id,
        COUNT(*) as message_count
      FROM case_messages 
      WHERE legacy_record_id IS NOT NULL
      GROUP BY case_id 
      ORDER BY message_count DESC 
      LIMIT 5
    `);
    console.log('\nTop 5 cases by message count:');
    topCases.rows.forEach((row, index) => {
      console.log(`  ${index + 1}. Case ${row.case_id}: ${row.message_count} messages`);
    });

    // Sample data validation
    console.log('\n🔍 SAMPLE DATA VALIDATION:');
    const sourceComparison = await sourcePool.query(`
      SELECT id, text, created_at, author_id, plan_id
      FROM dispatch_comment 
      WHERE id IN (79, 80, 81)
      ORDER BY id
    `);
    
    const targetComparison = await targetPool.query(`
      SELECT legacy_record_id, content, sent_at, sender_id, metadata
      FROM case_messages 
      WHERE legacy_record_id IN (79, 80, 81)
      ORDER BY legacy_record_id
    `);
    
    console.log('Source vs Target comparison:');
    sourceComparison.rows.forEach((sourceRow, index) => {
      const targetRow = targetComparison.rows[index];
      if (targetRow) {
        console.log(`  Comment ${sourceRow.id}:`);
        console.log(`    Source: "${sourceRow.text.substring(0, 50)}..." (${sourceRow.text.length} chars)`);
        console.log(`    Target: "${targetRow.content.substring(0, 50)}..." (${targetRow.content.length} chars)`);
        console.log(`    Dates match: ${sourceRow.created_at.getTime() === targetRow.sent_at.getTime()}`);
      }
    });

    console.log('\n✅ VALIDATION COMPLETE!');
    console.log('========================================');

  } catch (error: any) {
    console.error('❌ Validation failed:', error.message);
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

// Run validation
if (require.main === module) {
  validateCaseMessagessMigration().catch(console.error);
}
