# Quickstart: Migration Coverage Validation

## Overview
This quickstart guide provides step-by-step instructions for validating comprehensive migration scripts coverage and ensuring all clinical, business, and communications data has been properly migrated.

## Prerequisites

### Environment Setup
```bash
# Ensure you're in the project root
cd /usr/local/src/sage/dataload

# Verify environment variables are configured
source .env

# Check database connections
npm run validate:connections
```

### Required Tools
- Node.js 18+ with TypeScript 5.9+
- PostgreSQL client (psql)
- Database access to both source and target systems

## Quick Validation (5 minutes)

### Step 1: Overall Coverage Check
```bash
# Run comprehensive validation across all domains
npm run validate:all

# Expected output: 99%+ success rates across all categories
# ✅ Cases: 7,853/7,854 (99.99%)
# ✅ Orders: 23,050/23,272 (99.05%)
# ✅ Tasks: 762,604/768,962 (99.17%)
```

### Step 2: Domain-Specific Validation
```bash
# Validate clinical data coverage
npm run validate:clinical

# Validate business data coverage
npm run validate:business

# Validate communications data coverage
npm run validate:communications

# Expected: All domains showing >99% coverage
```

### Step 3: Data Integrity Check
```bash
# Check foreign key relationships
npm run validate:integrity

# Verify UUID mappings are complete
npm run validate:mappings

# Expected: Zero integrity violations
```

## Detailed Validation (15 minutes)

### Core Entity Validation
```bash
# Validate foundation entities (required first)
npm run validate:offices     # Expected: 7,853 offices
npm run validate:profiles    # Expected: All user profiles
npm run validate:doctors     # Expected: All doctor records
npm run validate:patients    # Expected: All patient records
npm run validate:orders      # Expected: 23,050+ orders
```

### Communications Data Validation
```bash
# Validate messaging systems
npx ts-node validate-messages-migration.ts
npx ts-node validate-comments-migration.ts
npx ts-node validate-communications-migration.ts

# Expected: All message threads and communication history preserved
```

### Business Data Validation
```bash
# Validate financial and operational data
npx ts-node validate-payments-migration.ts
npx ts-node validate-billing-migration.ts
npx ts-node validate-offers-discounts-migration.ts

# Expected: Financial data accuracy with zero corruption
```

### Technical Data Validation
```bash
# Validate system and file data
npx ts-node validate-files-migration.ts
npx ts-node validate-cases-migration.ts
npx ts-node validate-tasks-migration.ts

# Expected: All technical assets and metadata preserved
```

## Coverage Analysis

### Script Inventory Check
```bash
# List all migration scripts by category
npx ts-node analyze-script-coverage.ts

# Expected output:
# ✅ Core migrations: 9 scripts
# ✅ Communications: 5 scripts
# ✅ Business: 5 scripts
# ✅ Specialized: 4 scripts
# ✅ System: 4 scripts
# ✅ Critical fixes: 3 scripts
# Total: 40+ scripts covering all data domains
```

### Success Rate Analysis
```bash
# Generate detailed success metrics
npx ts-node generate-coverage-report.ts

# Expected metrics:
# - Total records: 1.2M+
# - Success rate: >99%
# - Financial accuracy: $366,002+ preserved
# - Zero data corruption incidents
```

## Validation Scenarios

### Scenario 1: Clinical Data Completeness
**Given**: A legacy database with patient records, medical history, and treatment data
**When**: Migration validation is executed
**Then**: All clinical data is preserved with 99%+ accuracy

```bash
# Execute clinical validation
npm run validate:clinical

# Verify specific metrics:
# - Patients: All profiles with medical history
# - Doctors: Complete practitioner records
# - Orders: Full treatment order lifecycle
# - Treatments: Clinical protocols and progress
```

### Scenario 2: Business Operations Continuity
**Given**: Business operational data including offices, payments, and billing
**When**: Migration validation runs
**Then**: All business operations remain functional

```bash
# Execute business validation
npm run validate:business

# Verify operational continuity:
# - Office data: Complete location and operational info
# - Payments: All financial transactions preserved
# - Billing: Invoice generation capabilities intact
# - Inventory: Product catalog completeness
```

### Scenario 3: Communications Preservation
**Given**: Message threads, comments, and notification systems
**When**: Communications validation executes
**Then**: All communication history is maintained

```bash
# Execute communications validation
npm run validate:communications

# Verify communication continuity:
# - Messages: Direct user messaging preserved
# - Comments: Discussion threads maintained
# - Notifications: Alert systems functional
# - Feedback: Review systems operational
```

## Troubleshooting

### Common Issues and Solutions

#### Issue: Script Not Found
```bash
# Error: Cannot find migration script
# Solution: Verify script exists and path is correct
ls -la src/*-migration.ts
ls -la migrate-*.ts
```

#### Issue: Database Connection Failed
```bash
# Error: Connection timeout or auth failure
# Solution: Check environment variables and connectivity
echo $SOURCE_DB_HOST $TARGET_DB_HOST
pg_isready -h $TARGET_DB_HOST -p $TARGET_DB_PORT
```

#### Issue: Validation Failures
```bash
# Error: Data mismatch or integrity violations
# Solution: Check migration logs and error details
tail -100 logs/migration-errors.log
npm run validate:integrity --verbose
```

#### Issue: Missing Data
```bash
# Error: Records not found in target database
# Solution: Check migration mappings and re-run specific migrations
npx ts-node check-missing-records.ts
npm run migrate:missing-data
```

## Performance Benchmarks

### Expected Performance Metrics
- **Validation Speed**: 1000+ records/second
- **Memory Usage**: <2GB for full validation
- **Execution Time**: <5 minutes for quick validation
- **Accuracy**: 99%+ success rates across all domains

### Performance Monitoring
```bash
# Monitor validation performance
npm run validate:performance

# Expected output:
# ✅ Validation throughput: 1200 records/sec
# ✅ Memory usage: 1.8GB peak
# ✅ Total execution time: 4m 32s
# ✅ Error rate: <1%
```

## Success Criteria

### Primary Success Indicators
- [ ] All 40+ migration scripts accounted for
- [ ] 99%+ success rates across all data domains
- [ ] Zero data corruption incidents
- [ ] Complete audit trail preserved
- [ ] All foreign key relationships intact

### Secondary Success Indicators
- [ ] Financial data accuracy: $366,002+ preserved exactly
- [ ] Communication threads: All message history maintained
- [ ] Clinical records: Complete patient data continuity
- [ ] Performance targets: <5 minute validation time
- [ ] Error handling: Graceful degradation on issues

## Next Steps

### After Successful Validation
1. **Generate final report**: `npm run generate:final-report`
2. **Archive validation logs**: `npm run archive:validation-logs`
3. **Update documentation**: `npm run update:coverage-docs`
4. **Notify stakeholders**: `npm run notify:validation-complete`

### If Validation Fails
1. **Review error logs**: `tail -100 logs/validation-errors.log`
2. **Identify missing data**: `npm run find:missing-records`
3. **Re-run specific migrations**: `npm run migrate:fix-issues`
4. **Repeat validation**: `npm run validate:all`

## Support and Resources

### Documentation
- [Migration Architecture Guide](../../../CLAUDE.md)
- [Database Schema Documentation](./data-model.md)
- [API Reference](./contracts/migration-coverage-api.yaml)

### Commands Reference
- `npm run validate:all` - Complete validation suite
- `npm run validate:domain <domain>` - Domain-specific validation
- `npm run generate:report` - Generate coverage report
- `npm run fix:issues` - Automated issue resolution

This quickstart ensures comprehensive validation of all migration scripts and data coverage with minimal time investment while providing detailed diagnostic capabilities when issues arise.