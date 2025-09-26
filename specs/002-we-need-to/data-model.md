# Data Model: Migration Scripts Coverage

## Entity Overview
This data model documents all entities involved in the comprehensive migration scripts coverage analysis, representing the complete data ecosystem migrated from legacy to modern database architecture.

## Core Migration Entities

### MigrationScript
Represents individual migration scripts in the repository.

**Fields**:
- `id` (UUID): Unique identifier
- `name` (string): Script filename (e.g., "office-migration.ts")
- `category` (enum): CORE | COMMUNICATIONS | BUSINESS | SPECIALIZED | SYSTEM | CRITICAL_FIX
- `data_domain` (enum): CLINICAL | BUSINESS | COMMUNICATIONS | TECHNICAL
- `source_table` (string): Legacy table name (e.g., "dispatch_office")
- `target_table` (string): Modern table name (e.g., "offices")
- `record_count` (number): Total records processed
- `success_rate` (decimal): Percentage of successful migrations
- `status` (enum): COMPLETE | IN_PROGRESS | FAILED | NOT_STARTED

**Relationships**:
- Has many `MigrationMetrics`
- Has many `DataDomain` associations
- References `ExecutionLog` entries

**Validation Rules**:
- `success_rate` must be between 0.0 and 1.0
- `name` must end with ".ts"
- `record_count` must be non-negative

### DataDomain
Categorizes data by business domain for comprehensive coverage tracking.

**Fields**:
- `id` (UUID): Unique identifier
- `name` (enum): CLINICAL | BUSINESS | COMMUNICATIONS | TECHNICAL
- `description` (string): Domain description
- `priority` (enum): CRITICAL | HIGH | MEDIUM | LOW
- `coverage_percentage` (decimal): Percentage of domain data migrated

**Relationships**:
- Has many `MigrationScript` associations
- Has many `DataEntity` records

**Validation Rules**:
- `coverage_percentage` must be between 0.0 and 1.0
- `name` must be unique

### DataEntity
Specific data entities within each domain (e.g., patients, orders, messages).

**Fields**:
- `id` (UUID): Unique identifier
- `name` (string): Entity name
- `domain_id` (UUID): Reference to DataDomain
- `legacy_table` (string): Source table name
- `target_table` (string): Destination table name
- `total_records` (number): Total legacy records
- `migrated_records` (number): Successfully migrated records
- `failed_records` (number): Failed migration records
- `migration_script_id` (UUID): Reference to handling MigrationScript

**Relationships**:
- Belongs to `DataDomain`
- Belongs to `MigrationScript`
- Has many `MigrationMetrics`

**Validation Rules**:
- `migrated_records + failed_records <= total_records`
- All record counts must be non-negative

## Migration Tracking Entities

### MigrationMetrics
Detailed performance and success metrics for each migration operation.

**Fields**:
- `id` (UUID): Unique identifier
- `script_id` (UUID): Reference to MigrationScript
- `entity_id` (UUID): Reference to DataEntity
- `execution_date` (timestamp): When migration was executed
- `records_processed` (number): Total records processed
- `records_successful` (number): Successfully migrated records
- `records_failed` (number): Failed migration records
- `records_skipped` (number): Skipped records (duplicates, etc.)
- `execution_time_ms` (number): Processing time in milliseconds
- `throughput_per_second` (decimal): Records processed per second
- `error_details` (json): Detailed error information

**Relationships**:
- Belongs to `MigrationScript`
- Belongs to `DataEntity`

**State Transitions**:
- NOT_STARTED → IN_PROGRESS → (COMPLETE | FAILED)
- FAILED → IN_PROGRESS (retry)

### ExecutionLog
Audit trail for all migration operations and system events.

**Fields**:
- `id` (UUID): Unique identifier
- `script_id` (UUID): Reference to MigrationScript
- `operation_type` (enum): MIGRATE | VALIDATE | ROLLBACK | FIX
- `timestamp` (timestamp): Event timestamp
- `level` (enum): INFO | WARN | ERROR | DEBUG
- `message` (string): Log message
- `context` (json): Additional context data
- `user_id` (string): Operator identifier

**Relationships**:
- References `MigrationScript`

## Data Coverage Tracking

### CoverageReport
High-level coverage summary across all data domains.

**Fields**:
- `id` (UUID): Unique identifier
- `report_date` (timestamp): Report generation date
- `total_scripts` (number): Total migration scripts
- `completed_scripts` (number): Successfully completed scripts
- `total_records` (number): Total records across all migrations
- `migrated_records` (number): Total successfully migrated records
- `overall_success_rate` (decimal): Global success rate
- `clinical_coverage` (decimal): Clinical data coverage percentage
- `business_coverage` (decimal): Business data coverage percentage
- `communications_coverage` (decimal): Communications data coverage percentage
- `technical_coverage` (decimal): Technical data coverage percentage

**Validation Rules**:
- All coverage percentages must be between 0.0 and 1.0
- `completed_scripts <= total_scripts`
- `migrated_records <= total_records`

## Legacy System Mapping

### LegacyMapping
Maintains traceability between legacy and modern system identifiers.

**Fields**:
- `id` (UUID): Unique identifier
- `entity_type` (enum): OFFICE | PROFILE | DOCTOR | PATIENT | ORDER | etc.
- `legacy_id` (number): Original legacy system ID
- `modern_id` (UUID): New UUID in modern system
- `migration_batch` (string): Migration batch identifier
- `migrated_at` (timestamp): Migration timestamp
- `metadata` (json): Additional migration context

**Relationships**:
- References various entity types via `modern_id`

**Validation Rules**:
- Combination of `entity_type` and `legacy_id` must be unique
- `modern_id` must be valid UUID format

## API Contracts

### Migration Coverage API
RESTful API for accessing migration coverage information.

**Endpoints**:
- `GET /api/coverage/summary` - Overall coverage summary
- `GET /api/coverage/domain/{domain}` - Domain-specific coverage
- `GET /api/scripts` - List all migration scripts
- `GET /api/scripts/{id}/metrics` - Script performance metrics
- `GET /api/entities/{domain}` - Entities by domain
- `POST /api/reports/generate` - Generate coverage report

### Data Validation API
Endpoints for validating migration completeness and integrity.

**Endpoints**:
- `POST /api/validate/coverage` - Validate complete coverage
- `POST /api/validate/integrity` - Check data integrity
- `GET /api/validate/missing` - Find missing data
- `POST /api/validate/reconcile` - Reconcile source vs target

## Database Schema Constraints

### Referential Integrity
- All foreign key relationships enforced
- Cascade delete for dependent records
- Unique constraints on natural keys

### Data Quality
- Non-null constraints on required fields
- Check constraints for valid ranges
- JSON schema validation for metadata fields

### Performance Optimization
- Indexes on frequently queried fields
- Partitioning for large metric tables
- Materialized views for complex reports

## Migration Status Tracking

### Status Enums

```typescript
enum MigrationStatus {
  NOT_STARTED = 'not_started',
  IN_PROGRESS = 'in_progress',
  COMPLETE = 'complete',
  FAILED = 'failed',
  ROLLBACK_REQUIRED = 'rollback_required'
}

enum DataDomainType {
  CLINICAL = 'clinical',
  BUSINESS = 'business',
  COMMUNICATIONS = 'communications',
  TECHNICAL = 'technical'
}

enum ScriptCategory {
  CORE = 'core',
  COMMUNICATIONS = 'communications',
  BUSINESS = 'business',
  SPECIALIZED = 'specialized',
  SYSTEM = 'system',
  CRITICAL_FIX = 'critical_fix'
}
```

This data model provides complete traceability and accountability for all migration operations while maintaining the flexibility to handle the diverse data types and relationships present in the comprehensive migration ecosystem.