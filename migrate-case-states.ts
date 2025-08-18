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

interface SourceState {
  id: number;
  status: number;
  on: boolean;
  changed_at: Date;
  actor_id: number | null;
  instruction_id: number;
}

// Mapping dispatch_state.status codes to case_state_type enum values
const STATUS_MAPPING: { [key: number]: string } = {
  11: 'treatment_active',      // Most common status - likely active treatment
  12: 'case_closed',          // Second most common - likely completed/closed
  // Add more mappings as discovered
};

async function migrateCaseStates() {
  let migrationStats = {
    statesProcessed: 0,
    statesSkipped: 0,
    statesMigrated: 0,
    casesWithoutStates: 0,
    actorsWithoutProfiles: 0
  };

  try {
    console.log('🚀 Starting Case States Migration...\n');

    // Step 1: Prepare mapping tables
    console.log('📋 Step 1: Preparing mapping tables...');
    
    // Get case mappings (instruction_id -> case_id via orders)
    const caseMappings = new Map<number, string>();
    const caseMappingQuery = await targetPool.query(`
      SELECT o.legacy_instruction_id, c.id as case_id
      FROM orders o
      INNER JOIN cases c ON o.patient_id = c.patient_id
      WHERE o.legacy_instruction_id IS NOT NULL
    `);
    
    caseMappingQuery.rows.forEach(row => {
      caseMappings.set(row.legacy_instruction_id, row.case_id);
    });
    
    console.log(`Found ${caseMappings.size} case mappings (instruction_id -> case_id)`);

    // Get profile mappings for actors (user_id -> profile_id)
    const profileMappings = new Map<number, string>();
    const profileMappingQuery = await targetPool.query(`
      SELECT legacy_user_id, id as profile_id
      FROM profiles
      WHERE legacy_user_id IS NOT NULL
    `);
    
    profileMappingQuery.rows.forEach(row => {
      profileMappings.set(row.legacy_user_id, row.profile_id);
    });
    
    console.log(`Found ${profileMappings.size} profile mappings (user_id -> profile_id)`);

    // Step 2: Fetch and process source data
    console.log('\n📊 Step 2: Processing dispatch_state records...');
    
    const sourceStates = await sourcePool.query<SourceState>(`
      SELECT id, status, "on", changed_at, actor_id, instruction_id
      FROM dispatch_state 
      ORDER BY changed_at ASC
    `);

    console.log(`Processing ${sourceStates.rows.length} state records...`);

    // Track state transitions per case
    const caseStatesMap = new Map<string, any[]>();

    for (const sourceState of sourceStates.rows) {
      migrationStats.statesProcessed++;
      
      try {
        // Find corresponding case
        const caseId = caseMappings.get(sourceState.instruction_id);
        if (!caseId) {
          migrationStats.casesWithoutStates++;
          if (migrationStats.statesProcessed % 500 === 0) {
            console.log(`⚠️  Processed ${migrationStats.statesProcessed} states, ${migrationStats.casesWithoutStates} without case mapping...`);
          }
          continue;
        }

        // Map status code to enum value
        const currentState = STATUS_MAPPING[sourceState.status];
        if (!currentState) {
          console.log(`⚠️  Unknown status code: ${sourceState.status} for state ${sourceState.id}`);
          migrationStats.statesSkipped++;
          continue;
        }

        // Find actor profile
        let changedByProfileId = null;
        if (sourceState.actor_id) {
          changedByProfileId = profileMappings.get(sourceState.actor_id);
          if (!changedByProfileId) {
            migrationStats.actorsWithoutProfiles++;
          }
        }

        // Track states for each case to determine previous state
        if (!caseStatesMap.has(caseId)) {
          caseStatesMap.set(caseId, []);
        }
        
        const caseStates = caseStatesMap.get(caseId)!;
        const previousState = caseStates.length > 0 ? caseStates[caseStates.length - 1].currentState : null;

        // Insert case state record
        await targetPool.query(`
          INSERT INTO case_states (
            case_id,
            changed_by_id,
            previous_state,
            current_state,
            reason,
            notes,
            automated,
            changed_at,
            metadata,
            legacy_state_id
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
          )
        `, [
          caseId,
          changedByProfileId,
          previousState,
          currentState,
          `Status transition from code ${sourceState.status}`,
          sourceState.on ? 'State is active' : 'State is inactive',
          true, // Assume automated since it's from legacy system
          sourceState.changed_at,
          JSON.stringify({
            source_state_id: sourceState.id,
            source_status: sourceState.status,
            source_on: sourceState.on,
            source_actor_id: sourceState.actor_id,
            source_instruction_id: sourceState.instruction_id,
            migration_source: 'dispatch_state'
          }),
          sourceState.id
        ]);

        // Update case states tracking
        caseStates.push({
          currentState: currentState,
          changedAt: sourceState.changed_at
        });

        migrationStats.statesMigrated++;
        
        if (migrationStats.statesMigrated % 100 === 0) {
          console.log(`✅ Migrated ${migrationStats.statesMigrated} case states so far...`);
        }

      } catch (error: any) {
        console.error(`❌ Error migrating state ${sourceState.id}:`, error.message);
        migrationStats.statesSkipped++;
      }
    }

    console.log(`\n✅ Case states migration complete: ${migrationStats.statesMigrated}/${migrationStats.statesProcessed} migrated`);

    // Step 3: Validation
    console.log('\n🔍 Step 3: Validation...');
    
    const finalStatesCount = await targetPool.query('SELECT COUNT(*) as count FROM case_states');
    console.log(`Final case_states count: ${finalStatesCount.rows[0].count}`);

    const statesByStatus = await targetPool.query(`
      SELECT current_state, COUNT(*) as count
      FROM case_states
      GROUP BY current_state
      ORDER BY count DESC
    `);
    console.log('\nStates by status:');
    statesByStatus.rows.forEach(row => {
      console.log(`  ${row.current_state}: ${row.count}`);
    });

    // Check foreign key integrity
    const orphanedStates = await targetPool.query(`
      SELECT COUNT(*) as count 
      FROM case_states cs
      WHERE cs.case_id NOT IN (SELECT id FROM cases)
    `);
    console.log(`Orphaned case_states: ${orphanedStates.rows[0].count}`);

    // Sample migrated data
    console.log('\n📋 Sample migrated data:');
    const sampleStates = await targetPool.query(`
      SELECT 
        id,
        current_state,
        previous_state,
        changed_at,
        legacy_state_id
      FROM case_states 
      ORDER BY changed_at DESC
      LIMIT 5
    `);
    console.log('Sample case_states:', sampleStates.rows);

    console.log('\n📊 MIGRATION SUMMARY:');
    console.log('='.repeat(50));
    console.log(`States processed: ${migrationStats.statesProcessed}`);
    console.log(`States migrated: ${migrationStats.statesMigrated}`);
    console.log(`States skipped: ${migrationStats.statesSkipped}`);
    console.log(`Cases without mapping: ${migrationStats.casesWithoutStates}`);
    console.log(`Actors without profiles: ${migrationStats.actorsWithoutProfiles}`);
    console.log(`Success rate: ${((migrationStats.statesMigrated / migrationStats.statesProcessed) * 100).toFixed(2)}%`);
    console.log('='.repeat(50));

    console.log('\n🎉 Case states migration completed successfully!');

  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

// Run the migration
if (require.main === module) {
  migrateCaseStates().catch(console.error);
}

export { migrateCaseStates };
