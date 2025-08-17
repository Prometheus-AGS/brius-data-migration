import { Client } from 'pg';

// Source database connection
const sourceClient = new Client({
  host: 'test.brius.com',
  port: 5432,
  database: 'mdw_db',
  user: 'mdw_ai',
  password: 'xGXmckHY',
});

async function analyzeDispatchRecords() {
  try {
    await sourceClient.connect();
    console.log('Connected to source database');
    
    // Get total count
    const countResult = await sourceClient.query('SELECT COUNT(*) as total FROM dispatch_record');
    console.log('Total dispatch_record rows:', countResult.rows[0].total);
    
    // Analyze content types
    const contentTypesResult = await sourceClient.query(`
      SELECT 
        dc.app_label,
        dc.model,
        COUNT(*) as count
      FROM dispatch_record dr
      JOIN django_content_type dc ON dr.content_type_id = dc.id
      GROUP BY dc.app_label, dc.model
      ORDER BY count DESC;
    `);
    
    console.log('\nContent types in dispatch_record:');
    contentTypesResult.rows.forEach(row => {
      console.log(`  ${row.app_label}.${row.model}: ${row.count} records`);
    });
    
    // Sample records by content type
    console.log('\nSample records:');
    for (const contentType of contentTypesResult.rows) {
      console.log(`\n--- ${contentType.app_label}.${contentType.model} ---`);
      
      const sampleResult = await sourceClient.query(`
        SELECT 
          dr.id,
          dr.object_id,
          dr.message,
          dr.created,
          dr.updated,
          dc.app_label,
          dc.model
        FROM dispatch_record dr
        JOIN django_content_type dc ON dr.content_type_id = dc.id
        WHERE dc.app_label = $1 AND dc.model = $2
        ORDER BY dr.created DESC
        LIMIT 3;
      `, [contentType.app_label, contentType.model]);
      
      sampleResult.rows.forEach((row, i) => {
        console.log(`  Sample ${i + 1}:`, {
          id: row.id,
          object_id: row.object_id,
          message_preview: row.message.substring(0, 100) + (row.message.length > 100 ? '...' : ''),
          created: row.created
        });
      });
    }
    
    // Check date ranges
    const dateRangeResult = await sourceClient.query(`
      SELECT 
        MIN(created) as earliest,
        MAX(created) as latest,
        COUNT(*) as total
      FROM dispatch_record;
    `);
    
    console.log('\nDate range:');
    console.log('  Earliest:', dateRangeResult.rows[0].earliest);
    console.log('  Latest:', dateRangeResult.rows[0].latest);
    
  } catch (error) {
    console.error('Error analyzing dispatch_record:', error);
  } finally {
    await sourceClient.end();
  }
}

analyzeDispatchRecords().catch(console.error);
