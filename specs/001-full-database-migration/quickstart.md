# Quickstart: Full Database Migration System

**Last Updated**: 2025-11-17
**Purpose**: Get started with the comprehensive database migration system

---

## Prerequisites

### System Requirements
- Node.js 18+ with TypeScript 5.9+
- PostgreSQL access to source database
- Supabase access to destination database
- Minimum 8GB RAM, 16GB recommended for large migrations
- Stable network connection (migration may run 2-4 hours)

### Environment Setup

1. **Install Dependencies**
   ```bash
   npm install
   npm install --save-dev jest @types/jest ts-jest
   ```

2. **Configure Environment**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your database credentials:
   ```env
   # Source Database (Legacy PostgreSQL)
   SOURCE_DB_HOST=your-legacy-host
   SOURCE_DB_PORT=5432
   SOURCE_DB_USER=your-user
   SOURCE_DB_PASSWORD=your-password
   SOURCE_DB_NAME=your-database

   # Destination Database (Supabase)
   TARGET_DB_HOST=localhost  # or your Supabase host
   TARGET_DB_PORT=54322
   TARGET_DB_USER=supabase_admin
   TARGET_DB_PASSWORD=your-password

   # Migration Configuration
   BATCH_SIZE=1000
   MAX_PARALLEL_ENTITIES=4
   MIGRATION_TIMEOUT=300000
   ```

3. **Verify Connections**
   ```bash
   npx ts-node src/cli/test-connections.ts
   ```

---

## Quick Start: 5-Minute Migration Test

### Step 1: Pre-Flight Check
```bash
# Analyze source database structure
npx ts-node analyze-source-schema.ts

# Validate destination schema
npx ts-node validate-destination-schema.ts

# Check dependency order
npx ts-node src/cli/validate-dependencies.ts
```

### Step 2: Start Small Test Migration
```bash
# Test with a single small entity first
npx ts-node src/cli/full-migration.ts \
  --entities=offices \
  --dry-run=true \
  --batch-size=100
```

### Step 3: Execute Full Migration
```bash
# Run complete migration (2-4 hours)
npx ts-node migrate-full-database.ts
```

### Step 4: Validate Results
```bash
# Comprehensive validation
npx ts-node validate-full-migration.ts

# Check data counts
npx ts-node src/cli/compare-record-counts.ts
```

---

## Common Usage Patterns

### Pattern 1: First-Time Complete Migration

**Scenario**: Initial migration from legacy system to Supabase

```bash
# 1. Pre-migration analysis
npm run analyze:source-schema
npm run validate:destination-ready

# 2. Execute with schema cleanup
curl -X POST http://localhost:3000/api/v1/migrations \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "migration_type": "full_migration",
    "include_schema_cleanup": true,
    "incremental_only": false,
    "configuration": {
      "batch_size": 1000,
      "max_parallel_entities": 4,
      "enable_rollback": true
    }
  }'

# 3. Monitor progress
curl -X GET http://localhost:3000/api/v1/migrations/{migration_id}

# 4. Validate completion
curl -X POST http://localhost:3000/api/v1/validation \
  -H "Content-Type: application/json" \
  -d '{
    "migration_id": "your-migration-id",
    "validation_types": ["referential_integrity", "data_completeness"]
  }'
```

### Pattern 2: Incremental Updates

**Scenario**: Daily/weekly updates of changed data

```bash
# Incremental migration (much faster - minutes instead of hours)
curl -X POST http://localhost:3000/api/v1/migrations \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "migration_type": "incremental",
    "incremental_only": true,
    "entity_filters": ["profiles", "orders", "comments"],
    "configuration": {
      "batch_size": 2000,
      "max_parallel_entities": 6
    }
  }'
```

### Pattern 3: Schema Cleanup Only

**Scenario**: Remove deprecated columns after migration

```bash
# IMPORTANT: Based on research, DO NOT remove legacy_patient_id
curl -X POST http://localhost:3000/api/v1/schema/cleanup \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "columns_to_remove": [
      {
        "table_name": "profiles",
        "column_name": "insurance_info",
        "risk_level": "low"
      },
      {
        "table_name": "profiles",
        "column_name": "medical_history",
        "risk_level": "low"
      },
      {
        "table_name": "products",
        "column_name": "sku",
        "risk_level": "medium"
      }
    ],
    "dry_run": false,
    "create_backup": true
  }'
```

### Pattern 4: Recovery from Failure

**Scenario**: Resume interrupted migration

```bash
# List recent migrations to find interrupted one
curl -X GET http://localhost:3000/api/v1/migrations?status=failed

# Resume from last checkpoint
curl -X POST http://localhost:3000/api/v1/migrations/{migration_id}/resume \
  -H "Content-Type: application/json" \
  -d '{
    "force_resume": false
  }'
```

---

## Monitoring and Troubleshooting

### Real-Time Monitoring

**Progress Tracking**:
```bash
# Watch migration progress
watch -n 10 "curl -s http://localhost:3000/api/v1/migrations/{migration_id} | jq '.progress'"

# Monitor performance metrics
curl -X GET "http://localhost:3000/api/v1/monitoring/metrics?migration_id={id}&time_range=last_hour"
```

**Log Monitoring**:
```bash
# Follow migration logs
tail -f logs/migration-$(date +%Y-%m-%d).log

# Check for errors
grep -i error logs/migration-*.log | tail -20
```

### Common Issues and Solutions

#### Issue: "Connection timeout to source database"
**Solution**:
```bash
# Increase timeout in configuration
export MIGRATION_TIMEOUT=600000  # 10 minutes

# Test connection
npx ts-node src/cli/test-connections.ts --verbose
```

#### Issue: "Referential integrity violation"
**Solution**:
```bash
# Run dependency analysis
npx ts-node src/cli/analyze-dependencies.ts

# Check for missing prerequisite entities
npx ts-node src/cli/validate-entity-order.ts
```

#### Issue: "Memory usage exceeding limits"
**Solution**:
```bash
# Reduce batch size
export BATCH_SIZE=500

# Reduce parallel processing
export MAX_PARALLEL_ENTITIES=2

# Monitor memory usage
npx ts-node src/cli/memory-monitor.ts
```

#### Issue: "Schema cleanup fails with 'column still in use'"
**Solution**:
```bash
# Analyze column dependencies (DO NOT remove legacy_patient_id)
npx ts-node src/cli/analyze-column-dependencies.ts

# Run dry-run first
curl -X POST http://localhost:3000/api/v1/schema/cleanup \
  -d '{"dry_run": true, ...}'
```

---

## Performance Optimization

### Large Dataset Optimization

**For migrations with 1M+ records**:
```bash
# Optimize for throughput
export BATCH_SIZE=2000
export MAX_PARALLEL_ENTITIES=6
export CONNECTION_POOL_SIZE=12

# Use performance monitoring
npx ts-node migrate-full-database.ts --with-metrics
```

### Memory-Constrained Environment

**For systems with limited RAM**:
```bash
# Conservative settings
export BATCH_SIZE=500
export MAX_PARALLEL_ENTITIES=2
export MEMORY_LIMIT_MB=256

# Enable streaming mode
npx ts-node migrate-full-database.ts --streaming-mode
```

### High-Availability Setup

**For production environments**:
```bash
# Use connection pooling
export CONNECTION_POOL_MIN=5
export CONNECTION_POOL_MAX=20

# Enable checkpointing
export CHECKPOINT_FREQUENCY=1000  # Every 1000 records

# Configure retry logic
export MAX_RETRY_ATTEMPTS=5
export RETRY_BACKOFF_MS=2000
```

---

## Validation and Testing

### Pre-Migration Validation

```bash
# Comprehensive pre-flight checks
npm run validate:all

# Specific validations
npm run validate:source-schema
npm run validate:destination-schema
npm run validate:credentials
npm run validate:dependencies
```

### Post-Migration Validation

```bash
# Data integrity checks
npm run validate:referential-integrity
npm run validate:data-completeness
npm run validate:business-rules

# Performance validation
npm run validate:query-performance
npm run validate:index-coverage

# Generate validation report
npx ts-node src/cli/generate-validation-report.ts
```

### Testing Strategies

**Unit Testing**:
```bash
# Test individual components
npm test -- --testPathPattern=migration

# Test with coverage
npm run test:coverage
```

**Integration Testing**:
```bash
# Test full migration flow (use test database)
npm run test:integration

# Test rollback procedures
npm run test:rollback
```

---

## Advanced Configurations

### Custom Entity Ordering

```typescript
// src/config/entity-dependencies.ts
export const CUSTOM_ENTITY_ORDER = [
  'offices',           // Foundation
  'profiles',         // Core users
  'doctors',          // Healthcare providers
  'patients',         // Healthcare recipients
  'orders',           // Business transactions
  'products',         // Product catalog
  'comments',         // User content
  'jaws',            // Specialized data
  'projects',        // Project management
  'treatment_plans'  // Clinical data
];
```

### Custom Transformation Rules

```typescript
// src/transformations/custom-rules.ts
export const PROFILE_TRANSFORMATION = {
  source_table: 'auth_user',
  destination_table: 'profiles',
  field_mappings: {
    'id': 'legacy_user_id',
    'first_name': 'first_name',
    'last_name': 'last_name',
    'email': 'email',
    'username': 'username',
    'is_active': 'is_active'
  },
  computed_fields: {
    'id': 'generateUUID()',
    'profile_type': 'determineProfileType(source.groups)',
    'created_at': 'source.date_joined'
  }
};
```

### Performance Monitoring Hooks

```typescript
// src/hooks/performance-monitor.ts
export const PERFORMANCE_HOOKS = {
  onBatchStart: (batchInfo) => {
    console.log(`Starting batch ${batchInfo.batchNumber} for ${batchInfo.entity}`);
  },
  onBatchComplete: (batchResult) => {
    const throughput = batchResult.recordCount / (batchResult.durationMs / 1000);
    console.log(`Batch completed: ${throughput.toFixed(2)} records/second`);
  },
  onEntityComplete: (entityResult) => {
    // Send metrics to monitoring system
    sendMetrics('entity_migration_complete', entityResult);
  }
};
```

---

## Production Deployment Checklist

### Pre-Deployment
- [ ] Environment credentials configured and tested
- [ ] Database backups created (both source and destination)
- [ ] Migration tested in staging environment
- [ ] Rollback procedures documented and tested
- [ ] Stakeholder notification sent
- [ ] Maintenance window scheduled (optional)

### During Migration
- [ ] Monitor system resource usage (CPU, memory, disk)
- [ ] Watch database connection counts
- [ ] Monitor error rates and response times
- [ ] Track migration progress against timeline
- [ ] Verify checkpoint creation frequency

### Post-Migration
- [ ] Run comprehensive validation suite
- [ ] Compare record counts between source and destination
- [ ] Test critical application workflows
- [ ] Monitor for 24-48 hours for issues
- [ ] Document lessons learned
- [ ] Schedule schema cleanup (if applicable)

---

## Getting Help

### Documentation
- [Full API Reference](./contracts/migration-api.yaml)
- [Data Model Documentation](./data-model.md)
- [Research and Architecture Decisions](./research.md)

### Support Channels
- Database Team: db-team@company.com
- Migration Issues: Create GitHub issue with label `migration`
- Emergency: Use on-call rotation for production issues

### Common Resources
```bash
# Generate support bundle
npx ts-node src/cli/generate-support-bundle.ts

# Check system health
npx ts-node src/cli/health-check.ts

# Export migration logs
npx ts-node src/cli/export-logs.ts --format=json
```

---

*This quickstart guide covers the most common scenarios. For advanced use cases, refer to the complete API documentation and data model specifications.*