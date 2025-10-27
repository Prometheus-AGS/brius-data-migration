# Differential Migration CLI Help Documentation

## Overview

The Differential Migration CLI provides comprehensive command-line tools for database migration operations with incremental sync capabilities. All commands support `--help` for detailed usage information.

## Quick Reference

| Command | NPM Script | Description |
|---------|------------|-------------|
| `baseline-cli` | `npm run differential:analyze` | Baseline analysis and gap detection |
| `differential-cli` | `npm run differential:detect` | Change detection and differential analysis |
| `migration-cli` | `npm run differential:migrate` | Migration execution with checkpointing |
| `status-cli` | `npm run differential:status` | Real-time migration status monitoring |
| `control-cli` | `npm run differential:control` | Migration control operations |
| `logs-cli` | `npm run differential:logs` | Log management and streaming |

---

## 1. Baseline Analysis CLI

**Command**: `baseline-cli` | **NPM**: `npm run differential:analyze`

Establishes migration baseline by comparing source and destination databases, identifying record gaps, and validating mapping integrity.

### Syntax

```bash
npm run differential:analyze [options]
npx ts-node src/differential-migration/cli/baseline-cli.ts [options]
```

### Options

| Option | Argument | Description | Default |
|--------|----------|-------------|---------|
| `--entities` | `<list>` | Comma-separated entities to analyze | all available |
| `--output` | `<format>` | Output format: `table`, `json`, `csv` | `table` |
| `--include-mappings` | - | Include UUID mapping analysis | `false` |
| `--verbose` | - | Show detailed analysis information | `false` |
| `--dry-run` | - | Test connections without executing analysis | `false` |
| `--config` | `<path>` | Custom configuration file path | default config |
| `--help` | - | Show help message | - |

### Examples

```bash
# Basic baseline analysis for all entities
npm run differential:analyze

# Analyze specific entities with detailed output
npm run differential:analyze --entities "offices,doctors,patients" --verbose

# Generate JSON report with mapping validation
npm run differential:analyze --output json --include-mappings

# Test database connections without running analysis
npm run differential:analyze --dry-run --verbose

# Use custom configuration file
npm run differential:analyze --config ./custom-migration.json
```

### Sample Output

```
📊 Differential Migration: Baseline Analysis
============================================

✅ Source database connected (45ms)
✅ Destination database connected (52ms)

Entity Analysis Summary:
┌─────────────┬─────────────┬──────────────┬───────────┬──────────────┬───────────┐
│ Entity      │ Source      │ Destination  │ Gap       │ Gap %        │ Status    │
├─────────────┼─────────────┼──────────────┼───────────┼──────────────┼───────────┤
│ offices     │ 1,250       │ 1,200        │ 50        │ 4.0%         │ behind    │
│ doctors     │ 5,600       │ 5,580        │ 20        │ 0.4%         │ behind    │
│ patients    │ 45,000      │ 44,950       │ 50        │ 0.1%         │ behind    │
└─────────────┴─────────────┴──────────────┴───────────┴──────────────┴───────────┘

Overall Status: GAPS_DETECTED
Total Gap: 120 records (0.2% of 51,850 total)

🎯 Recommendation: Run differential detection to identify specific changes
```

---

## 2. Differential Detection CLI

**Command**: `differential-cli` | **NPM**: `npm run differential:detect`

Detects changes between source and destination databases since a specified timestamp or last sync operation.

### Syntax

```bash
npm run differential:detect [options]
npx ts-node src/differential-migration/cli/differential-cli.ts [options]
```

### Options

| Option | Argument | Description | Default |
|--------|----------|-------------|---------|
| `--entities` | `<list>` | Comma-separated entities to check | all available |
| `--since` | `<timestamp>` | ISO timestamp for change detection baseline | last sync |
| `--include-deletes` | - | Detect deleted records | `true` |
| `--batch-size` | `<number>` | Records per processing batch | `1000` |
| `--content-hash` | - | Enable content hash-based change detection | `true` |
| `--output` | `<format>` | Output format: `json`, `csv`, `table` | `table` |
| `--save-results` | `<path>` | Save detection results to file | - |
| `--verbose` | - | Show detailed change information | `false` |
| `--help` | - | Show help message | - |

### Examples

```bash
# Detect changes since last sync
npm run differential:detect

# Detect changes for specific entities since timestamp
npm run differential:detect --entities "offices,doctors" --since "2025-10-25T18:00:00.000Z"

# Full detection with verbose output and result saving
npm run differential:detect --include-deletes --verbose --save-results ./changes.json

# Large batch processing for performance
npm run differential:detect --batch-size 2000 --content-hash

# CSV output for external processing
npm run differential:detect --output csv --entities "patients"
```

### Sample Output

```
🔍 Differential Detection Results
==================================

Detection completed in 2.3 seconds
Processing 3 entities with batch size 1000

Change Summary:
┌─────────────┬─────────┬─────────┬──────────┬─────────┬─────────────┐
│ Entity      │ Total   │ New     │ Modified │ Deleted │ Last Change │
├─────────────┼─────────┼─────────┼──────────┼─────────┼─────────────┤
│ offices     │ 25      │ 10      │ 15       │ 0       │ 10:35:22    │
│ doctors     │ 45      │ 20      │ 20       │ 5       │ 10:34:18    │
│ patients    │ 150     │ 80      │ 65       │ 5       │ 10:36:45    │
└─────────────┴─────────┴─────────┴──────────┴─────────┴─────────────┘

Total Changes Detected: 220
Performance: 4,347 records/second

📄 Results saved to: /tmp/changes-2025-10-26-103722.json
🚀 Ready for migration: npm run differential:migrate
```

---

## 3. Migration Execution CLI

**Command**: `migration-cli` | **NPM**: `npm run differential:migrate`

Executes migration of detected changes with comprehensive checkpointing, parallel processing, and recovery capabilities.

### Syntax

```bash
npm run differential:migrate [options]
npx ts-node src/differential-migration/cli/migration-cli.ts [options]
```

### Options

| Option | Argument | Description | Default |
|--------|----------|-------------|---------|
| `--entities` | `<list>` | Comma-separated entities to migrate | all with changes |
| `--batch-size` | `<number>` | Records per migration batch | `500` |
| `--parallel` | `<number>` | Maximum parallel entity processing | `2` |
| `--checkpoint-interval` | `<number>` | Batches between checkpoints | `10` |
| `--max-retries` | `<number>` | Maximum retry attempts per batch | `3` |
| `--timeout` | `<ms>` | Operation timeout in milliseconds | `300000` |
| `--dry-run` | - | Simulate migration without actual changes | `false` |
| `--resume` | `<checkpoint-id>` | Resume from specific checkpoint | - |
| `--validation` | - | Enable post-migration validation | `true` |
| `--validation-sample` | `<number>` | Sample size for validation | `10` |
| `--save-report` | `<path>` | Save migration report to file | - |
| `--verbose` | - | Show detailed migration progress | `false` |
| `--help` | - | Show help message | - |

### Examples

```bash
# Basic migration with default settings
npm run differential:migrate

# High-performance migration with large batches
npm run differential:migrate --batch-size 1000 --parallel 4 --checkpoint-interval 20

# Safe migration with frequent checkpoints
npm run differential:migrate --batch-size 100 --checkpoint-interval 5 --max-retries 5

# Dry run to test migration without changes
npm run differential:migrate --dry-run --verbose

# Resume from failed migration
npm run differential:migrate --resume "cp-offices-batch-15"

# Migration with comprehensive validation
npm run differential:migrate --validation --validation-sample 50 --save-report ./migration-report.json

# Specific entities with custom timeout
npm run differential:migrate --entities "offices,doctors" --timeout 600000
```

### Sample Output

```
🚀 Migration Execution Started
===============================
Session ID: migration-2025-10-26-104520

Configuration:
- Batch Size: 500 records
- Parallel Entities: 2
- Checkpoint Interval: 10 batches
- Max Retries: 3 attempts
- Validation: Enabled (sample size: 10)

Entity Processing Order:
1. offices (dependency: none)
2. doctors (dependency: offices)
3. patients (dependency: doctors)

🏢 Processing offices...
  ✅ Batch 1/5 completed: 100 records migrated (0.8s)
  ✅ Batch 2/5 completed: 100 records migrated (0.9s)
  📍 Checkpoint created: cp-offices-batch-2
  ✅ Batch 3/5 completed: 100 records migrated (0.7s)
  ✅ Batch 4/5 completed: 100 records migrated (0.8s)
  ✅ Batch 5/5 completed: 100 records migrated (0.9s)
  📍 Final checkpoint: cp-offices-complete
  ✅ offices migration completed (4.1s, 122 records/sec)

👨‍⚕️ Processing doctors...
  ✅ Batch 1/10 completed: 50 records migrated (1.2s)
  ✅ Batch 2/10 completed: 50 records migrated (1.1s)
  [... progress continues ...]

📊 Migration Summary:
┌─────────────┬───────────┬─────────┬────────────┬──────────────┐
│ Entity      │ Processed │ Failed  │ Duration   │ Throughput   │
├─────────────┼───────────┼─────────┼────────────┼──────────────┤
│ offices     │ 500       │ 0       │ 4.1s       │ 122/sec      │
│ doctors     │ 1,200     │ 2       │ 12.5s      │ 96/sec       │
│ patients    │ 3,800     │ 5       │ 45.2s      │ 84/sec       │
└─────────────┴───────────┴─────────┴────────────┴──────────────┘

✅ Migration completed successfully
Total: 5,500 records processed, 7 failed (99.9% success rate)
Overall duration: 1m 15s
Average throughput: 88 records/second

📄 Report saved to: ./migration-report-2025-10-26-104520.json
```

---

## 4. Status Monitoring CLI

**Command**: `status-cli` | **NPM**: `npm run differential:status`

Provides real-time monitoring of migration operations with detailed progress tracking and performance metrics.

### Syntax

```bash
npm run differential:status [options]
npx ts-node src/differential-migration/cli/status-cli.ts [options]
```

### Options

| Option | Argument | Description | Default |
|--------|----------|-------------|---------|
| `--session` | `<session-id>` | Specific migration session to monitor | current active |
| `--watch` | - | Continuous monitoring mode | `false` |
| `--refresh` | `<seconds>` | Refresh interval for watch mode | `5` |
| `--format` | `<format>` | Output format: `table`, `json`, `compact` | `table` |
| `--include-details` | - | Show detailed entity progress | `false` |
| `--show-performance` | - | Include performance metrics | `false` |
| `--filter` | `<entity>` | Filter by specific entity type | all entities |
| `--history` | `<number>` | Show last N migration sessions | `5` |
| `--help` | - | Show help message | - |

### Examples

```bash
# Current migration status
npm run differential:status

# Watch mode with 3-second refresh
npm run differential:status --watch --refresh 3

# Detailed status for specific session
npm run differential:status --session "migration-2025-10-26-104520" --include-details

# Performance monitoring
npm run differential:status --show-performance --format json

# Entity-specific monitoring
npm run differential:status --filter "patients" --watch

# Migration history
npm run differential:status --history 10

# Compact output for scripting
npm run differential:status --format compact
```

### Sample Output

```
📊 Migration Status Monitor
============================
Session: migration-2025-10-26-104520
Status: RUNNING
Started: 2025-10-26 10:45:20
Duration: 00:03:15

Overall Progress: ████████████████░░░░ 75.5% (3,775/5,000 records)

Entity Status:
┌─────────────┬──────────┬─────────────┬──────────┬──────────────┬──────────────┐
│ Entity      │ Status   │ Progress    │ Records  │ Current Batch│ ETA          │
├─────────────┼──────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ offices     │ ✅ DONE  │ 100%        │ 500/500  │ -            │ -            │
│ doctors     │ ✅ DONE  │ 100%        │ 1200/1200│ -            │ -            │
│ patients    │ 🔄 RUN   │ 65.8%       │ 2075/3150│ Batch 42/63  │ 00:01:45     │
└─────────────┴──────────┴─────────────┴──────────┴──────────────┴──────────────┘

Current Performance:
- Throughput: 89 records/second
- Memory Usage: 142 MB
- Active Connections: 4/20

Last Update: 2025-10-26 10:48:35 (refreshing every 5s)
Press Ctrl+C to exit watch mode
```

---

## 5. Migration Control CLI

**Command**: `control-cli` | **NPM**: `npm run differential:control`

Provides control operations for migration processes including pause, resume, cancel, and checkpoint management.

### Syntax

```bash
npm run differential:control <command> [options]
npx ts-node src/differential-migration/cli/control-cli.ts <command> [options]
```

### Commands

| Command | Description |
|---------|-------------|
| `pause` | Pause running migration |
| `resume` | Resume paused migration |
| `cancel` | Cancel migration (with rollback option) |
| `checkpoint` | Manage migration checkpoints |
| `list` | List active and recent sessions |
| `cleanup` | Clean up old sessions and logs |

### Options

| Option | Argument | Description | Default |
|--------|----------|-------------|---------|
| `--session` | `<session-id>` | Target migration session | current active |
| `--force` | - | Force operation without confirmation | `false` |
| `--rollback` | - | Rollback changes when canceling | `false` |
| `--checkpoint-id` | `<id>` | Specific checkpoint for operations | latest |
| `--keep-logs` | - | Preserve logs during cleanup | `false` |
| `--older-than` | `<days>` | Cleanup sessions older than N days | `7` |
| `--help` | - | Show help message | - |

### Examples

```bash
# Pause current migration
npm run differential:control pause

# Resume specific migration session
npm run differential:control resume --session "migration-2025-10-26-104520"

# Cancel with rollback
npm run differential:control cancel --rollback --force

# List all sessions
npm run differential:control list

# Checkpoint management
npm run differential:control checkpoint --session "migration-2025-10-26-104520"

# Cleanup old sessions (keep logs)
npm run differential:control cleanup --older-than 14 --keep-logs

# Force cancel without confirmation
npm run differential:control cancel --force
```

### Sample Output

```
🎛️  Migration Control Center
=============================

Available Sessions:
┌─────────────────────────────┬──────────┬─────────────┬──────────────┬─────────────┐
│ Session ID                  │ Status   │ Started     │ Entity       │ Progress    │
├─────────────────────────────┼──────────┼─────────────┼──────────────┼─────────────┤
│ migration-2025-10-26-104520 │ RUNNING  │ 10:45:20    │ patients     │ 65.8%       │
│ migration-2025-10-26-093015 │ PAUSED   │ 09:30:15    │ doctors      │ 23.4%       │
│ migration-2025-10-25-164500 │ COMPLETE │ 16:45:00    │ -            │ 100%        │
└─────────────────────────────┴──────────┴─────────────┴──────────────┴─────────────┘

Command executed: PAUSE
Session: migration-2025-10-26-104520
Result: ✅ Migration paused successfully
Current checkpoint: cp-patients-batch-42
```

---

## 6. Logs Management CLI

**Command**: `logs-cli` | **NPM**: `npm run differential:logs`

Advanced log management with filtering, streaming, and analysis capabilities for migration operations.

### Syntax

```bash
npm run differential:logs [options]
npx ts-node src/differential-migration/cli/logs-cli.ts [options]
```

### Options

| Option | Argument | Description | Default |
|--------|----------|-------------|---------|
| `--session` | `<session-id>` | Target migration session | current active |
| `--level` | `<level>` | Minimum log level: `debug`, `info`, `warn`, `error` | `info` |
| `--entity` | `<entity>` | Filter by entity type | all entities |
| `--since` | `<timestamp>` | Show logs since timestamp | session start |
| `--tail` | `<lines>` | Show last N lines | `100` |
| `--follow` | - | Real-time log streaming | `false` |
| `--format` | `<format>` | Output format: `text`, `json`, `csv` | `text` |
| `--output` | `<file>` | Save logs to file | stdout |
| `--search` | `<pattern>` | Search for specific pattern | - |
| `--stats` | - | Show log statistics summary | `false` |
| `--help` | - | Show help message | - |

### Examples

```bash
# View recent logs
npm run differential:logs

# Stream logs in real-time
npm run differential:logs --follow

# Error logs only for specific session
npm run differential:logs --level error --session "migration-2025-10-26-104520"

# Entity-specific logs with search
npm run differential:logs --entity "patients" --search "failed"

# Export logs to JSON for analysis
npm run differential:logs --format json --output ./migration-logs.json

# Show log statistics
npm run differential:logs --stats

# Tail last 50 lines and follow
npm run differential:logs --tail 50 --follow

# Historical logs for completed session
npm run differential:logs --session "migration-2025-10-25-164500" --since "2025-10-25T16:45:00Z"
```

### Sample Output

```
📋 Migration Logs
==================
Session: migration-2025-10-26-104520
Showing last 100 entries (level: info and above)

2025-10-26 10:45:20 [INFO ] [SYSTEM   ] Migration session started
2025-10-26 10:45:21 [INFO ] [SYSTEM   ] Configuration loaded: batch_size=500, parallel=2
2025-10-26 10:45:22 [INFO ] [OFFICES  ] Starting entity migration (500 records)
2025-10-26 10:45:23 [INFO ] [OFFICES  ] Batch 1/5: Processing records 1-100
2025-10-26 10:45:24 [INFO ] [OFFICES  ] Batch 1/5: 100 records migrated successfully (0.8s)
2025-10-26 10:45:25 [INFO ] [OFFICES  ] Batch 2/5: Processing records 101-200
2025-10-26 10:45:26 [WARN ] [OFFICES  ] Batch 2/5: Retry attempt 1 due to connection timeout
2025-10-26 10:45:27 [INFO ] [OFFICES  ] Batch 2/5: 100 records migrated successfully (1.2s)
2025-10-26 10:45:28 [INFO ] [SYSTEM   ] Checkpoint created: cp-offices-batch-2
2025-10-26 10:45:29 [INFO ] [OFFICES  ] Batch 3/5: Processing records 201-300
2025-10-26 10:45:30 [INFO ] [OFFICES  ] Batch 3/5: 100 records migrated successfully (0.7s)
2025-10-26 10:45:31 [INFO ] [OFFICES  ] Entity migration completed: 500/500 records (99.8% success)
2025-10-26 10:45:32 [INFO ] [DOCTORS  ] Starting entity migration (1200 records)
2025-10-26 10:45:33 [INFO ] [DOCTORS  ] Batch 1/24: Processing records 1-50
...

Log Statistics:
- Total Entries: 1,247
- Errors: 3 (0.2%)
- Warnings: 15 (1.2%)
- Info: 1,156 (92.7%)
- Debug: 73 (5.9%)

Real-time streaming active (--follow mode)
Press Ctrl+C to exit
```

---

## Global Configuration

### Environment Variables

All CLI commands respect these environment variables:

```bash
# Database connections
SOURCE_DB_HOST=localhost
SOURCE_DB_PORT=5432
SOURCE_DB_USER=postgres
SOURCE_DB_PASSWORD=your_password
SOURCE_DB_NAME=source_db

TARGET_DB_HOST=localhost
TARGET_DB_PORT=54322
TARGET_DB_USER=postgres
TARGET_DB_PASSWORD=your_password
TARGET_DB_NAME=target_db

# Migration settings
BATCH_SIZE=500
MAX_RETRY_ATTEMPTS=3
CHECKPOINT_INTERVAL=10
PARALLEL_ENTITY_LIMIT=2
MIGRATION_TIMEOUT=300000
ENABLE_PERFORMANCE_MONITORING=true
LOG_LEVEL=info
```

### Configuration File

Create a `migration-config.json` file for persistent settings:

```json
{
  "database": {
    "source": {
      "host": "localhost",
      "port": 5432,
      "database": "source_db",
      "user": "postgres",
      "password": "your_password",
      "maxConnections": 20
    },
    "destination": {
      "host": "localhost",
      "port": 54322,
      "database": "target_db",
      "user": "postgres",
      "password": "your_password",
      "maxConnections": 20
    }
  },
  "migration": {
    "batchSize": 500,
    "maxRetryAttempts": 3,
    "checkpointInterval": 10,
    "parallelEntityLimit": 2,
    "timeoutMs": 300000,
    "enableValidation": true,
    "validationSampleSize": 10
  },
  "entities": {
    "available": [
      "offices", "doctors", "patients", "orders", "products",
      "jaws", "projects", "treatment_plans", "files", "case_files"
    ],
    "dependencies": {
      "doctors": ["offices"],
      "patients": ["doctors"],
      "orders": ["patients"],
      "products": ["orders"]
    }
  }
}
```

Use with: `--config ./migration-config.json`

---

## Exit Codes

All CLI commands use consistent exit codes:

| Code | Description |
|------|-------------|
| `0` | Success |
| `1` | General error |
| `2` | Invalid arguments |
| `3` | Database connection error |
| `4` | Migration failure |
| `5` | Validation failure |
| `6` | Configuration error |
| `7` | Checkpoint error |
| `8` | Resource exhaustion |

---

## Tips and Best Practices

### Performance Optimization

```bash
# For large datasets (>100K records)
npm run differential:migrate --batch-size 1000 --checkpoint-interval 20 --parallel 4

# For memory-constrained environments
npm run differential:migrate --batch-size 200 --parallel 1 --checkpoint-interval 5

# For high-performance scenarios
npm run differential:migrate --batch-size 2000 --parallel 6 --timeout 600000
```

### Monitoring and Debugging

```bash
# Comprehensive monitoring during migration
npm run differential:status --watch --include-details --show-performance

# Debug failed migration
npm run differential:logs --level error --search "failed"
npm run differential:control list

# Resume from failure
npm run differential:control resume --session "failed-session-id"
```

### Automation and Scripting

```bash
# Daily incremental sync
npm run differential:detect --since "$(date -d '1 day ago' -Iseconds)"
npm run differential:migrate --validation

# Backup before major migration
npm run differential:analyze --output json > backup-baseline.json
npm run differential:migrate --dry-run --save-report ./migration-plan.json
```

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Connection timeout | Increase `--timeout` or check network connectivity |
| Memory exhaustion | Reduce `--batch-size` or `--parallel` |
| Migration stuck | Use `npm run differential:control pause` then check logs |
| Validation failures | Use `--validation-sample` to adjust sample size |
| Checkpoint corruption | Use `npm run differential:control checkpoint --list` |

For additional help, see the [API Documentation](../api/differential-migration-api.md) and [Integration Guide](../integration/integration-guide.md).