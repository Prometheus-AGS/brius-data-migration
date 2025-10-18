# Feature Specification: Complete Database Migration Execution

**Feature Branch**: `003-specify-scripts-bash`
**Created**: October 15, 2025
**Status**: Draft
**Input**: User description: "run the migration scripts in this directory and subdirectories based on previous runs that produced documents that logged the results. this has been done twice. categories, doctors and offices have been migrated from the source to the target schemas. the connections for those are reflected in @.env file and are accurate. Now we need to get patients, orders, communications, technicians, everything in the target schema document (and you can inspect the target tables in supabase) for how to do it. ALL the information is here, and we should not need ANY new scripts to get this done. @package.json is complete for the purpose. do you understand and can you specify?"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Complete Core Entity Migrations (Priority: P1)

Execute the core foundational entity migrations (doctors, patients, orders) that form the backbone of the business operations, building upon the already completed offices, profiles, and categories migrations.

**Why this priority**: Core entities are fundamental dependencies for all other business operations. Without patients and orders, the system cannot function for business operations.

**Independent Test**: Can be fully tested by running the core migration scripts (doctors, patients, orders) and verifying record counts match source database expectations, delivering a functional patient-order management system.

**Acceptance Scenarios**:

1. **Given** source database contains doctor records and offices are migrated, **When** doctor migration is executed, **Then** all doctors are successfully migrated with proper office relationships
2. **Given** doctors are migrated, **When** patient migration is executed, **Then** patient records are migrated with correct doctor assignments and legacy ID mappings preserved
3. **Given** patients are migrated, **When** orders migration is executed, **Then** treatment orders are linked to correct patients with full relationship integrity

---

### User Story 2 - Business Operations Data Migration (Priority: P2)

Migrate all business-critical operational data including tasks, communications, payments, and file management systems to enable complete workflow operations.

**Why this priority**: These enable day-to-day business operations and workflow management, critical for operational continuity but dependent on core entities.

**Independent Test**: Can be tested by running business operation migrations and verifying workflow capabilities function end-to-end through sample task and communication scenarios.

**Acceptance Scenarios**:

1. **Given** core entities are migrated, **When** tasks migration is executed, **Then** all workflow tasks are properly linked with assignment and completion tracking
2. **Given** core entities exist, **When** communications migration is executed, **Then** clinical messages and team communications preserve full conversation history
3. **Given** orders exist, **When** payments and offers migration is executed, **Then** financial data maintains complete transactional integrity with $4M+ in preserved values

---

### User Story 3 - Advanced Clinical and Technical Data (Priority: P3)

Complete the migration of specialized clinical data (JAWS, treatment plans, projects) and technical systems (brackets, products, technician roles) for full feature parity.

**Why this priority**: These provide advanced functionality and specialized workflows but are not critical for basic operations.

**Independent Test**: Can be tested by verifying specialized clinical workflows and technical operations function independently with their respective data sets.

**Acceptance Scenarios**:

1. **Given** patients exist, **When** JAWS and treatment plans migration executes, **Then** advanced clinical analysis and treatment planning data is fully accessible
2. **Given** core system is operational, **When** technician roles and brackets are migrated, **Then** complete role-based workflow and product catalog functionality is available
3. **Given** projects migration completes, **When** validation runs, **Then** project management and tracking capabilities are fully functional

---

### Edge Cases

- What happens when migration scripts encounter partial or corrupted source data during batch processing?
- How does the system handle foreign key constraint violations when migrating dependent entities out of sequence?
- What occurs if the target database runs out of storage space during large data migrations (tasks: 700K+ records)?
- How are UUID generation collisions handled during high-volume migrations?
- What happens when network interruptions occur during migrations connecting to remote source database?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST execute migrations in proper dependency order (offices → profiles → doctors → patients → orders → dependent entities)
- **FR-002**: System MUST preserve all legacy ID mappings via migration_mappings table for backward compatibility
- **FR-003**: System MUST maintain referential integrity across all migrated entities with zero orphaned records
- **FR-004**: System MUST process large datasets (700K+ task records) using efficient batch processing without memory issues
- **FR-005**: System MUST provide comprehensive logging and validation reporting for each migration phase
- **FR-006**: System MUST preserve exact financial data ($4M+ in transaction values) with 100% accuracy
- **FR-007**: System MUST handle migration resumption from checkpoints in case of interruption
- **FR-008**: System MUST execute validation scripts to verify data integrity after each major migration
- **FR-009**: System MUST utilize existing npm package.json scripts for standardized migration execution
- **FR-010**: System MUST preserve complete clinical communication history (60K+ messages) with full context

### Key Entities *(include if feature involves data)*

- **Doctors**: Medical professionals with office associations, credentials, and specializations
- **Patients**: Patient demographics, medical history, doctor assignments, and treatment preferences
- **Orders**: Treatment orders with specifications, delivery tracking, and patient relationships
- **Tasks**: Workflow tasks with assignments, completion status, and dependency tracking
- **Messages**: Clinical communications, patient notifications, and team messages
- **Payments**: Financial transactions, payment methods, and transaction history
- **JAWS**: Orthodontic analysis data with detailed jaw measurements
- **Treatment Plans**: Complete treatment specifications with phases and milestones
- **Projects**: Project timelines, deliverables, and status tracking
- **Technician Roles**: Role assignments, permissions, and workflow responsibilities

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Successfully migrate 1.2M+ total records across all entities with >98% success rate matching historical performance
- **SC-002**: Complete core entity migrations (doctors, patients, orders) within 4 hours of execution time
- **SC-003**: Achieve 100% referential integrity with zero foreign key violations across all migrated relationships
- **SC-004**: Preserve $4M+ in financial transaction values with 100% accuracy (zero discrepancy)
- **SC-005**: Maintain complete clinical communication history (60K+ messages) with full conversation context
- **SC-006**: Execute migrations using existing npm scripts without requiring new script development
- **SC-007**: Generate comprehensive validation reports confirming data integrity for each migrated entity
- **SC-008**: Complete dependency-ordered migration workflow from current state (offices/categories/profiles complete) to full system migration

