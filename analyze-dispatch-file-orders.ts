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
    
    // Get total counts
    const totalFiles = await sourceClient.query('SELECT COUNT(*) as count FROM dispatch_file');
    const filesWithOrders = await sourceClient.query('SELECT COUNT(*) as count FROM dispatch_file WHERE instruction_id IS NOT NULL');
    const filesWithoutOrders = await sourceClient.query('SELECT COUNT(*) as count FROM dispatch_file WHERE instruction_id IS NULL');
    
    console.log('File Distribution:');
    console.log(`  Total files: ${parseInt(totalFiles.rows[0].count).toLocaleString()}`);
    console.log(`  Files with orders: ${parseInt(filesWithOrders.rows[0].count).toLocaleString()}`);
    console.log(`  Files without orders: ${parseInt(filesWithoutOrders.rows[0].count).toLocaleString()}`);
    
    // Analyze file types and patterns
    const fileTypeAnalysis = await sourceClient.query(`
      SELECT 
        CASE 
          WHEN file_name LIKE '%.jpg' OR file_name LIKE '%.jpeg' THEN 'JPEG'
          WHEN file_name LIKE '%.png' THEN 'PNG'
          WHEN file_name LIKE '%.pdf' THEN 'PDF'
          WHEN file_name LIKE '%.zip' THEN 'ZIP'
          WHEN file_name LIKE '%.stl' THEN 'STL'
          WHEN file_name LIKE '%.ply' THEN 'PLY'
          ELSE 'OTHER'
        END as file_type,
        COUNT(*) as count
      FROM dispatch_file 
      WHERE instruction_id IS NOT NULL
      GROUP BY 1
      ORDER BY count DESC;
    `);
    
    console.log('\nFile Types (with orders):');
    fileTypeAnalysis.rows.forEach(row => {
      console.log(`  ${row.file_type}: ${parseInt(row.count).toLocaleString()}`);
    });
    
    // Sample files with orders
    const sampleFiles = await sourceClient.query(`
      SELECT 
        id, 
        file_name, 
        instruction_id,
        created_date,
        file_size,
        notes
      FROM dispatch_file 
      WHERE instruction_id IS NOT NULL
      ORDER BY created_date DESC
      LIMIT 5;
    `);
    
    console.log('\nSample files with orders:');
    sampleFiles.rows.forEach((file, i) => {
      console.log(`  ${i + 1}. File ID: ${file.id}`);
      console.log(`     Name: ${file.file_name}`);
      console.log(`     Order ID: ${file.instruction_id}`);
      console.log(`     Size: ${file.file_size} bytes`);
      console.log(`     Notes: ${file.notes || 'None'}`);
      console.log(`     Created: ${file.created_date}`);
      console.log('');
    });
    
    // Check for files with notes/metadata
    const filesWithNotes = await sourceClient.query(`
      SELECT COUNT(*) as count 
      FROM dispatch_file 
      WHERE instruction_id IS NOT NULL 
      AND notes IS NOT NULL 
      AND notes != '';
    `);
    
    console.log(`Files with notes: ${parseInt(filesWithNotes.rows[0].count).toLocaleString()}`);
    
    // Sample files with notes
    if (parseInt(filesWithNotes.rows[0].count) > 0) {
      const sampleNotesFiles = await sourceClient.query(`
        SELECT id, file_name, instruction_id, notes
        FROM dispatch_file 
        WHERE instruction_id IS NOT NULL 
        AND notes IS NOT NULL 
        AND notes != ''
        LIMIT 3;
      `);
      
      console.log('\nSample files with notes:');
      sampleNotesFiles.rows.forEach((file, i) => {
        console.log(`  ${i + 1}. File: ${file.file_name}`);
        console.log(`     Order: ${file.instruction_id}`);
        console.log(`     Notes: ${file.notes.substring(0, 100)}${file.notes.length > 100 ? '...' : ''}`);
      });
    }
    
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
    
    // Check for additional metadata columns
    const schemaInfo = await sourceClient.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'dispatch_file' 
      AND column_name IN ('description', 'metadata', 'category', 'file_type', 'tags')
      ORDER BY column_name;
    `);
    
    if (schemaInfo.rows.length > 0) {
      console.log('\nAdditional metadata columns found:');
      schemaInfo.rows.forEach(col => {
        console.log(`  ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
      });
    }
    
  } catch (error) {
    console.error('Error analyzing dispatch_file orders:', error);
  } finally {
    await sourceClient.end();
  }
}

analyzeDispatchFileOrders().catch(console.error);
