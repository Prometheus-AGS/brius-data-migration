# Data Model: Differential Database Migration System

**Date**: 2025-10-26
**Feature**: Differential Database Migration System
**Branch**: `001-continue-migration-all`

## Overview

Data models for the differential migration system that extend the existing migration infrastructure with new entities for tracking differential operations, checkpoints, and analysis results.

## Core Entities

### MigrationCheckpoint

Stores resumable state information for interrupted migration operations.

**Purpose**: Enable pause/resume functionality for long-running differential migrations
**Storage**: PostgreSQL table `migration_checkpoints`
**Relationships**: References `migration_control` for batch tracking

```typescript
interface MigrationCheckpoint {
  id: string;                    // UUID primary key
  entity_type: string;           // Entity being migrated (e.g., 'doctors', 'patients')
  migration_run_id: string;      // References migration_control.run_id
  last_processed_id: string;     // Last successfully processed source record ID
  batch_position: number;        // Position within current batch
  records_processed: number;     // Total records processed so far
  records_remaining: number;     // Estimated records remaining
  checkpoint_data: object;       // Serialized state data for resumption
  created_at: Date;
  updated_at: Date;
}
```

**Validation Rules**:
- `entity_type` must be valid entity from migration dependency order
- `last_processed_id` must exist in source database
- `records_processed >= 0`
- `checkpoint_data` must be valid JSON

**State Transitions**:
- Created → Active (when migration starts)
- Active → Suspended (when migration pauses)
- Suspended → Active (when migration resumes)
- Active → Completed (when migration finishes)

### DifferentialAnalysisResult

Contains lists of new, modified, and deleted records identified for migration.

**Purpose**: Store results of differential analysis for processing by migration executor
**Storage**: PostgreSQL table `differential_analysis_results`
**Relationships**: One-to-many with `migration_checkpoints`

```typescript
interface DifferentialAnalysisResult {
  id: string;                    // UUID primary key
  entity_type: string;           // Entity analyzed
  analysis_timestamp: Date;      // When analysis was performed
  source_record_count: number;   // Total records in source
  destination_record_count: number; // Total records in destination
  new_records: string[];         // Array of source IDs for new records
  modified_records: string[];    // Array of source IDs for modified records
  deleted_records: string[];     // Array of source IDs for deleted records
  last_migration_timestamp: Date; // Baseline timestamp for comparison
  analysis_metadata: object;     // Additional analysis context
  created_at: Date;
  updated_at: Date;
}
```

**Validation Rules**:
- `new_records + modified_records` count must be reasonable (<1M for performance)
- `analysis_timestamp > last_migration_timestamp`
- `source_record_count >= 0`
- All record IDs in arrays must exist in source database

**Derived Calculations**:
- `total_changes = new_records.length + modified_records.length`
- `change_percentage = total_changes / source_record_count * 100`

### MigrationStatus

Tracks overall migration execution status across all entities.

**Purpose**: Provide comprehensive view of differential migration progress
**Storage**: PostgreSQL table `migration_status_tracking`
**Relationships**: Aggregates data from multiple `migration_checkpoints`

```typescript
interface MigrationStatus {
  id: string;                    // UUID primary key
  migration_session_id: string;  // Groups related migration operations
  overall_status: MigrationStatusEnum; // PENDING, RUNNING, PAUSED, COMPLETED, FAILED
  entities_pending: string[];    // Entities not yet started
  entities_running: string[];    // Entities currently processing
  entities_completed: string[];  // Entities successfully finished
  entities_failed: string[];     // Entities that failed
  total_records_processed: number;
  total_records_remaining: number;
  estimated_completion: Date;    // Calculated based on current progress
  error_summary: object;         // Aggregated error information
  performance_metrics: object;   // Throughput, timing, resource usage
  started_at: Date;
  completed_at?: Date;
  created_at: Date;
  updated_at: Date;
}

enum MigrationStatusEnum {
  PENDING = 'pending',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed'
}
```

**Validation Rules**:
- Status transitions must follow valid state machine
- `entities_*` arrays must not overlap
- `total_records_processed + total_records_remaining` should be consistent
- `estimated_completion` must be in the future when status is RUNNING

### SchemaMappingDefinition

Defines field transformations and relationships between source and destination schemas.

**Purpose**: Handle schema evolution and mapping updates between source and destination
**Storage**: PostgreSQL table `schema_mapping_definitions`
**Relationships**: Referenced by migration execution services

```typescript
interface SchemaMappingDefinition {
  id: string;                    // UUID primary key
  entity_type: string;           // Target entity (e.g., 'doctors', 'patients')
  source_table: string;          // Source table name
  destination_table: string;     // Destination table name
  field_mappings: FieldMapping[]; // Array of field transformation rules
  validation_rules: ValidationRule[]; // Data validation specifications
  transformation_functions: TransformationFunction[]; // Custom transformations
  version: string;               // Schema version for change tracking
  is_active: boolean;            // Whether this mapping is currently used
  created_at: Date;
  updated_at: Date;
}

interface FieldMapping {
  source_field: string;
  destination_field: string;
  data_type: string;
  is_required: boolean;
  default_value?: any;
  transformation?: string;       // Function name for custom transformations
}

interface ValidationRule {
  field_name: string;
  rule_type: 'required' | 'unique' | 'format' | 'range';
  rule_parameters: object;
}

interface TransformationFunction {
  name: string;
  description: string;
  function_body: string;         // TypeScript function implementation
}
```

**Validation Rules**:
- `source_table` and `destination_table` must exist in respective databases
- Field mappings must reference valid database columns
- Transformation functions must be valid TypeScript
- Only one active mapping per entity_type at a time

### MigrationExecutionLog

Detailed logs of all migration operations including errors, warnings, and performance metrics.

**Purpose**: Comprehensive audit trail and debugging information
**Storage**: PostgreSQL table `migration_execution_logs`
**Relationships**: References `migration_checkpoints` and specific record operations

```typescript
interface MigrationExecutionLog {
  id: string;                    // UUID primary key
  migration_session_id: string;  // Groups related operations
  entity_type: string;           // Entity being processed
  operation_type: OperationType; // Type of operation performed
  record_id?: string;            // Specific record ID (if applicable)
  log_level: LogLevel;           // ERROR, WARN, INFO, DEBUG
  message: string;               // Human-readable log message
  error_details?: object;        // Structured error information
  performance_data?: object;     // Timing, memory, throughput metrics
  context_data: object;          // Additional operation context
  timestamp: Date;
  created_at: Date;
}

enum OperationType {
  BASELINE_ANALYSIS = 'baseline_analysis',
  DIFFERENTIAL_DETECTION = 'differential_detection',
  RECORD_MIGRATION = 'record_migration',
  VALIDATION = 'validation',
  CHECKPOINT_SAVE = 'checkpoint_save',
  CHECKPOINT_RESTORE = 'checkpoint_restore'
}

enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug'
}
```

**Validation Rules**:
- `log_level` must be valid enum value
- `operation_type` must be valid enum value
- `record_id` must exist in source when provided
- `timestamp` must be within reasonable time bounds

## Relationships

### Entity Relationship Diagram

```
MigrationStatus (1) ──→ (M) MigrationCheckpoint
MigrationCheckpoint (M) ──→ (1) DifferentialAnalysisResult
MigrationCheckpoint (1) ──→ (M) MigrationExecutionLog
SchemaMappingDefinition (1) ──→ (M) MigrationCheckpoint
```

### Integration with Existing Schema

The differential migration entities integrate with existing migration infrastructure:

- `migration_control`: Extended with differential operation tracking
- `migration_mappings`: Reused for UUID mapping preservation
- Existing entity tables: Enhanced with differential metadata columns

## Performance Considerations

### Indexing Strategy

**Primary Indexes**:
- `migration_checkpoints`: `(entity_type, migration_run_id)`, `(last_processed_id)`
- `differential_analysis_results`: `(entity_type, analysis_timestamp)`, `(last_migration_timestamp)`
- `migration_execution_logs`: `(migration_session_id, timestamp)`, `(entity_type, log_level)`

**Composite Indexes**:
- `migration_status_tracking`: `(migration_session_id, overall_status)`
- `schema_mapping_definitions`: `(entity_type, is_active, version)`

### Data Retention

**Log Data**: Retain execution logs for 90 days, archive older entries
**Checkpoint Data**: Retain active checkpoints indefinitely, clean up completed sessions after 30 days
**Analysis Results**: Retain for 30 days for debugging, clean up automatically
**Status Tracking**: Permanent retention for audit trail

## Migration Scripts

Database schema creation and migration scripts will be generated as part of implementation:

- `001_create_differential_migration_tables.sql`
- `002_add_differential_indexes.sql`
- `003_create_differential_functions.sql`
- `004_migrate_existing_migration_data.sql`