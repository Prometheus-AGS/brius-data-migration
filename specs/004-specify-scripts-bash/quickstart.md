# Quickstart Guide: Final Database Migration Phase Execution

**Date**: 2025-10-18 | **Phase**: 1 - Execution Guide

## Prerequisites

### Environment Setup
1. **Node.js 18+** installed and configured
2. **TypeScript** globally installed (`npm install -g typescript`)
3. **Environment Configuration** (.env file) properly configured:
   ```bash
   # Source database (legacy system)
   SOURCE_DB_HOST=your-source-host
   SOURCE_DB_PORT=5432
   SOURCE_DB_USER=your-source-user
   SOURCE_DB_PASSWORD=your-source-password
   SOURCE_DB_NAME=your-source-db

   # Target database (remote Supabase)
   TARGET_DB_HOST=db.gyyottknjakkagswebwh.supabase.co
   TARGET_DB_PORT=5432
   TARGET_DB_USER=postgres
   TARGET_DB_PASSWORD=P@n@m3r@!
   TARGET_DB_NAME=postgres

   # Migration settings
   BATCH_SIZE=500
   TEST_MODE=false
   ```

### Dependency Verification
- **Successful Previous Migrations**: Ensure messages, orders, cases, files are already migrated
- **Database Connectivity**: Test both source and target connections
- **Sufficient Disk Space**: ~2GB free space for logs and temporary files
- **Network Stability**: Reliable connection for 4+ hour migration process

## Migration Execution Plan

### Phase 1: Simple Tables (30 minutes)
```bash
# 1. Template View Groups (no dependencies)
npx ts-node src/migrate-template-view-groups.ts

# 2. Template View Roles (depends on groups)
npx ts-node src/migrate-template-view-roles.ts

# 3. Brackets (standalone product data)
npx ts-node src/migrate-brackets.ts
```

### Phase 2: Personnel Tables (45 minutes)
```bash
# 4. Technicians (links to profiles)
npx ts-node src/migrate-technicians.ts

# 5. Technician Roles (depends on technicians)
npx ts-node src/migrate-technician-roles.ts
```

### Phase 3: Complex Relationship Tables (90 minutes)
```bash
# 6. Treatment Discussions (clinical workflow)
npx ts-node src/migrate-treatment-discussions.ts

# 7. Order Cases (complex relationships)
npx ts-node src/migrate-order-cases.ts
```

### Phase 4: High-Complexity Tables (60 minutes)
```bash
# 8. Message Attachments (file relationships)
npx ts-node src/migrate-message-attachments.ts

# 9. Purchases (financial data - most complex)
npx ts-node src/migrate-purchases.ts
```

### Phase 5: Final Validation & Reporting (30 minutes)
```bash
# Comprehensive validation
npx ts-node validation/final-system-validation.ts

# Generate final migration report
npx ts-node src/generate-final-report.ts
```

## Individual Migration Commands

### Template View Groups
```bash
# Test mode (first 10 records)
TEST_MODE=true npx ts-node src/migrate-template-view-groups.ts

# Full migration
npx ts-node src/migrate-template-view-groups.ts

# Validation
npx ts-node validation/validate-template-view-groups.ts
```

### Template View Roles
```bash
# Test mode
TEST_MODE=true npx ts-node src/migrate-template-view-roles.ts

# Full migration
npx ts-node src/migrate-template-view-roles.ts

# Validation
npx ts-node validation/validate-template-view-roles.ts
```

### Technicians
```bash
# Test mode
TEST_MODE=true npx ts-node src/migrate-technicians.ts

# Full migration
npx ts-node src/migrate-technicians.ts

# Validation
npx ts-node validation/validate-technicians.ts
```

### Technician Roles
```bash
# Test mode
TEST_MODE=true npx ts-node src/migrate-technician-roles.ts

# Full migration
npx ts-node src/migrate-technician-roles.ts

# Validation
npx ts-node validation/validate-technician-roles.ts
```

### Brackets
```bash
# Test mode
TEST_MODE=true npx ts-node src/migrate-brackets.ts

# Full migration
npx ts-node src/migrate-brackets.ts

# Validation
npx ts-node validation/validate-brackets.ts
```

### Treatment Discussions
```bash
# Test mode
TEST_MODE=true npx ts-node src/migrate-treatment-discussions.ts

# Full migration
npx ts-node src/migrate-treatment-discussions.ts

# Validation
npx ts-node validation/validate-treatment-discussions.ts
```

### Order Cases
```bash
# Test mode
TEST_MODE=true npx ts-node src/migrate-order-cases.ts

# Full migration
npx ts-node src/migrate-order-cases.ts

# Validation
npx ts-node validation/validate-order-cases.ts
```

### Message Attachments
```bash
# Test mode
TEST_MODE=true npx ts-node src/migrate-message-attachments.ts

# Full migration
npx ts-node src/migrate-message-attachments.ts

# Validation
npx ts-node validation/validate-message-attachments.ts
```

### Purchases
```bash
# Test mode (recommended for financial data)
TEST_MODE=true npx ts-node src/migrate-purchases.ts

# Review test results before full migration
npx ts-node validation/validate-purchases.ts

# Full migration (only after test validation)
npx ts-node src/migrate-purchases.ts

# Final validation
npx ts-node validation/validate-purchases.ts
```

## Automated Execution Script

Create `execute-final-migration.sh` for automated execution:

```bash
#!/bin/bash
set -e

echo "🚀 Starting Final Database Migration Phase"
echo "=========================================="

# Function to run migration with validation
run_migration() {
    local script_name=$1
    local validation_script=$2
    local description=$3

    echo "📋 $description"
    echo "   Executing: $script_name"

    npx ts-node "$script_name"

    if [ -f "$validation_script" ]; then
        echo "   Validating: $validation_script"
        npx ts-node "$validation_script"
    fi

    echo "   ✅ Completed: $description"
    echo ""
}

# Phase 1: Simple Tables
echo "🔄 Phase 1: Simple Tables"
run_migration "src/migrate-template-view-groups.ts" "validation/validate-template-view-groups.ts" "Template View Groups"
run_migration "src/migrate-template-view-roles.ts" "validation/validate-template-view-roles.ts" "Template View Roles"
run_migration "src/migrate-brackets.ts" "validation/validate-brackets.ts" "Brackets"

# Phase 2: Personnel Tables
echo "🔄 Phase 2: Personnel Tables"
run_migration "src/migrate-technicians.ts" "validation/validate-technicians.ts" "Technicians"
run_migration "src/migrate-technician-roles.ts" "validation/validate-technician-roles.ts" "Technician Roles"

# Phase 3: Complex Relationships
echo "🔄 Phase 3: Complex Relationship Tables"
run_migration "src/migrate-treatment-discussions.ts" "validation/validate-treatment-discussions.ts" "Treatment Discussions"
run_migration "src/migrate-order-cases.ts" "validation/validate-order-cases.ts" "Order Cases"

# Phase 4: High Complexity
echo "🔄 Phase 4: High-Complexity Tables"
run_migration "src/migrate-message-attachments.ts" "validation/validate-message-attachments.ts" "Message Attachments"
run_migration "src/migrate-purchases.ts" "validation/validate-purchases.ts" "Purchases"

# Phase 5: Final Validation & Reporting
echo "🔄 Phase 5: Final Validation & Reporting"
echo "📋 Running comprehensive system validation"
npx ts-node validation/final-system-validation.ts

echo "📋 Generating final migration report"
npx ts-node src/generate-final-report.ts

echo "🎉 Final Database Migration Phase Complete!"
echo "Check the generated report for detailed results."
```

## Monitoring & Progress Tracking

### Real-time Monitoring
```bash
# Monitor migration progress
tail -f migration-progress.log

# Check database connections
npx ts-node scripts/test-db-connections.ts

# Monitor system resources
htop # or top
```

### Progress Checkpoints
Each migration script outputs progress in this format:
```
Processing batch: 1 to 500
Progress: 2.1% (500/23000) - Success: 500, Skipped: 0, Errors: 0

Processing batch: 501 to 1000
Progress: 4.3% (1000/23000) - Success: 1000, Skipped: 0, Errors: 0
```

### Error Recovery
If a migration fails:
1. **Check the error message** in console output
2. **Review the log files** for detailed error information
3. **Fix any data issues** in the source database if needed
4. **Resume from last successful checkpoint** (scripts support resume)
5. **Re-run the specific migration script**

## Validation & Quality Assurance

### Pre-Migration Checks
```bash
# Verify source data quality
npx ts-node scripts/analyze-source-data.ts

# Check target database schema
npx ts-node scripts/verify-target-schema.ts

# Test migration scripts in TEST_MODE
TEST_MODE=true npx ts-node src/migrate-[table-name].ts
```

### Post-Migration Validation
```bash
# Data integrity checks
npx ts-node validation/check-data-integrity.ts

# Foreign key validation
npx ts-node validation/check-foreign-keys.ts

# Record count verification
npx ts-node validation/verify-record-counts.ts

# Sample data verification
npx ts-node validation/verify-sample-data.ts
```

## Success Criteria Verification

After completion, verify these success criteria:

1. **✅ All Tables Migrated**: 9/9 tables successfully migrated
2. **✅ Data Integrity**: Zero data corruption detected
3. **✅ Performance Goals**: Completed within 4-hour window
4. **✅ Foreign Key Integrity**: All relationships properly established
5. **✅ Legacy ID Preservation**: All legacy mappings maintained
6. **✅ Audit Trail**: Complete migration history documented
7. **✅ Resume Capability**: All scripts support interruption/resume
8. **✅ Error Reporting**: Comprehensive error logging and reporting
9. **✅ Final Report**: Complete system status documentation generated

## Troubleshooting

### Common Issues
1. **Connection Timeout**: Increase timeout values in .env
2. **Foreign Key Violations**: Check dependency migration completion
3. **Memory Issues**: Reduce BATCH_SIZE in .env
4. **Disk Space**: Monitor available space during execution
5. **Data Type Mismatches**: Review source data formatting

### Support Resources
- **Migration Logs**: Check detailed logs in project directory
- **Database Queries**: Use provided diagnostic queries
- **Rollback Procedures**: Each script supports safe rollback
- **Data Recovery**: Source data remains untouched for recovery

## Next Steps

After successful completion:
1. **Review Final Report**: Analyze migration statistics and recommendations
2. **System Testing**: Perform comprehensive system functionality testing
3. **Performance Testing**: Verify system performance with migrated data
4. **User Acceptance**: Coordinate user acceptance testing
5. **Go-Live Planning**: Plan production cutover and deployment
6. **Documentation Handoff**: Provide complete documentation to operations team