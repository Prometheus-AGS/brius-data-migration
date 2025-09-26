# Tasks: Comprehensive Migration Scripts Coverage

**Input**: Design documents from `/usr/local/src/sage/dataload/specs/002-we-need-to/`
**Prerequisites**: plan.md (✅), research.md (✅), data-model.md (✅), contracts/ (✅)

## Execution Flow (main)
```
1. Load plan.md from feature directory
   ✅ Tech stack: TypeScript 5.9+ with Node.js ES2020
   ✅ Extract: pg, @supabase/supabase-js, dotenv, Jest testing
2. Load optional design documents:
   ✅ data-model.md: 7 core entities → model tasks
   ✅ contracts/: 8 API endpoints → contract test tasks
   ✅ research.md: Validated technical decisions → setup tasks
3. Generate tasks by category:
   ✅ Setup: TypeScript project, dependencies, linting
   ✅ Tests: contract tests for 8 endpoints, integration tests
   ✅ Core: 7 entity models, migration coverage services
   ✅ Integration: API server, database connections, validation
   ✅ Polish: unit tests, performance validation, docs
4. Apply task rules:
   ✅ Different files = mark [P] for parallel
   ✅ Same file = sequential (no [P])
   ✅ Tests before implementation (TDD)
5. Number tasks sequentially (T001-T036)
6. Generate dependency graph and parallel execution examples
```

## Format: `[ID] [P?] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- Include exact file paths in descriptions

## Phase 3.1: Setup
- [x] T001 Create migration coverage API project structure in `/usr/local/src/sage/dataload/src/migration-coverage/`
- [x] T002 Initialize TypeScript project with Jest, pg, @supabase/supabase-js dependencies in migration-coverage/
- [x] T003 [P] Configure ESLint, Prettier, and TypeScript compiler options for migration-coverage/

## Phase 3.2: Tests First (TDD) ⚠️ MUST COMPLETE BEFORE 3.3
**CRITICAL: These tests MUST be written and MUST FAIL before ANY implementation**

### Contract Tests (API Endpoints)
- [x] T004 [P] Contract test GET /coverage/summary in `/usr/local/src/sage/dataload/tests/contract/coverage-summary.test.ts`
- [x] T005 [P] Contract test GET /coverage/domain/{domain} in `/usr/local/src/sage/dataload/tests/contract/domain-coverage.test.ts`
- [x] T006 [P] Contract test GET /scripts in `/usr/local/src/sage/dataload/tests/contract/migration-scripts.test.ts`
- [x] T007 [P] Contract test GET /scripts/{scriptId}/metrics in `/usr/local/src/sage/dataload/tests/contract/script-metrics.test.ts`
- [x] T008 [P] Contract test GET /entities/{domain} in `/usr/local/src/sage/dataload/tests/contract/domain-entities.test.ts`
- [x] T009 [P] Contract test POST /validate/coverage in `/usr/local/src/sage/dataload/tests/contract/validate-coverage.test.ts`
- [x] T010 [P] Contract test POST /validate/integrity in `/usr/local/src/sage/dataload/tests/contract/validate-integrity.test.ts`
- [x] T011 [P] Contract test POST /reports/generate in `/usr/local/src/sage/dataload/tests/contract/generate-reports.test.ts`

### Integration Tests (User Stories)
- [x] T012 [P] Integration test comprehensive coverage validation in `/usr/local/src/sage/dataload/tests/integration/coverage-validation.test.ts`
- [x] T013 [P] Integration test data integrity checking in `/usr/local/src/sage/dataload/tests/integration/integrity-validation.test.ts`
- [x] T014 [P] Integration test migration script analysis in `/usr/local/src/sage/dataload/tests/integration/script-analysis.test.ts`
- [x] T015 [P] Integration test report generation workflow in `/usr/local/src/sage/dataload/tests/integration/report-generation.test.ts`

## Phase 3.3: Core Implementation (ONLY after tests are failing)

### Entity Models
- [x] T016 [P] MigrationScript model in `/usr/local/src/sage/dataload/src/migration-coverage/models/migration-script.ts`
- [ ] T017 [P] DataDomain model in `/usr/local/src/sage/dataload/src/migration-coverage/models/data-domain.ts`
- [ ] T018 [P] DataEntity model in `/usr/local/src/sage/dataload/src/migration-coverage/models/data-entity.ts`
- [ ] T019 [P] MigrationMetrics model in `/usr/local/src/sage/dataload/src/migration-coverage/models/migration-metrics.ts`
- [ ] T020 [P] ExecutionLog model in `/usr/local/src/sage/dataload/src/migration-coverage/models/execution-log.ts`
- [ ] T021 [P] CoverageReport model in `/usr/local/src/sage/dataload/src/migration-coverage/models/coverage-report.ts`
- [ ] T022 [P] LegacyMapping model in `/usr/local/src/sage/dataload/src/migration-coverage/models/legacy-mapping.ts`

### Core Services
- [ ] T023 [P] Migration script analysis service in `/usr/local/src/sage/dataload/src/migration-coverage/services/script-analyzer.ts`
- [ ] T024 [P] Coverage calculation service in `/usr/local/src/sage/dataload/src/migration-coverage/services/coverage-calculator.ts`
- [ ] T025 [P] Data validation service in `/usr/local/src/sage/dataload/src/migration-coverage/services/data-validator.ts`
- [ ] T026 [P] Report generation service in `/usr/local/src/sage/dataload/src/migration-coverage/services/report-generator.ts`

### API Endpoints Implementation
- [ ] T027 Coverage summary endpoint (GET /coverage/summary) in `/usr/local/src/sage/dataload/src/migration-coverage/api/coverage-endpoints.ts`
- [ ] T028 Domain coverage endpoint (GET /coverage/domain/{domain}) in coverage-endpoints.ts
- [ ] T029 Scripts listing endpoint (GET /scripts) in `/usr/local/src/sage/dataload/src/migration-coverage/api/scripts-endpoints.ts`
- [ ] T030 Script metrics endpoint (GET /scripts/{scriptId}/metrics) in scripts-endpoints.ts
- [ ] T031 Domain entities endpoint (GET /entities/{domain}) in `/usr/local/src/sage/dataload/src/migration-coverage/api/entities-endpoints.ts`
- [ ] T032 Coverage validation endpoint (POST /validate/coverage) in `/usr/local/src/sage/dataload/src/migration-coverage/api/validation-endpoints.ts`
- [ ] T033 Integrity validation endpoint (POST /validate/integrity) in validation-endpoints.ts
- [ ] T034 Report generation endpoint (POST /reports/generate) in `/usr/local/src/sage/dataload/src/migration-coverage/api/reports-endpoints.ts`

## Phase 3.4: Integration
- [ ] T035 Database connection setup for migration coverage API in `/usr/local/src/sage/dataload/src/migration-coverage/config/database.ts`
- [ ] T036 Express server setup with middleware and routing in `/usr/local/src/sage/dataload/src/migration-coverage/server.ts`
- [ ] T037 Error handling middleware and request logging in `/usr/local/src/sage/dataload/src/migration-coverage/middleware/error-handler.ts`
- [ ] T038 API input validation middleware in `/usr/local/src/sage/dataload/src/migration-coverage/middleware/validation.ts`

## Phase 3.5: Polish
- [ ] T039 [P] Unit tests for script analyzer service in `/usr/local/src/sage/dataload/tests/unit/script-analyzer.test.ts`
- [ ] T040 [P] Unit tests for coverage calculator in `/usr/local/src/sage/dataload/tests/unit/coverage-calculator.test.ts`
- [ ] T041 [P] Unit tests for data validator in `/usr/local/src/sage/dataload/tests/unit/data-validator.test.ts`
- [ ] T042 [P] Unit tests for report generator in `/usr/local/src/sage/dataload/tests/unit/report-generator.test.ts`
- [ ] T043 Performance tests for large dataset validation (<5 minutes for full coverage check) in `/usr/local/src/sage/dataload/tests/performance/coverage-performance.test.ts`
- [ ] T044 [P] API documentation generation from OpenAPI spec in `/usr/local/src/sage/dataload/docs/migration-coverage-api.md`
- [ ] T045 [P] CLI tool for migration coverage validation in `/usr/local/src/sage/dataload/src/migration-coverage/cli/coverage-cli.ts`
- [ ] T046 Execute quickstart validation scenarios from `/usr/local/src/sage/dataload/specs/002-we-need-to/quickstart.md`

## Dependencies

### Critical Path
- Setup (T001-T003) before everything
- Tests (T004-T015) before implementation (T016-T038)
- Models (T016-T022) before services (T023-T026)
- Services (T023-T026) before endpoints (T027-T034)
- Core implementation (T016-T034) before integration (T035-T038)
- Everything before polish (T039-T046)

### Specific Dependencies
- T016-T022 (models) block T023-T026 (services)
- T023-T026 (services) block T027-T034 (endpoints)
- T035 (database) blocks T036 (server)
- T036 (server) blocks T037-T038 (middleware)

## Parallel Example
```bash
# Launch contract tests together (T004-T011):
Task: "Contract test GET /coverage/summary in tests/contract/coverage-summary.test.ts"
Task: "Contract test GET /coverage/domain/{domain} in tests/contract/domain-coverage.test.ts"
Task: "Contract test GET /scripts in tests/contract/migration-scripts.test.ts"
Task: "Contract test GET /scripts/{scriptId}/metrics in tests/contract/script-metrics.test.ts"

# Launch model creation together (T016-T022):
Task: "MigrationScript model in src/migration-coverage/models/migration-script.ts"
Task: "DataDomain model in src/migration-coverage/models/data-domain.ts"
Task: "DataEntity model in src/migration-coverage/models/data-entity.ts"
Task: "MigrationMetrics model in src/migration-coverage/models/migration-metrics.ts"

# Launch service creation together (T023-T026):
Task: "Migration script analysis service in src/migration-coverage/services/script-analyzer.ts"
Task: "Coverage calculation service in src/migration-coverage/services/coverage-calculator.ts"
Task: "Data validation service in src/migration-coverage/services/data-validator.ts"
Task: "Report generation service in src/migration-coverage/services/report-generator.ts"
```

## Validation Checklist
*GATE: Checked before task execution*

- [x] All contracts have corresponding tests (T004-T011 → T027-T034)
- [x] All entities have model tasks (7 entities → T016-T022)
- [x] All tests come before implementation (T004-T015 before T016-T046)
- [x] Parallel tasks truly independent (different files, no shared dependencies)
- [x] Each task specifies exact file path
- [x] No task modifies same file as another [P] task

## Success Criteria
- Migration coverage API serves 99%+ accurate data
- All 8 API endpoints functional with comprehensive validation
- Performance targets: <5 minutes for full coverage validation
- Integration with existing migration infrastructure
- Complete test coverage for all services and endpoints
- CLI tool provides same functionality as API for automation

## Notes
- [P] tasks = different files, no dependencies
- Verify tests fail before implementing (TDD critical)
- Commit after each task completion
- This builds on existing migration scripts - does not replace them
- API provides visibility and validation layer over existing 40+ migration scripts
- Focus on documentation and accountability of migration completeness