# Feature Specification: Final Database Migration Phase - Remaining Tables

**Feature Branch**: `004-specify-scripts-bash`
**Created**: 2025-10-18
**Status**: Draft
**Input**: User description: "now i need the message_attachements associated in the remote target supabase , technicians, brackets, order_cases, purchases, technician_roles,treatement_discussions, template_view_groups, template_view_roles migrated from source to remote supabase destination in the .env file to finish off all migrations, using existing scripts if possible for tracking, and generating a final report"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Complete Message Attachments Migration (Priority: P1)

Database administrators need to migrate all message attachments to ensure complete communication functionality, linking attachment records to the already migrated messages table with proper file relationships and metadata preservation.

**Why this priority**: Message attachments are critical for maintaining communication context and ensuring users can access historical file attachments. Without these, the messaging system is incomplete.

**Independent Test**: Can be fully tested by verifying message-attachment relationships in target database and confirming file metadata integrity delivers complete messaging functionality.

**Acceptance Scenarios**:

1. **Given** message attachments exist in source `dispatch_file` table, **When** migration runs, **Then** all attachments are linked to migrated messages with preserved file metadata
2. **Given** legacy attachment IDs exist, **When** migration completes, **Then** all legacy relationships are preserved in target system with proper UUID mappings

---

### User Story 2 - Migrate Core Personnel Tables (Priority: P1)

Database administrators need to migrate technicians and technician_roles tables to complete the personnel management system, ensuring all staff data and role assignments are available in the target system.

**Why this priority**: Personnel data is fundamental for system operations, user management, and role-based access control. These tables are dependencies for other operational functions.

**Independent Test**: Can be fully tested by verifying technician profiles and role assignments function correctly in target system and deliver complete personnel management.

**Acceptance Scenarios**:

1. **Given** technician records exist in source, **When** migration runs, **Then** all technician profiles are created with proper profile relationships
2. **Given** technician role assignments exist, **When** migration completes, **Then** all role mappings are preserved with correct permissions structure

---

### User Story 3 - Migrate Treatment and Template Management (Priority: P2)

Database administrators need to migrate treatment_discussions, template_view_groups, and template_view_roles to complete the clinical workflow and template management systems.

**Why this priority**: These tables support clinical workflows and template management but are secondary to core operational functions. They enhance functionality rather than provide basic operations.

**Independent Test**: Can be fully tested by verifying treatment discussion threads and template access controls function correctly in target system.

**Acceptance Scenarios**:

1. **Given** treatment discussions exist in source, **When** migration runs, **Then** all discussion threads are preserved with proper case linkages
2. **Given** template permissions exist, **When** migration completes, **Then** all template access controls are correctly configured

---

### User Story 4 - Migrate Operational Data Tables (Priority: P2)

Database administrators need to migrate brackets, order_cases, and purchases tables to complete the operational data migration, ensuring all business process data is available in the target system.

**Why this priority**: These tables contain important business data but are not critical for basic system functionality. They support advanced operational features and reporting.

**Independent Test**: Can be fully tested by verifying business data integrity and operational reporting functions correctly in target system.

**Acceptance Scenarios**:

1. **Given** bracket specifications exist in source, **When** migration runs, **Then** all bracket data is preserved with proper product relationships
2. **Given** purchase records exist, **When** migration completes, **Then** all financial data is accurately migrated with proper audit trails

---

### User Story 5 - Generate Comprehensive Migration Report (Priority: P1)

Database administrators need a comprehensive final migration report that documents all completed migrations, success rates, data integrity verification, and system readiness status.

**Why this priority**: Documentation is critical for handoff, audit compliance, and system maintenance. A comprehensive report ensures project completion can be verified and future maintenance can be planned.

**Independent Test**: Can be fully tested by generating report and verifying it contains accurate migration statistics and system status information.

**Acceptance Scenarios**:

1. **Given** all migrations are complete, **When** report generation runs, **Then** comprehensive statistics and status are documented with actionable insights
2. **Given** migration issues exist, **When** report is generated, **Then** all issues are documented with recommended remediation steps

---

### Edge Cases

- What happens when message attachments reference non-existent messages or files?
- How does system handle technician records with missing profile relationships?
- What occurs when template permissions reference non-existent roles or groups?
- How are duplicate records handled across different table migrations?
- What happens when source data contains invalid foreign key relationships?
- How does system handle partial migration failures requiring resume capability?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST migrate all message_attachments with preserved file metadata and message relationships
- **FR-002**: System MUST migrate technicians table with proper profile linkages and authentication integration
- **FR-003**: System MUST migrate technician_roles with correct permission mappings and access control preservation
- **FR-004**: System MUST migrate brackets table with product relationships and specification data intact
- **FR-005**: System MUST migrate order_cases with proper order and case relationship mappings
- **FR-006**: System MUST migrate purchases with accurate financial data and audit trail preservation
- **FR-007**: System MUST migrate treatment_discussions with proper case and participant linkages
- **FR-008**: System MUST migrate template_view_groups and template_view_roles with correct access control structure
- **FR-009**: System MUST utilize existing migration scripts where applicable for consistency and reliability
- **FR-010**: System MUST provide progress tracking and status reporting for all migration operations
- **FR-011**: System MUST generate comprehensive final migration report with success metrics and system status
- **FR-012**: System MUST preserve all legacy ID mappings for audit trails and data traceability
- **FR-013**: System MUST handle migration failures gracefully with resume capability
- **FR-014**: System MUST validate data integrity before and after each table migration
- **FR-015**: System MUST use remote Supabase destination as configured in .env file

### Key Entities *(include if feature involves data)*

- **Message_Attachments**: File attachment records linked to messages, containing file metadata, paths, and message relationships
- **Technicians**: Staff member profiles with authentication and system access information
- **Technician_Roles**: Role assignments and permissions for technicians with access control definitions
- **Brackets**: Orthodontic bracket specifications and product information with manufacturing details
- **Order_Cases**: Relationships between orders and cases with processing status and workflow information
- **Purchases**: Financial transaction records with payment information and audit trails
- **Treatment_Discussions**: Clinical discussion threads linked to cases with participant and timeline information
- **Template_View_Groups**: Template access group definitions with permission structures
- **Template_View_Roles**: Role-based template access permissions with group mappings

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All message attachments (100%) are successfully migrated with verified file metadata and message linkages
- **SC-002**: All technician records (100%) are migrated with functional authentication integration and profile relationships
- **SC-003**: All business data tables achieve 95%+ migration success rate with comprehensive error reporting for failures
- **SC-004**: Migration process completes within 4 hours total execution time with progress visibility throughout
- **SC-005**: Final migration report documents complete system status with actionable recommendations for any issues
- **SC-006**: All existing migration script patterns are reused successfully, maintaining consistency with previous migrations
- **SC-007**: Zero data corruption occurs during migration with full integrity verification before and after each table
- **SC-008**: System demonstrates full operational readiness with all migrated data accessible and functional
- **SC-009**: Complete audit trail is maintained with all legacy ID mappings preserved for traceability
- **SC-010**: Migration failures (if any) are automatically recoverable with resume capability from last successful checkpoint

