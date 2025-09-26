
# Implementation Plan: Database Migration and Synchronization System

**Branch**: `001-i-need-to` | **Date**: 2025-09-26 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-i-need-to/spec.md`

## Execution Flow (/plan command scope)
```
1. Load feature spec from Input path
   → If not found: ERROR "No feature spec at {path}"
2. Fill Technical Context (scan for NEEDS CLARIFICATION)
   → Detect Project Type from file system structure or context (web=frontend+backend, mobile=app+api)
   → Set Structure Decision based on project type
3. Fill the Constitution Check section based on the content of the constitution document.
4. Evaluate Constitution Check section below
   → If violations exist: Document in Complexity Tracking
   → If no justification possible: ERROR "Simplify approach first"
   → Update Progress Tracking: Initial Constitution Check
5. Execute Phase 0 → research.md
   → If NEEDS CLARIFICATION remain: ERROR "Resolve unknowns"
6. Execute Phase 1 → contracts, data-model.md, quickstart.md, agent-specific template file (e.g., `CLAUDE.md` for Claude Code, `.github/copilot-instructions.md` for GitHub Copilot, `GEMINI.md` for Gemini CLI, `QWEN.md` for Qwen Code or `AGENTS.md` for opencode).
7. Re-evaluate Constitution Check section
   → If new violations: Refactor design, return to Phase 1
   → Update Progress Tracking: Post-Design Constitution Check
8. Plan Phase 2 → Describe task generation approach (DO NOT create tasks.md)
9. STOP - Ready for /tasks command
```

**IMPORTANT**: The /plan command STOPS at step 7. Phases 2-4 are executed by other commands:
- Phase 2: /tasks command creates tasks.md
- Phase 3-4: Implementation execution (manual or via tools)

## Summary
Database administrator needs to ensure target Supabase database contains all data from source database, including new records added since original migration, with ongoing synchronization mechanism to prevent data drift. System must analyze existing migration scripts for reusability, migrate only new/missing records, validate completeness, and provide scheduled synchronization with conflict resolution.

## Technical Context
**Language/Version**: TypeScript 5.9+ with Node.js ES2020
**Primary Dependencies**: pg (PostgreSQL client), @supabase/supabase-js, dotenv, ts-node
**Storage**: PostgreSQL (source) + Supabase/PostgreSQL (target) with UUID-based schemas
**Testing**: TypeScript compilation checks, manual validation scripts
**Target Platform**: Linux server environment with database access
**Project Type**: single - command-line database migration tools
**Performance Goals**: Process up to 100K records per sync operation with batch processing
**Constraints**: Preserve existing UUID mappings, maintain referential integrity, file-based logging only
**Scale/Scope**: Multi-table migration system with 1.2M+ existing migrated records, scheduled sync intervals

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Status**: Constitution template not yet filled - proceeding with best practices:
- ✅ Library-first approach: Reuse existing migration patterns and utilities
- ✅ CLI interface: All scripts accessible via npm run commands
- ✅ Test-first mindset: Validation scripts for all migration operations
- ✅ Observability: File-based logging as specified in requirements

## Project Structure

### Documentation (this feature)
```
specs/[###-feature]/
├── plan.md              # This file (/plan command output)
├── research.md          # Phase 0 output (/plan command)
├── data-model.md        # Phase 1 output (/plan command)
├── quickstart.md        # Phase 1 output (/plan command)
├── contracts/           # Phase 1 output (/plan command)
└── tasks.md             # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (repository root)
```
src/
├── differential-migration.ts        # New: Core differential migration logic
├── sync-scheduler.ts               # New: Scheduled synchronization system
├── migration-analyzer.ts           # New: Analyze existing scripts for reuse
├── data-validator.ts               # New: Comprehensive validation system
├── conflict-resolver.ts            # New: Source-wins conflict resolution
├── sync-logger.ts                  # New: File-based logging system
├── models/
│   ├── migration-checkpoint.ts    # Migration progress tracking
│   ├── data-differential.ts       # Source/target comparison
│   └── sync-job.ts                # Synchronization job management
└── lib/
    ├── database-connections.ts     # Reuse existing connection patterns
    ├── batch-processor.ts          # Reuse existing batch processing
    └── uuid-mapper.ts              # Reuse existing UUID mapping system

# Existing migration infrastructure (reused)
src/office-migration.ts
src/profile-migration.ts
src/doctor-migration.ts
src/patient-migration.ts
src/orders-migration.ts
[... other existing migration files]

# New validation and testing
tests/
├── integration/
│   ├── differential-migration.test.ts
│   ├── sync-scheduler.test.ts
│   └── conflict-resolution.test.ts
└── validation/
    ├── data-integrity.test.ts
    └── sync-completeness.test.ts
```

**Structure Decision**: Single project structure extending existing migration system. New differential migration and synchronization components will integrate with existing `src/` directory structure, reusing established patterns for database connections, batch processing, and UUID mapping. New components focus on differential analysis, scheduled synchronization, and conflict resolution while preserving all existing migration infrastructure.

## Phase 0: Outline & Research
1. **Extract unknowns from Technical Context** above:
   - For each NEEDS CLARIFICATION → research task
   - For each dependency → best practices task
   - For each integration → patterns task

2. **Generate and dispatch research agents**:
   ```
   For each unknown in Technical Context:
     Task: "Research {unknown} for {feature context}"
   For each technology choice:
     Task: "Find best practices for {tech} in {domain}"
   ```

3. **Consolidate findings** in `research.md` using format:
   - Decision: [what was chosen]
   - Rationale: [why chosen]
   - Alternatives considered: [what else evaluated]

**Output**: research.md with all NEEDS CLARIFICATION resolved

## Phase 1: Design & Contracts
*Prerequisites: research.md complete*

1. **Extract entities from feature spec** → `data-model.md`:
   - Entity name, fields, relationships
   - Validation rules from requirements
   - State transitions if applicable

2. **Generate API contracts** from functional requirements:
   - For each user action → endpoint
   - Use standard REST/GraphQL patterns
   - Output OpenAPI/GraphQL schema to `/contracts/`

3. **Generate contract tests** from contracts:
   - One test file per endpoint
   - Assert request/response schemas
   - Tests must fail (no implementation yet)

4. **Extract test scenarios** from user stories:
   - Each story → integration test scenario
   - Quickstart test = story validation steps

5. **Update agent file incrementally** (O(1) operation):
   - Run `.specify/scripts/bash/update-agent-context.sh claude`
     **IMPORTANT**: Execute it exactly as specified above. Do not add or remove any arguments.
   - If exists: Add only NEW tech from current plan
   - Preserve manual additions between markers
   - Update recent changes (keep last 3)
   - Keep under 150 lines for token efficiency
   - Output to repository root

**Output**: data-model.md, /contracts/*, failing tests, quickstart.md, agent-specific file

## Phase 2: Task Planning Approach
*This section describes what the /tasks command will do - DO NOT execute during /plan*

**Task Generation Strategy**:
- Load `.specify/templates/tasks-template.md` as base
- Generate tasks from Phase 1 design docs (contracts, data model, quickstart)
- Each database schema → table creation and migration tasks [P]
- Each CLI command contract → command implementation task
- Each data model entity → TypeScript interface and service task [P]
- Each quickstart scenario → integration test task
- Core differential migration logic → implementation tasks
- Sync scheduler system → implementation tasks
- Validation and logging → implementation tasks

**Ordering Strategy**:
- TDD order: Schema creation → Tests → Implementation
- Dependency order: Database tables → Models → Services → CLI commands
- Infrastructure first: Logging, connections, utilities
- Core features: Differential migration, sync scheduler, validation
- Integration tests last to validate end-to-end scenarios
- Mark [P] for parallel execution (independent components)

**Estimated Output**: 35-45 numbered, ordered tasks in tasks.md

**Task Categories**:
1. **Database Schema Tasks (5-7 tasks)**: Create new tables, indexes, triggers
2. **Model Implementation Tasks (8-10 tasks)**: TypeScript interfaces, data access layers
3. **Core Service Tasks (12-15 tasks)**: Differential migration, sync scheduler, conflict resolution
4. **CLI Integration Tasks (5-7 tasks)**: Command interfaces, argument parsing, output formatting
5. **Testing Tasks (8-12 tasks)**: Unit tests, integration tests, performance benchmarks
6. **Documentation Tasks (2-3 tasks)**: Update existing docs, add new migration commands

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks.md following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking
*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |


## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command)
- [x] Phase 1: Design complete (/plan command)
- [x] Phase 2: Task planning complete (/plan command - describe approach only)
- [x] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS
- [x] All NEEDS CLARIFICATION resolved
- [x] Complexity deviations documented (none required - aligns with existing patterns)

---
*Based on Constitution v2.1.1 - See `/memory/constitution.md`*
