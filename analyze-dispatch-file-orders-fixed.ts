import { Client } from 'pg';

const sourceClient = new Client({
  host: 'test.brius.com',
  port: 5432,
  database: 'mdw_db',
  user: 'mdw_ai',
  password: 'xGXmckHY',
});

async function analyzeDispatchFileOrders() {
  try {
    await sourceClient.connect();
    console.log('Connected to source database');
    
    console.log('=== Analyzing dispatch_file → order relationships ===\n');
    
    // First, get the schema to see what columns exist
    const schemaResult = await sourceClient.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'dispatch_file' 
      ORDER BY ordinal_position;
    `);
    
    console.log('dispatch_file table columns:');
    schemaResult.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
    });
    
    // Get total counts
    const totalFiles = await sourceClient.query('SELECT COUNT(*) as count FROM dispatch_file');
    const filesWithOrders = await sourceClient.query('SELECT COUNT(*) as count FROM dispatch_file WHERE instruction_id IS NOT NULL');
    const filesWithoutOrders = await sourceClient.query('SELECT COUNT(*) as count FROM dispatch_file WHERE instruction_id IS NULL');
    
    console.log('\nFile Distribution:');
    console.log(`  Total files: ${parseInt(totalFiles.rows[0].count).toLocaleString()}`);
    console.log(`  Files with orders: ${parseInt(filesWithOrders.rows[0].count).toLocaleString()}`);
    console.log(`  Files without orders: ${parseInt(filesWithoutOrders.rows[0].count).toLocaleString()}`);
    
    // Sample files with orders using correct column names
    const sampleFiles = await sourceClient.query(`
      SELECT *
      FROM dispatch_file 
      WHERE instruction_id IS NOT NULL
      ORDER BY id DESC
      LIMIT 3;
    `);
    
    console.log('\nSample files with orders:');
    sampleFiles.rows.forEach((file, i) => {
      console.log(`\n  Sample ${i + 1}:`);
      Object.keys(file).forEach(key => {
        let value = file[key];
        if (typeof value === 'string' && value.length > 100) {
          value = value.substring(0, 100) + '...';
        }
        console.log(`    ${key}: ${value}`);
      });
    });
    
    // Check order ID ranges
    const orderIdRange = await sourceClient.query(`
      SELECT 
        MIN(instruction_id) as min_order,
        MAX(instruction_id) as max_order,
        COUNT(DISTINCT instruction_id) as unique_orders
      FROM dispatch_file 
      WHERE instruction_id IS NOT NULL;
    `);
    
    console.log('\nOrder ID Analysis:');
    console.log(`  Min order ID: ${orderIdRange.rows[0].min_order}`);
    console.log(`  Max order ID: ${orderIdRange.rows[0].max_order}`);
    console.log(`  Unique orders with files: ${parseInt(orderIdRange.rows[0].unique_orders).toLocaleString()}`);
    
    // Files per order distribution
    const filesPerOrder = await sourceClient.query(`
      SELECT 
        instruction_id,
        COUNT(*) as file_count
      FROM dispatch_file 
      WHERE instruction_id IS NOT NULL
      GROUP BY instruction_id
      ORDER BY file_count DESC
      LIMIT 10;
    `);
    
    console.log('\nOrders with most files:');
    filesPerOrder.rows.forEach((order, i) => {
      console.log(`  ${i + 1}. Order ${order.instruction_id}: ${order.file_count} files`);
    });
    
    // Average files per order
    const avgFiles = await sourceClient.query(`
      SELECT AVG(file_count)::NUMERIC(10,2) as avg_files
      FROM (
        SELECT instruction_id, COUNT(*) as file_count
        FROM dispatch_file 
        WHERE instruction_id IS NOT NULL
        GROUP BY instruction_id
      ) subq;
    `);
    
    console.log(`\nAverage files per order: ${avgFiles.rows[0].avg_files}`);
    
  } catch (error) {
    console.error('Error analyzing dispatch_file orders:', error);
  } finally {
    await sourceClient.end();
  }
}

analyzeDispatchFileOrders().catch(console.error);
