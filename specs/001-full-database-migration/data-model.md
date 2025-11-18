# Data Model: Full Database Migration with Schema Updates

**Date**: 2025-11-17
**Purpose**: Define data entities and relationships for comprehensive database migration system

---

## Core Migration Entities

### MigrationOrchestration

**Purpose**: Central control entity managing full migration execution lifecycle

**Attributes**:
- `id`: UUID - Unique migration execution identifier
- `migration_type`: Enum - 'full_migration' | 'incremental' | 'schema_cleanup'
- `status`: Enum - 'pending' | 'running' | 'completed' | 'failed' | 'rolling_back'
- `started_at`: Timestamp - Migration start time
- `completed_at`: Timestamp - Migration completion time (nullable)
- `progress_percentage`: Number - Overall completion percentage (0-100)
- `total_entities`: Number - Total number of entities to migrate
- `completed_entities`: Number - Number of entities successfully migrated
- `error_count`: Number - Total number of errors encountered
- `configuration`: JSON - Migration parameters and settings
- `created_by`: String - User or system that initiated migration

**Relationships**:
- Has many `EntityMigrationStatus`
- Has many `MigrationCheckpoint`
- Has many `MigrationError`

**Validation Rules**:
- `progress_percentage` must be between 0 and 100
- `completed_entities` cannot exceed `total_entities`
- `started_at` must be before `completed_at` when both are present

**State Transitions**:
```
pending → running → completed
pending → running → failed
running → rolling_back → pending
```

---

### EntityMigrationStatus

**Purpose**: Track migration progress for individual entities (tables/collections)

**Attributes**:
- `id`: UUID - Unique status record identifier
- `migration_id`: UUID - Reference to parent migration
- `entity_name`: String - Name of source entity (e.g., 'dispatch_user', 'dispatch_comment')
- `target_entity`: String - Name of destination entity (e.g., 'profiles', 'comments')
- `dependency_order`: Number - Order in migration dependency chain
- `status`: Enum - 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
- `records_total`: Number - Total records to migrate
- `records_processed`: Number - Records successfully processed
- `records_failed`: Number - Records that failed to migrate
- `started_at`: Timestamp - Entity migration start time
- `completed_at`: Timestamp - Entity migration completion time (nullable)
- `last_processed_id`: String - Last successfully processed source record ID
- `batch_size`: Number - Configured batch size for this entity
- `throughput_per_second`: Number - Processing rate (records per second)

**Relationships**:
- Belongs to `MigrationOrchestration`
- Has many `BatchProcessingStatus`
- Has many `MigrationError`

**Validation Rules**:
- `dependency_order` must be unique within migration
- `records_processed + records_failed` cannot exceed `records_total`
- Entity names must match configured migration mapping

---

### MigrationCheckpoint

**Purpose**: Enable resumable migration with granular recovery points

**Attributes**:
- `id`: UUID - Unique checkpoint identifier
- `migration_id`: UUID - Reference to parent migration
- `entity_name`: String - Entity being processed at checkpoint
- `checkpoint_type`: Enum - 'batch_completion' | 'entity_completion' | 'error_recovery'
- `batch_number`: Number - Batch sequence number
- `last_source_id`: String - Last processed source record identifier
- `records_processed`: Number - Total records processed at checkpoint
- `system_state`: JSON - Serialized state for recovery
- `created_at`: Timestamp - Checkpoint creation time
- `is_resumable`: Boolean - Whether migration can resume from this point

**Relationships**:
- Belongs to `MigrationOrchestration`
- References `EntityMigrationStatus`

**Validation Rules**:
- Checkpoints must be created in chronological order
- `batch_number` must increment within entity
- `system_state` must contain required recovery information

---

### MigrationMapping

**Purpose**: Preserve legacy ID to UUID relationships for referential integrity

**Attributes**:
- `id`: UUID - Unique mapping identifier
- `migration_id`: UUID - Reference to parent migration
- `source_table`: String - Original source table name
- `source_id`: String - Original record identifier
- `destination_table`: String - Target table name
- `destination_id`: UUID - New UUID identifier
- `entity_type`: String - Business entity type (e.g., 'profile', 'comment', 'product')
- `mapping_metadata`: JSON - Additional mapping context
- `created_at`: Timestamp - Mapping creation time
- `is_active`: Boolean - Whether mapping is current/valid

**Relationships**:
- Belongs to `MigrationOrchestration`
- References multiple destination entities

**Validation Rules**:
- Source table + source ID combination must be unique per migration
- Destination ID must be valid UUID
- Entity type must match configured entity taxonomy

---

### BatchProcessingStatus

**Purpose**: Detailed tracking of batch-level processing for performance monitoring

**Attributes**:
- `id`: UUID - Unique batch identifier
- `entity_status_id`: UUID - Reference to parent entity status
- `batch_number`: Number - Sequential batch number within entity
- `batch_size`: Number - Number of records in this batch
- `status`: Enum - 'pending' | 'processing' | 'completed' | 'failed' | 'retrying'
- `records_successful`: Number - Successfully processed records in batch
- `records_failed`: Number - Failed records in batch
- `started_at`: Timestamp - Batch processing start time
- `completed_at`: Timestamp - Batch processing completion time (nullable)
- `processing_duration_ms`: Number - Time taken to process batch
- `retry_count`: Number - Number of retry attempts
- `error_summary`: String - Brief description of batch errors (nullable)

**Relationships**:
- Belongs to `EntityMigrationStatus`
- Has many `MigrationError`

**Validation Rules**:
- `batch_number` must be sequential within entity
- `records_successful + records_failed` must equal `batch_size`
- `retry_count` cannot exceed configured maximum

---

### MigrationError

**Purpose**: Comprehensive error tracking and diagnostic information

**Attributes**:
- `id`: UUID - Unique error identifier
- `migration_id`: UUID - Reference to parent migration
- `entity_status_id`: UUID - Reference to entity being processed (nullable)
- `batch_id`: UUID - Reference to specific batch (nullable)
- `error_type`: Enum - 'connection_error' | 'data_validation' | 'constraint_violation' | 'timeout' | 'unknown'
- `error_code`: String - Specific error code for categorization
- `error_message`: Text - Detailed error description
- `source_record_id`: String - ID of source record that caused error (nullable)
- `source_data`: JSON - Snapshot of problematic source data
- `context`: JSON - Additional diagnostic context
- `stack_trace`: Text - Technical stack trace (nullable)
- `occurred_at`: Timestamp - When error occurred
- `is_resolved`: Boolean - Whether error has been addressed
- `resolution_notes`: Text - How error was resolved (nullable)

**Relationships**:
- Belongs to `MigrationOrchestration`
- Optionally belongs to `EntityMigrationStatus`
- Optionally belongs to `BatchProcessingStatus`

**Validation Rules**:
- Error message must be non-empty
- Error type must be from predefined enum
- Context must be valid JSON

---

### SchemaChangeOperation

**Purpose**: Track schema modification operations (column removal, structure changes)

**Attributes**:
- `id`: UUID - Unique operation identifier
- `migration_id`: UUID - Reference to parent migration
- `operation_type`: Enum - 'drop_column' | 'add_column' | 'modify_column' | 'create_backup'
- `table_name`: String - Target table name
- `column_name`: String - Column being modified (nullable for table operations)
- `operation_sql`: Text - SQL statement executed
- `status`: Enum - 'pending' | 'completed' | 'failed' | 'rolled_back'
- `executed_at`: Timestamp - When operation was executed (nullable)
- `rollback_sql`: Text - SQL to reverse the operation
- `backup_table_name`: String - Name of backup table created (nullable)
- `risk_level`: Enum - 'low' | 'medium' | 'high' | 'critical'
- `validation_results`: JSON - Results of pre/post operation validation

**Relationships**:
- Belongs to `MigrationOrchestration`

**Validation Rules**:
- Rollback SQL must be provided for reversible operations
- Risk level must be assessed before execution
- Validation results required for critical operations

---

## Data Transformation Entities

### LegacyEntityMapping

**Purpose**: Define source-to-destination entity transformation rules

**Attributes**:
- `id`: UUID - Unique mapping rule identifier
- `source_entity`: String - Source table/collection name
- `destination_entity`: String - Target table/collection name
- `transformation_rules`: JSON - Field mapping and transformation logic
- `dependency_entities`: Array<String> - Required prerequisite entities
- `validation_rules`: JSON - Data validation requirements
- `is_active`: Boolean - Whether mapping is currently used
- `version`: String - Mapping rule version
- `created_at`: Timestamp
- `updated_at`: Timestamp

**Relationships**:
- Used by `EntityMigrationStatus`

**Validation Rules**:
- Source and destination entities must exist in schema definitions
- Transformation rules must be valid JSON with required fields
- Dependency entities must form acyclic dependency graph

---

### DataValidationResult

**Purpose**: Store results of data integrity and completeness validation

**Attributes**:
- `id`: UUID - Unique validation identifier
- `migration_id`: UUID - Reference to parent migration
- `validation_type`: Enum - 'referential_integrity' | 'data_completeness' | 'business_rules' | 'performance'
- `entity_name`: String - Entity being validated
- `status`: Enum - 'passed' | 'failed' | 'warning'
- `records_validated`: Number - Total records checked
- `issues_found`: Number - Number of validation issues
- `issue_details`: JSON - Detailed issue descriptions
- `validation_criteria`: JSON - Criteria used for validation
- `executed_at`: Timestamp - When validation was performed
- `execution_duration_ms`: Number - Time taken for validation

**Relationships**:
- Belongs to `MigrationOrchestration`

**Validation Rules**:
- Issues found cannot exceed records validated
- Issue details required when status is 'failed' or 'warning'
- Validation criteria must specify what was checked

---

## Migration Control Relationships

### Entity Dependency Graph

**Primary Dependencies** (must be migrated in order):
1. `Offices` → Foundation entity
2. `Profiles` → Requires basic infrastructure
3. `Doctors` → Requires Offices + Profiles
4. `Patients` → Requires Doctors + Profiles
5. `Orders` → Requires Patients

**Secondary Dependencies** (can be parallel after core):
- `Products` → Independent or after Orders
- `Comments` → Requires Profiles (author relationships)
- `JAWS` → Requires Patients + Orders
- `Projects` → Independent or after core entities
- `TreatmentPlans` → Requires Patients

### Foreign Key Relationships

**Core Relationships**:
- `MigrationOrchestration` ←→ `EntityMigrationStatus` (1:many)
- `EntityMigrationStatus` ←→ `BatchProcessingStatus` (1:many)
- `MigrationOrchestration` ←→ `MigrationCheckpoint` (1:many)
- `MigrationOrchestration` ←→ `MigrationMapping` (1:many)

**Error Tracking Relationships**:
- `MigrationOrchestration` ←→ `MigrationError` (1:many)
- `EntityMigrationStatus` ←→ `MigrationError` (1:many)
- `BatchProcessingStatus` ←→ `MigrationError` (1:many)

---

## Performance and Scalability Considerations

### Indexing Strategy

**Critical Indexes**:
- `migration_id` on all related entities (foreign key indexes)
- `(entity_name, dependency_order)` on EntityMigrationStatus
- `(migration_id, created_at)` on MigrationCheckpoint
- `(source_table, source_id)` on MigrationMapping
- `(error_type, occurred_at)` on MigrationError

**Partitioning Strategy**:
- Partition MigrationError by `occurred_at` (monthly partitions)
- Partition BatchProcessingStatus by `migration_id` for large migrations

### Data Retention

**Retention Policies**:
- Migration orchestration data: 2 years
- Error logs: 1 year
- Batch processing details: 6 months
- Checkpoints: Until next successful full migration
- Legacy mappings: Permanent (required for ongoing reconciliation)

---

## Integration Points

### External System Interfaces

**Legacy PostgreSQL Source**:
- Read-only access through connection pooling
- Batch query optimization for large result sets
- Timeout and retry logic for network resilience

**Supabase Destination**:
- API-based access with authentication
- Bulk insert/upsert operations
- Row Level Security (RLS) compliance

**Monitoring Systems**:
- Real-time progress metrics export
- Error alerting integration
- Performance dashboard data feeds

### Event Publishing

**Migration Events**:
- Migration started/completed
- Entity processing milestones
- Error threshold breaches
- Performance anomaly detection

**Event Schema**:
```json
{
  "event_type": "migration_progress",
  "migration_id": "uuid",
  "timestamp": "iso8601",
  "data": {
    "entity": "string",
    "progress_percentage": "number",
    "throughput": "number"
  }
}
```