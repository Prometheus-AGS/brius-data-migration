import { Client } from 'pg';

// Source database connection
const sourceClient = new Client({
  host: 'test.brius.com',
  port: 5432,
  database: 'mdw_db',
  user: 'mdw_ai',
  password: 'xGXmckHY',
});

async function analyzeTypes() {
  try {
    await sourceClient.connect();
    console.log('Connected to source database');
    
    // Analyze target_type_id values
    const targetTypesResult = await sourceClient.query(`
      SELECT target_type_id, COUNT(*) as count
      FROM dispatch_record 
      WHERE target_type_id IS NOT NULL
      GROUP BY target_type_id 
      ORDER BY count DESC;
    `);
    
    console.log('\nTarget type IDs:');
    targetTypesResult.rows.forEach(row => {
      console.log(`  target_type_id ${row.target_type_id}: ${row.count} records`);
    });
    
    // Analyze type values  
    const typesResult = await sourceClient.query(`
      SELECT type, COUNT(*) as count
      FROM dispatch_record 
      WHERE type IS NOT NULL
      GROUP BY type 
      ORDER BY count DESC;
    `);
    
    console.log('\nMessage types:');
    typesResult.rows.forEach(row => {
      console.log(`  type ${row.type}: ${row.count} records`);
    });
    
    // Check if there's a django_content_type table to understand target_type_id
    try {
      const contentTypesResult = await sourceClient.query(`
        SELECT id, app_label, model 
        FROM django_content_type 
        WHERE id IN (${targetTypesResult.rows.map(r => r.target_type_id).join(',')})
        ORDER BY id;
      `);
      
      console.log('\nContent types (target_type_id mapping):');
      contentTypesResult.rows.forEach(row => {
        console.log(`  ${row.id}: ${row.app_label}.${row.model}`);
      });
    } catch (e) {
      console.log('\nNo django_content_type table found');
    }
    
    // Sample records by target_type_id
    console.log('\nSample records by target_type_id:');
    for (const targetType of targetTypesResult.rows.slice(0, 3)) {
      console.log(`\n--- target_type_id: ${targetType.target_type_id} ---`);
      
      const sampleResult = await sourceClient.query(`
        SELECT id, target_id, type, text, author_id, created_at
        FROM dispatch_record 
        WHERE target_type_id = $1
        ORDER BY created_at DESC
        LIMIT 2;
      `, [targetType.target_type_id]);
      
      sampleResult.rows.forEach((row, i) => {
        console.log(`  Sample ${i + 1}:`, {
          id: row.id,
          target_id: row.target_id,
          type: row.type,
          text_preview: row.text.substring(0, 80) + (row.text.length > 80 ? '...' : ''),
          author_id: row.author_id
        });
      });
    }
    
  } catch (error) {
    console.error('Error analyzing types:', error);
  } finally {
    await sourceClient.end();
  }
}

analyzeTypes().catch(console.error);
