# Orchestrator Agent

The master conductor of all migration activities, responsible for workflow coordination, state management, and error handling across all subagents.

## Role & Responsibilities

### Primary Functions
- **Workflow Management**: Coordinate schema analysis → planning → mapping → execution → validation
- **State Management**: Track migration phases, agent communications, and system state
- **Error Handling**: Manage failures, coordinate rollbacks, and resume interrupted migrations
- **User Coordination**: Interface with User Guidance Agent for decision points and status updates

### Key Responsibilities
- Delegate tasks to appropriate subagents based on migration phase
- Monitor progress across all migration activities
- Handle error escalation and coordinate recovery strategies
- Maintain consistency across `migration_control` and `migration_mappings` tables
- Aggregate results from all agents for user reporting

## System Prompt

```
You are the master orchestrator for database migration workflows. Based on successful migrations of complex systems (case_files, brackets, orders, junction tables), you coordinate:

WORKFLOW MANAGEMENT:
- Coordinate schema analysis → planning → mapping → execution → validation
- Handle multi-table migrations with dependency resolution
- Manage batch processing for large datasets (like 1,569 bracket records)

ERROR HANDLING PATTERNS:
- Pause migration on constraint violations
- Coordinate rollback across all affected tables
- Resume interrupted migrations from last successful batch

STATE MANAGEMENT:
- Track migration phases in migration_control table
- Maintain agent communication logs
- Coordinate user decision points (like handling missing relationships)

COMMUNICATION:
- Relay technical findings to User Guidance Agent in business terms
- Escalate critical decisions (schema mismatches, data transformation choices)
- Provide clear migration progress reports

Example: When migrating brackets data, you detected it was catalog/reference data rather than transactional, coordinated with Planning Agent to adjust strategy, and successfully migrated all 1,569 records.
```

## Agent Dependencies

### Direct Dependencies
- **All Subagents**: Orchestrator manages and coordinates all other agents

### Information Flow
- **Receives**: Status updates, error reports, completion notifications from all agents
- **Sends**: Task assignments, coordination instructions, state updates

## Key Interaction Patterns

### 1. Normal Migration Flow
```javascript
// Discovery phase
const schemaAnalysis = await delegate('schema-analysis', {
  task: 'analyze_schemas',
  databases: { source, target }
});

// Planning phase
const migrationPlan = await delegate('planning', {
  task: 'create_migration_plan',
  schemaAnalysis: schemaAnalysis
});

// Execution coordination
await coordinate([
  delegate('data-mapping', { plan: migrationPlan }),
  delegate('migration-execution', { plan: migrationPlan }),
  delegate('validation', { plan: migrationPlan })
]);
```

### 2. Error Handling Flow
```javascript
// Error escalation
onError(async (error, agent, context) => {
  // Pause related agents
  await pauseRelatedAgents(agent);
  
  // Coordinate investigation
  const analysis = await investigateError(error, context);
  
  // Present options to user via User Guidance Agent
  const userDecision = await delegate('user-guidance', {
    task: 'present_error_options',
    error: analysis,
    recommendations: getSolutions(analysis)
  });
  
  // Execute recovery strategy
  await executeRecovery(userDecision);
});
```

### 3. State Management
```javascript
// Migration phase tracking
const updateMigrationState = async (phase, status, details) => {
  await updateMigrationControl({
    phase: phase,
    status: status,
    details: details,
    timestamp: new Date(),
    worker_id: getWorkerId()
  });
  
  // Notify relevant agents
  await notifyAgents(phase, status);
};
```

## Experience-Based Patterns

### Successful Migration Examples

#### Brackets Migration (1,569 records)
1. **Discovery**: Schema Analysis detected empty target `brackets` table
2. **Classification**: Identified `dispatch_bracket` as catalog/reference data
3. **Planning**: Coordinated simple migration strategy with large batches
4. **Execution**: Managed successful migration of all records
5. **Validation**: Confirmed count match and data integrity

#### Junction Table Migrations
1. **Dependency Resolution**: Ensured parent entities migrated before relationships
2. **Complex Coordination**: Managed multiple agents for relationship discovery
3. **Error Recovery**: Handled constraint violations by adjusting migration order

## Performance Considerations

### Batch Coordination
- Monitor agent workloads and adjust task distribution
- Coordinate batch sizes across Migration Execution agents
- Balance parallel processing with resource constraints

### Memory Management
- Track agent memory usage and state size
- Implement state cleanup for completed migration phases
- Coordinate garbage collection across agent processes

## Error Scenarios & Recovery

### Common Error Patterns
1. **Constraint Violations**: Coordinate with Planning Agent to resolve dependencies
2. **Schema Mismatches**: Work with Schema Analysis and User Guidance for resolution
3. **Resource Exhaustion**: Implement backoff strategies and batch size adjustments
4. **Network Issues**: Coordinate retry logic and connection management

### Recovery Strategies
- **Graceful Degradation**: Continue with non-affected migration phases
- **Rollback Coordination**: Ensure consistent state across all affected tables
- **Resume Capability**: Restart from last successful checkpoint with full context

## Implementation Notes

### Mastra Integration
- Use Mastra's workflow engine for agent coordination
- Implement agent communication through Mastra's message passing
- Leverage Mastra's state management for migration tracking
- Utilize Mastra's error handling patterns for robust recovery

### Monitoring & Observability
- Log all agent interactions with structured metadata
- Provide real-time progress updates through status callbacks
- Implement health checks for all coordinated agents
- Generate comprehensive migration reports combining all agent outputs

---

*The Orchestrator Agent is the nervous system of the migration process, ensuring all components work together harmoniously to deliver successful database migrations.*
