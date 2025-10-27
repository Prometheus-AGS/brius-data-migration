# Feature Specification: Differential Database Migration System

**Feature Branch**: `001-continue-migration-all`
**Created**: 2025-10-26
**Status**: Draft
**Input**: User description: "continue migration of all table data from the source postgres database connection specified in .env to the destination supabase database as indicated with keys in the .env. I am looking for just the differences between the dataset we currently have and the new data in the source database since the last migration.  All the scripts necessary to run the migration of all the tables we need are in this directory and subdirectories.  We need to first establish a baseline on where we are and start migrating the data in the same order as previous runs, starting with dispatch_office -> offices, doctors, doctor offices, patients, dispatch_instructions -> orders/cases, files, case files, messages, message files, jaw, dispatch_records -> (tables representing django_contenttype types), etc.  Be sure to update the current target database schema notes with changes made since the last migration, use the previous scripts, source schemas, etc. to generate updated mappings, then execute the migration ,keeping track of where you are along the way."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Baseline Migration Status Assessment (Priority: P1)

As a database administrator, I need to establish the current state of migrated data to determine what records still need to be transferred from the source to destination database.

**Why this priority**: This is the foundation for all subsequent operations. Without knowing the current state, we cannot determine what data needs to be migrated, making this the critical first step.

**Independent Test**: Can be fully tested by running migration status check commands and produces a comprehensive report showing current migration state, record counts, and identified gaps.

**Acceptance Scenarios**:

1. **Given** both source and destination databases are accessible, **When** I run the baseline assessment, **Then** I receive a detailed report showing current record counts for each migrated table
2. **Given** the migration control tables exist, **When** I check migration history, **Then** I can see the last successful migration timestamp and batch details for each entity
3. **Given** mapping tables exist, **When** I analyze ID mappings, **Then** I can identify any orphaned or missing relationship mappings

---

### User Story 2 - Differential Data Detection (Priority: P1)

As a database administrator, I need to identify new or changed records in the source database since the last migration to process only the delta changes.

**Why this priority**: Processing only changes dramatically improves performance and reduces risk. This is essential for ongoing synchronization operations.

**Independent Test**: Can be fully tested by comparing source and destination data and produces a list of specific records that need migration, with clear identification of new vs. modified records.

**Acceptance Scenarios**:

1. **Given** both databases contain migration history, **When** I run differential analysis, **Then** I receive a report of new records added to source since last migration
2. **Given** records exist in both databases, **When** I check for modifications, **Then** I can identify records with different updated_at timestamps or content changes
3. **Given** source records were deleted, **When** I run differential analysis, **Then** I can identify records that should be marked as inactive in destination

---

### User Story 3 - Sequential Migration Execution (Priority: P2)

As a database administrator, I need to execute migration in the correct dependency order (offices → doctors → patients → orders, etc.) to maintain referential integrity.

**Why this priority**: Data integrity depends on proper dependency ordering. This builds on the differential detection and ensures migration succeeds without foreign key violations.

**Independent Test**: Can be fully tested by executing migration for a single entity in isolation and verifying all dependencies are satisfied and data integrity is maintained.

**Acceptance Scenarios**:

1. **Given** differential analysis is complete, **When** I start migration execution, **Then** the system processes entities in the correct dependency order
2. **Given** a migration step fails, **When** I restart the process, **Then** the system resumes from the last successful checkpoint
3. **Given** foreign key dependencies exist, **When** I migrate child records, **Then** all parent records are verified to exist or are migrated first

---

### User Story 4 - Real-time Migration Tracking (Priority: P2)

As a database administrator, I need to monitor migration progress in real-time with detailed logging and the ability to pause/resume operations.

**Why this priority**: Large migrations can take hours or days. Real-time monitoring and resumability are essential for production operations.

**Independent Test**: Can be fully tested by starting a migration, monitoring progress through logs and status commands, then stopping and resuming to verify checkpoint functionality.

**Acceptance Scenarios**:

1. **Given** migration is running, **When** I check progress status, **Then** I see real-time updates on records processed, success rate, and estimated completion time
2. **Given** migration encounters errors, **When** I review logs, **Then** I can see detailed error messages with specific record IDs and error context
3. **Given** migration is interrupted, **When** I restart, **Then** the system resumes from the last successful checkpoint without reprocessing completed records

---

### User Story 5 - Schema Synchronization and Mapping Updates (Priority: P3)

As a database administrator, I need to detect and handle schema changes between source and destination, updating field mappings and transformations as needed.

**Why this priority**: Schema evolution is common in long-running systems. While important for completeness, it's lower priority than core migration functionality.

**Independent Test**: Can be fully tested by simulating schema changes in source database and verifying the system detects and handles mapping updates correctly.

**Acceptance Scenarios**:

1. **Given** source schema has new columns, **When** I run schema analysis, **Then** I receive recommendations for handling new fields in destination
2. **Given** field types have changed, **When** I update mappings, **Then** the system validates transformation compatibility and warns of potential data loss
3. **Given** relationships have changed, **When** I update migration scripts, **Then** foreign key mappings are automatically updated to maintain integrity

---

### Edge Cases

- What happens when source database becomes unavailable during migration?
- How does system handle records that exist in destination but were deleted from source?
- What occurs when destination database runs out of storage space during large batch migration?
- How does system handle concurrent modifications to source data during migration?
- What happens when UUID mapping tables become corrupted or inconsistent?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST establish baseline by comparing current record counts between source and destination databases
- **FR-002**: System MUST identify differential data by comparing timestamps and content hashes to detect new/modified records
- **FR-003**: System MUST execute migrations in dependency order: offices → doctors → doctor_offices → patients → orders → cases → files → messages → jaw → dispatch_records
- **FR-004**: System MUST maintain migration checkpoints to enable pause/resume functionality for long-running operations
- **FR-005**: System MUST preserve existing UUID mappings while creating new mappings for differential records
- **FR-006**: System MUST validate referential integrity before and after each migration step
- **FR-007**: System MUST log all migration operations with detailed success/failure reporting
- **FR-008**: System MUST handle source database connection failures gracefully with automatic retry logic
- **FR-009**: System MUST update migration control tables with batch processing status and timestamps
- **FR-010**: System MUST generate comprehensive migration reports showing before/after states and success metrics
- **FR-011**: System MUST utilize existing migration scripts rather than creating duplicate logic
- **FR-012**: System MUST support both full migration and differential-only modes of operation

### Key Entities *(include if feature involves data)*

- **Migration Control Record**: Tracks migration batches, timestamps, success rates, and entity processing status
- **Migration Mapping**: Preserves legacy ID to UUID relationships for all migrated entities
- **Migration Checkpoint**: Stores resumable state information including last processed record ID and batch position
- **Differential Analysis Result**: Contains lists of new, modified, and deleted records identified for migration
- **Schema Mapping Definition**: Defines field transformations and relationships between source and destination schemas
- **Migration Execution Log**: Detailed logs of all migration operations including errors, warnings, and performance metrics

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: System can establish complete baseline assessment of migration status within 5 minutes for databases with 1M+ records
- **SC-002**: Differential analysis identifies exact record differences with 100% accuracy compared to manual verification
- **SC-003**: Migration execution maintains 99%+ success rate with detailed error reporting for failed records
- **SC-004**: System can resume interrupted migrations from exact checkpoint position with zero data duplication
- **SC-005**: All migration operations complete within 2x the time of equivalent full migration for datasets with <10% changes
- **SC-006**: Migration reports provide complete audit trail suitable for compliance and debugging purposes
- **SC-007**: System handles source database disconnections with automatic reconnection and minimal data loss
- **SC-008**: Foreign key integrity is maintained at 100% with zero orphaned records after migration completion
