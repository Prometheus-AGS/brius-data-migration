# Planning Agent

Migration planning specialist responsible for creating detailed, dependency-aware migration strategies with risk assessment and error recovery planning.

## Role & Responsibilities

### Primary Functions
- **Dependency Analysis**: Create migration order based on foreign key relationships and data dependencies
- **Batch Strategy**: Determine optimal batch sizes and processing strategies
- **Risk Assessment**: Identify potential migration challenges and mitigation strategies
- **Transformation Planning**: Design data type conversions and schema evolution steps

### Key Responsibilities
- Receive schema analysis reports and create comprehensive migration plans
- Order migrations to respect foreign key dependencies
- Plan batch sizes based on table size, complexity, and system resources
- Design rollback and recovery strategies for each migration phase
- Coordinate with Data Mapping Agent on transformation requirements

## System Prompt

```
You are a migration planning specialist creating detailed, dependency-aware migration strategies:

DEPENDENCY ANALYSIS:
- Order migrations based on foreign key relationships
- Plan junction table migrations after parent entities
- Handle circular dependencies with temporary constraint drops

BATCH STRATEGIES:
- Size batches based on table size and complexity
- Plan larger batches for simple catalog tables (like brackets)
- Use smaller batches for complex relational data
- Consider memory and performance constraints

TRANSFORMATION PLANNING:
- Map legacy INTEGER IDs to new UUID primary keys
- Plan data type conversions and format changes
- Handle missing relationships (source tables without target equivalents)
- Design fallback strategies for data that doesn't fit target schema

RISK ASSESSMENT:
- Identify high-risk migrations requiring manual review
- Plan rollback strategies for each migration phase
- Anticipate constraint violations and prepare solutions
- Design validation checkpoints

ERROR RECOVERY:
- Plan resume points for interrupted migrations
- Design transaction boundaries for safe rollback
- Prepare diagnostic queries for troubleshooting

Example: For brackets migration, you would plan it as a catalog migration with simple batch strategy, minimal dependencies, and validation against source dispatch_bracket count (1,569 records).
```

## Core Planning Functions

### 1. Dependency Resolution

```javascript
const createDependencyGraph = (schemaAnalysis) => {
  const graph = new Map();
  const tables = schemaAnalysis.tables;
  
  // Build dependency relationships
  tables.forEach(table => {
    graph.set(table.name, {
      dependencies: table.foreignKeys.map(fk => fk.referencedTable),
      dependents: [],
      migrationOrder: null,
      riskLevel: assessRiskLevel(table)
    });
  });
  
  // Calculate reverse dependencies
  graph.forEach((tableInfo, tableName) => {
    tableInfo.dependencies.forEach(dep => {
      if (graph.has(dep)) {
        graph.get(dep).dependents.push(tableName);
      }
    });
  });
  
  return topologicalSort(graph);
};
```

### 2. Batch Size Optimization

```javascript
const calculateBatchSizes = (table, systemResources) => {
  const baseFactors = {
    catalog: 1000,      // Large batches for simple reference data
    transactional: 100, // Smaller batches for complex data
    junction: 500,      // Medium batches for relationship data
    large: 50          // Very small batches for huge tables
  };
  
  let batchSize = baseFactors[table.classification] || 100;
  
  // Adjust based on complexity
  if (table.foreignKeyCount > 3) batchSize = Math.floor(batchSize / 2);
  if (table.requiresTransformation) batchSize = Math.floor(batchSize / 2);
  if (table.recordCount > 1000000) batchSize = Math.min(batchSize, 25);
  
  // System resource considerations
  if (systemResources.memoryLimited) batchSize = Math.floor(batchSize / 2);
  if (systemResources.concurrentMigrations) batchSize = Math.floor(batchSize * 0.7);
  
  return Math.max(batchSize, 10); // Minimum viable batch size
};
```

### 3. Migration Strategy Selection

```javascript
const selectMigrationStrategy = (table, schemaAnalysis) => {
  // Catalog/Reference Data Strategy
  if (table.classification === 'catalog') {
    return {
      strategy: 'catalog_migration',
      approach: 'bulk_insert_with_metadata',
      batchSize: 500,
      dependencies: [],
      transformations: ['add_timestamps', 'add_metadata'],
      validation: ['count_match', 'sample_verification'],
      rollbackStrategy: 'truncate_and_restore',
      riskLevel: 'low'
    };
  }
  
  // Junction Table Strategy
  if (table.classification === 'junction') {
    return {
      strategy: 'relationship_migration',
      approach: 'foreign_key_mapping',
      batchSize: 200,
      dependencies: table.parentTables,
      transformations: ['id_mapping_lookup', 'relationship_validation'],
      validation: ['count_match', 'referential_integrity', 'orphan_detection'],
      rollbackStrategy: 'cascade_delete',
      riskLevel: 'medium'
    };
  }
  
  // Transactional Data Strategy
  return {
    strategy: 'transactional_migration',
    approach: 'incremental_with_validation',
    batchSize: 100,
    dependencies: table.foreignKeyTables,
    transformations: ['type_conversion', 'id_generation', 'audit_fields'],
    validation: ['full_integrity_check', 'business_rule_validation'],
    rollbackStrategy: 'point_in_time_restore',
    riskLevel: 'high'
  };
};
```

## Migration Plan Structure

### Comprehensive Migration Plan

```javascript
const createMigrationPlan = (schemaAnalysis) => {
  const dependencyOrder = createDependencyGraph(schemaAnalysis);
  
  return {
    metadata: {
      planId: generatePlanId(),
      createdAt: new Date(),
      sourceDatabase: schemaAnalysis.source.name,
      targetDatabase: schemaAnalysis.target.name,
      estimatedDuration: calculateEstimatedTime(schemaAnalysis),
      totalRecords: schemaAnalysis.totalRecords
    },
    
    phases: dependencyOrder.map(batch => ({
      phaseNumber: batch.order,
      phaseName: `Migration Batch ${batch.order}`,
      tables: batch.tables.map(table => ({
        tableName: table.name,
        strategy: selectMigrationStrategy(table, schemaAnalysis),
        estimatedRecords: table.recordCount,
        estimatedTime: estimateTableMigrationTime(table),
        prerequisites: table.dependencies,
        successCriteria: defineSuccessCriteria(table)
      })),
      parallelizable: batch.canRunInParallel,
      rollbackPoint: true
    })),
    
    transformations: {
      globalTransformations: [
        'integer_to_uuid_conversion',
        'timestamp_standardization',
        'metadata_field_addition'
      ],
      tableSpecificTransformations: extractTransformations(schemaAnalysis)
    },
    
    validation: {
      preFlightChecks: [
        'schema_compatibility_check',
        'constraint_validation',
        'disk_space_verification'
      ],
      perTableValidation: [
        'record_count_match',
        'foreign_key_integrity',
        'data_type_compliance'
      ],
      postMigrationValidation: [
        'full_referential_integrity',
        'business_rule_compliance',
        'performance_benchmarks'
      ]
    },
    
    errorRecovery: {
      rollbackStrategy: 'phase_level_rollback',
      checkpointFrequency: 'per_batch',
      resumeCapability: true,
      diagnosticQueries: generateDiagnosticQueries(schemaAnalysis)
    }
  };
};
```

## Real-World Planning Examples

### Brackets Migration Plan
```javascript
// Based on successful 1,569 record migration
const bracketsPlan = {
  tableName: 'brackets',
  sourceTable: 'dispatch_bracket',
  strategy: {
    type: 'catalog_migration',
    batchSize: 500, // Large batches for simple catalog data
    dependencies: [], // No foreign key dependencies
    transformations: [
      'add_created_at_timestamp',
      'add_updated_at_timestamp', 
      'add_metadata_json_field',
      'preserve_legacy_id'
    ],
    validation: [
      'count_match_1569_records',
      'sample_name_field_verification',
      'type_field_enum_validation'
    ]
  },
  riskLevel: 'low',
  estimatedTime: '2-3 minutes',
  rollbackStrategy: 'simple_truncate'
};
```

### Junction Table Migration Plan
```javascript
// Complex relationship migration
const caseFileRelationshipsPlan = {
  tableName: 'case_file_relationships',
  strategy: {
    type: 'junction_migration',
    batchSize: 200, // Smaller batches for relationship complexity
    dependencies: ['cases', 'files'], // Must migrate parents first
    transformations: [
      'lookup_case_uuid_from_legacy_id',
      'lookup_file_uuid_from_legacy_id',
      'validate_both_parents_exist'
    ],
    validation: [
      'no_orphaned_relationships',
      'bidirectional_relationship_integrity',
      'unique_constraint_compliance'
    ]
  },
  riskLevel: 'medium',
  estimatedTime: '5-10 minutes',
  rollbackStrategy: 'cascade_delete_relationships'
};
```

### Large Table Migration Plan
```javascript
// High-volume transactional data
const ordersMigrationPlan = {
  tableName: 'orders',
  strategy: {
    type: 'large_transactional_migration',
    batchSize: 50, // Very small batches for safety
    dependencies: ['customers', 'products', 'brackets'],
    transformations: [
      'generate_uuid_primary_key',
      'convert_timestamps_to_utc',
      'normalize_currency_fields',
      'update_foreign_key_references'
    ],
    validation: [
      'financial_total_reconciliation',
      'order_status_consistency',
      'customer_relationship_integrity'
    ]
  },
  riskLevel: 'high',
  estimatedTime: '30-60 minutes',
  rollbackStrategy: 'point_in_time_snapshot_restore'
};
```

## Error Scenario Planning

### Constraint Violation Recovery
```javascript
const handleConstraintViolations = {
  scenario: 'foreign_key_constraint_failure',
  detection: 'automatic_during_batch_insert',
  response: [
    'pause_current_migration',
    'analyze_missing_parent_records',
    'coordinate_with_orchestrator_for_dependency_reorder',
    'present_options_to_user_via_guidance_agent'
  ],
  solutions: [
    'migrate_parent_table_first',
    'create_placeholder_parent_records',
    'skip_orphaned_records_with_logging'
  ]
};
```

### Resource Exhaustion Recovery
```javascript
const handleResourceExhaustion = {
  scenario: 'memory_or_connection_limit_exceeded',
  detection: 'system_resource_monitoring',
  response: [
    'reduce_batch_sizes_by_50_percent',
    'introduce_processing_delays',
    'coordinate_with_orchestrator_for_sequential_processing'
  ],
  prevention: [
    'pre_flight_resource_assessment',
    'dynamic_batch_size_adjustment',
    'connection_pooling_optimization'
  ]
};
```

## Agent Dependencies

### Inputs from Schema Analysis Agent
- Complete table classifications and relationships
- Data profiling reports with record counts and complexity metrics
- Schema mismatch analysis between source and target
- Risk assessments for each table and transformation

### Outputs to Other Agents
- **Data Mapping Agent**: Transformation requirements and field mapping priorities  
- **Migration Execution Agent**: Detailed batch strategies and execution order
- **Validation Agent**: Success criteria and validation requirements
- **User Guidance Agent**: Risk assessments and decision points requiring user input

---

*The Planning Agent transforms raw schema analysis into actionable migration strategies, ensuring each table is migrated safely, efficiently, and in the correct order.*
