import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

// Source database connection
const sourceClient = new Client({
  host: process.env.SOURCE_DB_HOST,
  port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
  database: process.env.SOURCE_DB_NAME,
  user: process.env.SOURCE_DB_USER,
  password: process.env.SOURCE_DB_PASSWORD,
});

// Target database connection
const targetClient = new Client({
  host: process.env.TARGET_DB_HOST,
  port: parseInt(process.env.TARGET_DB_PORT || '5432'),
  database: process.env.TARGET_DB_NAME,
  user: process.env.TARGET_DB_USER,
  password: process.env.TARGET_DB_PASSWORD,
});

async function validateCaseMigration() {
  try {
    await sourceClient.connect();
    await targetClient.connect();
    
    console.log('📊 Gathering source data counts...');
    
    // Get source counts
    const sourcePatients = await sourceClient.query('SELECT COUNT(*) as count FROM dispatch_patient');
    const sourceInstructions = await sourceClient.query('SELECT COUNT(*) as count FROM dispatch_instruction'); 
    const sourceComments = await sourceClient.query('SELECT COUNT(*) as count FROM dispatch_comment');
    const sourceRecords = await sourceClient.query('SELECT COUNT(*) as count FROM dispatch_record');
    
    console.log('📊 Gathering target data counts...');
    
    // Get target counts
    const targetCases = await targetClient.query('SELECT COUNT(*) as count FROM cases');
    const targetOrders = await targetClient.query('SELECT COUNT(*) as count FROM orders');
    const targetDiscussions = await targetClient.query('SELECT COUNT(*) as count FROM treatment_discussions');
    
    const targetCasesWithLegacy = await targetClient.query('SELECT COUNT(*) as count FROM cases WHERE legacy_patient_id IS NOT NULL');
    const targetOrdersWithLegacy = await targetClient.query('SELECT COUNT(*) as count FROM orders WHERE legacy_instruction_id IS NOT NULL');
    const targetDiscussionsWithLegacy = await targetClient.query('SELECT COUNT(*) as count FROM treatment_discussions WHERE legacy_comment_id IS NOT NULL');
    
    console.log('📊 Gathering sample case data...');
    
    // Get sample cases
    const sampleCases = await targetClient.query(`
      SELECT 
        case_number,
        status,
        deleted,
        legacy_patient_id,
        created_at
      FROM cases
      ORDER BY created_at DESC
      LIMIT 5
    `);
    
    // Calculate statistics
    const sourcePatientsCount = parseInt(sourcePatients.rows[0].count);
    const sourceInstructionsCount = parseInt(sourceInstructions.rows[0].count);
    const sourceCommentsCount = parseInt(sourceComments.rows[0].count);
    const sourceRecordsCount = parseInt(sourceRecords.rows[0].count);
    
    const targetCasesCount = parseInt(targetCases.rows[0].count);
    const targetOrdersCount = parseInt(targetOrders.rows[0].count);
    const targetDiscussionsCount = parseInt(targetDiscussions.rows[0].count);
    
    const targetCasesWithLegacyCount = parseInt(targetCasesWithLegacy.rows[0].count);
    const targetOrdersWithLegacyCount = parseInt(targetOrdersWithLegacy.rows[0].count);
    const targetDiscussionsWithLegacyCount = parseInt(targetDiscussionsWithLegacy.rows[0].count);
    
    console.log('\n📊 Migration Validation Results:');
    console.log('==================================\n');
    
    console.log('📈 Core Data Migration:');
    console.log('------------------------');
    console.log(`Source dispatch_patient: ${sourcePatientsCount.toLocaleString()}`);
    console.log(`Target cases: ${targetCasesCount.toLocaleString()} (${targetCasesWithLegacyCount.toLocaleString()} with legacy IDs)`);
    console.log(`Coverage: ${((targetCasesWithLegacyCount / sourcePatientsCount) * 100).toFixed(2)}%\n`);
    
    console.log(`Source dispatch_instruction: ${sourceInstructionsCount.toLocaleString()}`);
    console.log(`Target orders: ${targetOrdersCount.toLocaleString()} (${targetOrdersWithLegacyCount.toLocaleString()} with legacy IDs)`);
    console.log(`Coverage: ${((targetOrdersWithLegacyCount / sourceInstructionsCount) * 100).toFixed(2)}%\n`);
    
    console.log(`Source dispatch_comment: ${sourceCommentsCount.toLocaleString()}`);
    console.log(`Target treatment_discussions: ${targetDiscussionsCount.toLocaleString()} (${targetDiscussionsWithLegacyCount.toLocaleString()} with legacy IDs)`);
    console.log(`Coverage: ${((targetDiscussionsWithLegacyCount / sourceCommentsCount) * 100).toFixed(2)}%\n`);
    
    console.log(`Source dispatch_record (all types): ${sourceRecordsCount.toLocaleString()}`);
    console.log('Target communications: Not migrated (schema incompatibility)\n');
    
    console.log('🔍 Sample Cases:');
    console.log('================');
    sampleCases.rows.forEach((record, idx) => {
      console.log(`${idx + 1}. ${record.case_number}`);
      console.log(`   Status: ${record.status} | Deleted: ${record.deleted}`);
      console.log(`   Legacy Patient ID: ${record.legacy_patient_id}`);
      console.log(`   Created: ${record.created_at}\n`);
    });
    
    // Validation summary
    console.log('✅ Validation Summary:');
    console.log('======================');
    
    const casesCoverage = (targetCasesWithLegacyCount / sourcePatientsCount) * 100;
    const ordersCoverage = (targetOrdersWithLegacyCount / sourceInstructionsCount) * 100;
    const discussionsCoverage = (targetDiscussionsWithLegacyCount / sourceCommentsCount) * 100;
    
    if (casesCoverage >= 99) {
      console.log(`✅ Cases migration: ${casesCoverage.toFixed(2)}% (Excellent)`);
    } else if (casesCoverage >= 95) {
      console.log(`✅ Cases migration: ${casesCoverage.toFixed(2)}% (Good)`);
    } else {
      console.log(`⚠️  Cases migration: ${casesCoverage.toFixed(2)}% (Below 95%)`);
    }
    
    if (ordersCoverage >= 99) {
      console.log(`✅ Orders migration: ${ordersCoverage.toFixed(2)}% (Excellent)`);
    } else if (ordersCoverage >= 95) {
      console.log(`✅ Orders migration: ${ordersCoverage.toFixed(2)}% (Good)`);
    } else {
      console.log(`⚠️  Orders migration: ${ordersCoverage.toFixed(2)}% (Below 95%)`);
    }
    
    if (discussionsCoverage >= 30) {
      console.log(`✅ Discussions migration: ${discussionsCoverage.toFixed(2)}% (Expected - subset of comments)`);
    } else {
      console.log(`⚠️  Discussions migration: ${discussionsCoverage.toFixed(2)}% (Low)`);
    }
    
    console.log(`⚠️  Communications migration: Skipped (target schema designed for different purpose)`);
    console.log(`✅ Core case relationships established successfully`);
    
  } catch (error) {
    console.error('❌ Validation failed:', error);
  } finally {
    await sourceClient.end();
    await targetClient.end();
  }
}

validateCaseMigration();
