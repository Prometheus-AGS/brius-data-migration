# Tasks: Differential Database Migration System

**Input**: Design documents from `/specs/001-continue-migration-all/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4, US5)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

### T001 [P] [SETUP] Initialize TypeScript project structure ✅
Create directory structure `src/differential-migration/{services,models,cli,lib}/` and basic TypeScript configuration files (tsconfig.json, package.json updates, .gitignore updates for new directories).

### T002 [P] [SETUP] Install and configure dependencies ✅
Add pg, @supabase/supabase-js, dotenv, @types/pg to package.json. Configure Jest for TypeScript testing. Update scripts for linting and testing.

### T003 [P] [SETUP] Create database schema migration scripts ✅
Create SQL scripts in `src/differential-migration/sql/`:
- `001_create_differential_migration_tables.sql`
- `002_add_differential_indexes.sql`
- `003_create_differential_functions.sql`

### T004 [P] [SETUP] Setup test infrastructure ✅
Create test directory structure `tests/{integration,unit,fixtures}/` with sample test data files and Jest configuration for database testing.

## Phase 2: Data Models (TDD Foundation)

**Purpose**: Core entity definitions and validation

### T005 [P] [US1,US2] Test: MigrationCheckpoint model validation ✅
Create `tests/unit/models/migration-checkpoint.test.ts` - Test checkpoint creation, validation rules, state transitions (Created → Active → Suspended → Completed).

### T006 [P] [US2] Test: DifferentialAnalysisResult model validation ✅
Create `tests/unit/models/differential-result.test.ts` - Test analysis result creation, record count validation, change percentage calculations.

### T007 [P] [US4] Test: MigrationStatus model validation ✅
Create `tests/unit/models/migration-status.test.ts` - Test status tracking, entity arrays, progress calculations, state machine transitions.

### T008 [P] [US5] Test: SchemaMappingDefinition model validation ✅
Create `tests/unit/models/schema-mapping.test.ts` - Test field mappings, validation rules, transformation functions.

### T009 [P] [US3,US4] Test: MigrationExecutionLog model validation ✅
Create `tests/unit/models/execution-log.test.ts` - Test log entry creation, level validation, context data serialization.

### T010 [US1,US2] Implement MigrationCheckpoint model ✅
Create `src/differential-migration/models/migration-checkpoint.ts` - Implement interface, validation, state transitions, serialization/deserialization.

### T011 [US2] Implement DifferentialAnalysisResult model ✅
Create `src/differential-migration/models/differential-result.ts` - Implement interface, change calculations, record ID array management.

### T012 [US4] Implement MigrationStatus model ✅
Create `src/differential-migration/models/migration-status.ts` - Implement interface, progress tracking, entity management, ETA calculations.

### T013 [US5] Implement SchemaMappingDefinition model ✅
Create `src/differential-migration/models/schema-mapping.ts` - Implement interface, field mapping logic, validation rule processing.

### T014 [US3,US4] Implement MigrationExecutionLog model ✅
Create `src/differential-migration/models/execution-log.ts` - Implement interface, structured logging, context serialization.

## Phase 3: Core Services (TDD Implementation)

**Purpose**: Business logic for differential migration operations

### T015 [P] [US1] Test: BaselineAnalyzer service ✅
Create `tests/unit/services/baseline-analyzer.test.ts` - Test database comparison, record counting, mapping analysis, gap identification.

### T016 [P] [US2] Test: DifferentialDetector service ✅
Create `tests/unit/services/differential-detector.test.ts` - Test timestamp-based detection, content hash verification, change classification.

### T017 [P] [US3] Test: MigrationExecutor service ✅
Create `tests/unit/services/migration-executor.test.ts` - Test batch processing, dependency ordering, checkpoint creation, error handling.

### T018 [P] [US4] Test: ProgressTracker service ✅
Create `tests/unit/services/progress-tracker.test.ts` - Test real-time updates, performance metrics, ETA calculations.

### T019 [US1] Implement BaselineAnalyzer service ✅
Create `src/differential-migration/services/baseline-analyzer.ts` - Implement database comparison logic, record counting, mapping validation, status assessment.

### T020 [US2] Implement DifferentialDetector service ✅
Create `src/differential-migration/services/differential-detector.ts` - Implement timestamp-based change detection, content hashing, record classification.

### T021 [US3] Implement MigrationExecutor service ✅
Create `src/differential-migration/services/migration-executor.ts` - Implement batch processing, checkpoint management, dependency-aware execution.

### T022 [US4] Implement ProgressTracker service ✅
Create `src/differential-migration/services/progress-tracker.ts` - Implement real-time progress tracking, performance monitoring, status reporting.

## Phase 4: Library Components (TDD Support)

**Purpose**: Utility libraries for core services

### T023 [P] [US1,US2] Test: DatabaseComparator library ✅
Create `tests/unit/lib/database-comparator.test.ts` - Test connection pooling, query optimization, result comparison.

### T024 [P] [US5] Test: SchemaAnalyzer library ✅
Create `tests/unit/lib/schema-analyzer.test.ts` - Test schema introspection, difference detection, mapping recommendations.

### T025 [P] [US1,US3] Test: CheckpointManager library ✅
Create `tests/unit/lib/checkpoint-manager.test.ts` - Test checkpoint save/restore, state serialization, recovery operations.

### T026 [US1,US2] Implement DatabaseComparator library ✅
Create `src/differential-migration/lib/database-comparator.ts` - Implement connection pooling, efficient querying, data comparison utilities.

### T027 [US5] Implement SchemaAnalyzer library ✅
Create `src/differential-migration/lib/schema-analyzer.ts` - Implement schema introspection, difference analysis, automatic mapping generation.

### T028 [US1,US3] Implement CheckpointManager library ✅
Create `src/differential-migration/lib/checkpoint-manager.ts` - Implement checkpoint persistence, state management, recovery logic.

## Phase 5: CLI Commands (TDD User Interface)

**Purpose**: Command-line interfaces for user interaction

### T029 [P] [US1] Test: Baseline analysis CLI ✅
Create `tests/unit/cli/baseline-cli.test.ts` - Test command parsing, output formatting, error handling for `differential:analyze`.

### T030 [P] [US2] Test: Differential detection CLI ✅
Create `tests/unit/cli/differential-cli.test.ts` - Test command parsing, file output, progress display for `differential:detect`.

### T031 [P] [US4] Test: Status monitoring CLI ✅
Create `tests/unit/cli/status-cli.test.ts` - Test watch mode, formatting, session management for `differential:status`.

### T032 [US1] Implement baseline analysis CLI ✅
Create `src/differential-migration/cli/baseline-cli.ts` - Implement `differential:analyze` command with table/JSON output, entity filtering.

### T033 [US2] Implement differential detection CLI ✅
Create `src/differential-migration/cli/differential-cli.ts` - Implement `differential:detect` command with timestamp filtering, result persistence.

### T034 [US3] Implement migration execution CLI ✅
Create `src/differential-migration/cli/migration-cli.ts` - Implement `differential:migrate` command with batch control, parallel execution.

### T035 [US4] Implement status monitoring CLI ✅
Create `src/differential-migration/cli/status-cli.ts` - Implement `differential:status` command with watch mode, detailed metrics.

### T036 [US3,US4] Implement migration control CLI ✅
Create `src/differential-migration/cli/control-cli.ts` - Implement `differential:control` command for pause/resume/cancel operations.

### T037 [US4] Implement logs viewing CLI ✅
Create `src/differential-migration/cli/logs-cli.ts` - Implement `differential:logs` command with filtering, export functionality.

## Phase 6: API Endpoints (TDD REST Interface)

**Purpose**: REST API for programmatic access

### T038 [P] [US1] Test: Baseline analysis endpoint ✅
Create `tests/integration/api/baseline.test.ts` - Test POST /api/migration/baseline with various entity configurations.

### T039 [P] [US2] Test: Differential analysis endpoint ✅
Create `tests/integration/api/differential.test.ts` - Test POST /api/migration/differential with timestamp filtering.

### T040 [P] [US3] Test: Migration execution endpoint ✅
Create `tests/integration/api/execute.test.ts` - Test POST /api/migration/execute with session management.

### T041 [P] [US4] Test: Status retrieval endpoints ✅
Create `tests/integration/api/status.test.ts` - Test GET /api/migration/status/{sessionId} and control endpoints.

### T042 [US1] Implement baseline analysis endpoint ✅
Create API handler for POST /api/migration/baseline - Integrate with BaselineAnalyzer service, implement OpenAPI schema validation.

### T043 [US2] Implement differential analysis endpoint ✅
Create API handler for POST /api/migration/differential - Integrate with DifferentialDetector service, handle async processing.

### T044 [US3] Implement migration execution endpoint ✅
Create API handler for POST /api/migration/execute - Integrate with MigrationExecutor service, session management.

### T045 [US4] Implement status and control endpoints ✅
Create API handlers for GET /api/migration/status/{sessionId}, POST /api/migration/pause/{sessionId}, POST /api/migration/resume/{sessionId}.

### T046 [US4] Implement logs retrieval endpoint ✅
Create API handler for GET /api/migration/logs/{sessionId} - Implement filtering, pagination, export functionality.

## Phase 7: Integration Tests (TDD End-to-End)

**Purpose**: Comprehensive workflow validation

### T047 [P] [US1] Test: Complete baseline analysis workflow
Create `tests/integration/baseline-analysis.test.ts` - Test end-to-end baseline analysis with real database connections.

### T048 [P] [US2] Test: Complete differential detection workflow
Create `tests/integration/differential-detection.test.ts` - Test end-to-end change detection with sample data modifications.

### T049 [P] [US3] Test: Complete migration execution workflow
Create `tests/integration/migration-execution.test.ts` - Test end-to-end migration with checkpointing and recovery.

### T050 [P] [US4] Test: Real-time monitoring workflow
Create `tests/integration/real-time-monitoring.test.ts` - Test progress tracking, status updates, log streaming.

### T051 [P] [US5] Test: Schema evolution handling
Create `tests/integration/schema-evolution.test.ts` - Test schema change detection and mapping updates.

### T052 [US1,US2,US3] Integration: Daily incremental sync scenario
Implement comprehensive test for quickstart Scenario 1 - Daily incremental sync workflow with minimal changes.

### T053 [US3,US4] Integration: Recovery from failed migration scenario
Implement comprehensive test for quickstart Scenario 2 - Migration interruption and checkpoint-based recovery.

### T054 [US3,US4] Integration: Large backlog processing scenario
Implement comprehensive test for quickstart Scenario 3 - Efficient processing of significant data backlogs.

## Phase 8: NPM Script Integration

**Purpose**: Package.json script configuration

### T055 [P] [SETUP] Configure NPM scripts for differential commands
Update package.json with scripts for `differential:analyze`, `differential:detect`, `differential:migrate`, `differential:status`, `differential:control`, `differential:logs`.

### T056 [P] [SETUP] Configure development and testing scripts
Add scripts for development mode, testing, linting, and build processes specific to differential migration components.

## Phase 9: Documentation and Polish

**Purpose**: Production readiness

### T057 [P] [US1,US2,US3,US4,US5] Create comprehensive API documentation
Generate OpenAPI documentation with examples, integrate with existing documentation structure.

### T058 [P] [US1,US2,US3,US4,US5] Create CLI help documentation
Implement --help options for all CLI commands with detailed usage examples and parameter descriptions.

### T059 [P] [SETUP] Performance optimization and monitoring
Implement performance monitoring, memory usage optimization, connection pool tuning based on research.md recommendations.

### T060 [P] [SETUP] Security hardening and error handling
Implement comprehensive error handling, input validation, and security measures for production deployment.

## Parallel Execution Examples

**Run parallel model tests:**
```bash
Task: Run tasks T005, T006, T007, T008, T009 in parallel
```

**Run parallel service tests:**
```bash
Task: Run tasks T015, T016, T017, T018 in parallel
```

**Run parallel API endpoint tests:**
```bash
Task: Run tasks T038, T039, T040, T041 in parallel
```

**Run parallel integration tests:**
```bash
Task: Run tasks T047, T048, T049, T050, T051 in parallel
```

## Dependencies Summary

- **Setup tasks (T001-T004)** must complete before any implementation
- **Model tests (T005-T009)** can run in parallel, must complete before model implementation
- **Model implementation (T010-T014)** must complete before service tests
- **Service tests (T015-T018)** can run in parallel, must complete before service implementation
- **Library tests (T023-T025)** can run in parallel with service tests
- **CLI and API tests** can run in parallel after core services are implemented
- **Integration tests** require all core components to be complete
- **Polish tasks** can run in parallel after integration tests pass