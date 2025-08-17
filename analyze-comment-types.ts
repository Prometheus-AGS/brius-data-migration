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

async function analyzeCommentTypes() {
  console.log('🔍 Analyzing comment types and patterns in source database...\n');

  try {
    await sourceDb.connect();

    // 1. Analyze dispatch_comment table relationships and types
    console.log('📋 DISPATCH_COMMENT Analysis:');
    console.log('=====================================');
    
    // Check what dispatch_comment links to
    const commentStructureQuery = `
      SELECT 
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns 
      WHERE table_name = 'dispatch_comment'
      ORDER BY ordinal_position;
    `;
    
    const commentStructure = await sourceDb.query(commentStructureQuery);
    console.log('\nStructure:');
    commentStructure.rows.forEach(row => {
      console.log(`  • ${row.column_name}: ${row.data_type} ${row.is_nullable === 'YES' ? '(nullable)' : '(required)'}`);
    });

    // Analyze relationships - what does plan_id reference?
    const planRelationshipQuery = `
      SELECT 
        COUNT(*) as total_comments,
        COUNT(DISTINCT plan_id) as unique_plans,
        COUNT(DISTINCT author_id) as unique_authors,
        MIN(created_at) as earliest_comment,
        MAX(created_at) as latest_comment
      FROM dispatch_comment;
    `;
    
    const planStats = await sourceDb.query(planRelationshipQuery);
    const stats = planStats.rows[0];
    console.log('\nRelationship Analysis:');
    console.log(`  • Total comments: ${stats.total_comments}`);
    console.log(`  • Unique treatment plans: ${stats.unique_plans}`);
    console.log(`  • Unique authors: ${stats.unique_authors}`);
    console.log(`  • Date range: ${stats.earliest_comment?.toISOString()?.split('T')[0]} to ${stats.latest_comment?.toISOString()?.split('T')[0]}`);

    // Check if there are different comment patterns or types
    const commentPatternsQuery = `
      SELECT 
        CASE 
          WHEN LENGTH(text) <= 50 THEN 'short'
          WHEN LENGTH(text) <= 200 THEN 'medium'
          ELSE 'long'
        END as comment_length,
        COUNT(*) as count,
        ROUND(AVG(LENGTH(text))) as avg_length,
        COUNT(DISTINCT author_id) as unique_authors
      FROM dispatch_comment
      WHERE text IS NOT NULL
      GROUP BY 1
      ORDER BY count DESC;
    `;
    
    const patterns = await sourceDb.query(commentPatternsQuery);
    console.log('\nComment Length Distribution:');
    patterns.rows.forEach(row => {
      console.log(`  • ${row.comment_length} (avg ${row.avg_length} chars): ${row.count} comments by ${row.unique_authors} authors`);
    });

    // 2. Analyze dispatch_note table
    console.log('\n📝 DISPATCH_NOTE Analysis:');
    console.log('==========================');
    
    const noteStructureQuery = `
      SELECT 
        column_name,
        data_type,
        is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'dispatch_note'
      ORDER BY ordinal_position;
    `;
    
    const noteStructure = await sourceDb.query(noteStructureQuery);
    console.log('\nStructure:');
    noteStructure.rows.forEach(row => {
      console.log(`  • ${row.column_name}: ${row.data_type} ${row.is_nullable === 'YES' ? '(nullable)' : '(required)'}`);
    });

    // Get note statistics and relationships
    const noteStatsQuery = `
      SELECT 
        COUNT(*) as total_notes,
        COUNT(DISTINCT author_id) as unique_authors,
        MIN(created_at) as earliest_note,
        MAX(created_at) as latest_note
      FROM dispatch_note;
    `;
    
    const noteStats = await sourceDb.query(noteStatsQuery);
    const nStats = noteStats.rows[0];
    console.log('\nNote Statistics:');
    console.log(`  • Total notes: ${nStats.total_notes}`);
    console.log(`  • Unique authors: ${nStats.unique_authors}`);
    console.log(`  • Date range: ${nStats.earliest_note?.toISOString()?.split('T')[0]} to ${nStats.latest_note?.toISOString()?.split('T')[0]}`);

    // Check what dispatch_note references (see foreign keys)
    const noteForeignKeysQuery = `
      SELECT 
        column_name,
        COUNT(DISTINCT ${sourceDb.escapeIdentifier('column_name')}) as unique_refs
      FROM dispatch_note 
      WHERE ${sourceDb.escapeIdentifier('column_name')} IS NOT NULL
      GROUP BY column_name;
    `;
    
    // Since we don't know the exact foreign key columns, let's get sample data
    const noteSampleQuery = `SELECT * FROM dispatch_note LIMIT 5;`;
    const noteSample = await sourceDb.query(noteSampleQuery);
    console.log('\nSample dispatch_note records:');
    console.log(noteSample.rows);

    // 3. Check for other comment-like tables
    console.log('\n🔍 OTHER COMMENT-LIKE STRUCTURES:');
    console.log('===================================');
    
    // Look for any other tables with text/comment fields
    const otherCommentTablesQuery = `
      SELECT DISTINCT
        t.table_name,
        c.column_name,
        c.data_type
      FROM information_schema.tables t
      JOIN information_schema.columns c ON t.table_name = c.table_name
      WHERE t.table_schema = 'public' 
        AND t.table_type = 'BASE TABLE'
        AND t.table_name LIKE 'dispatch_%'
        AND t.table_name NOT IN ('dispatch_comment', 'dispatch_note')
        AND (
          c.data_type = 'text' AND
          (c.column_name ILIKE '%text%' OR
           c.column_name ILIKE '%content%' OR
           c.column_name ILIKE '%body%' OR
           c.column_name ILIKE '%message%')
        )
      ORDER BY t.table_name, c.column_name;
    `;
    
    const otherComments = await sourceDb.query(otherCommentTablesQuery);
    if (otherComments.rows.length > 0) {
      console.log('\nOther tables with comment-like text fields:');
      otherComments.rows.forEach(row => {
        console.log(`  • ${row.table_name}.${row.column_name} (${row.data_type})`);
      });
    } else {
      console.log('\nNo other comment-like text fields found in dispatch_* tables.');
    }

    // 4. Relationship analysis - do comments relate to different entity types?
    console.log('\n🔗 RELATIONSHIP ANALYSIS:');
    console.log('=========================');
    
    // Check if dispatch_comment only relates to plans or other entities too
    const commentRelationshipsQuery = `
      SELECT 
        'dispatch_comment -> dispatch_plan' as relationship,
        COUNT(*) as total_links,
        COUNT(DISTINCT plan_id) as unique_targets
      FROM dispatch_comment;
    `;
    
    const relationships = await sourceDb.query(commentRelationshipsQuery);
    console.log('\nComment Relationships:');
    relationships.rows.forEach(row => {
      console.log(`  • ${row.relationship}: ${row.total_links} links to ${row.unique_targets} targets`);
    });

    // Check if there are any threading/reply patterns
    const threadingQuery = `
      SELECT 
        date_trunc('day', created_at) as comment_date,
        plan_id,
        COUNT(*) as comments_per_plan_per_day,
        COUNT(DISTINCT author_id) as authors_per_day
      FROM dispatch_comment
      GROUP BY date_trunc('day', created_at), plan_id
      HAVING COUNT(*) > 1
      ORDER BY comments_per_plan_per_day DESC
      LIMIT 10;
    `;
    
    const threading = await sourceDb.query(threadingQuery);
    console.log('\nPotential Discussion Threading (multiple comments per plan per day):');
    if (threading.rows.length > 0) {
      threading.rows.forEach(row => {
        console.log(`  • Plan ${row.plan_id} on ${row.comment_date?.toISOString()?.split('T')[0]}: ${row.comments_per_plan_per_day} comments by ${row.authors_per_day} authors`);
      });
    } else {
      console.log('  • No obvious threading patterns found');
    }

    // 5. Recommendation analysis
    console.log('\n🎯 ARCHITECTURE RECOMMENDATIONS:');
    console.log('=================================');
    
    const hasMultipleCommentTypes = noteSample.rows.length > 0;
    const hasThreadingPatterns = threading.rows.length > 0;
    const commentCount = parseInt(stats.total_comments);
    const noteCount = parseInt(nStats.total_notes);
    
    console.log(`\nData Summary:`);
    console.log(`  • dispatch_comment: ${commentCount} records (linked to treatment plans)`);
    console.log(`  • dispatch_note: ${noteCount} records (structure TBD)`);
    console.log(`  • Threading patterns: ${hasThreadingPatterns ? 'Yes' : 'No'}`);
    console.log(`  • Multiple comment types: ${hasMultipleCommentTypes ? 'Yes' : 'No'}`);

    if (hasMultipleCommentTypes || hasThreadingPatterns || (commentCount + noteCount) > 10000) {
      console.log('\n✅ RECOMMENDATION: Create normalized comment architecture');
      console.log('   • Root "comments" table with comment_type field');
      console.log('   • Specialized relationship tables (treatment_discussions, etc.)');
      console.log('   • Benefits: Extensible, supports threading, unified comment management');
    } else {
      console.log('\n📋 RECOMMENDATION: Single table approach may suffice');
      console.log('   • Direct migration to treatment_discussions');
      console.log('   • Simpler but less extensible');
    }

  } catch (error) {
    console.error('❌ Error analyzing comment types:', error);
  } finally {
    await sourceDb.end();
  }
}

analyzeCommentTypes().catch(console.error);
