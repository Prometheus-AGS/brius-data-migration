import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const sourcePool = new Pool({
  host: process.env.SOURCE_DB_HOST!,
  port: parseInt(process.env.SOURCE_DB_PORT!),
  user: process.env.SOURCE_DB_USER!,
  password: process.env.SOURCE_DB_PASSWORD!,
  database: process.env.SOURCE_DB_NAME!
});

const targetPool = new Pool({
  host: process.env.TARGET_DB_HOST!,
  port: parseInt(process.env.TARGET_DB_PORT!),
  user: process.env.TARGET_DB_USER!,
  password: process.env.TARGET_DB_PASSWORD!,
  database: process.env.TARGET_DB_NAME!
});

async function validateCaseStatesMigration() {
  try {
    console.log('🔍 CASE STATES MIGRATION VALIDATION REPORT');
    console.log('==========================================');

    // Source vs Target counts
    const sourceCount = await sourcePool.query('SELECT COUNT(*) as count FROM dispatch_state');
    const targetCount = await targetPool.query('SELECT COUNT(*) as count FROM case_states WHERE legacy_state_id IS NOT NULL');
    
    console.log('\n📊 RECORD COUNTS:');
    console.log(`Source dispatch_state: ${sourceCount.rows[0].count}`);
    console.log(`Target case_states (migrated): ${targetCount.rows[0].count}`);
    console.log(`Migration rate: ${((targetCount.rows[0].count / sourceCount.rows[0].count) * 100).toFixed(2)}%`);

    // Data integrity checks
    console.log('\n🔗 DATA INTEGRITY CHECKS:');
    
    // Check for duplicate legacy IDs
    const duplicateStates = await targetPool.query(`
      SELECT legacy_state_id, COUNT(*) 
      FROM case_states 
      WHERE legacy_state_id IS NOT NULL 
      GROUP BY legacy_state_id 
      HAVING COUNT(*) > 1
    `);
    console.log(`Duplicate legacy state IDs: ${duplicateStates.rows.length}`);
    
    // Check foreign key relationships
    const orphanedStates = await targetPool.query(`
      SELECT COUNT(*) as count 
      FROM case_states 
      WHERE case_id NOT IN (SELECT id FROM cases)
    `);
    console.log(`Orphaned case_states: ${orphanedStates.rows[0].count}`);

    // State distribution analysis
    console.log('\n📈 STATE DISTRIBUTION:');
    const stateDistribution = await targetPool.query(`
      SELECT 
        current_state,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM case_states WHERE legacy_state_id IS NOT NULL), 2) as percentage
      FROM case_states 
      WHERE legacy_state_id IS NOT NULL
      GROUP BY current_state 
      ORDER BY count DESC
    `);
    
    stateDistribution.rows.forEach(row => {
      console.log(`  ${row.current_state}: ${row.count} (${row.percentage}%)`);
    });

    // Timeline analysis
    console.log('\n📅 TIMELINE ANALYSIS:');
    const timelineStats = await targetPool.query(`
      SELECT 
        DATE_TRUNC('year', changed_at) as year,
        COUNT(*) as count
      FROM case_states 
      WHERE legacy_state_id IS NOT NULL
      GROUP BY year 
      ORDER BY year
    `);
    
    console.log('State changes by year:');
    timelineStats.rows.forEach(row => {
      console.log(`  ${row.year.getFullYear()}: ${row.count} state changes`);
    });

    // State transition analysis
    console.log('\n🔄 STATE TRANSITIONS:');
    const transitions = await targetPool.query(`
      SELECT 
        previous_state,
        current_state,
        COUNT(*) as count
      FROM case_states 
      WHERE legacy_state_id IS NOT NULL AND previous_state IS NOT NULL
      GROUP BY previous_state, current_state 
      ORDER BY count DESC
      LIMIT 10
    `);
    
    console.log('Top 10 state transitions:');
    transitions.rows.forEach(row => {
      console.log(`  ${row.previous_state} → ${row.current_state}: ${row.count}`);
    });

    // Actor/Profile mapping success
    console.log('\n👤 ACTOR MAPPING ANALYSIS:');
    const actorStats = await targetPool.query(`
      SELECT 
        COUNT(*) as total_states,
        COUNT(changed_by_id) as states_with_actor,
        ROUND(COUNT(changed_by_id) * 100.0 / COUNT(*), 2) as actor_mapping_rate
      FROM case_states 
      WHERE legacy_state_id IS NOT NULL
    `);
    
    const stats = actorStats.rows[0];
    console.log(`Total migrated states: ${stats.total_states}`);
    console.log(`States with actor mapping: ${stats.states_with_actor}`);
    console.log(`Actor mapping success rate: ${stats.actor_mapping_rate}%`);

    // Sample data validation
    console.log('\n🔍 SAMPLE DATA VALIDATION:');
    const sampleComparison = await sourcePool.query(`
      SELECT id, status, changed_at, actor_id, instruction_id
      FROM dispatch_state 
      WHERE id IN (1, 2, 3)
      ORDER BY id
    `);
    
    const targetSamples = await targetPool.query(`
      SELECT legacy_state_id, current_state, changed_at, changed_by_id, metadata
      FROM case_states 
      WHERE legacy_state_id IN (1, 2, 3)
      ORDER BY legacy_state_id
    `);
    
    console.log('Source vs Target comparison:');
    sampleComparison.rows.forEach((sourceRow, index) => {
      const targetRow = targetSamples.rows[index];
      if (targetRow) {
        console.log(`  State ${sourceRow.id}:`);
        console.log(`    Source: status=${sourceRow.status}, time=${sourceRow.changed_at}`);
        console.log(`    Target: state=${targetRow.current_state}, time=${targetRow.changed_at}`);
        console.log(`    Metadata: ${JSON.stringify(targetRow.metadata)}`);
      }
    });

    console.log('\n✅ VALIDATION COMPLETE!');
    console.log('========================================');

  } catch (error: any) {
    console.error('❌ Validation failed:', error.message);
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

// Run validation
if (require.main === module) {
  validateCaseStatesMigration().catch(console.error);
}
