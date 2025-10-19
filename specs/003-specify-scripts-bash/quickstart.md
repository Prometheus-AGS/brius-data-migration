# Migration Execution Quickstart Guide

**Feature**: Complete Database Migration Execution
**Branch**: `003-specify-scripts-bash`
**Date**: October 15, 2025

## Prerequisites ✅ VERIFIED

All prerequisites are already met and verified:

- ✅ **Environment**: `.env` file configured with correct database connections
- ✅ **Dependencies**: All npm packages installed (`@supabase/supabase-js`, `pg`, `ts-node`)
- ✅ **Scripts**: All 29 migration scripts available and tested
- ✅ **Database Access**: Source (read-only) and target (read/write) connections working
- ✅ **Foundation**: Offices (523), categories (40), profiles (9,751) already migrated

## Quick Start (Complete Migration)

### Option 1: Full Automated Migration (Recommended)

Execute the complete migration workflow with proper dependency handling:

```bash
# 1. Core entities first (NPM managed with dependencies)
npm run migrate:core-with-patients     # offices + profiles + doctors + patients

# 2. Orders and extended core
npm run migrate:orders                  # treatment orders
npm run migrate:products               # product catalog
npm run migrate:jaws                   # orthodontic data

# 3. Business operations (Direct scripts)
ts-node migrate-tasks.ts               # 762K+ workflow tasks
ts-node migrate-cases.ts               # 7.8K patient cases
ts-node migrate-dispatch-records.ts    # 60K+ clinical messages

# 4. File management
ts-node migrate-order-files.ts         # 294K+ order attachments
ts-node migrate-case-files-optimized.ts # case documentation

# 5. Financial systems
ts-node migrate-offers-and-discounts-fixed.ts  # $4M+ offers/discounts
ts-node migrate-purchases-fixed.ts             # payment processing

# 6. Clinical and support systems
npm run migrate:projects                # 66K+ project records
npm run migrate:treatment-plans         # 67K+ treatment plans
ts-node migrate-doctor-notes.ts        # clinical notes
ts-node migrate-customer-feedback.ts   # 21K+ feedback records

# 7. System configuration
ts-node migrate-technician-roles-complete.ts   # role management
ts-node migrate-communications.ts              # team communications
ts-node migrate-doctor-offices.ts              # doctor-office relationships

# 8. Final validation
npm run validate:final                  # comprehensive system validation
```

**Expected Results**: 1.2M+ records migrated across 56+ tables with >98% success rate

### Option 2: Phase-by-Phase Migration (Safer)

Execute in carefully planned phases with validation checkpoints:

#### Phase 1: Core Foundation (2-3 hours)
```bash
# Already complete, but verify
npm run validate:core                   # Verify offices + profiles

# Add missing core entities
npm run migrate:doctors                 # ~1,213 doctors
npm run validate:doctors

npm run migrate:patients                # ~7,854 patients
npm run validate:patients

npm run migrate:orders                  # ~23,050 orders
npm run validate:orders
```

#### Phase 2: High-Volume Business Operations (1-2 hours)
```bash
# Large datasets requiring careful handling
ts-node migrate-tasks.ts               # 762K+ records (60-90 min)
ts-node migrate-cases.ts               # 7.8K cases (5-10 min)
ts-node migrate-dispatch-records.ts    # 60K+ messages (10-15 min)
ts-node migrate-order-files.ts         # 294K+ files (30-45 min)

# Validate high-volume migrations
ts-node validate-task-migration.ts
ts-node validate-case-migration.ts
```

#### Phase 3: Financial & Clinical Systems (30-60 minutes)
```bash
# Financial data (zero-tolerance for errors)
ts-node migrate-offers-and-discounts-fixed.ts  # $4M+ value
ts-node migrate-purchases-fixed.ts

# Clinical systems
npm run migrate:jaws                    # 39K+ orthodontic records
npm run migrate:treatment-plans         # 67K+ treatment plans
npm run migrate:projects                # 66K+ project records

# Validate financial accuracy
ts-node validate-offers-discounts-migration.ts
```

#### Phase 4: Supporting Systems (15-30 minutes)
```bash
# Extended clinical and operational data
ts-node migrate-doctor-notes.ts
ts-node migrate-customer-feedback.ts   # 21K+ feedback
ts-node migrate-technician-roles-complete.ts
ts-node migrate-communications.ts
ts-node migrate-doctor-offices.ts

# Relationship and state tables
ts-node migrate-case-files-optimized.ts
ts-node migrate-message-attachments.ts
```

#### Phase 5: Final Validation & Verification
```bash
# Comprehensive system validation
npm run validate:final
ts-node final-migration-validation.ts

# Check migration completeness
npm run check:migration-status
```

## Current State Analysis

### Already Completed ✅
- **offices**: 523 records
- **categories**: 40 records
- **profiles**: 9,751 records
- **brackets**: 1,569 records (product catalog)
- **Supporting data**: roles, templates, etc.

### Next Priority (Core Entities) 🔄
- **doctors**: 0 → ~1,213 records expected
- **patients**: 0 → ~7,854 records expected
- **orders**: 0 → ~23,050 records expected

### Business Operations 🔄
- **tasks**: 0 → ~762,604 records expected
- **cases**: 0 → ~7,853 records expected
- **messages**: 0 → ~60,944 records expected
- **files**: 0 → ~294,818 records expected

## Critical Commands Reference

### Essential NPM Scripts
```bash
# Core dependency-aware migrations
npm run migrate:core                    # offices + profiles + doctors
npm run migrate:core-with-patients      # core + patients
npm run migrate:orders-with-deps        # full chain through orders

# Individual entity migrations
npm run migrate:doctors                 # medical professionals
npm run migrate:patients                # patient demographics
npm run migrate:orders                  # treatment orders
npm run migrate:products                # product catalog
npm run migrate:jaws                    # orthodontic analysis
npm run migrate:projects                # project management
npm run migrate:treatment-plans         # treatment specifications

# Validation workflows
npm run validate:core                   # validate core entities
npm run validate:all                    # validate NPM-managed entities
npm run validate:final                  # comprehensive validation

# Emergency rollback (reverse dependency order)
npm run rollback:all                    # complete system rollback
```

### Essential Direct Scripts
```bash
# High-volume business operations
ts-node migrate-tasks.ts                # 762K+ workflow tasks
ts-node migrate-cases.ts                # patient case management
ts-node migrate-dispatch-records.ts     # clinical communications

# File management systems
ts-node migrate-order-files.ts          # treatment file attachments
ts-node migrate-case-files-optimized.ts # case documentation

# Financial operations (critical accuracy)
ts-node migrate-offers-and-discounts-fixed.ts  # pricing & promotions
ts-node migrate-purchases-fixed.ts             # payment processing

# Clinical & support systems
ts-node migrate-doctor-notes.ts         # clinical documentation
ts-node migrate-customer-feedback.ts    # patient feedback
ts-node migrate-technician-roles-complete.ts # role management
ts-node migrate-communications.ts       # team communications
```

## Monitoring & Troubleshooting

### Real-time Progress Monitoring
```bash
# Check current database state
npm run check:migration-status

# Monitor large migrations
tail -f logs/migration-$(date +%Y%m%d).log

# Check system resources
htop                                    # CPU and memory usage
df -h                                   # disk space
```

### Common Issues & Solutions

#### Database Connection Issues
```bash
# Test connections
psql -h database-1.cluster-ro-czs1irwyssuq.us-east-2.rds.amazonaws.com -p 5432 -U postgres -d mdw_db -c "SELECT COUNT(*) FROM dispatch_patient;"
psql -h localhost -p 54322 -U supabase_admin -d postgres -c "SELECT COUNT(*) FROM patients;"
```

#### Memory Issues (Large Migrations)
```bash
# Reduce batch size for large datasets
BATCH_SIZE=250 ts-node migrate-tasks.ts
BATCH_SIZE=100 ts-node migrate-order-files.ts
```

#### Dependency Violations
```bash
# Check dependency status before migration
npm run validate:doctors                # before patients
npm run validate:patients               # before orders
npm run validate:orders                 # before tasks/files
```

#### Performance Issues
```bash
# Monitor query performance
npm run validate:performance

# Check database locks
SELECT * FROM pg_stat_activity WHERE datname = 'postgres';
```

## Quality Assurance Checklist

### Pre-Migration Validation ✅
- [x] Database connections verified
- [x] Environment variables configured
- [x] Foundation data confirmed (offices, profiles, categories)
- [x] Disk space sufficient (>5GB free)
- [x] All migration scripts present

### During Migration Monitoring
- [ ] Monitor memory usage (stay under 2GB)
- [ ] Watch for error patterns in logs
- [ ] Verify batch processing progress
- [ ] Check database connection stability
- [ ] Monitor target database growth

### Post-Migration Validation
- [ ] Record counts match expectations (±1% tolerance)
- [ ] Foreign key integrity maintained (zero violations)
- [ ] Financial data accuracy (100% for monetary values)
- [ ] UUID mappings created for all legacy IDs
- [ ] Audit trail complete and accessible

## Performance Expectations

### Estimated Timeline
- **Phase 1 (Core)**: 30-60 minutes (4,000 records)
- **Phase 2 (Business)**: 60-120 minutes (850K+ records)
- **Phase 3 (Financial/Clinical)**: 30-60 minutes (175K+ records)
- **Phase 4 (Supporting)**: 15-30 minutes (25K+ records)
- **Phase 5 (Validation)**: 15-30 minutes

**Total Expected Duration**: 2.5-5 hours for complete migration

### Resource Requirements
- **Memory**: 2GB minimum, 4GB recommended
- **Disk**: 5GB free space minimum
- **Network**: Stable connection to source database
- **CPU**: 2+ cores for optimal performance

## Success Criteria Verification

After completion, verify these success criteria:

```bash
# 1. Record volume verification (>98% success rate expected)
echo "Expected: 1,200,000+ total records migrated"
npm run check:migration-status

# 2. Referential integrity (zero violations)
npm run validate:data-integrity

# 3. Financial accuracy (100% for monetary values)
ts-node validate-offers-discounts-migration.ts

# 4. Clinical data completeness (60K+ messages)
echo "Expected: 60,944 clinical messages"
psql -h localhost -p 54322 -U supabase_admin -d postgres -c "SELECT COUNT(*) FROM messages;"

# 5. Legacy ID preservation (100% backward compatibility)
echo "Expected: Complete UUID mappings for all entities"
psql -h localhost -p 54322 -U supabase_admin -d postgres -c "SELECT entity_type, COUNT(*) FROM migration_mappings GROUP BY entity_type;"
```

## Emergency Procedures

### Rollback Instructions
```bash
# Partial rollback (specific entity)
npm run rollback:orders                 # rollback orders only
ts-node migrate-cases.ts rollback       # rollback cases (if supported)

# Complete system rollback (nuclear option)
npm run rollback:all                    # rollback everything (reverse order)
```

### Recovery from Failure
```bash
# Resume from checkpoint (for supported migrations)
ts-node migrate-tasks.ts --resume
ts-node migrate-order-files.ts --continue-from=15000

# Restart with smaller batches
BATCH_SIZE=100 ts-node migrate-tasks.ts --restart
```

### Data Corruption Response
```bash
# Immediate assessment
npm run validate:data-integrity

# Isolate affected entities
npm run validate:patients
npm run validate:orders

# Contact support with audit logs
tar -czf migration-logs-$(date +%Y%m%d).tar.gz logs/ audit/
```

---

**Ready to Execute**: All prerequisites verified, scripts tested, comprehensive plan established. Expected completion: 1.2M+ records across 56+ tables with >98% success rate.