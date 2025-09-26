# Quickstart: Database Migration and Synchronization System

## Prerequisites

1. **Environment Setup**:
   ```bash
   # Ensure .env file is configured with database connections
   cp .env.example .env
   # Edit .env with your database credentials
   ```

2. **Dependencies**:
   ```bash
   npm install
   npm run build
   npm run typecheck
   ```

3. **Database Preparation**:
   ```bash
   # Ensure target database has existing migration infrastructure
   # Run existing schema setup if needed
   npm run migrate:offices  # Example - ensure base migration system works
   ```

## Quick Test Scenarios

### Scenario 1: Differential Migration (Primary User Story)

**Goal**: Migrate only new records from source database without duplicating existing data

```bash
# Step 1: Check current migration status
npm run check:migration-status

# Step 2: Run differential migration analysis
npx ts-node src/differential-migration.ts analyze --entities offices,doctors,patients

# Step 3: Execute differential migration (dry run first)
npx ts-node src/differential-migration.ts migrate --entities offices,doctors,patients --dry-run

# Step 4: Execute actual differential migration
npx ts-node src/differential-migration.ts migrate --entities offices,doctors,patients --batch-size 500

# Step 5: Validate migration results
npx ts-node src/data-validator.ts validate --entities offices,doctors,patients --type completeness_check
```

**Expected Results**:
- ✅ Only new records (not already in target) are migrated
- ✅ No duplicate records created
- ✅ All existing UUID mappings preserved
- ✅ Migration report shows success counts and any failures
- ✅ Validation confirms all source records exist in target

### Scenario 2: Sync Scheduler Setup (Ongoing Synchronization)

**Goal**: Set up scheduled synchronization with configurable intervals

```bash
# Step 1: Create scheduled sync job
npx ts-node src/sync-scheduler.ts create-job \
  --name "daily-sync" \
  --schedule "daily" \
  --entities "offices,doctors,patients,orders" \
  --conflict-resolution "source_wins" \
  --max-records 50000

# Step 2: Verify job creation
npx ts-node src/sync-scheduler.ts list-jobs

# Step 3: Run manual sync to test
npx ts-node src/sync-scheduler.ts run-job --name "daily-sync" --manual

# Step 4: Check sync job history
npx ts-node src/sync-scheduler.ts job-status --name "daily-sync"
```

**Expected Results**:
- ✅ Sync job created with correct schedule configuration
- ✅ Manual sync executes successfully
- ✅ Job status shows execution history and metrics
- ✅ Next scheduled run time is set correctly

### Scenario 3: Conflict Resolution (Source Wins Strategy)

**Goal**: Handle conflicts between source and target databases using source-wins strategy

```bash
# Step 1: Create test conflict scenario (modify existing target record)
npx ts-node tests/setup-conflict-scenario.ts

# Step 2: Run differential sync with conflict detection
npx ts-node src/differential-migration.ts sync --entities doctors --detect-conflicts

# Step 3: Review conflict resolution report
npx ts-node src/conflict-resolver.ts report --last-sync

# Step 4: Validate conflict resolution applied correctly
npx ts-node src/data-validator.ts validate --entities doctors --type data_integrity
```

**Expected Results**:
- ✅ Conflicts detected and logged
- ✅ Source data overwrites target data (source wins)
- ✅ Conflict resolution report shows which records were updated
- ✅ Data integrity validation passes

### Scenario 4: Error Recovery and Checkpointing

**Goal**: System can resume from last successful checkpoint after interruption

```bash
# Step 1: Start large migration that will be interrupted
npx ts-node src/differential-migration.ts migrate --entities orders --batch-size 1000 &
MIGRATION_PID=$!

# Step 2: Simulate interruption (stop after ~30 seconds)
sleep 30
kill $MIGRATION_PID

# Step 3: Check checkpoint status
npx ts-node src/migration-analyzer.ts checkpoint-status --entity orders

# Step 4: Resume from last checkpoint
npx ts-node src/differential-migration.ts resume --entity orders

# Step 5: Verify completion
npx ts-node src/data-validator.ts validate --entities orders --type completeness_check
```

**Expected Results**:
- ✅ Migration stops gracefully when interrupted
- ✅ Checkpoint records last successfully processed batch
- ✅ Resume operation starts from correct point
- ✅ No duplicate records created during resume
- ✅ Final validation confirms all records migrated

### Scenario 5: Comprehensive Validation

**Goal**: Validate all source database records exist in target with correct relationships

```bash
# Step 1: Run comprehensive data integrity check
npx ts-node src/data-validator.ts validate \
  --entities "offices,profiles,doctors,patients,orders" \
  --type data_integrity \
  --sampling-rate 1.0

# Step 2: Check relationship integrity
npx ts-node src/data-validator.ts validate \
  --entities "offices,profiles,doctors,patients,orders" \
  --type relationship_integrity

# Step 3: Performance validation (ensure sync meets timing requirements)
npx ts-node src/data-validator.ts validate \
  --entities "orders" \
  --type performance_check \
  --max-records 100000

# Step 4: Generate comprehensive validation report
npx ts-node src/data-validator.ts report --comprehensive --output validation-report.json
```

**Expected Results**:
- ✅ Data integrity validation passes (all records match)
- ✅ Relationship integrity maintained (foreign keys valid)
- ✅ Performance meets requirements (100K records processed efficiently)
- ✅ Validation report provides detailed metrics and any discrepancies

## Integration Test Suite

### Automated Test Execution

```bash
# Run all integration tests
npm test

# Run specific test suites
npm run test:differential-migration
npm run test:sync-scheduler
npm run test:conflict-resolution
npm run test:data-validation
```

### Test Coverage Requirements

Each test must validate:
- ✅ **Functional correctness**: Feature works as specified
- ✅ **Data integrity**: No corruption or loss
- ✅ **Performance**: Meets 100K record processing requirement
- ✅ **Error handling**: Graceful failure and recovery
- ✅ **Logging**: Adequate file-based logging for debugging

## Performance Benchmarks

### Expected Performance Targets

- **Differential Migration**: Process 50K records in < 10 minutes
- **Synchronization**: Complete daily sync in < 30 minutes
- **Validation**: Check 100K records in < 5 minutes
- **Conflict Resolution**: Handle 1K conflicts in < 2 minutes

### Performance Test Commands

```bash
# Benchmark differential migration
npx ts-node tests/performance/benchmark-differential.ts --records 50000

# Benchmark sync operation
npx ts-node tests/performance/benchmark-sync.ts --entities "all" --records 100000

# Benchmark validation
npx ts-node tests/performance/benchmark-validation.ts --records 100000
```

## Troubleshooting

### Common Issues and Solutions

1. **Migration Checkpoint Stuck**:
   ```bash
   # Check checkpoint status
   npx ts-node src/migration-analyzer.ts checkpoint-status --all

   # Reset stuck checkpoint (use carefully)
   npx ts-node src/migration-analyzer.ts reset-checkpoint --id <checkpoint-id>
   ```

2. **Sync Job Not Running**:
   ```bash
   # Check job configuration
   npx ts-node src/sync-scheduler.ts debug-job --name <job-name>

   # Manually trigger sync
   npx ts-node src/sync-scheduler.ts run-job --name <job-name> --manual
   ```

3. **Validation Failures**:
   ```bash
   # Get detailed validation report
   npx ts-node src/data-validator.ts validate --entities <entity> --verbose

   # Check specific record discrepancies
   npx ts-node src/data-validator.ts check-record --entity <entity> --legacy-id <id>
   ```

### Log File Locations

- **Migration logs**: `./logs/migration-YYYY-MM-DD.log`
- **Sync logs**: `./logs/sync-YYYY-MM-DD.log`
- **Validation logs**: `./logs/validation-YYYY-MM-DD.log`
- **Error logs**: `./logs/errors-YYYY-MM-DD.log`

## Success Criteria Checklist

After running the quickstart scenarios, verify:

- [ ] Differential migration completes without duplicating existing records
- [ ] Scheduled synchronization executes according to configured intervals
- [ ] Conflict resolution follows source-wins strategy consistently
- [ ] System recovers gracefully from interruptions using checkpoints
- [ ] Comprehensive validation confirms 100% data integrity
- [ ] Performance meets requirements (100K records processed efficiently)
- [ ] File-based logging provides adequate debugging information
- [ ] All existing UUID mappings and relationships preserved
- [ ] Migration reports show accurate success/failure metrics
- [ ] Sync job monitoring and status reporting works correctly