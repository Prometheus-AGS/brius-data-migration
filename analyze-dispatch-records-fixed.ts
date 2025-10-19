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

async function analyzeDispatchRecords() {
  try {
    await sourceClient.connect();
    console.log('Connected to source database');

    // Get total count
    const countResult = await sourceClient.query('SELECT COUNT(*) as total FROM dispatch_record');
    console.log('Total dispatch_record rows:', countResult.rows[0].total);

    // Analyze all columns to understand structure
    const structureResult = await sourceClient.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'dispatch_record'
      ORDER BY ordinal_position;
    `);

    console.log('\nTable structure:');
    structureResult.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type} (${row.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
    });

    // Analyze target_type_id relationships
    const targetTypeResult = await sourceClient.query(`
      SELECT
        dt.id as target_type_id,
        dt.app_label,
        dt.model,
        COUNT(dr.id) as record_count
      FROM django_content_type dt
      LEFT JOIN dispatch_record dr ON dr.target_type_id = dt.id
      GROUP BY dt.id, dt.app_label, dt.model
      HAVING COUNT(dr.id) > 0
      ORDER BY record_count DESC;
    `);

    console.log('\nTarget types with dispatch_record entries:');
    targetTypeResult.rows.forEach(row => {
      console.log(`  ${row.target_type_id}: ${row.app_label}.${row.model} (${row.record_count} records)`);
    });

    // Analyze message types
    const typeResult = await sourceClient.query(`
      SELECT
        type,
        COUNT(*) as count,
        MIN(created_at) as earliest,
        MAX(created_at) as latest
      FROM dispatch_record
      WHERE type IS NOT NULL
      GROUP BY type
      ORDER BY count DESC;
    `);

    console.log('\nMessage types:');
    typeResult.rows.forEach(row => {
      console.log(`  Type ${row.type}: ${row.count} records (${row.earliest?.toISOString().split('T')[0]} to ${row.latest?.toISOString().split('T')[0]})`);
    });

    // Sample records by type and target type
    console.log('\nSample records by type:');
    for (const typeRow of typeResult.rows.slice(0, 5)) {
      console.log(`\n--- Type ${typeRow.type} ---`);

      const sampleResult = await sourceClient.query(`
        SELECT
          dr.id,
          dr.target_id,
          dr.author_id,
          SUBSTRING(dr.text, 1, 100) as text_sample,
          dr.created_at,
          dr.target_type_id,
          tt.app_label || '.' || tt.model as target_type
        FROM dispatch_record dr
        LEFT JOIN django_content_type tt ON dr.target_type_id = tt.id
        WHERE dr.type = $1
        ORDER BY dr.created_at DESC
        LIMIT 3;
      `, [typeRow.type]);

      sampleResult.rows.forEach((row, i) => {
        console.log(`  Sample ${i + 1}:`, {
          id: row.id,
          target_id: row.target_id,
          author_id: row.author_id,
          text_sample: row.text_sample + (row.text_sample?.length === 100 ? '...' : ''),
          created: row.created_at?.toISOString(),
          target_type_id: row.target_type_id,
          target_type: row.target_type
        });
      });
    }

    // Check for relationships to existing migrated entities
    console.log('\n=== RELATIONSHIP ANALYSIS ===');

    // Check patient relationships (target_type_id = patient model)
    const patientTypeResult = await sourceClient.query(`
      SELECT id FROM django_content_type
      WHERE app_label = 'brius' AND model = 'patient'
    `);

    if (patientTypeResult.rows.length > 0) {
      const patientTypeId = patientTypeResult.rows[0].id;
      const patientRecordsResult = await sourceClient.query(`
        SELECT COUNT(*) as count FROM dispatch_record
        WHERE target_type_id = $1
      `, [patientTypeId]);
      console.log(`Patient-related records (target_type_id=${patientTypeId}):`, patientRecordsResult.rows[0].count);
    }

    // Check instruction relationships
    const instructionTypeResult = await sourceClient.query(`
      SELECT id FROM django_content_type
      WHERE app_label = 'brius' AND model = 'instruction'
    `);

    if (instructionTypeResult.rows.length > 0) {
      const instructionTypeId = instructionTypeResult.rows[0].id;
      const instructionRecordsResult = await sourceClient.query(`
        SELECT COUNT(*) as count FROM dispatch_record
        WHERE target_type_id = $1
      `, [instructionTypeId]);
      console.log(`Instruction-related records (target_type_id=${instructionTypeId}):`, instructionRecordsResult.rows[0].count);
    }

    // Check user relationships
    const userTypeResult = await sourceClient.query(`
      SELECT id FROM django_content_type
      WHERE app_label = 'auth' AND model = 'user'
    `);

    if (userTypeResult.rows.length > 0) {
      const userTypeId = userTypeResult.rows[0].id;
      const userRecordsResult = await sourceClient.query(`
        SELECT COUNT(*) as count FROM dispatch_record
        WHERE target_type_id = $1
      `, [userTypeId]);
      console.log(`User-related records (target_type_id=${userTypeId}):`, userRecordsResult.rows[0].count);
    }

    // Combination analysis - type + target_type_id
    const combinationResult = await sourceClient.query(`
      SELECT
        dr.type,
        dr.target_type_id,
        tt.app_label || '.' || tt.model as target_type,
        COUNT(*) as count
      FROM dispatch_record dr
      LEFT JOIN django_content_type tt ON dr.target_type_id = tt.id
      WHERE dr.type IS NOT NULL AND dr.target_type_id IS NOT NULL
      GROUP BY dr.type, dr.target_type_id, tt.app_label, tt.model
      ORDER BY count DESC
      LIMIT 10;
    `);

    console.log('\n=== TYPE + TARGET COMBINATIONS (Top 10) ===');
    combinationResult.rows.forEach(row => {
      console.log(`  Type ${row.type} → ${row.target_type} (${row.target_type_id}): ${row.count} records`);
    });

    // Date range analysis
    const dateRangeResult = await sourceClient.query(`
      SELECT
        MIN(created_at) as earliest,
        MAX(created_at) as latest,
        COUNT(*) as total
      FROM dispatch_record;
    `);

    console.log('\n=== DATE RANGE ANALYSIS ===');
    console.log('Earliest record:', dateRangeResult.rows[0].earliest);
    console.log('Latest record:', dateRangeResult.rows[0].latest);
    console.log('Total records:', dateRangeResult.rows[0].total);

    // Author analysis
    const authorResult = await sourceClient.query(`
      SELECT
        COUNT(DISTINCT author_id) as unique_authors,
        COUNT(*) as total_with_authors,
        COUNT(*) FILTER (WHERE author_id IS NULL) as without_authors
      FROM dispatch_record;
    `);

    console.log('\n=== AUTHOR ANALYSIS ===');
    console.log('Unique authors:', authorResult.rows[0].unique_authors);
    console.log('Records with authors:', authorResult.rows[0].total_with_authors);
    console.log('Records without authors:', authorResult.rows[0].without_authors);

    // Check for existing message tables in target
    console.log('\n=== EXISTING MESSAGE MIGRATIONS ===');
    console.log('Based on the files I found, these message types may already be partially migrated:');
    console.log('- case_messages (from dispatch_comment)');
    console.log('- Some clinical_communications, team_communications, system_messages');
    console.log('- Need to check what dispatch_record types are NOT yet migrated');

  } catch (error) {
    console.error('Error analyzing dispatch_record:', error);
  } finally {
    await sourceClient.end();
  }
}

analyzeDispatchRecords().catch(console.error);