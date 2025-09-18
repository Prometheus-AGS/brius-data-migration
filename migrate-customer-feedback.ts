/**
 * Customer Feedback Migration Script
 * Migrates data from dispatch_comment and dispatch_record tables to customer_feedback table
 * Focuses on messages/comments from doctors (the customers) providing feedback
 */

const { Pool } = require('pg');
require('dotenv').config();

// Database connections
const sourceDb = new Pool({
  host: process.env.SOURCE_DB_HOST,
  port: process.env.SOURCE_DB_PORT,
  user: process.env.SOURCE_DB_USER,
  password: process.env.SOURCE_DB_PASSWORD,
  database: process.env.SOURCE_DB_NAME
});

const targetDb = new Pool({
  host: process.env.TARGET_DB_HOST,
  port: process.env.TARGET_DB_PORT,
  user: process.env.TARGET_DB_USER,
  password: process.env.TARGET_DB_PASSWORD,
  database: process.env.TARGET_DB_NAME
});

interface SourceComment {
  id: number;
  text: string;
  created_at: string;
  author_id: number;
  plan_id: number;
  author_username: string;
  author_email: string;
  author_first_name: string;
  author_last_name: string;
  source_type: 'dispatch_comment';
}

interface SourceRecord {
  id: number;
  text: string;
  created_at: string;
  author_id: number;
  target_id: number;
  target_type_id: number;
  target_model: string;
  author_username: string;
  author_email: string;
  author_first_name: string;
  author_last_name: string;
  source_type: 'dispatch_record';
}

type SourceFeedback = SourceComment | SourceRecord;

interface TargetFeedback {
  id: string;  // UUID
  feedback_type: string;
  severity?: string;
  source_type: string;  // 'doctor'
  source_id?: string;  // UUID reference to profiles
  source_organization_id?: string;  // UUID reference to offices
  regarding_order_id?: string;  // UUID if related to order
  regarding_patient_id?: string;  // UUID if related to patient
  subject: string;
  description: string;
  status: string;
  created_at: string;
  legacy_record_id: number;
}

// Helper function to determine feedback type from text content
function classifyFeedbackType(text: string): string {
  const lowerText = text.toLowerCase();
  
  // Check for complaint indicators
  if (lowerText.includes('problem') || lowerText.includes('issue') || 
      lowerText.includes('wrong') || lowerText.includes('error') ||
      lowerText.includes('incorrect') || lowerText.includes('not right') ||
      lowerText.includes('disappointing') || lowerText.includes('unsatisfied')) {
    return 'complaint';
  }
  
  // Check for quality issues
  if (lowerText.includes('quality') || lowerText.includes('defect') ||
      lowerText.includes('remake') || lowerText.includes('redo') ||
      lowerText.includes('fit') || lowerText.includes('adjustment needed')) {
    return 'quality_issue';
  }
  
  // Check for suggestions
  if (lowerText.includes('suggest') || lowerText.includes('recommend') ||
      lowerText.includes('could you') || lowerText.includes('please') ||
      lowerText.includes('would it be possible') || lowerText.includes('modification')) {
    return 'suggestion';
  }
  
  // Check for compliments
  if (lowerText.includes('thank you') || lowerText.includes('great') ||
      lowerText.includes('excellent') || lowerText.includes('perfect') ||
      lowerText.includes('good work') || lowerText.includes('well done')) {
    return 'compliment';
  }
  
  // Default to general feedback
  return 'general_feedback';
}

// Helper function to determine severity
function classifySeverity(text: string, feedbackType: string): string {
  const lowerText = text.toLowerCase();
  
  // Critical indicators
  if (lowerText.includes('urgent') || lowerText.includes('asap') ||
      lowerText.includes('critical') || lowerText.includes('emergency') ||
      lowerText.includes('immediate')) {
    return 'critical';
  }
  
  // High priority indicators
  if (lowerText.includes('important') || lowerText.includes('priority') ||
      feedbackType === 'complaint' || feedbackType === 'quality_issue') {
    return 'high';
  }
  
  // Low priority for compliments
  if (feedbackType === 'compliment') {
    return 'low';
  }
  
  // Default to medium
  return 'medium';
}

// Helper function to extract subject from text
function extractSubject(text: string): string {
  // Remove newlines and extra spaces
  const cleanText = text.replace(/\s+/g, ' ').trim();
  
  // If text is short, use as subject
  if (cleanText.length <= 50) {
    return cleanText;
  }
  
  // Try to extract first sentence or meaningful part
  const sentences = cleanText.split(/[.!?]/);
  if (sentences[0] && sentences[0].length <= 100) {
    return sentences[0].trim();
  }
  
  // Truncate to first 100 characters and add ellipsis
  return cleanText.substring(0, 97) + '...';
}

async function migrateCustomerFeedback() {
  let sourceClient, targetClient;
  
  try {
    console.log('🔄 Starting customer feedback migration...');
    
    // Get connections
    sourceClient = await sourceDb.connect();
    targetClient = await targetDb.connect();
    
    // Begin transaction
    await targetClient.query('BEGIN');
    
    // Step 1: Fetch doctor comments from dispatch_comment
    console.log('📋 Fetching doctor comments from dispatch_comment...');
    const commentsResult = await sourceClient.query(`
      SELECT 
        dc.id,
        dc.text,
        dc.created_at,
        dc.author_id,
        dc.plan_id,
        au.username as author_username,
        au.email as author_email,
        au.first_name as author_first_name,
        au.last_name as author_last_name
      FROM dispatch_comment dc
      JOIN auth_user au ON dc.author_id = au.id
      JOIN auth_user_groups aug ON au.id = aug.user_id
      JOIN auth_group ag ON aug.group_id = ag.id
      WHERE ag.name = 'Doctor'
        AND dc.text IS NOT NULL
        AND LENGTH(TRIM(dc.text)) > 5
      ORDER BY dc.created_at DESC
    `);
    
    const sourceComments: SourceComment[] = commentsResult.rows.map((row: any) => ({
      ...row,
      source_type: 'dispatch_comment' as const
    }));
    
    console.log(`Found ${sourceComments.length} doctor comments`);
    
    // Step 2: Fetch doctor records from dispatch_record
    console.log('📋 Fetching doctor records from dispatch_record...');
    const recordsResult = await sourceClient.query(`
      SELECT 
        dr.id,
        dr.text,
        dr.created_at,
        dr.author_id,
        dr.target_id,
        dr.target_type_id,
        dct.model as target_model,
        au.username as author_username,
        au.email as author_email,
        au.first_name as author_first_name,
        au.last_name as author_last_name
      FROM dispatch_record dr
      JOIN auth_user au ON dr.author_id = au.id
      JOIN auth_user_groups aug ON au.id = aug.user_id
      JOIN auth_group ag ON aug.group_id = ag.id
      JOIN django_content_type dct ON dr.target_type_id = dct.id
      WHERE ag.name = 'Doctor'
        AND dr.text IS NOT NULL
        AND LENGTH(TRIM(dr.text)) > 5
      ORDER BY dr.created_at DESC
    `);
    
    const sourceRecords: SourceRecord[] = recordsResult.rows.map((row: any) => ({
      ...row,
      source_type: 'dispatch_record' as const
    }));
    
    console.log(`Found ${sourceRecords.length} doctor records`);
    
    // Step 3: Combine and process all feedback
    const allFeedback: SourceFeedback[] = [...sourceComments, ...sourceRecords];
    console.log(`Total feedback items to migrate: ${allFeedback.length}`);
    
    // Step 4: Process and insert feedback
    console.log('🔄 Processing and inserting feedback...');
    
    let processed = 0;
    const batchSize = parseInt(process.env.BATCH_SIZE || '100');
    
    for (let i = 0; i < allFeedback.length; i += batchSize) {
      const batch = allFeedback.slice(i, i + batchSize);
      
      for (const feedback of batch) {
        const feedbackType = classifyFeedbackType(feedback.text);
        const severity = classifySeverity(feedback.text, feedbackType);
        const subject = extractSubject(feedback.text);
        
        // Generate UUID for the feedback
        const uuidResult = await targetClient.query('SELECT gen_random_uuid() as id');
        const feedbackUuid = uuidResult.rows[0].id;
        
        await targetClient.query(`
          INSERT INTO customer_feedback (
            id,
            feedback_type,
            severity,
            source_type,
            subject,
            description,
            status,
            created_at,
            updated_at,
            legacy_record_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)
        `, [
          feedbackUuid,
          feedbackType,
          severity,
          'doctor',  // All feedback is from doctors
          subject,
          feedback.text,
          'new',  // Default status
          feedback.created_at,
          feedback.id  // Store original ID for reference
        ]);
        
        processed++;
      }
      
      console.log(`Processed ${Math.min(i + batchSize, allFeedback.length)} / ${allFeedback.length} feedback items`);
    }
    
    console.log(`✅ Successfully processed ${processed} feedback items`);
    
    // Step 5: Validation
    console.log('🔍 Validating migration...');
    
    const targetCount = await targetClient.query('SELECT COUNT(*) as total FROM customer_feedback');
    const typeBreakdown = await targetClient.query(`
      SELECT feedback_type, COUNT(*) as count 
      FROM customer_feedback 
      GROUP BY feedback_type 
      ORDER BY count DESC
    `);
    const severityBreakdown = await targetClient.query(`
      SELECT severity, COUNT(*) as count 
      FROM customer_feedback 
      GROUP BY severity 
      ORDER BY count DESC
    `);
    
    console.log(`\nMigration Summary:`);
    console.log(`Source comments: ${sourceComments.length}`);
    console.log(`Source records: ${sourceRecords.length}`);
    console.log(`Total source items: ${allFeedback.length}`);
    console.log(`Target feedback entries: ${targetCount.rows[0].total}`);
    
    console.log('\n📊 Feedback Type Breakdown:');
    console.table(typeBreakdown.rows);
    
    console.log('\n📊 Severity Breakdown:');
    console.table(severityBreakdown.rows);
    
    // Show recent samples
    console.log('\n📋 Recent Feedback Samples:');
    const samples = await targetClient.query(`
      SELECT 
        feedback_type,
        severity,
        subject,
        LEFT(description, 100) as description_preview,
        created_at
      FROM customer_feedback
      ORDER BY created_at DESC
      LIMIT 5
    `);
    
    console.table(samples.rows);
    
    // Commit transaction
    await targetClient.query('COMMIT');
    console.log('✅ Customer feedback migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    if (targetClient) {
      await targetClient.query('ROLLBACK');
      console.log('🔄 Transaction rolled back');
    }
    throw error;
  } finally {
    if (sourceClient) sourceClient.release();
    if (targetClient) targetClient.release();
  }
}

async function validateFeedbackData() {
  try {
    console.log('\n🔍 Validating customer feedback data...');
    
    const client = await targetDb.connect();
    
    // Check for data consistency
    const stats = await client.query(`
      SELECT 
        COUNT(*) as total_feedback,
        COUNT(DISTINCT source_type) as source_types,
        MIN(created_at) as earliest_feedback,
        MAX(created_at) as latest_feedback,
        AVG(LENGTH(description)) as avg_description_length
      FROM customer_feedback
    `);
    
    console.log('📈 Overall Statistics:');
    console.table(stats.rows);
    
    // Check for any data quality issues
    const qualityCheck = await client.query(`
      SELECT 
        'Empty subjects' as issue,
        COUNT(*) as count
      FROM customer_feedback 
      WHERE subject IS NULL OR TRIM(subject) = ''
      
      UNION ALL
      
      SELECT 
        'Empty descriptions' as issue,
        COUNT(*) as count
      FROM customer_feedback 
      WHERE description IS NULL OR TRIM(description) = ''
      
      UNION ALL
      
      SELECT 
        'Very short descriptions' as issue,
        COUNT(*) as count
      FROM customer_feedback 
      WHERE LENGTH(TRIM(description)) < 10
    `);
    
    console.log('\n🔍 Quality Check:');
    console.table(qualityCheck.rows);
    
    client.release();
    
  } catch (error) {
    console.error('❌ Validation failed:', error);
  }
}

async function main() {
  try {
    await migrateCustomerFeedback();
    await validateFeedbackData();
  } catch (error) {
    console.error('❌ Script failed:', error);
    process.exit(1);
  } finally {
    await sourceDb.end();
    await targetDb.end();
  }
}

// Run the migration
if (require.main === module) {
  main();
}
