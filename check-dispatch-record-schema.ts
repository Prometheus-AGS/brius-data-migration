import { Client } from 'pg';

// Source database connection
const sourceClient = new Client({
  host: 'test.brius.com',
  port: 5432,
  database: 'mdw_db',
  user: 'mdw_ai',
  password: 'xGXmckHY',
});

async function checkSchema() {
  try {
    await sourceClient.connect();
    console.log('Connected to source database');
    
    // Check dispatch_record schema
    const schemaResult = await sourceClient.query(`
      SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'dispatch_record' 
      ORDER BY ordinal_position;
    `);
    
    console.log('\ndispatch_record table columns:');
    schemaResult.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
    });
    
    // Get total count
    const countResult = await sourceClient.query('SELECT COUNT(*) as total FROM dispatch_record');
    console.log('\nTotal dispatch_record rows:', countResult.rows[0].total);
    
    // Get sample records
    const sampleResult = await sourceClient.query(`
      SELECT * FROM dispatch_record 
      ORDER BY RANDOM() 
      LIMIT 5;
    `);
    
    console.log('\nSample records:');
    sampleResult.rows.forEach((row, i) => {
      console.log(`\n  Sample ${i + 1}:`);
      Object.keys(row).forEach(key => {
        let value = row[key];
        if (typeof value === 'string' && value.length > 100) {
          value = value.substring(0, 100) + '...';
        }
        console.log(`    ${key}: ${value}`);
      });
    });
    
  } catch (error) {
    console.error('Error checking schema:', error);
  } finally {
    await sourceClient.end();
  }
}

checkSchema().catch(console.error);
