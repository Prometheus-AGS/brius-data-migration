---
description: "Final Database Migration Phase - Remaining Tables Implementation Tasks"
---

# Tasks: Final Database Migration Phase - Remaining Tables

**Input**: Design documents from `/specs/004-specify-scripts-bash/`
**Prerequisites**: research.md (migration analysis), data-model.md (table schemas), contracts/ (interfaces), quickstart.md (execution guide)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4, US5)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Migration infrastructure and shared utilities setup

- [x] T001 Create TypeScript interfaces from contracts in `/usr/local/src/sage/dataload/src/interfaces/migration-types.ts`
- [x] T002 [P] Create shared configuration builder in `/usr/local/src/sage/dataload/src/config/migration-config.ts`
- [x] T003 [P] Create base migration service class in `/usr/local/src/sage/dataload/src/services/base-migration-service.ts`
- [x] T004 [P] Create batch processor utility in `/usr/local/src/sage/dataload/src/utils/batch-processor.ts`
- [x] T005 [P] Create lookup mapping builder in `/usr/local/src/sage/dataload/src/utils/lookup-mappings.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core migration utilities that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T006 Create validation framework in `/usr/local/src/sage/dataload/src/validation/validation-framework.ts`
- [ ] T007 [P] Create error handling system in `/usr/local/src/sage/dataload/src/utils/error-handler.ts`
- [ ] T008 [P] Create progress tracking utility in `/usr/local/src/sage/dataload/src/utils/progress-tracker.ts`
- [ ] T009 Create report generator in `/usr/local/src/sage/dataload/src/reporting/report-generator.ts`
- [ ] T010 Setup database connection utilities in `/usr/local/src/sage/dataload/src/database/connection-manager.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 3 - Migrate Treatment and Template Management (Priority: P2)

**Goal**: Migrate template_view_groups, template_view_roles, and treatment_discussions for clinical workflow support

**Independent Test**: Can be verified by confirming template access controls and treatment discussion threads function correctly

### Implementation for User Story 3

- [ ] T011 [P] [US3] Create template_view_groups migration script in `/usr/local/src/sage/dataload/src/migrate-template-view-groups.ts`
- [ ] T012 [P] [US3] Create template_view_groups validation script in `/usr/local/src/sage/dataload/validation/validate-template-view-groups.ts`
- [ ] T013 [US3] Create template_view_roles migration script in `/usr/local/src/sage/dataload/src/migrate-template-view-roles.ts` (depends on T011)
- [ ] T014 [US3] Create template_view_roles validation script in `/usr/local/src/sage/dataload/validation/validate-template-view-roles.ts`
- [ ] T015 [P] [US3] Create treatment_discussions migration script in `/usr/local/src/sage/dataload/src/migrate-treatment-discussions.ts`
- [ ] T016 [P] [US3] Create treatment_discussions validation script in `/usr/local/src/sage/dataload/validation/validate-treatment-discussions.ts`

**Checkpoint**: Template management and treatment discussions should be fully functional and testable independently

---

## Phase 4: User Story 2 - Migrate Core Personnel Tables (Priority: P1)

**Goal**: Migrate technicians and technician_roles tables for complete personnel management system

**Independent Test**: Can be verified by confirming technician profiles and role assignments function correctly in target system

### Implementation for User Story 2

- [ ] T017 [P] [US2] Create technicians migration script in `/usr/local/src/sage/dataload/src/migrate-technicians.ts`
- [ ] T018 [P] [US2] Create technicians validation script in `/usr/local/src/sage/dataload/validation/validate-technicians.ts`
- [ ] T019 [US2] Create technician_roles migration script in `/usr/local/src/sage/dataload/src/migrate-technician-roles.ts` (depends on T017)
- [ ] T020 [US2] Create technician_roles validation script in `/usr/local/src/sage/dataload/validation/validate-technician-roles.ts`

**Checkpoint**: Personnel management system should be fully functional with technicians and roles

---

## Phase 5: User Story 4 - Migrate Operational Data Tables (Priority: P2)

**Goal**: Migrate brackets, order_cases, and purchases for complete operational data migration

**Independent Test**: Can be verified by confirming business data integrity and operational reporting functions correctly

### Implementation for User Story 4

- [ ] T021 [P] [US4] Create brackets migration script in `/usr/local/src/sage/dataload/src/migrate-brackets.ts`
- [ ] T022 [P] [US4] Create brackets validation script in `/usr/local/src/sage/dataload/validation/validate-brackets.ts`
- [ ] T023 [P] [US4] Create order_cases migration script in `/usr/local/src/sage/dataload/src/migrate-order-cases.ts`
- [ ] T024 [P] [US4] Create order_cases validation script in `/usr/local/src/sage/dataload/validation/validate-order-cases.ts`
- [ ] T025 [P] [US4] Create purchases migration script in `/usr/local/src/sage/dataload/src/migrate-purchases.ts`
- [ ] T026 [P] [US4] Create purchases validation script in `/usr/local/src/sage/dataload/validation/validate-purchases.ts`

**Checkpoint**: All operational data tables should be migrated with business data integrity maintained

---

## Phase 6: User Story 1 - Complete Message Attachments Migration (Priority: P1)

**Goal**: Migrate message_attachments to ensure complete communication functionality with file relationships

**Independent Test**: Can be verified by confirming message-attachment relationships and file metadata integrity

### Implementation for User Story 1

- [ ] T027 [P] [US1] Create message_attachments migration script in `/usr/local/src/sage/dataload/src/migrate-message-attachments.ts`
- [ ] T028 [P] [US1] Create message_attachments validation script in `/usr/local/src/sage/dataload/validation/validate-message-attachments.ts`

**Checkpoint**: Message attachments should be fully linked to messages with complete file metadata

---

## Phase 7: User Story 5 - Generate Comprehensive Migration Report (Priority: P1)

**Goal**: Generate comprehensive final report documenting all completed migrations and system readiness

**Independent Test**: Can be verified by confirming report contains accurate migration statistics and actionable insights

### Implementation for User Story 5

- [ ] T029 [P] [US5] Create final system validation script in `/usr/local/src/sage/dataload/validation/final-system-validation.ts`
- [ ] T030 [US5] Create comprehensive final report generator in `/usr/local/src/sage/dataload/src/generate-final-report.ts`
- [ ] T031 [P] [US5] Create automated execution script `/usr/local/src/sage/dataload/execute-final-migration.sh`

**Checkpoint**: Complete system status should be documented with actionable recommendations

---

## Phase 8: Polish & Integration

**Purpose**: Cross-cutting improvements and integration testing

- [ ] T032 [P] Create database connection testing utility in `/usr/local/src/sage/dataload/scripts/test-db-connections.ts`
- [ ] T033 [P] Create source data analysis utility in `/usr/local/src/sage/dataload/scripts/analyze-source-data.ts`
- [ ] T034 [P] Create target schema verification utility in `/usr/local/src/sage/dataload/scripts/verify-target-schema.ts`
- [ ] T035 [P] Create comprehensive data integrity checker in `/usr/local/src/sage/dataload/validation/check-data-integrity.ts`
- [ ] T036 [P] Create foreign key validation utility in `/usr/local/src/sage/dataload/validation/check-foreign-keys.ts`
- [ ] T037 [P] Create record count verification utility in `/usr/local/src/sage/dataload/validation/verify-record-counts.ts`
- [ ] T038 Update project documentation for final migration phase

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phases 3-7)**: All depend on Foundational phase completion
  - User stories can proceed in parallel (if staffed)
  - Or sequentially in priority order (US2, US1, US5 first, then US3, US4)
- **Polish (Phase 8)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 3 (P2)**: Can start after Foundational - Template groups before template roles, treatment discussions independent
- **User Story 2 (P1)**: Can start after Foundational - Technicians before technician roles
- **User Story 4 (P2)**: Can start after Foundational - All tables independent of each other
- **User Story 1 (P1)**: Can start after Foundational - Requires existing messages and files tables
- **User Story 5 (P1)**: Must start after all migration user stories complete

### Migration Table Order (Sequential within execution)

Based on dependency analysis from contracts:
1. template_view_groups → template_view_roles (US3)
2. technicians → technician_roles (US2)
3. brackets (US4)
4. treatment_discussions (US3)
5. order_cases (US4)
6. message_attachments (US1)
7. purchases (US4)

### Parallel Opportunities

- **Setup Phase**: All tasks T001-T005 can run in parallel
- **Foundational Phase**: Tasks T007, T008 can run in parallel with T006, T009, T010
- **Between User Stories**: US2, US3, US4 can start in parallel after foundational
- **Within User Stories**: Validation scripts can be written in parallel with migration scripts for different tables
- **Polish Phase**: Most validation and utility scripts (T032-T037) can run in parallel

---

## Parallel Example: User Story 2 (Personnel Tables)

```bash
# Launch technicians migration and validation together:
Task: "Create technicians migration script in /usr/local/src/sage/dataload/src/migrate-technicians.ts"
Task: "Create technicians validation script in /usr/local/src/sage/dataload/validation/validate-technicians.ts"

# Then launch technician roles (after technicians complete):
Task: "Create technician_roles migration script in /usr/local/src/sage/dataload/src/migrate-technician-roles.ts"
Task: "Create technician_roles validation script in /usr/local/src/sage/dataload/validation/validate-technician-roles.ts"
```

---

## Implementation Strategy

### MVP First (Critical Tables)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete User Story 2: Personnel Tables (P1)
4. Complete User Story 1: Message Attachments (P1)
5. Complete User Story 5: Final Report (P1)
6. **STOP and VALIDATE**: Test critical functionality independently

### Full Implementation

1. Complete Setup + Foundational → Foundation ready
2. Launch US2 (Personnel) + US3 (Templates) + US4 (Operational) in parallel
3. Complete US1 (Message Attachments) after core tables
4. Complete US5 (Final Report) after all migrations
5. Complete Polish phase for production readiness

### Critical Path

The fastest path to a working system:
1. Foundational (T006-T010) - Required for everything
2. Personnel Tables (T017-T020) - Critical for system operations
3. Message Attachments (T027-T028) - Critical for communication completeness
4. Final Report (T029-T030) - Critical for validation and handoff

---

## Notes

- [P] tasks = different files, no dependencies within user story
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Migration scripts follow existing patterns from successful migrations (messages, orders, cases)
- All scripts support TEST_MODE, batch processing, error recovery, and progress tracking
- Financial data (purchases) requires extra validation due to audit requirements
- Legacy ID preservation is mandatory for all tables
- Each migration maintains complete audit trail in metadata JSON fields