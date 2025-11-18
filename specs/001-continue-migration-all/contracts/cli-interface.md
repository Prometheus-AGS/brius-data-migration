# CLI Interface Contract: Differential Database Migration

**Date**: 2025-10-26
**Feature**: Differential Database Migration System
**Branch**: `001-continue-migration-all`

## Overview

Command-line interface specifications for the differential database migration system. All commands follow UNIX conventions with clear input/output protocols, proper exit codes, and structured logging.

## Core Commands

### Migration Baseline Analysis

**Command**: `npm run differential:analyze`
**Purpose**: Establish migration baseline by comparing source and destination databases
**Alternative**: `npx ts-node src/differential-migration.ts analyze`

#### Usage

```bash
# Analyze all entities
npm run differential:analyze

# Analyze specific entities
npm run differential:analyze -- --entities offices,doctors,patients

# Generate JSON output
npm run differential:analyze -- --output json

# Include detailed mapping analysis
npm run differential:analyze -- --include-mappings --verbose
```

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `--entities` | string[] | No | all | Comma-separated list of entities to analyze |
| `--output` | enum | No | table | Output format: `table`, `json`, `csv` |
| `--include-mappings` | boolean | No | false | Include UUID mapping analysis |
| `--verbose` | boolean | No | false | Include detailed analysis information |
| `--dry-run` | boolean | No | false | Simulate analysis without database writes |

#### Output Format

**Table Output** (default):
```
Entity Analysis Summary
=======================
Entity       Source    Dest     Mapped   Status    Last Migration
offices      1,234     1,234    1,234    synced    2025-10-25 14:30:00
doctors      5,678     5,670    5,670    behind    2025-10-25 14:30:00
patients     12,345    12,200   12,200   behind    2025-10-25 14:30:00

Overall Status: 145 records behind
Total Records: 19,257 source, 19,104 destination
```

**JSON Output** (`--output json`):
```json
{
  "analysisId": "uuid-here",
  "timestamp": "2025-10-26T10:30:00Z",
  "entitySummary": [
    {
      "entityType": "offices",
      "sourceCount": 1234,
      "destinationCount": 1234,
      "mappingCount": 1234,
      "status": "synced",
      "lastMigrationTimestamp": "2025-10-25T14:30:00Z"
    }
  ],
  "overallStatus": "behind",
  "totalRecords": 19257,
  "migrationGaps": []
}
```

#### Exit Codes

- `0`: Analysis completed successfully
- `1`: Invalid parameters or configuration
- `2`: Database connection failure
- `3`: Analysis failed due to data issues
- `4`: Insufficient permissions

### Differential Detection

**Command**: `npm run differential:detect`
**Purpose**: Identify new, modified, and deleted records since last migration
**Alternative**: `npx ts-node src/differential-migration.ts detect`

#### Usage

```bash
# Detect changes for all entities
npm run differential:detect

# Detect changes for specific entities since timestamp
npm run differential:detect -- --entities orders,cases --since "2025-10-25 12:00:00"

# Include soft-deleted records
npm run differential:detect -- --include-deleted

# Save results to file
npm run differential:detect -- --output json --save-to differential-results.json
```

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `--entities` | string[] | No | all | Entities to analyze for changes |
| `--since` | datetime | No | last_migration | Override baseline timestamp |
| `--include-deleted` | boolean | No | true | Include soft-deleted records |
| `--output` | enum | No | table | Output format: `table`, `json`, `csv` |
| `--save-to` | string | No | none | Save results to specified file |
| `--threshold` | number | No | 0 | Minimum change percentage to report |

#### Output Format

**Table Output**:
```
Differential Analysis Results
=============================
Entity       New    Modified  Deleted  Change%  Est. Time
offices      12     5         2        1.5%     2 min
doctors      45     23        1        1.2%     8 min
patients     156    89        7        2.0%     25 min

Total Changes: 340 records
Estimated Migration Time: 35 minutes
```

#### Exit Codes

- `0`: Detection completed successfully
- `1`: Invalid parameters
- `2`: Database connection failure
- `3`: No baseline found (run analyze first)

### Migration Execution

**Command**: `npm run differential:migrate`
**Purpose**: Execute differential migration with checkpoint support
**Alternative**: `npx ts-node src/differential-migration.ts migrate`

#### Usage

```bash
# Migrate all detected changes
npm run differential:migrate -- --analysis-id <uuid>

# Migrate specific entities with custom batch size
npm run differential:migrate -- --analysis-id <uuid> --entities doctors,patients --batch-size 500

# Dry run migration (no actual changes)
npm run differential:migrate -- --analysis-id <uuid> --dry-run

# Parallel execution for independent entities
npm run differential:migrate -- --analysis-id <uuid> --parallel --max-concurrent 4
```

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `--analysis-id` | uuid | Yes | none | Reference to differential analysis result |
| `--entities` | string[] | No | all | Specific entities to migrate |
| `--batch-size` | number | No | 1000 | Records per batch |
| `--parallel` | boolean | No | true | Enable parallel processing |
| `--max-concurrent` | number | No | 3 | Maximum concurrent entity migrations |
| `--dry-run` | boolean | No | false | Simulate without making changes |
| `--resume` | boolean | No | false | Resume from last checkpoint |
| `--force` | boolean | No | false | Force migration despite warnings |

#### Output Format

```
Differential Migration Progress
===============================
Session ID: 550e8400-e29b-41d4-a716-446655440000

Entity        Status      Progress    Records/sec    ETA
offices       completed   100%        1,234/sec      -
doctors       running     75%         987/sec        2 min
patients      pending     0%          -              -

Overall Progress: 58% complete (1,234 of 2,140 records)
Estimated Completion: 2025-10-26 11:15:00
```

#### Exit Codes

- `0`: Migration completed successfully
- `1`: Invalid parameters
- `2`: Database connection failure
- `3`: Migration failed with errors
- `4`: Migration paused by user
- `5`: Checkpoint corruption detected

### Migration Status

**Command**: `npm run differential:status`
**Purpose**: Monitor migration progress and view detailed status
**Alternative**: `npx ts-node src/differential-migration.ts status`

#### Usage

```bash
# Show status for latest migration session
npm run differential:status

# Show status for specific session
npm run differential:status -- --session-id <uuid>

# Continuous monitoring (refresh every 5 seconds)
npm run differential:status -- --watch --interval 5

# Show detailed error information
npm run differential:status -- --show-errors --verbose
```

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `--session-id` | uuid | No | latest | Specific migration session to check |
| `--watch` | boolean | No | false | Continuous monitoring mode |
| `--interval` | number | No | 10 | Refresh interval in seconds (watch mode) |
| `--show-errors` | boolean | No | false | Include error details in output |
| `--verbose` | boolean | No | false | Show detailed performance metrics |

#### Output Format

```
Migration Status: 550e8400-e29b-41d4-a716-446655440000
=========================================================
Status: RUNNING
Started: 2025-10-26 10:30:00
Progress: 58% complete (1,234 of 2,140 records)
ETA: 2025-10-26 11:15:00

Entity Progress:
  ✓ offices     (completed - 100%, 345 records in 2m 15s)
  → doctors     (running - 75%, 889/1,200 records, 987 rec/sec)
  ⏸ patients    (pending - 0%, 595 records queued)

Performance:
  Throughput: 987 records/sec (avg)
  Memory Usage: 234 MB
  Active Connections: 6/20

Recent Errors: 0
Last Checkpoint: 2025-10-26 11:05:23
```

### Migration Control

**Command**: `npm run differential:control`
**Purpose**: Pause, resume, or cancel running migrations
**Alternative**: `npx ts-node src/differential-migration.ts control`

#### Usage

```bash
# Pause migration
npm run differential:control -- pause --session-id <uuid>

# Resume migration
npm run differential:control -- resume --session-id <uuid>

# Cancel migration (with cleanup)
npm run differential:control -- cancel --session-id <uuid> --cleanup

# List all active sessions
npm run differential:control -- list
```

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `action` | enum | Yes | none | Action: `pause`, `resume`, `cancel`, `list` |
| `--session-id` | uuid | No* | latest | Session to control (*required for pause/resume/cancel) |
| `--cleanup` | boolean | No | false | Clean up checkpoints when canceling |
| `--force` | boolean | No | false | Force action despite warnings |

### Migration Logs

**Command**: `npm run differential:logs`
**Purpose**: View detailed migration execution logs
**Alternative**: `npx ts-node src/differential-migration.ts logs`

#### Usage

```bash
# Show recent logs for latest session
npm run differential:logs

# Show logs for specific session with filtering
npm run differential:logs -- --session-id <uuid> --level error --entity doctors

# Follow logs in real-time
npm run differential:logs -- --follow --tail 100

# Export logs to file
npm run differential:logs -- --export logs-export.json --format json
```

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `--session-id` | uuid | No | latest | Migration session to view |
| `--level` | enum | No | info | Log level: `debug`, `info`, `warn`, `error` |
| `--entity` | string | No | all | Filter by entity type |
| `--follow` | boolean | No | false | Follow logs in real-time |
| `--tail` | number | No | 50 | Number of recent entries to show |
| `--export` | string | No | none | Export logs to file |
| `--format` | enum | No | table | Export format: `table`, `json`, `csv` |

## Global Options

All commands support these global options:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `--config` | string | `.env` | Configuration file path |
| `--log-level` | enum | `info` | Console log level: `debug`, `info`, `warn`, `error` |
| `--no-color` | boolean | false | Disable colored output |
| `--quiet` | boolean | false | Suppress non-essential output |
| `--help` | boolean | false | Show command help |
| `--version` | boolean | false | Show version information |

## Error Handling

### Standard Error Format

All commands output errors in consistent format:

```
ERROR: Migration failed for entity 'doctors'
Details: Foreign key constraint violation on record ID 12345
Suggestion: Ensure dependent 'offices' records are migrated first
Timestamp: 2025-10-26 11:30:45
Session ID: 550e8400-e29b-41d4-a716-446655440000
```

### Common Exit Codes

- `0`: Success
- `1`: Invalid arguments or configuration
- `2`: Database connection failure
- `3`: Operation failed due to data issues
- `4`: Insufficient permissions
- `5`: Resource constraints (memory, disk space)
- `6`: Operation interrupted by user
- `7`: System error (unexpected failure)

## Integration with Existing Commands

The differential migration commands integrate with existing npm scripts:

```bash
# Combined workflow
npm run differential:analyze          # 1. Establish baseline
npm run differential:detect           # 2. Identify changes
npm run differential:migrate          # 3. Execute migration
npm run validate:all                  # 4. Validate results (existing)

# Existing commands continue to work
npm run migrate:all                   # Full migration (existing)
npm run migrate:doctors               # Single entity (existing)
npm run validate:doctors              # Validation (existing)
```

## Environment Configuration

Commands respect existing environment variables:

- `SOURCE_DB_*`: Source database connection settings
- `TARGET_DB_*`: Destination database connection settings
- `BATCH_SIZE`: Default batch size for processing
- `MAX_RETRY_ATTEMPTS`: Retry attempts for failed operations
- `MIGRATION_TIMEOUT`: Operation timeout in milliseconds