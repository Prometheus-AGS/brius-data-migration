import { Client } from 'pg';

const sourceClient = new Client({
  host: 'test.brius.com',
  port: 5432,
  database: 'mdw_db',
  user: 'mdw_ai',
  password: 'xGXmckHY',
});

async function analyzeDispatchState() {
  try {
    await sourceClient.connect();
    console.log('Connected to source database');
    
    console.log('=== Analyzing dispatch_state table ===\n');
    
    // Get table schema
    const schemaResult = await sourceClient.query(`
      SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'dispatch_state' 
      ORDER BY ordinal_position;
    `);
    
    console.log('dispatch_state table columns:');
    schemaResult.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
    });
    
    // Get total count
    const countResult = await sourceClient.query('SELECT COUNT(*) as total FROM dispatch_state');
    const totalStates = parseInt(countResult.rows[0].total);
    console.log(`\nTotal dispatch_state records: ${totalStates.toLocaleString()}`);
    
    if (totalStates === 0) {
      console.log('No dispatch_state records found.');
      return;
    }
    
    // Sample records
    const sampleResult = await sourceClient.query(`
      SELECT * FROM dispatch_state 
      ORDER BY RANDOM() 
      LIMIT 5;
    `);
    
    console.log('\nSample dispatch_state records:');
    sampleResult.rows.forEach((row, i) => {
      console.log(`\nSample ${i + 1}:`);
      Object.keys(row).forEach(key => {
        let value = row[key];
        if (typeof value === 'string' && value.length > 100) {
          value = value.substring(0, 100) + '...';
        }
        console.log(`  ${key}: ${value}`);
      });
    });
    
    // Analyze state values/types
    try {
      const stateAnalysis = await sourceClient.query(`
        SELECT 
          state,
          COUNT(*) as count
        FROM dispatch_state 
        GROUP BY state 
        ORDER BY count DESC
        LIMIT 20;
      `);
      
      console.log('\nState distribution:');
      stateAnalysis.rows.forEach(row => {
        console.log(`  State "${row.state}": ${parseInt(row.count).toLocaleString()} records`);
      });
    } catch (e) {
      console.log('\nCould not analyze state column - may not exist or have different name');
    }
    
    // Check for instruction relationships
    try {
      const instructionAnalysis = await sourceClient.query(`
        SELECT 
          COUNT(*) as total_states,
          COUNT(DISTINCT instruction_id) as unique_orders,
          MIN(instruction_id) as min_order,
          MAX(instruction_id) as max_order
        FROM dispatch_state 
        WHERE instruction_id IS NOT NULL;
      `);
      
      console.log('\nInstruction relationships:');
      console.log(`  Total states: ${parseInt(instructionAnalysis.rows[0].total_states).toLocaleString()}`);
      console.log(`  Unique orders: ${parseInt(instructionAnalysis.rows[0].unique_orders).toLocaleString()}`);
      console.log(`  Order ID range: ${instructionAnalysis.rows[0].min_order} - ${instructionAnalysis.rows[0].max_order}`);
    } catch (e) {
      console.log('\nCould not analyze instruction relationships');
    }
    
    // Check for timestamps
    try {
      const timestampAnalysis = await sourceClient.query(`
        SELECT 
          MIN(created_at) as earliest,
          MAX(created_at) as latest
        FROM dispatch_state;
      `);
      
      console.log('\nTimestamp range:');
      console.log(`  Earliest: ${timestampAnalysis.rows[0].earliest}`);
      console.log(`  Latest: ${timestampAnalysis.rows[0].latest}`);
    } catch (e) {
      console.log('\nCould not analyze timestamps');
    }
    
    // States per order analysis
    try {
      const statesPerOrder = await sourceClient.query(`
        SELECT 
          instruction_id,
          COUNT(*) as state_count
        FROM dispatch_state 
        WHERE instruction_id IS NOT NULL
        GROUP BY instruction_id
        ORDER BY state_count DESC
        LIMIT 10;
      `);
      
      console.log('\nOrders with most state changes:');
      statesPerOrder.rows.forEach((row, i) => {
        console.log(`  ${i + 1}. Order ${row.instruction_id}: ${row.state_count} state changes`);
      });
    } catch (e) {
      console.log('\nCould not analyze states per order');
    }
    
    // Check for additional metadata columns
    const metadataColumns = ['user_id', 'comment', 'notes', 'metadata', 'reason', 'actor_id'];
    for (const col of metadataColumns) {
      try {
        const colCheck = await sourceClient.query(`
          SELECT COUNT(*) as count FROM dispatch_state WHERE ${col} IS NOT NULL LIMIT 1
        `);
        console.log(`\n${col} column exists and has data`);
      } catch (e) {
        // Column doesn't exist
      }
    }
    
  } catch (error) {
    console.error('Error analyzing dispatch_state:', error);
  } finally {
    await sourceClient.end();
  }
}

analyzeDispatchState().catch(console.error);
