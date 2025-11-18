# Tasks: Full Database Migration with Schema Updates

**Input**: Design documents from `/specs/001-full-database-migration/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root
- Paths assume single project structure per plan.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and enhanced migration system structure

- [x] T001 Create enhanced project structure per implementation plan in src/full-migration/
- [x] T002 Initialize TypeScript 5.9+ project with Node.js 18+ and configure dependencies (pg, @supabase/supabase-js, dotenv)
- [x] T003 [P] Configure ESLint and Prettier for TypeScript migration codebase
- [x] T004 [P] Setup Jest testing framework with TypeScript integration in tests/
- [x] T005 [P] Create base environment configuration management in src/lib/environment-config.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T006 Implement enhanced database connection management in src/lib/database-connections.ts
- [x] T007 [P] Create UUID mapper service with legacy ID preservation in src/lib/uuid-mapper.ts
- [x] T008 [P] Implement batch processor with adaptive sizing (500-2000 records) in src/lib/batch-processor.ts
- [ ] T009 [P] Create checkpoint manager for resumable migrations in src/lib/checkpoint-manager.ts
- [ ] T010 Implement migration orchestration data models per data-model.md in src/models/migration-models.ts
- [ ] T011 [P] Setup comprehensive error handling and logging infrastructure in src/lib/error-handler.ts
- [ ] T012 [P] Create migration event publishing system per data-model.md in src/lib/event-publisher.ts
- [ ] T013 Create base CLI framework structure in src/cli/base-cli.ts
- [ ] T014 Implement database schema validation utilities in src/lib/schema-validator.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Database Administrator Executes Complete Migration (Priority: P1) 🎯 MVP

**Goal**: Complete end-to-end migration of all 50+ dispatch_* tables from PostgreSQL to Supabase with incremental capability

**Independent Test**: Execute full migration process and verify all expected data appears in destination database with correct counts, relationships, and schema structure

### Implementation for User Story 1

- [ ] T015 [P] [US1] Create MigrationOrchestration model with state transitions in src/models/migration-orchestration.ts
- [ ] T016 [P] [US1] Create EntityMigrationStatus model with dependency tracking in src/models/entity-migration-status.ts
- [ ] T017 [P] [US1] Create MigrationCheckpoint model for resumability in src/models/migration-checkpoint.ts
- [ ] T018 [P] [US1] Create MigrationMapping model for legacy ID preservation in src/models/migration-mapping.ts
- [ ] T019 [P] [US1] Create BatchProcessingStatus model for performance monitoring in src/models/batch-processing-status.ts
- [ ] T020 [P] [US1] Create MigrationError model with comprehensive error tracking in src/models/migration-error.ts
- [ ] T021 [US1] Implement full migration orchestrator service with dependency management in src/full-migration/full-migration-orchestrator.ts
- [ ] T022 [US1] Implement incremental migration service with timestamp + checkpoint detection in src/full-migration/incremental-migration-service.ts
- [ ] T023 [US1] Create entity dependency resolver following Offices→Profiles→Doctors→Patients→Orders order in src/services/entity-dependency-resolver.ts
- [ ] T024 [US1] Implement legacy entity mapping transformer in src/services/legacy-entity-mapper.ts
- [ ] T025 [US1] Create migration progress tracker with real-time metrics in src/services/migration-progress-tracker.ts
- [ ] T026 [US1] Implement comprehensive validation service per SC-002 (99.5% success rate) in src/full-migration/validation-service.ts
- [ ] T027 [US1] Create main migration CLI command in src/cli/full-migration.ts
- [ ] T028 [US1] Implement root-level orchestration script migrate-full-database.ts
- [ ] T029 [US1] Add error recovery and rollback capabilities per FR-014 in src/services/migration-rollback-service.ts
- [ ] T030 [US1] Create comprehensive validation script validate-full-migration.ts
- [ ] T031 [US1] Implement performance monitoring to meet 1000+ records/second goal in src/services/performance-monitor.ts
- [ ] T032 [US1] Add comprehensive audit logging per FR-012 requirements in src/services/audit-logger.ts

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Schema Cleanup and Standardization (Priority: P2)

**Goal**: Clean up destination schema by removing specified unused columns while maintaining data integrity

**Independent Test**: Examine destination schema structure and confirm specific columns are removed while data integrity is maintained

### Implementation for User Story 2

- [ ] T033 [P] [US2] Create SchemaChangeOperation model for tracking column removal operations in src/models/schema-change-operation.ts
- [ ] T034 [P] [US2] Create backup table management service in src/services/backup-table-service.ts
- [ ] T035 [US2] Implement schema cleanup service with 4-phase gradual removal strategy in src/full-migration/schema-cleanup-service.ts
- [ ] T036 [US2] Create column dependency analyzer to prevent removing legacy_patient_id in src/services/column-dependency-analyzer.ts
- [ ] T037 [US2] Implement safe column removal with validation checks in src/services/safe-column-remover.ts
- [ ] T038 [US2] Create schema cleanup CLI command in src/cli/schema-cleanup.ts
- [ ] T039 [US2] Implement root-level schema cleanup script migrate-schema-cleanup.ts
- [ ] T040 [US2] Add rollback capabilities for schema changes in src/services/schema-rollback-service.ts
- [ ] T041 [US2] Create pre-deployment validation for column removal in src/services/schema-validation-service.ts
- [ ] T042 [US2] Implement backup and restore functionality for removed columns in src/services/column-backup-service.ts

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Comment Hierarchy Migration with Relationship Preservation (Priority: P3)

**Goal**: Migrate comment data from dispatch_comment to hierarchical comments system while preserving relationships

**Independent Test**: Migrate comments and verify that comment content, authorship, and related entities are properly preserved

### Implementation for User Story 3

- [ ] T043 [P] [US3] Create comment transformation service for dispatch_comment→comments mapping in src/services/comment-transformer.ts
- [ ] T044 [P] [US3] Implement author relationship mapper for auth_user→profiles linkage in src/services/comment-author-mapper.ts
- [ ] T045 [US3] Create comment hierarchy builder for parent-child relationships in src/services/comment-hierarchy-builder.ts
- [ ] T046 [US3] Implement comment migration service with relationship preservation in src/services/comment-migration-service.ts
- [ ] T047 [US3] Add comment validation service to ensure content and author integrity in src/services/comment-validator.ts
- [ ] T048 [US3] Create comment migration CLI utilities in src/cli/comment-migration.ts
- [ ] T049 [US3] Implement comment-specific error handling and recovery in src/services/comment-error-handler.ts

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories and production readiness

- [ ] T050 [P] Create comprehensive API implementation per contracts/migration-api.yaml in src/api/
- [ ] T051 [P] Implement monitoring endpoints for real-time metrics in src/api/monitoring-controller.ts
- [ ] T052 [P] Add authentication and authorization for migration API in src/middleware/auth-middleware.ts
- [ ] T053 [P] Create integration tests for full migration workflow in tests/integration/full-migration.test.ts
- [ ] T054 [P] Add performance tests for 1000+ records/second requirement in tests/performance/throughput.test.ts
- [ ] T055 [P] Create validation tests for 99.5% success rate requirement in tests/validation/success-rate.test.ts
- [ ] T056 [P] Implement unit tests for core services in tests/unit/
- [ ] T057 [P] Add memory usage monitoring per 512MB constraint in src/services/memory-monitor.ts
- [ ] T058 Create production deployment configuration and Docker setup
- [ ] T059 [P] Generate comprehensive documentation in docs/
- [ ] T060 Add security hardening for database credentials and API access
- [ ] T061 Create quickstart.md validation and testing procedures
- [ ] T062 Implement agent system integration per plan.md in agents/migration-orchestrator/
- [ ] T063 [P] Add comprehensive error alerting and notification system
- [ ] T064 Final integration testing and performance validation

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Requires US1 migration infrastructure but should be independently testable
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Requires US1 profile migration for author relationships but should be independently testable

### Within Each User Story

- Models can be created in parallel (marked [P])
- Services depend on their required models
- CLI components depend on services
- Root-level scripts depend on CLI components
- Validation and monitoring can be developed in parallel

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- Models within each story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# Launch all models for User Story 1 together:
Task: "Create MigrationOrchestration model with state transitions in src/models/migration-orchestration.ts"
Task: "Create EntityMigrationStatus model with dependency tracking in src/models/entity-migration-status.ts"
Task: "Create MigrationCheckpoint model for resumability in src/models/migration-checkpoint.ts"
Task: "Create MigrationMapping model for legacy ID preservation in src/models/migration-mapping.ts"
Task: "Create BatchProcessingStatus model for performance monitoring in src/models/batch-processing-status.ts"
Task: "Create MigrationError model with comprehensive error tracking in src/models/migration-error.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo
4. Add User Story 3 → Test independently → Deploy/Demo
5. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (Core Migration)
   - Developer B: User Story 2 (Schema Cleanup)
   - Developer C: User Story 3 (Comments Migration)
3. Stories complete and integrate independently

---

## Performance & Success Criteria Validation

### Success Criteria Tasks Mapping

- **SC-001** (4-hour completion): Validated by T031 performance monitoring
- **SC-002** (99.5% success rate): Validated by T026 comprehensive validation service
- **SC-003** (100% referential integrity): Validated by T030 comprehensive validation script
- **SC-004** (Schema cleanup): Delivered by User Story 2 tasks T033-T042
- **SC-005** (80% incremental improvement): Delivered by T022 incremental migration service
- **SC-006** (Audit trails): Delivered by T032 comprehensive audit logging
- **SC-007** (Resume capability): Delivered by T017 MigrationCheckpoint model and T009 checkpoint manager
- **SC-008** (Zero data loss): Validated by T026 validation service and T055 validation tests

### Critical Performance Requirements

- **1000+ records/second**: T031 performance monitoring + T054 performance tests
- **<512MB memory usage**: T057 memory usage monitoring
- **99.5% success rate**: T026 validation service + T055 validation tests
- **Resume with <5% duplicate processing**: T009 checkpoint manager + T017 MigrationCheckpoint model

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Critical research finding: DO NOT remove profiles.legacy_patient_id (242 occurrences across 53 files)
- Schema cleanup follows 4-phase gradual removal strategy per research.md
- Incremental migration uses hybrid timestamp + checkpoint approach
- All file paths follow single project structure per plan.md
- Focus on leveraging existing migration infrastructure rather than rebuilding
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently