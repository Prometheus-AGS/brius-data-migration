# Quickstart Guide: Differential Database Migration

**Date**: 2025-10-26
**Feature**: Differential Database Migration System
**Branch**: `001-continue-migration-all`

## Overview

Get started with the differential database migration system in 5 minutes. This guide covers the essential workflow from baseline analysis to differential migration execution.

## Prerequisites

### Environment Setup

1. **Database Access**: Ensure both source and destination databases are accessible
2. **Environment Variables**: Configure connection settings in `.env`
3. **Dependencies**: Install required Node.js packages

```bash
# Install dependencies
npm install

# Verify database connections
npm run test:connections

# Check existing migration status
npm run validate:all
```

### Required Environment Variables

```bash
# Source database (legacy PostgreSQL)
SOURCE_DB_HOST=your-source-host
SOURCE_DB_PORT=5432
SOURCE_DB_USER=your-source-user
SOURCE_DB_PASSWORD=your-source-password
SOURCE_DB_NAME=your-source-database

# Destination database (Supabase)
TARGET_DB_HOST=your-supabase-host
TARGET_DB_PORT=5432
TARGET_DB_USER=postgres
TARGET_DB_PASSWORD=your-supabase-password
TARGET_DB_NAME=postgres

# Migration settings
BATCH_SIZE=1000
MAX_RETRY_ATTEMPTS=3
MIGRATION_TIMEOUT=300000
```

## Quick Start Workflow

### Step 1: Establish Baseline (2 minutes)

First, analyze the current state of your migration to understand what's already been migrated:

```bash
# Analyze all entities
npm run differential:analyze

# Example output:
# Entity Analysis Summary
# =======================
# Entity       Source    Dest     Status    Gap
# offices      1,234     1,234    synced    0
# doctors      5,678     5,670    behind    8
# patients     12,345    12,200   behind    145
```

**Key Information**:
- **Source**: Records in source database
- **Dest**: Records in destination database
- **Status**: `synced`, `behind`, `ahead`, or `missing`
- **Gap**: Number of records that need migration

### Step 2: Detect Changes (1 minute)

Identify what's changed since the last migration:

```bash
# Detect changes for all entities
npm run differential:detect

# Example output:
# Differential Analysis Results
# =============================
# Entity       New    Modified  Deleted  Change%
# offices      12     5         2        1.5%
# doctors      45     23        1        1.2%
# patients     156    89        7        2.0%
#
# Total Changes: 340 records
# Estimated Migration Time: 35 minutes
```

**Key Information**:
- **New**: Records added since last migration
- **Modified**: Records updated since last migration
- **Deleted**: Records removed from source
- **Change%**: Percentage of total records changed

### Step 3: Execute Migration (Variable time)

Migrate only the identified changes:

```bash
# Start differential migration
npm run differential:migrate -- --analysis-id <uuid-from-step-2>

# Monitor progress in another terminal
npm run differential:status -- --watch
```

**Real-time Progress Display**:
```
Differential Migration Progress
===============================
Session ID: 550e8400-e29b-41d4-a716-446655440000

Entity        Status      Progress    Records/sec    ETA
offices       completed   100%        1,234/sec      -
doctors       running     75%         987/sec        2 min
patients      pending     0%          -              -

Overall Progress: 58% complete (197 of 340 records)
```

### Step 4: Validate Results (1 minute)

Verify the migration completed successfully:

```bash
# Run validation on migrated entities
npm run validate:doctors
npm run validate:patients

# Check overall migration status
npm run differential:analyze
```

## Common Scenarios

### Scenario 1: Daily Incremental Sync

Perfect for ongoing synchronization with minimal changes:

```bash
# Morning sync routine
npm run differential:detect
npm run differential:migrate -- --analysis-id $(cat .last-analysis-id)
npm run validate:all
```

**Expected Performance**:
- 100-500 daily changes: 2-5 minutes
- 1000+ daily changes: 10-15 minutes

### Scenario 2: Recovery from Failed Migration

Resume interrupted migrations using checkpoints:

```bash
# Check for interrupted sessions
npm run differential:control -- list

# Resume specific session
npm run differential:control -- resume --session-id <uuid>

# Monitor recovery progress
npm run differential:status -- --session-id <uuid> --watch
```

### Scenario 3: Large Backlog Processing

Handle significant data backlogs efficiently:

```bash
# Analyze with detailed breakdown
npm run differential:analyze -- --verbose

# Process in smaller batches
npm run differential:migrate -- --batch-size 500 --entities offices,doctors

# Process remaining entities
npm run differential:migrate -- --entities patients,orders
```

## Configuration Options

### Performance Tuning

```bash
# High-performance settings for large datasets
export BATCH_SIZE=2000
export MAX_CONCURRENT_ENTITIES=4

# Memory-constrained environments
export BATCH_SIZE=500
export MAX_CONCURRENT_ENTITIES=2

# Network-limited environments
export BATCH_SIZE=1000
export CONNECTION_POOL_SIZE=5
```

### Entity-Specific Configuration

```bash
# Process only critical entities
npm run differential:migrate -- --entities offices,doctors

# Skip problematic entities temporarily
npm run differential:migrate -- --exclude patients,orders

# Prioritize specific entities
npm run differential:migrate -- --entities offices --parallel false
npm run differential:migrate -- --entities doctors,patients --parallel true
```

## Troubleshooting

### Common Issues and Solutions

#### Issue: "No baseline found"
```bash
ERROR: No migration baseline found. Run analysis first.
```
**Solution**:
```bash
npm run differential:analyze
```

#### Issue: Database connection failure
```bash
ERROR: Could not connect to source database
```
**Solution**:
1. Check `.env` configuration
2. Verify network connectivity
3. Test connections: `npm run test:connections`

#### Issue: Foreign key constraint violations
```bash
ERROR: Foreign key constraint violation on record ID 12345
```
**Solution**:
```bash
# Process dependencies first
npm run differential:migrate -- --entities offices,doctors
# Then process dependent entities
npm run differential:migrate -- --entities patients,orders
```

#### Issue: Memory usage too high
```bash
WARNING: Memory usage above 80% (410MB of 512MB)
```
**Solution**:
```bash
# Reduce batch size
npm run differential:migrate -- --batch-size 500

# Disable parallel processing
npm run differential:migrate -- --parallel false
```

### Getting Help

```bash
# Command-specific help
npm run differential:analyze -- --help
npm run differential:migrate -- --help

# View detailed logs
npm run differential:logs -- --level debug --tail 100

# Check system status
npm run differential:status -- --verbose
```

## Integration with Existing Workflow

The differential migration system works alongside existing migration commands:

### Mixed Migration Strategy

```bash
# Full migration for new entities
npm run migrate:new-entity

# Differential migration for existing entities
npm run differential:migrate -- --entities existing-entities

# Standard validation
npm run validate:all
```

### Backup Strategy

```bash
# Before differential migration
npm run backup:create

# After successful migration
npm run backup:cleanup

# Recovery if needed
npm run backup:restore --timestamp $(date -d "1 hour ago" +%s)
```

## Performance Expectations

### Typical Performance Metrics

| Dataset Size | Change Rate | Processing Time | Memory Usage |
|--------------|-------------|-----------------|--------------|
| 10K records  | 1-5%        | 30-60 seconds   | 50-100 MB    |
| 100K records | 1-5%        | 2-5 minutes     | 100-200 MB   |
| 1M records   | 1-5%        | 10-20 minutes   | 200-400 MB   |
| 10M records  | 1-5%        | 1-2 hours       | 400-512 MB   |

### Optimization Tips

1. **Run during off-peak hours** for better database performance
2. **Use parallel processing** for independent entities
3. **Monitor memory usage** and adjust batch sizes accordingly
4. **Regular baseline analysis** to track migration drift
5. **Clean up old checkpoints** to maintain system performance

## Next Steps

After completing the quickstart:

1. **Automate Daily Sync**: Set up cron jobs for regular differential migration
2. **Monitor Performance**: Implement alerting for migration failures
3. **Scale Configuration**: Optimize settings for your specific data patterns
4. **Documentation**: Review detailed API contracts and data models
5. **Integration**: Connect with existing CI/CD pipelines

For detailed implementation guidance, see:
- [Data Model Specification](data-model.md)
- [API Contracts](contracts/)
- [Implementation Plan](plan.md)