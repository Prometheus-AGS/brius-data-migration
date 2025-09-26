# Tasks: Database Migration and Synchronization System

**Input**: Design documents from `/specs/001-i-need-to/`
**Prerequisites**: plan.md (required), research.md, data-model.md, contracts/

## Execution Flow (main)
```
1. Load plan.md from feature directory
   → If not found: ERROR "No implementation plan found"
   → Extract: tech stack, libraries, structure
2. Load optional design documents:
   → data-model.md: Extract entities → model tasks
   → contracts/: Each file → contract test task
   → research.md: Extract decisions → setup tasks
3. Generate tasks by category:
   → Setup: project init, dependencies, linting
   → Tests: contract tests, integration tests
   → Core: models, services, CLI commands
   → Integration: DB, middleware, logging
   → Polish: unit tests, performance, docs
4. Apply task rules:
   → Different files = mark [P] for parallel
   → Same file = sequential (no [P])
   → Tests before implementation (TDD)
5. Number tasks sequentially (T001, T002...)
6. Generate dependency graph
7. Create parallel execution examples
8. Validate task completeness:
   → All contracts have tests?
   → All entities have models?
   → All endpoints implemented?
9. Return: SUCCESS (tasks ready for execution)
```

## Format: `[ID] [P?] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- Include exact file paths in descriptions

## Path Conventions
- **Single project**: `src/`, `tests/` at repository root
- Paths assume TypeScript single project structure extending existing migration system

## Phase 3.1: Setup & Database Schema
- [x] T001 Create database schema tables from `contracts/database-schema.sql` in target database
- [x] T002 [P] Create migration control extension tables (migration_checkpoints, data_differentials, synchronization_jobs, migration_validation_reports, sync_run_history)
- [x] T003 [P] Add npm script commands for new migration tools in `package.json`
- [x] T004 [P] Create TypeScript interfaces from data model in `src/types/migration-types.ts`

## Phase 3.2: Tests First (TDD) ⚠️ MUST COMPLETE BEFORE 3.3
**CRITICAL: These tests MUST be written and MUST FAIL before ANY implementation**

### Contract Tests (CLI Interface)
- [x] T005 [P] Contract test differential migration CLI in `tests/contract/differential-migration.test.ts`
- [x] T006 [P] Contract test sync scheduler create job CLI in `tests/contract/sync-scheduler-create.test.ts`
- [x] T007 [P] Contract test sync scheduler status CLI in `tests/contract/sync-scheduler-status.test.ts`
- [x] T008 [P] Contract test validation CLI in `tests/contract/validation.test.ts`

### Integration Tests (Quickstart Scenarios)
- [x] T009 [P] Integration test Scenario 1: Differential Migration in `tests/integration/differential-migration.test.ts`
- [x] T010 [P] Integration test Scenario 2: Sync Scheduler Setup in `tests/integration/sync-scheduler.test.ts`
- [x] T011 [P] Integration test Scenario 3: Conflict Resolution in `tests/integration/conflict-resolution.test.ts`
- [x] T012 [P] Integration test Scenario 4: Error Recovery and Checkpointing in `tests/integration/error-recovery.test.ts`
- [x] T013 [P] Integration test Scenario 5: Comprehensive Validation in `tests/integration/comprehensive-validation.test.ts`

## Phase 3.3: Core Models (ONLY after tests are failing)
- [x] T014 [P] Migration Checkpoint model in `src/models/migration-checkpoint.ts`
- [x] T015 [P] Data Differential model in `src/models/data-differential.ts`
- [x] T016 [P] Synchronization Job model in `src/models/synchronization-job.ts`
- [x] T017 [P] Migration Validation Report model in `src/models/migration-validation-report.ts`
- [x] T018 [P] Sync Run History model in `src/models/sync-run-history.ts`

## Phase 3.4: Core Services
- [x] T019 [P] Migration Analyzer service in `src/services/migration-analyzer.ts` (analyze existing scripts for reusability)
- [x] T020 [P] Data Comparator service in `src/services/data-comparator.ts` (identify missing/conflicted records)
- [x] T021 [P] Conflict Resolver service in `src/services/conflict-resolver.ts` (implement source-wins strategy)
- [x] T022 [P] Sync Logger service in `src/services/sync-logger.ts` (file-based structured logging)
- [x] T023 Differential Migration service in `src/services/differential-migration-service.ts` (coordinates migration process)
- [x] T024 Sync Scheduler service in `src/services/sync-scheduler-service.ts` (scheduled job management)
- [x] T025 Data Validator service in `src/services/data-validator.ts` (comprehensive validation checks)

## Phase 3.5: CLI Commands Implementation
- [x] T026 Differential Migration CLI in `src/cli/differential-migration.ts` (analyze, migrate commands with args)
- [x] T027 Sync Scheduler CLI in `src/cli/sync-scheduler.ts` (create-job, list-jobs, run-job, job-status commands)
- [x] T028 Data Validator CLI in `src/cli/data-validator.ts` (validate, report, check-record commands)
- [x] T029 Migration Analyzer CLI in `src/cli/migration-analyzer.ts` (checkpoint-status, reset-checkpoint, debug commands)

## Phase 3.6: Database Integration
- [x] T030 Database connection utility extending existing patterns in `src/lib/database-connections.ts`
- [x] T031 Batch processor utility extending existing patterns in `src/lib/batch-processor.ts`
- [x] T032 UUID mapper utility extending existing patterns in `src/lib/uuid-mapper.ts`
- [x] T033 Migration checkpoint manager in `src/lib/checkpoint-manager.ts` (save/restore state)

## Phase 3.7: Core Feature Implementation
- [x] T034 Differential migration orchestrator in `src/differential-migration.ts` (main entry point, CLI integration)
- [x] T035 Sync scheduler orchestrator in `src/sync-scheduler.ts` (main entry point, job management)
- [x] T036 Data validation orchestrator in `src/data-validator.ts` (main entry point, validation workflows)
- [x] T037 Conflict resolution orchestrator in `src/conflict-resolver.ts` (handles conflicts during sync)

## Phase 3.8: Polish & Performance
- [x] T038 [P] Unit tests for Migration Checkpoint model in `tests/unit/migration-checkpoint.test.ts`
- [x] T039 [P] Unit tests for Sync Scheduler service in `tests/unit/sync-scheduler-service.test.ts`
- [x] T040 [P] Unit tests for Conflict Resolver service in `tests/unit/conflict-resolver.test.ts`
- [x] T041 [P] Performance tests for 100K record processing in `tests/performance/large-dataset.test.ts`
- [x] T042 [P] Performance benchmarks for sync operations in `tests/performance/sync-benchmarks.test.ts`
- [x] T043 [P] Update CLAUDE.md with new migration commands and patterns
- [x] T044 [P] Create migration troubleshooting guide in `docs/troubleshooting.md`
- [x] T045 Execute quickstart.md scenarios to validate end-to-end functionality

## Dependencies
**Critical Dependencies**:
- Database setup (T001-T003) before all other tasks
- Tests (T005-T013) before implementation (T014-T037)
- Models (T014-T018) before services (T019-T025)
- Services before CLI commands (T026-T029)
- Core utilities (T030-T033) before orchestrators (T034-T037)

**Service Dependencies**:
- T023 (Differential Migration service) depends on T019, T020, T021
- T024 (Sync Scheduler service) depends on T033
- T025 (Data Validator service) depends on T020

**CLI Dependencies**:
- T026 depends on T023
- T027 depends on T024
- T028 depends on T025
- T029 depends on T033

## Parallel Execution Examples

### Phase 3.2: All Contract Tests (can run simultaneously)
```bash
# Launch T005-T008 together:
Task: "Contract test differential migration CLI in tests/contract/differential-migration.test.ts"
Task: "Contract test sync scheduler create job CLI in tests/contract/sync-scheduler-create.test.ts"
Task: "Contract test sync scheduler status CLI in tests/contract/sync-scheduler-status.test.ts"
Task: "Contract test validation CLI in tests/contract/validation.test.ts"
```

### Phase 3.2: All Integration Tests (can run simultaneously)
```bash
# Launch T009-T013 together:
Task: "Integration test Scenario 1: Differential Migration in tests/integration/differential-migration.test.ts"
Task: "Integration test Scenario 2: Sync Scheduler Setup in tests/integration/sync-scheduler.test.ts"
Task: "Integration test Scenario 3: Conflict Resolution in tests/integration/conflict-resolution.test.ts"
Task: "Integration test Scenario 4: Error Recovery and Checkpointing in tests/integration/error-recovery.test.ts"
Task: "Integration test Scenario 5: Comprehensive Validation in tests/integration/comprehensive-validation.test.ts"
```

### Phase 3.3: All Model Creation (can run simultaneously)
```bash
# Launch T014-T018 together:
Task: "Migration Checkpoint model in src/models/migration-checkpoint.ts"
Task: "Data Differential model in src/models/data-differential.ts"
Task: "Synchronization Job model in src/models/synchronization-job.ts"
Task: "Migration Validation Report model in src/models/migration-validation-report.ts"
Task: "Sync Run History model in src/models/sync-run-history.ts"
```

### Phase 3.4: Independent Services (can run simultaneously)
```bash
# Launch T019-T022 together (independent services):
Task: "Migration Analyzer service in src/services/migration-analyzer.ts"
Task: "Data Comparator service in src/services/data-comparator.ts"
Task: "Conflict Resolver service in src/services/conflict-resolver.ts"
Task: "Sync Logger service in src/services/sync-logger.ts"
```

## Notes
- [P] tasks = different files, no dependencies between them
- Verify tests fail before implementing corresponding functionality
- Commit after each significant task completion
- Reuse existing migration patterns from `src/office-migration.ts`, `src/doctor-migration.ts`, etc.
- Extend existing `migration_control` and `migration_mappings` tables rather than replacing
- Maintain compatibility with existing npm run commands and CLI patterns

## Task Generation Rules Applied

1. **From Contracts** (cli-commands.yaml):
   - 4 contract files → 4 contract test tasks (T005-T008) [P]
   - 4 CLI endpoints → 4 CLI implementation tasks (T026-T029)

2. **From Data Model**:
   - 5 entities → 5 model creation tasks (T014-T018) [P]
   - Entity relationships → service layer tasks (T019-T025)

3. **From Quickstart Scenarios**:
   - 5 scenarios → 5 integration test tasks (T009-T013) [P]
   - Validation scenarios → comprehensive validation tasks (T041-T045)

4. **From Research Decisions**:
   - Database schema → setup tasks (T001-T004)
   - Existing infrastructure reuse → utility extension tasks (T030-T033)

## Validation Checklist
*GATE: Checked before task execution*

- [x] All contracts have corresponding test tasks (T005-T008)
- [x] All entities have model creation tasks (T014-T018)
- [x] All tests come before implementation (Phase 3.2 before 3.3+)
- [x] Parallel tasks are truly independent (different files, no shared dependencies)
- [x] Each task specifies exact file path
- [x] No [P] task modifies same file as another [P] task
- [x] TDD workflow: failing tests → implementation → passing tests
- [x] Extends existing migration system rather than replacing it