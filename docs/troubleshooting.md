# Migration Troubleshooting Guide

## Overview

This guide provides comprehensive troubleshooting steps for the database migration and synchronization system. It covers common issues, diagnostic commands, and resolution strategies for maintaining data integrity during migrations.

## Quick Diagnostics

### System Health Check
```bash
# Check overall system health
npx ts-node src/migration-analyzer.ts system-health --comprehensive

# Test database connections
npx ts-node src/data-validator.ts validate --entities test --type data_integrity --quick

# Check active operations
npx ts-node src/migration-analyzer.ts checkpoint-status --all
```

## Common Issues and Solutions

### 1. Migration Checkpoint Issues

#### Problem: Migration checkpoint stuck in "in_progress" state
**Symptoms:**
- Migration appears to hang indefinitely
- No progress updates for extended period
- Checkpoint shows old timestamp

**Diagnosis:**
```bash
# Check checkpoint status for specific entity
npx ts-node src/migration-analyzer.ts checkpoint-status --entity orders

# Review checkpoint details
npx ts-node src/migration-analyzer.ts debug --entity orders --verbose
```

**Solutions:**
```bash
# Option 1: Attempt to resume (safest approach)
npx ts-node src/differential-migration.ts resume --entity orders

# Option 2: Reset checkpoint (use carefully - may lose progress)
npx ts-node src/migration-analyzer.ts reset-checkpoint --entity orders --operation differential_migration

# Option 3: Force complete checkpoint if migration actually finished
npx ts-node src/migration-analyzer.ts force-complete-checkpoint --id checkpoint-uuid-123
```

**Prevention:**
- Set appropriate timeouts in migration configuration
- Monitor migration progress regularly
- Use `--enable-heartbeat` flag for long-running operations

#### Problem: Cannot create new checkpoint due to existing active checkpoint
**Symptoms:**
- Error: "Active checkpoint already exists for entity"
- New migration cannot start

**Diagnosis:**
```bash
# List active checkpoints
npx ts-node src/migration-analyzer.ts checkpoint-status --status in_progress

# Check specific entity checkpoint history
npx ts-node src/migration-analyzer.ts checkpoint-status --entity doctors --history
```

**Solutions:**
```bash
# Complete existing checkpoint if migration finished
npx ts-node src/migration-analyzer.ts complete-checkpoint --entity doctors

# Or reset if checkpoint is truly stale (use with caution)
npx ts-node src/migration-analyzer.ts reset-checkpoint --entity doctors --force
```

### 2. Synchronization Job Issues

#### Problem: Sync job not executing on schedule
**Symptoms:**
- Job status shows "scheduled" but doesn't run
- `next_run_at` time has passed
- No recent entries in sync run history

**Diagnosis:**
```bash
# Check sync job configuration
npx ts-node src/sync-scheduler.ts job-status --name "daily-sync"

# Review sync scheduler logs
tail -f logs/sync-$(date +%Y-%m-%d).log

# Check for conflicting jobs
npx ts-node src/sync-scheduler.ts list-jobs --status running
```

**Solutions:**
```bash
# Manually trigger sync job to test
npx ts-node src/sync-scheduler.ts run-job --name "daily-sync" --manual

# Update job schedule if configuration is incorrect
npx ts-node src/sync-scheduler.ts update-job --name "daily-sync" --schedule "0 2 * * *"

# Restart sync scheduler service
npx ts-node src/sync-scheduler.ts restart-scheduler
```

#### Problem: Sync job failing with timeout errors
**Symptoms:**
- Job status shows "failed" with timeout error
- Large datasets causing extended execution times

**Diagnosis:**
```bash
# Check job execution history for timeout patterns
npx ts-node src/sync-scheduler.ts job-status --name "daily-sync" --detailed

# Analyze dataset size and processing time
npx ts-node src/data-validator.ts analyze-size --entities orders --estimate-sync-time
```

**Solutions:**
```bash
# Increase job timeout
npx ts-node src/sync-scheduler.ts update-job --name "daily-sync" --timeout 3600000  # 1 hour

# Reduce batch size for memory efficiency
npx ts-node src/sync-scheduler.ts update-job --name "daily-sync" --batch-size 200

# Split large entity sync into separate jobs
npx ts-node src/sync-scheduler.ts create-job --name "orders-only-sync" --entities orders --schedule daily
```

### 3. Data Validation Failures

#### Problem: Data integrity validation failing
**Symptoms:**
- Validation reports show data discrepancies
- Records missing in target database
- Field value mismatches between source and target

**Diagnosis:**
```bash
# Run detailed validation with verbose output
npx ts-node src/data-validator.ts validate --entities doctors --type data_integrity --verbose

# Check specific failing records
npx ts-node src/data-validator.ts check-record --entity doctors --legacy-id 12345

# Compare source vs target data
npx ts-node src/migration-analyzer.ts compare-records --entity doctors --legacy-id 12345
```

**Solutions:**
```bash
# Re-migrate specific records
npx ts-node src/differential-migration.ts migrate --entities doctors --force-records 12345,12346,12347

# Run differential migration to catch missing records
npx ts-node src/differential-migration.ts migrate --entities doctors --mode missing-only

# Validate foreign key relationships
npx ts-node src/data-validator.ts validate --entities doctors --type relationship_integrity --fix-references
```

#### Problem: Relationship integrity validation failing
**Symptoms:**
- Foreign key constraint violations
- Orphaned records in target database
- Broken entity relationships

**Diagnosis:**
```bash
# Check relationship integrity for all entities
npx ts-node src/data-validator.ts validate --entities all --type relationship_integrity

# Analyze specific relationship issues
npx ts-node src/migration-analyzer.ts analyze-relationships --entity patients --broken-only

# Check UUID mapping integrity
npx ts-node src/migration-analyzer.ts validate-uuid-mappings --entity doctors
```

**Solutions:**
```bash
# Repair broken relationships
npx ts-node src/migration-analyzer.ts repair-relationships --entity patients --auto-fix

# Re-create missing UUID mappings
npx ts-node src/migration-analyzer.ts repair-uuid-mappings --entity doctors

# Re-migrate entities with dependency order
npx ts-node src/differential-migration.ts migrate --entities doctors,patients --dependency-order
```

### 4. Conflict Resolution Issues

#### Problem: Conflicts not being resolved automatically
**Symptoms:**
- Conflicts detected but not resolved
- `data_differentials` table shows unresolved conflicts
- Sync operations failing due to conflicts

**Diagnosis:**
```bash
# Check unresolved conflicts
npx ts-node src/conflict-resolver.ts status --unresolved-only

# Analyze conflict patterns
npx ts-node src/conflict-resolver.ts analyze-conflicts --entity doctors --last-days 7

# Check conflict resolution configuration
npx ts-node src/sync-scheduler.ts job-status --name "daily-sync" --show-config
```

**Solutions:**
```bash
# Manually resolve conflicts with source-wins strategy
npx ts-node src/conflict-resolver.ts resolve --entity doctors --strategy source_wins

# Update job to use specific conflict resolution
npx ts-node src/sync-scheduler.ts update-job --name "daily-sync" --conflict-resolution source_wins

# Create backup before resolving critical conflicts
npx ts-node src/conflict-resolver.ts resolve --entity doctors --create-backup --strategy source_wins
```

#### Problem: Source-wins strategy not working as expected
**Symptoms:**
- Target data not being overwritten by source data
- Conflicts remain after resolution attempt
- Data inconsistency between source and target

**Diagnosis:**
```bash
# Verify conflict resolution strategy execution
npx ts-node src/conflict-resolver.ts test-strategy --entity doctors --strategy source_wins --dry-run

# Check conflict resolution logs
grep "conflict_resolution" logs/sync-$(date +%Y-%m-%d).log

# Validate source data availability
npx ts-node src/migration-analyzer.ts validate-source --entity doctors --conflict-records-only
```

**Solutions:**
```bash
# Force re-resolution with backup
npx ts-node src/conflict-resolver.ts resolve --entity doctors --strategy source_wins --force --create-backup

# Manual conflict resolution for complex cases
npx ts-node src/conflict-resolver.ts resolve-manual --conflict-id diff-uuid-123 --action source_wins

# Reset and re-sync entire entity if corruption is detected
npx ts-node src/differential-migration.ts reset-entity --entity doctors --full-resync
```

### 5. Performance Issues

#### Problem: Migration running slower than expected
**Symptoms:**
- Processing rate below 500 records/second
- High memory usage during processing
- Database connection timeouts

**Diagnosis:**
```bash
# Run performance analysis
npx ts-node src/migration-analyzer.ts analyze-performance --entity orders --last-run

# Check database connection pool status
npx ts-node src/migration-analyzer.ts debug-connections --show-pool-stats

# Monitor resource usage during migration
npx ts-node src/migration-analyzer.ts monitor-resources --entity orders --duration 60
```

**Solutions:**
```bash
# Optimize batch size
npx ts-node src/differential-migration.ts migrate --entities orders --batch-size 200 --optimize-batching

# Increase database connection pool size
export TARGET_DB_MAX_CONNECTIONS=50
npx ts-node src/differential-migration.ts migrate --entities orders

# Use parallel processing for independent entities
npx ts-node src/differential-migration.ts migrate --entities offices,products,projects --parallel
```

#### Problem: Memory usage exceeding limits
**Symptoms:**
- Process killed by out-of-memory errors
- Memory usage growing continuously during processing
- System becoming unresponsive

**Diagnosis:**
```bash
# Monitor memory usage patterns
npx ts-node tests/performance/memory-analysis.ts --entity orders --batch-sizes 100,500,1000

# Check for memory leaks
npx ts-node src/migration-analyzer.ts memory-leak-check --entity orders --duration 300
```

**Solutions:**
```bash
# Reduce batch size
npx ts-node src/differential-migration.ts migrate --entities orders --batch-size 100

# Enable garbage collection hints
NODE_OPTIONS="--max-old-space-size=4096 --gc-interval=1000" npx ts-node src/differential-migration.ts migrate

# Use streaming processing for very large datasets
npx ts-node src/differential-migration.ts migrate --entities orders --streaming-mode
```

### 6. Database Connection Issues

#### Problem: Database connection failures
**Symptoms:**
- "Connection refused" errors
- "Authentication failed" errors
- Intermittent connection timeouts

**Diagnosis:**
```bash
# Test database connectivity
npx ts-node src/migration-analyzer.ts test-connections --verbose

# Check database server status
PGPASSWORD=$TARGET_DB_PASSWORD psql -h $TARGET_DB_HOST -p $TARGET_DB_PORT -U $TARGET_DB_USER -d $TARGET_DB_NAME -c "SELECT version();"

# Validate environment configuration
npx ts-node src/migration-analyzer.ts validate-config
```

**Solutions:**
```bash
# Update connection parameters
export TARGET_DB_HOST=localhost
export TARGET_DB_PORT=54322
export TARGET_DB_PASSWORD=your_password

# Increase connection timeout
export TARGET_DB_CONNECTION_TIMEOUT=60000

# Use connection retry logic
npx ts-node src/differential-migration.ts migrate --entities offices --connection-retries 5
```

#### Problem: Connection pool exhaustion
**Symptoms:**
- "Too many connections" errors
- Long wait times for database operations
- Connection timeout errors during peak usage

**Diagnosis:**
```bash
# Check active connections
npx ts-node src/migration-analyzer.ts debug-connections --show-active

# Monitor connection pool usage
npx ts-node src/migration-analyzer.ts monitor-connections --duration 120

# Check for connection leaks
npx ts-node src/migration-analyzer.ts detect-connection-leaks --entity orders
```

**Solutions:**
```bash
# Reduce maximum connections
export TARGET_DB_MAX_CONNECTIONS=10

# Implement connection pooling optimization
npx ts-node src/differential-migration.ts migrate --entities orders --optimize-connections

# Use sequential processing to reduce connection pressure
npx ts-node src/differential-migration.ts migrate --entities all --sequential --batch-size 200
```

## Diagnostic Commands Reference

### Log Analysis
```bash
# Search for specific errors in logs
grep -r "ERROR" logs/ --include="*.log" | tail -20

# Find migration-related errors
grep -r "migration.*failed" logs/ --include="*.log"

# Check sync operation logs
grep -r "sync_operation" logs/sync-*.log | grep -v "success"

# Monitor real-time logs during operations
tail -f logs/migration-$(date +%Y-%m-%d).log logs/sync-$(date +%Y-%m-%d).log
```

### Database State Analysis
```bash
# Check migration control table status
PGPASSWORD=$TARGET_DB_PASSWORD psql -h $TARGET_DB_HOST -p $TARGET_DB_PORT -U $TARGET_DB_USER -d $TARGET_DB_NAME \
  -c "SELECT entity_type, operation_type, status, COUNT(*) FROM migration_checkpoints GROUP BY entity_type, operation_type, status ORDER BY entity_type;"

# Check data differentials
PGPASSWORD=$TARGET_DB_PASSWORD psql -h $TARGET_DB_HOST -p $TARGET_DB_PORT -U $TARGET_DB_USER -d $TARGET_DB_NAME \
  -c "SELECT source_table, comparison_type, resolved, COUNT(*) FROM data_differentials GROUP BY source_table, comparison_type, resolved;"

# Check sync job status
PGPASSWORD=$TARGET_DB_PASSWORD psql -h $TARGET_DB_HOST -p $TARGET_DB_PORT -U $TARGET_DB_USER -d $TARGET_DB_NAME \
  -c "SELECT job_name, status, last_run_at, next_run_at FROM synchronization_jobs ORDER BY created_at;"
```

### Performance Analysis
```bash
# Analyze migration performance trends
npx ts-node src/migration-analyzer.ts performance-trends --entity orders --last-days 30

# Check batch processing efficiency
npx ts-node tests/performance/analyze-batch-performance.ts --entity orders

# Monitor resource usage during operations
npx ts-node src/migration-analyzer.ts monitor-resources --entity orders --duration 300
```

## Emergency Procedures

### Emergency Stop Procedures
```bash
# Gracefully stop all running migrations
npx ts-node src/migration-analyzer.ts stop-all-operations --graceful

# Force stop if graceful stop fails
npx ts-node src/migration-analyzer.ts stop-all-operations --force

# Pause all scheduled sync jobs
npx ts-node src/sync-scheduler.ts pause-all-jobs
```

### Data Recovery Procedures
```bash
# Create complete backup before major operations
npx ts-node src/migration-analyzer.ts create-full-backup --entities all --output migration-backup-$(date +%Y%m%d).json

# Restore from backup if needed
npx ts-node src/migration-analyzer.ts restore-from-backup --backup-file migration-backup-20231201.json --entities doctors

# Validate data integrity after recovery
npx ts-node src/data-validator.ts validate --entities all --type data_integrity --comprehensive
```

### Rollback Procedures
```bash
# Rollback recent migration
npx ts-node src/differential-migration.ts rollback --operation-id diff_migration_20231201_123456

# Rollback by entity (preserve dependencies)
npx ts-node src/differential-migration.ts rollback-entity --entity orders --preserve-deps

# Full system rollback (use with extreme caution)
npx ts-node src/migration-analyzer.ts rollback-all --batch-id batch_20231201 --confirm
```

## Monitoring and Maintenance

### Regular Health Checks
```bash
# Daily validation script
#!/bin/bash
echo "$(date): Running daily migration health check"

# Check for stale checkpoints
npx ts-node src/migration-analyzer.ts cleanup-stale-checkpoints --older-than-hours 24

# Validate data integrity for core entities
npx ts-node src/data-validator.ts validate --entities offices,doctors,patients --type data_integrity --quick

# Check sync job health
npx ts-node src/sync-scheduler.ts health-check --all-jobs

# Clean up old logs (keep last 30 days)
find logs/ -name "*.log" -type f -mtime +30 -delete

echo "$(date): Health check completed"
```

### Performance Monitoring
```bash
# Weekly performance report
npx ts-node src/migration-analyzer.ts generate-performance-report --last-days 7 --output weekly-report.json

# Check for performance degradation
npx ts-node tests/performance/regression-check.ts --baseline baseline-performance.json

# Monitor sync job performance trends
npx ts-node src/sync-scheduler.ts analyze-performance --last-runs 50 --show-trends
```

### Database Maintenance
```bash
# Cleanup old checkpoint records (monthly)
npx ts-node src/migration-analyzer.ts cleanup-checkpoints --older-than-days 30

# Cleanup resolved data differentials
npx ts-node src/migration-analyzer.ts cleanup-differentials --resolved-older-than-days 7

# Optimize migration tables (quarterly)
PGPASSWORD=$TARGET_DB_PASSWORD psql -h $TARGET_DB_HOST -p $TARGET_DB_PORT -U $TARGET_DB_USER -d $TARGET_DB_NAME \
  -c "VACUUM ANALYZE migration_checkpoints; VACUUM ANALYZE data_differentials; VACUUM ANALYZE synchronization_jobs;"
```

## Error Code Reference

### Migration Errors (M001-M099)
- **M001**: Checkpoint creation failed - Database connection issue or constraint violation
- **M002**: Batch processing timeout - Increase timeout or reduce batch size
- **M003**: Foreign key constraint violation - Check entity dependencies
- **M004**: UUID mapping conflict - Existing mapping with different UUID
- **M005**: Resume operation failed - Checkpoint data corruption or missing

### Sync Errors (S001-S099)
- **S001**: Sync job creation failed - Invalid schedule or configuration
- **S002**: Job execution timeout - Increase job timeout or optimize processing
- **S003**: Concurrent job limit exceeded - Wait for running jobs to complete
- **S004**: Schedule parsing error - Fix cron expression or schedule format
- **S005**: Conflict resolution failed - Check conflict resolution strategy

### Validation Errors (V001-V099)
- **V001**: Data integrity check failed - Source and target data mismatch
- **V002**: Relationship validation failed - Foreign key integrity issues
- **V003**: Completeness check failed - Missing records in target database
- **V004**: Performance validation failed - Processing time exceeded limits
- **V005**: Record-level validation failed - Specific record data corruption

### System Errors (SYS001-SYS099)
- **SYS001**: Database connection failed - Check credentials and network connectivity
- **SYS002**: Configuration validation failed - Invalid environment variables
- **SYS003**: Resource exhaustion - Insufficient memory or database connections
- **SYS004**: Service initialization failed - Dependency service unavailable
- **SYS005**: Graceful shutdown timeout - Force stop required

## Best Practices

### Migration Planning
1. **Always run analysis before migration:**
   ```bash
   npx ts-node src/differential-migration.ts analyze --entities target_entities --output pre-migration-analysis.json
   ```

2. **Use dry-run mode for validation:**
   ```bash
   npx ts-node src/differential-migration.ts migrate --entities doctors --dry-run
   ```

3. **Enable checkpointing for large operations:**
   ```bash
   npx ts-node src/differential-migration.ts migrate --entities orders --enable-checkpointing --batch-size 500
   ```

### Performance Optimization
1. **Batch size optimization:**
   - Small datasets (< 10K): 100-200 records per batch
   - Medium datasets (10K-100K): 500-1000 records per batch
   - Large datasets (> 100K): 1000-2000 records per batch

2. **Connection pooling:**
   - Set `TARGET_DB_MAX_CONNECTIONS=20` for normal operations
   - Increase to 50 for concurrent sync operations
   - Reduce to 5-10 for memory-constrained environments

3. **Memory management:**
   - Use streaming processing for datasets > 100K records
   - Enable garbage collection for long-running operations
   - Monitor memory usage with `--memory-monitoring` flag

### Error Prevention
1. **Validate environment configuration:**
   ```bash
   npx ts-node src/migration-analyzer.ts validate-config --comprehensive
   ```

2. **Test database connectivity regularly:**
   ```bash
   npx ts-node src/migration-analyzer.ts test-connections --timeout 30000
   ```

3. **Implement monitoring alerts:**
   ```bash
   # Add to crontab for automated monitoring
   0 */6 * * * /path/to/project && npx ts-node src/migration-analyzer.ts system-health --alert-on-issues
   ```

## Getting Help

### Log File Locations
- **Migration logs:** `./logs/migration-YYYY-MM-DD.log`
- **Sync logs:** `./logs/sync-YYYY-MM-DD.log`
- **Validation logs:** `./logs/validation-YYYY-MM-DD.log`
- **Error logs:** `./logs/errors-YYYY-MM-DD.log`
- **Performance logs:** `./logs/performance-YYYY-MM-DD.log`

### Debug Information Collection
When reporting issues, include:

```bash
# System information
npx ts-node src/migration-analyzer.ts system-info --comprehensive > debug-info.txt

# Recent logs (last 1000 lines)
tail -1000 logs/migration-$(date +%Y-%m-%d).log >> debug-info.txt
tail -1000 logs/sync-$(date +%Y-%m-%d).log >> debug-info.txt

# Database state snapshot
npx ts-node src/migration-analyzer.ts database-snapshot --tables migration_checkpoints,data_differentials,synchronization_jobs >> debug-info.txt

# Performance metrics
npx ts-node tests/performance/current-performance.ts >> debug-info.txt
```

### Escalation Paths
1. **First Level:** Check logs and run diagnostic commands
2. **Second Level:** Run system health check and performance analysis
3. **Third Level:** Create debug information package and review with database administrator
4. **Emergency:** Stop operations and implement emergency procedures if data corruption suspected

---

*This troubleshooting guide covers the differential migration and synchronization system. For legacy migration issues, refer to existing migration-specific documentation and reports.*