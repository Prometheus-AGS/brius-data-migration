# Data Model: Database Migration and Synchronization System

## Core Entities

### Migration Checkpoint
**Purpose**: Represents the state of migration progress for tracking and resumability
**Relationships**: Links to Synchronization Jobs and Data Differentials

**Attributes**:
- `id`: UUID - Primary key
- `operation_type`: enum('differential_migration', 'sync_operation', 'validation') - Type of operation
- `entity_type`: string - Entity being processed (offices, doctors, patients, etc.)
- `last_processed_id`: string - Last successfully processed legacy ID
- `records_processed`: integer - Count of processed records in current batch
- `records_total`: integer - Total records to process (estimated)
- `batch_size`: integer - Configured batch size for operation
- `status`: enum('pending', 'in_progress', 'completed', 'failed', 'paused') - Current status
- `started_at`: timestamp - Operation start time
- `completed_at`: timestamp - Operation completion time (nullable)
- `error_message`: text - Error details if failed (nullable)
- `metadata`: jsonb - Additional context and configuration
- `created_at`: timestamp - Record creation time
- `updated_at`: timestamp - Last modification time

**Validation Rules**:
- `records_processed` must be <= `records_total`
- `completed_at` must be > `started_at` when not null
- `error_message` required when status is 'failed'

**State Transitions**:
```
pending → in_progress → [completed | failed | paused]
paused → in_progress
failed → in_progress (retry)
```

### Data Differential
**Purpose**: Represents the comparison results between source and target databases
**Relationships**: Referenced by Migration Checkpoints, contains comparison metadata

**Attributes**:
- `id`: UUID - Primary key
- `source_table`: string - Source database table name
- `target_table`: string - Target database table name
- `comparison_type`: enum('missing_records', 'conflicted_records', 'deleted_records') - Type of difference
- `legacy_ids`: jsonb - Array of legacy IDs that differ
- `record_count`: integer - Number of records in this differential
- `comparison_criteria`: jsonb - Criteria used for comparison (timestamps, checksums, etc.)
- `resolution_strategy`: enum('source_wins', 'target_wins', 'manual_review', 'skip') - How to resolve
- `resolved`: boolean - Whether differential has been processed
- `resolved_at`: timestamp - When resolution was completed (nullable)
- `created_at`: timestamp - When comparison was performed
- `metadata`: jsonb - Additional comparison details and context

**Validation Rules**:
- `record_count` must match length of `legacy_ids` array
- `resolved_at` required when `resolved` is true
- `resolution_strategy` must be consistent with system configuration

### Synchronization Job
**Purpose**: Represents an ongoing or scheduled sync operation with status tracking
**Relationships**: Contains multiple Migration Checkpoints, tracks overall sync progress

**Attributes**:
- `id`: UUID - Primary key
- `job_name`: string - Human-readable job identifier
- `job_type`: enum('scheduled_sync', 'manual_sync', 'differential_migration') - Type of sync operation
- `schedule_config`: jsonb - Cron-like schedule configuration (frequency, intervals)
- `entities_to_sync`: jsonb - Array of entity types to include in sync
- `sync_direction`: enum('source_to_target', 'bidirectional') - Direction of synchronization
- `conflict_resolution`: enum('source_wins', 'target_wins', 'manual') - Default conflict handling
- `max_records_per_batch`: integer - Maximum records to process per batch
- `status`: enum('scheduled', 'running', 'completed', 'failed', 'paused', 'cancelled') - Job status
- `last_run_at`: timestamp - Most recent execution time (nullable)
- `next_run_at`: timestamp - Next scheduled execution (nullable)
- `total_records_synced`: integer - Cumulative count across all runs
- `success_rate`: decimal(5,2) - Percentage of successful operations
- `average_duration_ms`: integer - Average execution time in milliseconds
- `created_at`: timestamp - Job creation time
- `updated_at`: timestamp - Last modification time
- `metadata`: jsonb - Job configuration and execution context

**Validation Rules**:
- `next_run_at` must be > `last_run_at` when not null
- `success_rate` must be between 0.00 and 100.00
- `schedule_config` required for 'scheduled_sync' job types
- `entities_to_sync` must contain valid entity names

**State Transitions**:
```
scheduled → running → [completed | failed | paused]
running → cancelled (manual intervention)
paused → running (resume)
completed → scheduled (for recurring jobs)
```

### Migration Validation Report
**Purpose**: Represents comprehensive validation results between source and target databases
**Relationships**: Associated with Synchronization Jobs and Migration Checkpoints

**Attributes**:
- `id`: UUID - Primary key
- `validation_type`: enum('data_integrity', 'relationship_integrity', 'completeness_check', 'performance_check') - Type of validation
- `source_entity`: string - Source entity/table being validated
- `target_entity`: string - Target entity/table being validated
- `records_validated`: integer - Total records checked
- `validation_passed`: boolean - Overall validation result
- `discrepancies_found`: integer - Count of validation failures
- `discrepancy_details`: jsonb - Detailed breakdown of validation issues
- `validation_criteria`: jsonb - Rules and thresholds used for validation
- `execution_time_ms`: integer - Time taken to complete validation
- `generated_at`: timestamp - When validation was performed
- `expires_at`: timestamp - When validation results become stale
- `metadata`: jsonb - Additional validation context and metrics

**Validation Rules**:
- `discrepancies_found` must be 0 when `validation_passed` is true
- `discrepancy_details` required when `discrepancies_found` > 0
- `expires_at` must be > `generated_at`
- `execution_time_ms` must be positive

### Legacy ID Mapping
**Purpose**: Maintains relationships between original integer IDs and new UUID primary keys
**Relationships**: Referenced by all migrated entities, critical for referential integrity

**Attributes**:
- `id`: UUID - Primary key
- `entity_type`: string - Type of entity (offices, doctors, patients, etc.)
- `legacy_id`: integer - Original ID from source database
- `uuid_id`: UUID - New UUID primary key in target database
- `migration_batch`: string - Batch identifier when record was migrated
- `migration_timestamp`: timestamp - When mapping was created
- `validation_status`: enum('pending', 'validated', 'error') - Mapping verification status
- `source_table`: string - Original source database table name
- `target_table`: string - Target database table name
- `checksum`: string - Hash of key fields for validation
- `metadata`: jsonb - Additional mapping context and source data references

**Validation Rules**:
- Unique constraint on (`entity_type`, `legacy_id`)
- Unique constraint on (`entity_type`, `uuid_id`)
- `migration_timestamp` must be <= current timestamp
- `checksum` required for validation verification

## Entity Relationships

### Primary Relationships
```
Synchronization Job (1) → (N) Migration Checkpoint
Migration Checkpoint (1) → (N) Data Differential
Migration Validation Report (N) → (1) Synchronization Job
Legacy ID Mapping (N) → (1) [All Migrated Entities]
```

### Cross-Entity Dependencies
```
offices → profiles (office_id foreign key)
profiles → doctors (profile_id foreign key)
doctors → patients (doctor_id foreign key)
patients → orders (patient_id foreign key)
orders → products (order_id foreign key)
```

## Data Volume Estimates

### Expected Scale per Sync Operation
- **Migration Checkpoints**: 10-50 records per sync (one per entity type per batch)
- **Data Differentials**: 100-1,000 records per sync (depending on change volume)
- **Synchronization Jobs**: 1-10 active jobs (scheduled + manual)
- **Migration Validation Reports**: 50-200 per sync (comprehensive validation)
- **Legacy ID Mappings**: Read-only access to 1.2M+ existing mappings

### Storage Requirements
- **Active synchronization data**: ~10MB per sync operation
- **Historical logs and reports**: ~100MB per month (with rotation)
- **Legacy mapping cache**: ~50MB (indexed subset of mappings)

## Performance Considerations

### Indexing Strategy
```sql
-- Migration Checkpoints
CREATE INDEX idx_checkpoint_status_entity ON migration_checkpoints(status, entity_type);
CREATE INDEX idx_checkpoint_operation_type ON migration_checkpoints(operation_type, created_at);

-- Data Differentials
CREATE INDEX idx_differential_table_type ON data_differentials(source_table, comparison_type);
CREATE INDEX idx_differential_resolved ON data_differentials(resolved, created_at);

-- Synchronization Jobs
CREATE INDEX idx_sync_job_status ON synchronization_jobs(status, next_run_at);
CREATE INDEX idx_sync_job_type_schedule ON synchronization_jobs(job_type, schedule_config);

-- Legacy ID Mappings (existing)
CREATE INDEX idx_legacy_mapping_entity_legacy ON legacy_id_mappings(entity_type, legacy_id);
CREATE INDEX idx_legacy_mapping_entity_uuid ON legacy_id_mappings(entity_type, uuid_id);
```

### Query Optimization
- Use prepared statements for batch processing operations
- Implement connection pooling for concurrent sync operations
- Cache frequently accessed legacy ID mappings in memory
- Use JSON indexes for metadata and configuration queries