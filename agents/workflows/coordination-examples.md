# Agent Coordination Examples

This document provides concrete examples of how agents coordinate during different migration scenarios, based on successful real-world migrations.

## Coordination Architecture

### Agent Communication Flow
```
User Request
     ↓
Orchestrator Agent ←→ User Guidance Agent
     ↓
Schema Analysis Agent
     ↓
Planning Agent
     ↓
Data Mapping Agent ←→ Migration Execution Agent ←→ Validation Agent
     ↓
Results → Orchestrator → User Guidance → User
```

## Successful Migration Examples

### 1. Brackets Migration Coordination (1,569 Records)

This example shows the complete coordination flow for migrating catalog/reference data.

#### Initial Discovery Phase
```javascript
// 1. User Request through User Guidance Agent
const userRequest = {
  type: "complete_migration", 
  priority: "fill_missing_data",
  userContext: "noticed brackets table is empty in target"
};

// 2. Orchestrator initiates discovery
orchestrator.coordinate({
  phase: "discovery",
  agents: ["schema-analysis", "user-guidance"],
  objective: "analyze_empty_brackets_table"
});

// 3. Schema Analysis discovers the issue
const schemaFindings = {
  targetTable: "brackets",
  status: "empty",
  sourceTable: "dispatch_bracket", 
  recordCount: 1569,
  tableType: "catalog",
  relationships: ["project_id -> dispatch_project"],
  complexity: "low"
};

// 4. User Guidance explains findings
const userExplanation = {
  message: "Found 1,569 bracket records in your old system that need to be moved",
  type: "catalog/reference data",
  impact: "These are lookup values that other parts of your system reference",
  recommendation: "Safe to migrate - low risk operation"
};
```

#### Planning Phase
```javascript
// 1. Orchestrator requests migration plan
orchestrator.delegate("planning", {
  task: "create_catalog_migration_plan",
  schemaAnalysis: schemaFindings,
  priority: "high" // User specifically requested this
});

// 2. Planning Agent creates strategy
const migrationPlan = {
  strategy: "catalog_migration",
  phases: [{
    name: "brackets_migration",
    tables: ["dispatch_bracket -> brackets"],
    batchSize: 500, // Large batches for simple catalog data
    dependencies: [],
    transformations: [
      "add_created_at",
      "add_updated_at", 
      "add_metadata_json",
      "preserve_legacy_id"
    ],
    estimatedTime: "2-3 minutes",
    riskLevel: "low"
  }],
  validation: ["count_match", "sample_verification"],
  rollback: "simple_truncate"
};

// 3. User Guidance confirms plan with user
const userConfirmation = {
  summary: "Ready to migrate your 1,569 brackets",
  time: "Should take 2-3 minutes",
  safety: "Very safe - we can easily undo if needed",
  question: "Shall we proceed?"
};
```

#### Execution Phase
```javascript
// 1. Orchestrator coordinates execution agents
orchestrator.coordinateParallel([
  {
    agent: "data-mapping",
    task: "prepare_bracket_transformations",
    config: migrationPlan.phases[0].transformations
  },
  {
    agent: "migration-execution", 
    task: "execute_catalog_migration",
    config: migrationPlan.phases[0],
    dependencies: ["data-mapping"]
  },
  {
    agent: "validation",
    task: "validate_bracket_migration",
    config: migrationPlan.validation,
    dependencies: ["migration-execution"]
  }
]);

// 2. Migration Execution provides progress updates
const progressUpdates = [
  { batch: 1, records: "1-500", status: "completed", message: "First batch of brackets migrated" },
  { batch: 2, records: "501-1000", status: "completed", message: "Second batch completed" },
  { batch: 3, records: "1001-1500", status: "completed", message: "Third batch completed" },
  { batch: 4, records: "1501-1569", status: "completed", message: "Final batch completed" }
];

// 3. User Guidance translates progress
orchestrator.onProgress((update) => {
  userGuidance.communicate({
    message: `Migrated ${update.recordsCompleted} of 1,569 brackets (${update.percentage}% complete)`,
    timeRemaining: update.estimatedTimeRemaining,
    currentAction: "Moving catalog data safely in batches"
  });
});
```

#### Completion and Validation
```javascript
// 1. Validation Agent confirms success
const validationResults = {
  countMatch: { source: 1569, target: 1569, status: "✓ PASS" },
  sampleCheck: { 
    samplesValidated: 50, 
    fieldMatches: ["name", "type", "project_id"],
    status: "✓ PASS" 
  },
  integrityCheck: { status: "✓ PASS" }
};

// 2. Orchestrator aggregates final results
const migrationComplete = {
  status: "SUCCESS",
  recordsMigrated: 1569,
  duration: "2m 14s",
  validation: "PASSED",
  rollbackAvailable: true
};

// 3. User Guidance celebrates success
userGuidance.celebrate({
  message: "🎉 Brackets migration completed successfully!",
  details: "All 1,569 bracket records have been safely moved to your new system",
  impact: "Your bracket data is now available for use in the new system",
  nextSteps: "You can now proceed with other migrations that depend on brackets"
});
```

### 2. Complex Junction Table Migration

This example shows coordination for complex relational data migration.

#### Discovery of Complex Relationships
```javascript
// 1. Schema Analysis discovers junction table pattern
const complexDiscovery = {
  table: "case_file_relationships",
  actualType: "junction", // Initially thought to be regular table
  parentTables: ["cases", "files"],
  relationships: [
    "case_id -> cases.id",
    "file_id -> files.id"
  ],
  recordCount: 15420,
  complexity: "high", // Many-to-many relationships
  dependencies: ["cases", "files"] // Must migrate parents first
};

// 2. Planning Agent recognizes dependency chain
const dependencyAnalysis = {
  migrationOrder: [
    { phase: 1, tables: ["cases", "files"], reason: "parent entities" },
    { phase: 2, tables: ["case_file_relationships"], reason: "junction table depends on parents" }
  ],
  risks: [
    "orphaned relationships if parents not migrated",
    "foreign key constraint violations"
  ]
};

// 3. User Guidance explains complexity
const complexityExplanation = {
  situation: "Found connection tables that link your cases to files",
  complexity: "These are relationship tables - they need special handling",
  dependencies: "We'll need to migrate cases and files first, then connect them",
  timeline: "This adds extra steps but ensures data integrity"
};
```

#### Coordinated Multi-Phase Execution
```javascript
// 1. Phase 1: Parent table migration coordination
orchestrator.executePhase({
  phase: 1,
  agents: {
    primary: "migration-execution",
    support: ["data-mapping", "validation"],
    communication: "user-guidance"
  },
  tables: ["cases", "files"],
  onComplete: () => orchestrator.proceedToPhase(2)
});

// 2. Phase 2: Junction table migration with ID mapping
orchestrator.executePhase({
  phase: 2,
  preRequisites: ["verify_parent_tables_complete"],
  agents: {
    primary: "migration-execution",
    critical: "data-mapping", // Critical for ID mapping
    validation: "validation"
  },
  specialHandling: {
    idMapping: true, // Legacy IDs → UUID mapping required
    foreignKeyValidation: true,
    orphanDetection: true
  }
});
```

### 3. Error Recovery Coordination

#### Constraint Violation Scenario
```javascript
// 1. Migration Execution encounters error
const migrationError = {
  type: "foreign_key_constraint_violation",
  table: "case_file_relationships", 
  constraint: "fk_case_file_case_id",
  batch: 15,
  affectedRecords: 23,
  errorDetail: "Referenced case IDs not found in target cases table"
};

// 2. Orchestrator coordinates investigation
orchestrator.handleError({
  immediate: [
    "pause_current_migration",
    "preserve_current_state", 
    "notify_user_guidance_agent"
  ],
  investigation: [
    {
      agent: "schema-analysis",
      task: "analyze_missing_references",
      context: migrationError
    },
    {
      agent: "validation", 
      task: "identify_orphaned_records",
      context: migrationError
    }
  ]
});

// 3. Schema Analysis provides diagnostic
const diagnosticResults = {
  issue: "23 case_file records reference cases not yet migrated",
  rootCause: "migration order dependency violation",
  affectedCases: [1001, 1002, 1003, /* ... */],
  solutions: [
    "migrate_missing_cases_first",
    "create_placeholder_cases",
    "skip_orphaned_records"
  ]
};

// 4. User Guidance presents options
const errorExplanation = {
  situation: "Hit a small snag - some file connections are missing their cases",
  impact: "23 files can't be connected because their cases aren't migrated yet",
  options: [
    {
      choice: "Find and migrate the missing cases first",
      time: "5 extra minutes",
      safety: "Safest option - ensures perfect data integrity"
    },
    {
      choice: "Skip these 23 connections for manual review later", 
      time: "Continue immediately",
      tradeoff: "You'll need to manually connect these files later"
    }
  ],
  recommendation: "Option 1 - it's what we'd do for production data"
};

// 5. Orchestrator executes recovery plan
orchestrator.executeRecovery({
  strategy: userChoice.selectedOption,
  steps: [
    "identify_missing_parent_records",
    "migrate_missing_parents",
    "retry_failed_junction_batch",
    "validate_relationship_integrity"
  ],
  onSuccess: "resume_normal_migration",
  onFailure: "escalate_to_user_with_detailed_analysis"
});
```

## Agent-Specific Coordination Patterns

### Schema Analysis ↔ Planning Coordination
```javascript
// Schema Analysis provides detailed findings
const schemaToPlanning = {
  tableClassifications: {
    "brackets": { type: "catalog", complexity: "low", dependencies: [] },
    "cases": { type: "transactional", complexity: "medium", dependencies: ["brackets"] },
    "case_files": { type: "junction", complexity: "high", dependencies: ["cases", "files"] }
  },
  relationshipMaps: [/* detailed FK mappings */],
  migrationChallenges: [/* identified issues */]
};

// Planning Agent creates dependency-aware strategy
const planningResponse = {
  migrationPhases: [
    { order: 1, tables: ["brackets"], rationale: "no dependencies" },
    { order: 2, tables: ["cases", "files"], rationale: "parent entities" }, 
    { order: 3, tables: ["case_files"], rationale: "junction depends on parents" }
  ],
  riskAssessments: {/* per-table risks */},
  batchStrategies: {/* optimized batch sizes */}
};
```

### Migration Execution ↔ Validation Coordination
```javascript
// Migration Execution provides batch completion events
const executionToValidation = {
  event: "batch_completed",
  table: "brackets",
  batch: 3,
  recordsProcessed: 500,
  timeElapsed: "45s",
  nextValidationNeeded: "count_verification"
};

// Validation Agent performs immediate checks
const validationResponse = {
  batchValidation: {
    recordCount: { expected: 500, actual: 500, status: "PASS" },
    sampleIntegrity: { samples: 10, passed: 10, status: "PASS" }
  },
  continueExecution: true,
  issues: []
};
```

### User Guidance ↔ Orchestrator Coordination
```javascript
// Orchestrator provides technical status
const orchestratorToGuidance = {
  phase: "execution",
  overallProgress: 65,
  currentTable: "case_file_relationships",
  technical_status: "processing_batch_12_foreign_key_mapping",
  estimatedCompletion: "8 minutes",
  lastSuccessfulCheckpoint: "batch_11_completed"
};

// User Guidance translates and communicates  
const guidanceToUser = {
  userMessage: "Currently connecting files to their cases (65% complete)",
  progressDetails: "Processing relationship data - this ensures every file stays connected to the right case",
  timeRemaining: "About 8 minutes left",
  currentActivity: "Working on batch 12 of relationship connections"
};
```

## Error Escalation Patterns

### Level 1: Agent Self-Recovery
```javascript
// Agent attempts self-recovery first
const agentSelfRecovery = {
  agent: "migration-execution",
  issue: "temporary_connection_timeout", 
  recovery: [
    "retry_with_exponential_backoff",
    "reduce_batch_size_by_half",
    "verify_connection_pool_health"
  ],
  maxRetries: 3,
  escalateIf: "still_failing_after_retries"
};
```

### Level 2: Orchestrator Coordination
```javascript
// Orchestrator coordinates cross-agent recovery
const orchestratorRecovery = {
  trigger: "agent_escalation",
  investigation: [
    { agent: "schema-analysis", task: "verify_target_schema" },
    { agent: "validation", task: "check_data_integrity" }
  ],
  recovery: "coordinate_rollback_to_last_checkpoint",
  userNotification: true
};
```

### Level 3: User Decision Required
```javascript
// Complex issues require user input
const userDecisionRequired = {
  trigger: "unable_to_auto_recover",
  presentation: {
    agent: "user-guidance",
    severity: "medium",
    options: [/* user-friendly choices */],
    recommendation: "based on similar scenarios"
  },
  awaitUserDecision: true,
  timeoutBehavior: "safe_pause_with_state_preservation"
};
```

---

*These coordination examples demonstrate how the multi-agent system works together seamlessly, handling both routine migrations and complex error scenarios with robust communication and recovery patterns.*
