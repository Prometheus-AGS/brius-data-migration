# Feature Specification: Full Database Migration with Schema Updates

**Feature Branch**: `001-full-database-migration`
**Created**: 2025-11-17
**Status**: Draft
**Input**: User description: "Execute a complete database migration to bring all data current, including incremental updates since the last migration. This includes: (1) User profile migration with schema cleanup, (2) Comment system migration with relationship preservation, (3) Product catalog migration with schema optimization, (4) Following documented dependency order, (5) Leveraging existing migration infrastructure."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Database Administrator Executes Complete Migration (Priority: P1)

A database administrator needs to perform a comprehensive migration from the legacy PostgreSQL system to the modern Supabase infrastructure, ensuring all data is current and schemas are properly aligned.

**Why this priority**: This is the core functionality that delivers the primary business value. Without a successful full migration, no other benefits can be realized.

**Independent Test**: Can be fully tested by executing the migration process and verifying that all expected data appears in the destination database with correct counts, relationships, and schema structure.

**Acceptance Scenarios**:

1. **Given** a legacy PostgreSQL database with 50+ dispatch tables and auth_user data, **When** the full migration is executed, **Then** all entity data is transferred to the Supabase destination with preserved relationships and correct counts
2. **Given** existing data in the destination database from previous partial migrations, **When** the full migration runs, **Then** only new and changed records are migrated (incremental update behavior)
3. **Given** the migration completes successfully, **When** validation checks are run, **Then** all critical relationships (profiles→doctors→patients→orders) are intact and referentially valid

---

### User Story 2 - Schema Cleanup and Standardization (Priority: P2)

A database administrator needs to clean up the destination schema by removing unused columns and ensuring the schema matches the intended design without legacy artifacts.

**Why this priority**: Schema cleanup is essential for long-term maintainability and prevents confusion from unused columns, but can be done after core data migration.

**Independent Test**: Can be tested by examining the destination schema structure and confirming specific columns are removed while data integrity is maintained.

**Acceptance Scenarios**:

1. **Given** the profiles table contains insurance_info, legacy_patient_id, and medical_history columns, **When** schema cleanup is executed, **Then** these columns are removed without affecting other profile data
2. **Given** the products table contains a sku column, **When** schema cleanup is executed, **Then** the sku column is removed while maintaining all product relationships
3. **Given** schema changes are applied, **When** the application is tested, **Then** all existing functionality continues to work without referencing the removed columns

---

### User Story 3 - Comment Hierarchy Migration with Relationship Preservation (Priority: P3)

A database administrator needs to migrate comment data from the simple dispatch_comment structure to the hierarchical comments system while maintaining any existing relationships.

**Why this priority**: Comment migration is important for preserving user-generated content but has lower business impact than core entity migrations.

**Independent Test**: Can be tested by migrating comments and verifying that comment content, authorship, and any related entities are properly preserved in the destination.

**Acceptance Scenarios**:

1. **Given** dispatch_comment records with author and plan references, **When** comments are migrated, **Then** each comment is linked to the correct profile (migrated from auth_user) and associated entity
2. **Given** the destination comments table supports parent-child relationships, **When** comments are migrated, **Then** the hierarchical structure is properly established if any relationships exist in the source data
3. **Given** comment migration completes, **When** the system is tested, **Then** users can view historical comments with correct authorship and timestamps

---

### Edge Cases

- What happens when source database connection fails during migration (network timeout, authentication issues)?
- How does the system handle UUID conflicts if destination already has records with same legacy IDs?
- What happens when schema changes conflict with existing data (e.g., removing columns that have data)?
- How does the system handle circular references or complex relationship dependencies during migration?
- What happens when destination database API rate limits are exceeded during large data transfers?
- How does the system handle partial migration failure (some tables succeed, others fail)?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST execute a complete migration of all dispatch_* tables from source PostgreSQL to destination Supabase database
- **FR-002**: System MUST migrate auth_user table data to profiles table with proper field mapping and UUID generation
- **FR-003**: System MUST remove insurance_info, legacy_patient_id, and medical_history columns from destination profiles table after data migration
- **FR-004**: System MUST migrate dispatch_comment data to comments table preserving author relationships and content
- **FR-005**: System MUST remove sku column from destination products table after ensuring no dependencies exist
- **FR-006**: System MUST follow the documented dependency order: Offices → Profiles → Doctors → Patients → Orders → Extended Entities
- **FR-007**: System MUST perform incremental migration, adding only new records since the last migration execution
- **FR-008**: System MUST use existing migration scripts and patterns where available rather than creating duplicate functionality
- **FR-009**: System MUST use the destination database's native API interface for data operations to ensure proper authentication and access control
- **FR-010**: System MUST use appropriate administrative credentials when elevated database access is required
- **FR-011**: System MUST preserve all foreign key relationships and referential integrity during migration
- **FR-012**: System MUST maintain audit trails and migration logs for debugging and validation purposes
- **FR-013**: System MUST validate source and destination schemas before beginning migration to identify any structural conflicts
- **FR-014**: System MUST provide rollback capability for each migration phase in case of errors or data corruption

### Key Entities *(include if feature involves data)*

- **Profiles**: Core user entity migrated from auth_user, containing identity and authentication information, linked to doctors and patients
- **Comments**: User-generated content migrated from dispatch_comment, with hierarchical parent-child relationship support and author linkage
- **Products**: Product catalog entities with pricing and metadata, requiring sku column removal and relationship preservation
- **Offices**: Foundational entity in dependency chain, referenced by doctors and other location-dependent entities
- **Doctors**: Healthcare provider entities dependent on offices and profiles, required for patient relationships
- **Patients**: Healthcare recipient entities dependent on doctors and profiles, required for orders and treatments
- **Orders**: Transaction entities dependent on patients, representing business transactions and workflows
- **Migration Control**: System entity tracking migration progress, batch status, and resumption points
- **Migration Mappings**: System entity preserving legacy ID to UUID mappings for relationship reconstruction

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Migration completes processing of all 50+ source tables within 4 hours execution time
- **SC-002**: 99.5% or higher data transfer success rate across all entities with detailed error reporting for failures
- **SC-003**: All critical dependency relationships (profiles→doctors→patients→orders) maintain 100% referential integrity post-migration
- **SC-004**: Schema cleanup removes exactly 4 specified columns (insurance_info, legacy_patient_id, medical_history, sku) without affecting any other data
- **SC-005**: Incremental migration capability reduces subsequent migration time by 80% compared to full re-migration
- **SC-006**: Migration process generates comprehensive audit logs enabling full traceability of data transformations
- **SC-007**: System can resume migration from last successful checkpoint if interrupted, with less than 5% duplicate processing
- **SC-008**: Validation checks confirm 100% preservation of business-critical data (user accounts, orders, payments) with zero data loss

## Assumptions

- Valid connection credentials are available for both source and destination database systems
- Source database schema has not changed significantly since last migration documentation was created
- Destination database has sufficient storage capacity and connection limits for the migration volume
- The dispatch_comment table in source does not contain actual parent-child comment relationships (based on schema examination)
- Existing migration scripts are compatible with current database versions and can be safely reused
- Network connectivity between migration environment and both databases is stable during execution
- Business users can tolerate read-only access during migration execution periods
- The insurance_info, legacy_patient_id, medical_history, and sku columns contain no critical data that must be preserved elsewhere