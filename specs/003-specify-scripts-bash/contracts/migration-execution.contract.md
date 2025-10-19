# Migration Execution Contract

**Contract Type**: Command Line Interface
**Service**: Complete Database Migration Execution
**Version**: 1.0.0
**Date**: October 15, 2025

## Contract Overview

This contract defines the interface for executing the complete database migration workflow, ensuring all tables with available scripts are properly migrated from the source database to the target database.

## Command Interface

### Core Migration Commands

#### 1. Phase-based Execution

```bash
# Execute specific migration phases
npm run migrate:core                    # Phase 1: offices + profiles + doctors
npm run migrate:core-with-patients      # Phase 1-2: core + patients
npm run migrate:orders-with-deps        # Phase 1-3: full dependency chain through orders
npm run migrate:all                     # Complete NPM-managed migrations

# Direct script execution for business operations
ts-node migrate-tasks.ts                # Business operations (700K+ records)
ts-node migrate-cases.ts                # Case management
ts-node migrate-dispatch-records.ts     # Clinical communications (60K+ messages)
ts-node migrate-communications.ts       # Team communications
```

#### 2. Entity-specific Execution

```bash
# Individual entity migrations (NPM-managed)
npm run migrate:doctors                 # Dependencies: offices
npm run migrate:patients                # Dependencies: doctors, offices
npm run migrate:orders                  # Dependencies: patients, doctors, offices
npm run migrate:products                # Dependencies: orders
npm run migrate:jaws                    # Dependencies: patients
npm run migrate:projects                # Dependencies: minimal
npm run migrate:treatment-plans         # Dependencies: patients

# Individual entity migrations (Direct scripts)
ts-node migrate-offers-and-discounts-fixed.ts    # Financial systems
ts-node migrate-purchases-fixed.ts               # Payment processing
ts-node migrate-order-files.ts                   # File management (140K+ files)
ts-node migrate-case-files-optimized.ts          # Case file attachments
ts-node migrate-doctor-notes.ts                  # Clinical notes
ts-node migrate-technician-roles-complete.ts     # Role management
ts-node migrate-customer-feedback.ts             # Customer relations
```

## Input/Output Contract

### Input Parameters

#### Environment Configuration (via .env)
```bash
# Source Database (Required)
SOURCE_DB_HOST=database-1.cluster-ro-czs1irwyssuq.us-east-2.rds.amazonaws.com
SOURCE_DB_PORT=5432
SOURCE_DB_USER=postgres
SOURCE_DB_NAME=mdw_db
SOURCE_DB_PASSWORD=mdw_replica2018

# Target Database (Required)
TARGET_DB_HOST=localhost
TARGET_DB_PORT=54322
TARGET_DB_USER=supabase_admin
TARGET_DB_NAME=postgres
TARGET_DB_PASSWORD=postgres

# Migration Settings (Optional)
BATCH_SIZE=500
MAX_RETRY_ATTEMPTS=3
MIGRATION_TIMEOUT=300000
```

#### Command Line Arguments
```bash
# NPM scripts accept standard arguments
npm run migrate:doctors validate    # Run validation after migration
npm run migrate:patients rollback   # Rollback migration

# Direct scripts accept custom arguments
ts-node migrate-tasks.ts --batch-size=1000      # Custom batch size
ts-node migrate-cases.ts --dry-run              # Preview mode
ts-node migrate-dispatch-records.ts --resume    # Resume from checkpoint
```

### Output Contract

#### Success Response
```json
{
  "status": "success",
  "entity": "patients",
  "execution": {
    "startTime": "2025-10-15T10:00:00Z",
    "endTime": "2025-10-15T10:15:30Z",
    "duration": "15m30s"
  },
  "results": {
    "totalRecords": 7856,
    "successful": 7854,
    "failed": 2,
    "successRate": 99.97
  },
  "validation": {
    "recordCountMatch": true,
    "referentialIntegrity": true,
    "dataQuality": 99.9
  },
  "mappings": {
    "legacyIdsPreserved": 7854,
    "uuidsGenerated": 7854
  }
}
```

#### Error Response
```json
{
  "status": "error",
  "entity": "orders",
  "error": {
    "code": "DEPENDENCY_NOT_MET",
    "message": "Patient migration must be completed before orders migration",
    "details": {
      "missingDependencies": ["patients"],
      "currentState": "doctors: completed, patients: pending"
    }
  },
  "recovery": {
    "suggestion": "Run 'npm run migrate:patients' first",
    "rollbackRequired": false
  }
}
```

#### Progress Response (for large migrations)
```json
{
  "status": "in_progress",
  "entity": "tasks",
  "progress": {
    "currentBatch": 1524,
    "totalBatches": 1530,
    "percentComplete": 99.6,
    "recordsProcessed": 762000,
    "recordsRemaining": 604,
    "estimatedTimeRemaining": "30s"
  },
  "performance": {
    "recordsPerSecond": 850,
    "averageBatchTime": "0.6s",
    "memoryUsage": "245MB"
  }
}
```

## Quality Assurance Contract

### Validation Commands
```bash
# Individual entity validation
npm run validate:doctors               # Validate doctors migration
npm run validate:patients              # Validate patients migration
npm run validate:orders                # Validate orders migration

# Comprehensive validation
npm run validate:core                  # Validate core entities
npm run validate:all                   # Validate all NPM-managed entities
npm run validate:final                 # Complete system validation

# Custom validation scripts
ts-node validate-case-migration.ts             # Case-specific validation
ts-node validate-offers-discounts-migration.ts # Financial data validation
ts-node final-migration-validation.ts          # Comprehensive final check
```

### Validation Output Contract
```json
{
  "entity": "patients",
  "timestamp": "2025-10-15T10:16:00Z",
  "validation": {
    "overallStatus": "passed",
    "checks": [
      {
        "type": "record_count",
        "status": "passed",
        "expected": 7856,
        "actual": 7854,
        "tolerance": 0.1
      },
      {
        "type": "referential_integrity",
        "status": "passed",
        "foreignKeyViolations": 0
      },
      {
        "type": "data_quality",
        "status": "passed",
        "completeness": 99.9,
        "accuracy": 100.0
      }
    ]
  },
  "issues": [],
  "recommendations": []
}
```

## Error Handling Contract

### Error Categories

#### Critical Errors (Stop Execution)
- Database connectivity failures
- Dependency violations (missing required entities)
- Schema compatibility issues
- Disk space exhaustion

#### Major Errors (Retry with Caution)
- Network timeouts
- Memory allocation failures
- Large batch processing failures
- Lock contention issues

#### Minor Errors (Log and Continue)
- Individual record processing failures within tolerance
- Non-critical validation warnings
- Performance degradation alerts

### Recovery Actions Contract

```bash
# Rollback commands (reverse dependency order)
npm run rollback:orders                # Rollback orders migration
npm run rollback:patients              # Rollback patients migration
npm run rollback:doctors               # Rollback doctors migration
npm run rollback:all                   # Complete system rollback

# Checkpoint recovery
ts-node migrate-tasks.ts --resume --checkpoint=15000
ts-node migrate-dispatch-records.ts --restart-from-batch=120
```

## Performance Contract

### Expected Performance Metrics

#### Small Entities (< 1K records)
- **Execution Time**: < 2 minutes
- **Memory Usage**: < 50MB
- **Success Rate**: > 99.5%

#### Medium Entities (1K - 10K records)
- **Execution Time**: 2-10 minutes
- **Memory Usage**: 50-200MB
- **Success Rate**: > 99.0%

#### Large Entities (10K - 100K records)
- **Execution Time**: 10-45 minutes
- **Memory Usage**: 200-500MB
- **Success Rate**: > 98.5%

#### Massive Entities (> 100K records)
- **Execution Time**: 45-120 minutes
- **Memory Usage**: 500MB-1GB
- **Success Rate**: > 98.0%

### Resource Requirements

```yaml
System Requirements:
  Memory: 2GB minimum, 4GB recommended
  Disk Space: 5GB free space minimum
  Network: Stable connection to source database
  CPU: 2+ cores for parallel processing

Database Requirements:
  Source: Read-only access sufficient
  Target: Full read/write access required
  Connection Pool: 10-20 connections recommended
```

## Monitoring & Observability Contract

### Logging Output
```bash
# Standard log format (structured JSON)
{
  "timestamp": "2025-10-15T10:00:00Z",
  "level": "INFO",
  "component": "migration-execution",
  "entity": "patients",
  "action": "batch_processed",
  "details": {
    "batchNumber": 15,
    "recordsInBatch": 500,
    "processingTime": "0.8s",
    "successCount": 500,
    "errorCount": 0
  }
}
```

### Progress Monitoring
```bash
# Real-time progress updates (stdout)
[10:00:00] Starting doctors migration...
[10:00:15] Processing batch 1/3 (500 records) ████████░░ 80%
[10:00:30] Processing batch 2/3 (500 records) ████████░░ 90%
[10:00:45] Processing batch 3/3 (213 records) ██████████ 100%
[10:01:00] Doctors migration completed successfully (1,213 records in 1m)
```

## Integration Contract

### Database Integration
- **Source Database**: Read-only PostgreSQL connection
- **Target Database**: Read/write Supabase PostgreSQL connection
- **Connection Pooling**: Automatic pool management
- **Transaction Safety**: Batch-level transactions with rollback support

### File System Integration
- **Log Files**: Written to `./logs/` directory
- **Checkpoint Files**: Written to `./checkpoints/` directory
- **Audit Trail**: Written to `./audit/` directory
- **Backup Metadata**: Written to `./backups/` directory

### Environment Integration
```bash
# Required environment setup
export NODE_ENV=production
export LOG_LEVEL=info
export MIGRATION_MODE=full
export VALIDATION_LEVEL=comprehensive

# Optional performance tuning
export BATCH_SIZE=500
export MAX_CONNECTIONS=15
export CHECKPOINT_FREQUENCY=10000
```

## Security Contract

### Data Protection
- **Credentials**: Loaded from environment variables only
- **Connection Security**: SSL/TLS for all database connections
- **Audit Trail**: Complete operation logging for compliance
- **Legacy ID Preservation**: Full traceability maintained

### Access Control
- **Source Database**: Read-only access sufficient
- **Target Database**: Requires schema modification permissions
- **File System**: Write access to logs and checkpoints directories
- **Network**: Outbound connections to source database required

## Compliance Contract

### Audit Requirements
- **Migration Tracking**: Every operation logged with timestamp
- **Data Lineage**: Complete mapping from legacy IDs to UUIDs
- **Validation Records**: All validation results preserved
- **Error Documentation**: Complete error and recovery audit trail

### Regulatory Compliance
- **Data Retention**: All source data relationships preserved
- **Privacy Protection**: UUID anonymization for enhanced security
- **Change Tracking**: Immutable audit log of all modifications
- **Recovery Capability**: Complete rollback support for compliance

## Contract Guarantees

### Data Integrity Guarantees
1. **Zero Data Loss**: All successfully processed records preserved exactly
2. **Referential Integrity**: All foreign key relationships maintained
3. **Legacy Compatibility**: Complete backward traceability via UUID mappings
4. **Financial Accuracy**: 100% accuracy for all monetary values

### Performance Guarantees
1. **Scalability**: Handles 1M+ records without performance degradation
2. **Memory Efficiency**: Bounded memory usage via batch processing
3. **Resumability**: All large migrations support checkpoint/resume
4. **Progress Visibility**: Real-time progress reporting for all operations

### Quality Guarantees
1. **Success Rate**: > 98% overall success rate across all entities
2. **Validation Coverage**: 100% of migrated entities validated
3. **Error Recovery**: Comprehensive rollback support for all failures
4. **Documentation**: Complete audit trail and reporting for all operations

This contract ensures the complete and reliable execution of database migration for all 56+ tables with available scripts, maintaining data integrity while providing comprehensive monitoring and recovery capabilities.