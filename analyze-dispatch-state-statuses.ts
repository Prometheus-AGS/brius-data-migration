import { Client } from 'pg';

const sourceClient = new Client({
  host: 'test.brius.com',
  port: 5432,
  database: 'mdw_db',
  user: 'mdw_ai',
  password: 'xGXmckHY',
});

async function analyzeStatuses() {
  try {
    await sourceClient.connect();
    console.log('Analyzing dispatch_state status values...\n');
    
    // Analyze status values
    const statusAnalysis = await sourceClient.query(`
      SELECT 
        status,
        COUNT(*) as count,
        COUNT(CASE WHEN "on" = true THEN 1 END) as on_count,
        COUNT(CASE WHEN "on" = false THEN 1 END) as off_count
      FROM dispatch_state 
      GROUP BY status 
      ORDER BY status;
    `);
    
    console.log('Status distribution:');
    statusAnalysis.rows.forEach(row => {
      console.log(`  Status ${row.status}: ${parseInt(row.count).toLocaleString()} records (${row.on_count} on, ${row.off_count} off)`);
    });
    
    // Sample recent state changes by status
    console.log('\nRecent state changes by status:');
    const recentStates = await sourceClient.query(`
      SELECT 
        status,
        "on",
        changed_at,
        instruction_id,
        actor_id
      FROM dispatch_state 
      ORDER BY changed_at DESC
      LIMIT 15;
    `);
    
    recentStates.rows.forEach((row, i) => {
      console.log(`  ${i + 1}. Status ${row.status} ${row.on ? 'ON' : 'OFF'} - Order ${row.instruction_id} by actor ${row.actor_id} at ${row.changed_at}`);
    });
    
    // Check for patterns - orders that have multiple status types
    console.log('\nSample order state progression:');
    const orderProgression = await sourceClient.query(`
      SELECT 
        instruction_id,
        status,
        "on",
        changed_at,
        actor_id
      FROM dispatch_state 
      WHERE instruction_id IN (
        SELECT instruction_id 
        FROM dispatch_state 
        GROUP BY instruction_id 
        HAVING COUNT(*) > 3
        LIMIT 3
      )
      ORDER BY instruction_id, changed_at;
    `);
    
    let currentOrder = null;
    orderProgression.rows.forEach(row => {
      if (row.instruction_id !== currentOrder) {
        currentOrder = row.instruction_id;
        console.log(`\n  Order ${row.instruction_id}:`);
      }
      console.log(`    Status ${row.status} ${row.on ? 'ON' : 'OFF'} at ${row.changed_at} by actor ${row.actor_id}`);
    });
    
    // Analyze typical state flows
    const stateFlows = await sourceClient.query(`
      SELECT 
        prev_status,
        next_status,
        COUNT(*) as transition_count
      FROM (
        SELECT 
          instruction_id,
          status as prev_status,
          LEAD(status) OVER (PARTITION BY instruction_id ORDER BY changed_at) as next_status
        FROM dispatch_state
      ) t
      WHERE next_status IS NOT NULL
      GROUP BY prev_status, next_status
      ORDER BY transition_count DESC
      LIMIT 10;
    `);
    
    console.log('\nMost common state transitions:');
    stateFlows.rows.forEach((row, i) => {
      console.log(`  ${i + 1}. Status ${row.prev_status} → ${row.next_status}: ${row.transition_count} times`);
    });
    
  } catch (error) {
    console.error('Error analyzing statuses:', error);
  } finally {
    await sourceClient.end();
  }
}

analyzeStatuses().catch(console.error);
