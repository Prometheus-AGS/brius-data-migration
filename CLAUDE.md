# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a comprehensive database migration project that migrates data from a legacy PostgreSQL database (`dispatch_*` tables) to a modern Supabase/PostgreSQL architecture with UUID-based primary keys. The project includes 1.2M+ migrated records across multiple components with 98.5%+ success rate.

## Development Commands

### Core Migration Commands
```bash
# Build and typecheck
npm run build              # Compile TypeScript to dist/
npm run typecheck         # Type checking without output

# Core entity migrations (run in order)
npm run migrate:offices
npm run migrate:profiles
npm run migrate:doctors
npm run migrate:patients
npm run migrate:orders

# Extended entity migrations
npm run migrate:products
npm run migrate:jaws
npm run migrate:projects
npm run migrate:treatment-plans

# Combined project migrations
npm run migrate:projects-and-plans      # Projects + treatment plans together

# Validation commands
npm run validate:offices
npm run validate:profiles
npm run validate:doctors
npm run validate:patients
npm run validate:orders
npm run validate:products
npm run validate:jaws
npm run validate:projects
npm run validate:treatment-plans
npm run validate:projects-and-plans     # Validate projects + treatment plans

# Rollback commands (reverse order)
npm run rollback:treatment-plans
npm run rollback:projects-and-plans     # Rollback projects + treatment plans
npm run rollback:projects
npm run rollback:jaws
npm run rollback:products
npm run rollback:orders
npm run rollback:patients
npm run rollback:doctors
npm run rollback:profiles
npm run rollback:offices

# Complex batch migrations
npm run migrate:all           # Full migration pipeline (all entities)
npm run migrate:core          # Core entities only (offices, profiles, doctors)
npm run migrate:core-with-patients  # Core + patients
npm run validate:all          # Complete validation
npm run validate:core         # Validate core entities
npm run rollback:all          # Full rollback (reverse order)
npm run rollback:core         # Rollback core entities only

# Dependency-aware migrations
npm run migrate:doctors-with-offices      # Offices + doctors
npm run migrate:patients-with-deps        # Offices + doctors + patients
npm run migrate:orders-with-deps          # Full dependency chain through orders
npm run migrate:products-with-deps        # Full dependency chain through products
npm run migrate:jaws-with-deps           # Full dependency chain through jaws
```

### Running Individual Scripts
```bash
# Direct TypeScript execution (most common pattern)
npx ts-node migrate-offers-and-discounts-fixed.ts
npx ts-node validate-offers-discounts-migration.ts

# Development mode
npm run dev                   # Default office migration
npm run dev:doctors          # Doctor migration dev mode
npm run dev:profiles         # Profile migration dev mode
npm run dev:patients         # Patient migration dev mode
npm run dev:orders           # Orders migration dev mode

# Specialized patient migrations
npm run update:patient-mappings       # Update patient ID mappings
npm run migrate:patients-complete     # Complete patient migration
npm run migrate:patient-events        # Patient events migration

# Final migration utilities
npm run migrate:missing-doctor-71     # Fix specific missing doctor
npm run migrate:remaining-orders      # Complete remaining orders
npm run validate:final               # Final migration validation
npm run migrate:complete-final       # Complete final migration process
```

### Full Sync System Commands
```bash
# Complete data synchronization (destructive operation)
./full-sync-improved.sh               # Full sync with confirmation prompts
./full-sync.sh                        # Basic full sync script

# Manual full sync process
psql -f truncate-all-tables.sql      # Truncate all target tables (dangerous!)
npm run migrate:all                   # Full migration after truncation
```

**Warning:** Full sync operations completely delete all target data before reloading from source.

## Architecture Overview

### Database Migration Architecture
- **Source:** Legacy PostgreSQL (`dispatch_*` tables with integer IDs)
- **Target:** Modern Supabase/PostgreSQL (UUID-based with full relationships)
- **Language:** TypeScript with Node.js
- **Database Client:** `pg` (node-postgres) with connection pooling
- **Pattern:** Batch processing with error recovery and resume capability

### Core Migration Components

#### 1. Migration Scripts (`src/` directory)
- Each entity has dedicated migration file (e.g., `office-migration.ts`)
- Includes: migrate, validate, and rollback functions
- Pattern: Legacy data analysis → Schema creation → Batch migration → Validation

#### 2. Analysis Scripts (root directory)
- Files prefixed with `analyze-*` examine source data structure
- Files prefixed with `check-*` validate target schemas and data
- Files prefixed with `investigate-*` explore complex relationships

#### 3. Migration Control System
- `migration_control` table tracks all operations with batch-level detail
- `migration_mappings` table preserves legacy ID → UUID mappings
- Comprehensive audit trail for debugging and rollbacks

#### 4. Agent System (`agents/` directory)
Multi-agent system built on Mastra framework with production-ready capabilities:

**Core Agents:**
- **Orchestrator:** Master workflow controller and state management
- **Schema Analysis:** Database introspection, relationship detection, data profiling
- **Planning:** Migration strategy with dependency resolution and risk assessment
- **Data Mapping:** Field transformation, type conversion, traceability maintenance
- **Migration Execution:** Batch processing with error recovery and progress tracking
- **Validation:** Data integrity verification and completeness checking
- **User Guidance:** Non-technical explanations and recommendations

**Key Features:**
- **Code Interpreter Tool:** Secure containerized TypeScript execution with Docker isolation
- **Battle-tested Patterns:** Built from successful migrations (case_files, brackets, orders)
- **Complete Security:** Container isolation, resource limits, non-root execution
- **Real-world Validation:** Successfully migrated technician_roles (31/31 records)
- **Supabase Integration:** Full API authentication and RLS compliance
- **Production Ready:** Comprehensive audit trails and error recovery

### File Organization Patterns

#### Migration Lifecycle Files
- `migrate-[component].ts` - Main migration logic
- `validate-[component]-migration.ts` - Post-migration validation
- `analyze-[component].ts` - Pre-migration analysis
- `create-[component]-schema.ts` - Target schema creation

#### Data Integrity Files
- `*-fixed.ts` - Corrected versions after issue resolution
- `*-final.ts` - Production-ready final versions
- `check-*` - Schema and data validation scripts

#### Analysis and Investigation Files (Root Directory)
- `analyze-*` - Pre-migration data structure analysis
- `investigate-*` - Complex relationship exploration
- `add-*` - Schema modification and enhancement scripts
- `final_migration_validation.ts` - Comprehensive final validation
- `migrate_missing_doctor_71.ts` - Specific data issue resolution
- `migrate_remaining_orders.ts` - Cleanup and completion scripts

## Key Technical Patterns

### Migration Script Structure
```typescript
interface MigrationStats {
  totalProcessed: number;
  successful: number;
  failed: number;
  skipped: number;
}

// Standard pattern in all migration files:
// 1. Environment config with source/target database connections
// 2. Interface definitions for legacy and target schemas
// 3. Main migration function with batch processing
// 4. Validation function to verify results
// 5. Rollback function for error recovery
```

### Error Handling Strategy
- Graceful failure recovery with detailed logging
- Resume capability from last successful checkpoint
- Transaction safety with rollback support
- Comprehensive error reporting with context

### Data Transformation Patterns
- Legacy ID preservation via JSON metadata fields
- UUID generation for all primary keys
- Foreign key relationship reconstruction
- Enum value mapping and validation

## Environment Setup

### Required Environment Variables
Copy `.env.example` to `.env` and configure:

```bash
# Source database (legacy system)
SOURCE_DB_HOST=
SOURCE_DB_PORT=5432
SOURCE_DB_USER=
SOURCE_DB_PASSWORD=
SOURCE_DB_NAME=

# Target database (modern system)
TARGET_DB_HOST=localhost
TARGET_DB_PORT=54322
TARGET_DB_USER=postgres
TARGET_DB_PASSWORD=

# Supabase configuration
SUPABASE_URL=http://localhost:8000
SUPABASE_SERVICE_ROLE=

# Migration settings
BATCH_SIZE=500
MAX_RETRY_ATTEMPTS=3
MIGRATION_TIMEOUT=300000
```

### Dependencies
- Node.js 18+
- TypeScript 5.9+
- PostgreSQL client libraries (`pg`, `@types/pg`)
- Supabase client (`@supabase/supabase-js`)
- Environment management (`dotenv`)

## Migration Execution Workflow

### Standard Migration Process
1. **Analysis Phase:** Run `analyze-[component].ts` to understand source data
2. **Schema Setup:** Execute `create-[component]-schema.ts` if needed
3. **Migration:** Run `migrate-[component].ts` with batch processing
4. **Validation:** Execute `validate-[component]-migration.ts`
5. **Documentation:** Review generated `*_MIGRATION_REPORT.md` files

### Dependency Order (Critical)
Dependencies must be migrated in this exact order:

#### Core Dependencies (Required First)
1. **Offices** (foundational - required by all entities)
2. **Profiles** (user accounts - required for doctors/patients)
3. **Doctors** (depends on offices)
4. **Patients** (depends on doctors)
5. **Orders** (depends on patients)

#### Extended Dependencies (Secondary Entities)
6. **Products** (depends on orders)
7. **JAWS** (orthodontic data - depends on patients/orders)
8. **Projects** (can run independently or after core)
9. **Treatment Plans** (depends on patients)
10. **Patient Events** (depends on patients - optional)

### Recovery and Debugging
- Check `migration_control` table for detailed batch status
- Use `migration_mappings` for ID relationship debugging
- Review detailed markdown reports for migration summaries
- Rollback functions available for each component

## Data Migration Results Summary

Successfully migrated 1.2M+ records with comprehensive tracking:
- **Cases:** 7,853/7,854 (99.99%)
- **Orders:** 23,050/23,272 (99.05%)
- **Tasks:** 762,604/768,962 (99.17%)
- **Offers:** 393/788 (49.87%)
- **Discounts:** 135/151 (89.40%)
- **Financial Data:** $366,002+ preserved
- **Zero Data Corruption:** Complete integrity maintained

## Differential Migration and Synchronization System

### New Migration Commands (Advanced System)

The project now includes an advanced differential migration and synchronization system for ongoing database maintenance and updates:

#### Differential Migration Commands
```bash
# Core differential migration commands (npm scripts)
npm run differential:migrate          # Execute differential migration
npm run differential:analyze          # Analyze migration needs (dry run)
npm run differential:validate         # Validate differential migration results

# Synchronization job management
npm run sync:create-job              # Create scheduled sync job
npm run sync:list-jobs               # List all sync jobs
npm run sync:run-job                 # Execute sync job
npm run sync:job-status              # Check job status
npm run sync:cancel-job              # Cancel running job

# Migration analysis and debugging
npm run checkpoint:status            # Check migration checkpoint status
npm run checkpoint:reset             # Reset migration checkpoint
npm run checkpoint:debug             # Debug migration checkpoints
npm run check:migration-status       # Overall migration status

# Data validation commands
npm run validate:data-integrity      # Validate data integrity
npm run validate:completeness        # Check data completeness
npm run validate:performance         # Performance validation

# Conflict resolution
npm run conflict:resolve             # Resolve migration conflicts
npm run conflict:report              # Generate conflict report
```

#### Advanced CLI Usage (Direct Script Execution)
For advanced users who need more control over parameters:
```bash
# Differential migration with custom parameters
npx ts-node src/differential-migration.ts migrate --entities offices,doctors,patients
npx ts-node src/differential-migration.ts analyze --entities all --output analysis-report.json

# Sync scheduler with custom configuration
npx ts-node src/sync-scheduler.ts create-job --name "daily-sync" --schedule "daily"
npx ts-node src/sync-scheduler.ts run-job --name "daily-sync" --manual

# Data validation with specific parameters
npx ts-node src/data-validator.ts validate --entities doctors --type relationship_integrity
npx ts-node src/data-validator.ts report --comprehensive --output validation-report.json

# Migration analyzer for debugging
npx ts-node src/migration-analyzer.ts checkpoint-status --entity orders
npx ts-node src/migration-analyzer.ts debug --entity doctors --verbose
```

### Advanced System Architecture

#### Core Orchestrators
- **`src/differential-migration.ts`** - Main entry point for differential migration operations
- **`src/sync-scheduler.ts`** - Scheduled synchronization job management
- **`src/data-validator.ts`** - Comprehensive data validation workflows
- **`src/conflict-resolver.ts`** - Handles data conflicts during synchronization

#### Service Layer
- **Migration Services** (`src/services/`)
  - `differential-migration-service.ts` - Coordinates differential migration process
  - `sync-scheduler-service.ts` - Manages scheduled sync jobs
  - `data-validator.ts` - Comprehensive validation checks
  - `conflict-resolver.ts` - Source-wins conflict resolution strategy
  - `migration-analyzer.ts` - Analyzes existing scripts for reusability
  - `data-comparator.ts` - Identifies missing/conflicted records
  - `sync-logger.ts` - File-based structured logging

#### Utility Libraries
- **Database Integration** (`src/lib/`)
  - `database-connections.ts` - Standardized database connection management
  - `batch-processor.ts` - Efficient batch processing with retry logic
  - `uuid-mapper.ts` - UUID generation and legacy ID mapping
  - `checkpoint-manager.ts` - Save/restore state for resumable migrations

#### CLI Integration
- **Command Line Interface** (`src/cli/`)
  - `differential-migration.ts` - CLI for differential migration operations
  - `sync-scheduler.ts` - CLI for job management commands
  - `data-validator.ts` - CLI for validation operations
  - `migration-analyzer.ts` - CLI for system analysis and debugging

### Performance Targets and Benchmarks

#### Processing Performance
- **Differential Migration:** Process 50K records in < 10 minutes
- **Synchronization:** Complete daily sync in < 30 minutes
- **Validation:** Check 100K records in < 5 minutes
- **Conflict Resolution:** Handle 1K conflicts in < 2 minutes

#### System Capabilities
- **Batch Processing:** 500-2000 records per batch (configurable)
- **Concurrent Operations:** Up to 8 parallel jobs
- **Memory Efficiency:** < 512MB memory usage for 100K records
- **Throughput:** 1000+ records per second sustained processing

### Migration Database Schema Extensions

#### New Control Tables
- **`migration_checkpoints`** - Tracks migration progress for resumability
- **`data_differentials`** - Records source/target comparison results
- **`synchronization_jobs`** - Manages scheduled sync operations
- **`migration_validation_reports`** - Stores comprehensive validation results
- **`sync_run_history`** - Historical sync execution tracking

#### Enhanced Logging
- **Structured Logging:** JSON-formatted logs with operation context
- **Log Rotation:** Daily log files with automatic cleanup
- **Performance Metrics:** Execution time, throughput, and resource usage tracking
- **Error Categorization:** Detailed error classification and recovery suggestions

### Quickstart Scenarios

#### Scenario 1: Daily Differential Sync Setup
```bash
# 1. Create daily sync job
npx ts-node src/sync-scheduler.ts create-job \
  --name "daily-sync" --schedule "daily" \
  --entities "offices,doctors,patients,orders" \
  --conflict-resolution "source_wins"

# 2. Test manual execution
npx ts-node src/sync-scheduler.ts run-job --name "daily-sync" --manual

# 3. Monitor execution
npx ts-node src/sync-scheduler.ts job-status --name "daily-sync"
```

#### Scenario 2: Large Dataset Migration Recovery
```bash
# 1. Check for resumable checkpoints
npx ts-node src/migration-analyzer.ts checkpoint-status --entity orders

# 2. Resume from last checkpoint
npx ts-node src/differential-migration.ts resume --entity orders

# 3. Validate completion
npx ts-node src/data-validator.ts validate --entities orders --type completeness_check
```

#### Scenario 3: Conflict Resolution Workflow
```bash
# 1. Detect conflicts
npx ts-node src/differential-migration.ts analyze --entities doctors --detect-conflicts

# 2. Review conflict report
npx ts-node src/conflict-resolver.ts report --last-analysis

# 3. Resolve with source-wins strategy
npx ts-node src/differential-migration.ts migrate --entities doctors --conflict-resolution source_wins

# 4. Validate resolution
npx ts-node src/data-validator.ts validate --entities doctors --type data_integrity
```

### Testing and Quality Assurance

#### Unit Tests
- Comprehensive test coverage for all models, services, and utilities
- Mock-based testing for database operations
- Performance regression testing with benchmarks

#### Integration Tests
- End-to-end scenario validation
- Multi-entity workflow testing
- Error recovery and checkpoint restoration testing

#### Performance Tests
- 100K+ record processing benchmarks
- Memory usage and throughput optimization
- Concurrent operation stress testing

## Important Notes

- Never commit `.env` files - database credentials are sensitive
- Migration logs may contain PII - handle appropriately
- All migrations maintain complete audit trails
- Foreign key integrity is preserved across all migrations
- Legacy ID mappings maintained for backward compatibility
- New differential migration system preserves all existing functionality
- Checkpointing enables safe interruption and resumption of large operations
- Scheduled synchronization maintains ongoing data consistency

## Active Technologies
- TypeScript 5.9+ with Node.js 18+ + pg (node-postgres), @supabase/supabase-js, dotenv (001-continue-migration-all)
- PostgreSQL (source) → Supabase/PostgreSQL (destination) with UUID-based schemas (001-continue-migration-all)

## Recent Changes
- 001-continue-migration-all: Added TypeScript 5.9+ with Node.js 18+ + pg (node-postgres), @supabase/supabase-js, dotenv
