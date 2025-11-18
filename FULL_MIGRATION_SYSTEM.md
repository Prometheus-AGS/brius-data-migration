# Full Migration System Documentation

## Overview

The Full Migration System is a comprehensive, enterprise-grade database migration solution that coordinates the complete migration from legacy PostgreSQL (`dispatch_*` tables) to modern Supabase architecture with UUID-based primary keys.

## Key Features

### 🎯 **Comprehensive Orchestration**
- **Dependency Management**: Automatic entity processing in correct dependency order
- **Resumable Migrations**: Checkpoint-based recovery from any point of failure
- **Real-time Monitoring**: Live progress tracking with detailed statistics
- **Event-driven Architecture**: Comprehensive event publishing for integration

### 🛡️ **Enterprise Reliability**
- **Transaction Safety**: Full rollback support with data integrity preservation
- **Error Recovery**: Multi-tier error handling with automatic retry logic
- **Connection Pooling**: Optimized database connections with health monitoring
- **Audit Trails**: Complete migration history with forensic-level detail

### ⚡ **High Performance**
- **Adaptive Batch Processing**: 500-2000 records per batch with dynamic sizing
- **Parallel Processing**: Up to 8 concurrent entity migrations
- **Performance Targets**: 1000+ records/second sustained throughput
- **Memory Efficient**: <512MB usage for 100K+ record migrations

### 📊 **Advanced Validation**
- **Data Integrity**: Foreign key consistency, primary key uniqueness
- **Completeness Checking**: Record count validation, mapping completeness
- **Performance Analysis**: Throughput monitoring, bottleneck identification
- **Auto-fixing**: Automated resolution of common data issues

## Quick Start

### 1. System Requirements
```bash
# Install dependencies
npm install

# Verify environment configuration
cp .env.example .env
# Configure your database connections in .env
```

### 2. Basic Migration Commands

```bash
# Full migration (all entities)
npm run migrate:full-database:all

# Core entities only (offices, profiles, doctors)
npm run migrate:full-database:core

# Core + patients
npm run migrate:full-database:core-with-patients

# Custom entity selection
npm run migrate:full-database -- --entities "offices,doctors,patients"
```

### 3. Validation Commands

```bash
# Comprehensive validation
npm run validate:full-migration -- <migration-id>

# Specific validation types
npm run validate:full-migration:integrity -- <migration-id>
npm run validate:full-migration:completeness -- <migration-id>
```

### 4. Monitoring Commands

```bash
# Migration status
npm run full-migration:status -- <migration-id>

# Detailed progress
npm run full-migration:progress -- <migration-id>

# Generate report
npm run full-migration:report -- <migration-id>
```

## Architecture Components

### Core Models (src/models/)
- **MigrationOrchestration**: Master migration coordination and state
- **EntityMigrationStatus**: Per-entity progress tracking with dependencies
- **MigrationCheckpoint**: Resumable migration points with system state
- **MigrationMapping**: Legacy ID → UUID preservation for relationships
- **BatchProcessingStatus**: Batch-level performance monitoring
- **MigrationError**: Comprehensive error tracking and analytics

### Services (src/full-migration/)
- **FullMigrationOrchestrator**: Central coordination service
- **FullMigrationCli**: Rich command-line interface
- **FullMigrationValidator**: Comprehensive validation engine
- **FullMigrationUtils**: Convenience functions for common operations

### Infrastructure (src/lib/)
- **DatabaseConnections**: Connection pooling and health monitoring
- **EnvironmentConfig**: Type-safe configuration management
- **ErrorHandler**: Enterprise-grade error handling with correlation IDs
- **EventPublisher**: Multi-target event publishing system

## Command Reference

### Migration Commands

| Command | Description | Example |
|---------|-------------|---------|
| `migrate` | Execute complete migration | `npm run migrate:full-database` |
| `migrate:core` | Core entities only | `npm run migrate:full-database:core` |
| `migrate:all` | All entities | `npm run migrate:full-database:all` |
| `migrate --schema-cleanup` | With schema cleanup | `npm run migrate:schema-cleanup` |

### Advanced Migration Options

```bash
# Custom batch size
npm run migrate:full-database -- --batch-size 2000

# Resume from checkpoint
npm run migrate:full-database -- --resume-from <migration-id>

# Schema cleanup (gradual column removal)
npm run migrate:full-database -- --schema-cleanup --schema-phase 1

# Dry run (validation only)
npm run migrate:full-database -- --dry-run

# Verbose logging
npm run migrate:full-database -- --verbose
```

### Monitoring Commands

| Command | Description | Example |
|---------|-------------|---------|
| `status` | Current migration status | `npm run full-migration:status` |
| `progress` | Detailed progress tracking | `npm run full-migration:progress -- <id>` |
| `list` | List all migrations | `npm run full-migration:list` |
| `report` | Generate comprehensive report | `npm run full-migration:report -- <id>` |

### Validation Commands

| Command | Description | Use Case |
|---------|-------------|----------|
| `validate` | Comprehensive validation | Post-migration verification |
| `validate:integrity` | Data integrity checks | Foreign keys, constraints |
| `validate:completeness` | Record completeness | Count validation, mappings |

### Utility Commands

| Command | Description | When to Use |
|---------|-------------|-------------|
| `cleanup` | Remove old checkpoints | Maintenance |
| `rollback` | Rollback migration (DANGEROUS) | Critical issues only |

## Performance Targets

### Processing Performance
- **Entity Migration**: 50+ entities in < 4 hours
- **Record Throughput**: 1000+ records/second sustained
- **Batch Processing**: 500-2000 records per batch (adaptive)
- **Memory Usage**: < 512MB for 100K+ records

### Success Metrics
- **Overall Success Rate**: 99.5%+ (industry-leading)
- **Data Integrity**: 100% maintained
- **Financial Accuracy**: 100% for monetary fields
- **Relationship Preservation**: 100% foreign key integrity

## Migration Entity Order

The system automatically handles dependencies, but the standard order is:

1. **Offices** (foundational - no dependencies)
2. **Profiles** (user accounts - auth_user source)
3. **Doctors** (depends on offices + profiles)
4. **Patients** (depends on doctors + profiles)
5. **Orders** (depends on patients)
6. **Products** (depends on orders)
7. **JAWS** (orthodontic data - depends on patients)
8. **Projects** (can run independently)
9. **Treatment Plans** (depends on patients)

## Error Recovery

### Automatic Recovery
- **Connection Failures**: Automatic reconnection with exponential backoff
- **Timeout Issues**: Configurable timeout with retry logic
- **Data Validation**: Skip invalid records with detailed logging
- **Constraint Violations**: Automatic constraint fixing where safe

### Manual Recovery
```bash
# Check migration status
npm run full-migration:status -- <migration-id>

# View errors
npm run full-migration:progress -- <migration-id> --details

# Resume from last checkpoint
npm run migrate:full-database -- --resume-from <migration-id>

# Rollback if necessary (CAUTION)
npm run full-migration:rollback -- <migration-id> --confirm
```

## Schema Cleanup Strategy

The system implements a 4-phase gradual schema cleanup:

### Phase 1: Analysis and Preparation
- Column usage analysis
- Dependency mapping
- Safety validation

### Phase 2: Graceful Deprecation
- Column nullification
- Warning notifications
- Backup procedures

### Phase 3: Controlled Removal
- Safe column removal
- Reference updates
- Integrity verification

### Phase 4: Final Cleanup
- Complete column removal
- Schema optimization
- Performance validation

## Integration Examples

### Programmatic Usage

```typescript
import {
  initializeFullMigrationSystem,
  executeFullMigration,
  validateMigration
} from './src/full-migration';

// Execute migration
const result = await executeFullMigration(['offices', 'doctors'], {
  batchSize: 1000,
  schemaCleanup: true
});

// Validate results
const validation = await validateMigration(result.migrationId, 'comprehensive');

console.log(`Migration ${result.success ? 'succeeded' : 'failed'}`);
console.log(`Validation ${validation.overallStatus}`);
```

### Event Integration

```typescript
import { EventPublisher } from './src/lib/event-publisher';

const publisher = new EventPublisher();

// Subscribe to migration events
publisher.subscribe('migration.started', (event) => {
  console.log(`Migration ${event.migration_id} started`);
});

publisher.subscribe('migration.completed', (event) => {
  console.log(`Migration ${event.migration_id} completed: ${event.success}`);
});
```

## Troubleshooting

### Common Issues

**Q: Migration fails with "connection timeout"**
```bash
# Check database connectivity
npm run migrate:full-database -- --timeout-minutes 480

# Reduce batch size
npm run migrate:full-database -- --batch-size 500
```

**Q: High memory usage during large migrations**
```bash
# Use smaller batches with more frequent checkpoints
npm run migrate:full-database -- --batch-size 500 --checkpoint-frequency 5
```

**Q: Foreign key constraint violations**
```bash
# Run integrity validation
npm run validate:full-migration:integrity -- <migration-id>

# Check dependency order
npm run full-migration:progress -- <migration-id> --details
```

### Performance Optimization

```bash
# Monitor performance
npm run full-migration:progress -- <migration-id>

# Optimize batch size based on throughput
npm run migrate:full-database -- --batch-size 2000

# Increase parallelism
npm run migrate:full-database -- --max-concurrency 8
```

## Production Deployment

### Pre-deployment Checklist
- [ ] Environment configuration verified
- [ ] Database connections tested
- [ ] Schema analysis completed
- [ ] Dry run executed successfully
- [ ] Rollback strategy prepared
- [ ] Monitoring systems configured

### Deployment Commands
```bash
# Production migration
npm run migrate:full-database:all --batch-size 1000

# Comprehensive validation
npm run validate:full-migration -- <migration-id>

# Generate final report
npm run full-migration:report -- <migration-id> --output production-report.md
```

### Post-deployment
```bash
# Verify system health
npm run full-migration:list

# Clean up old checkpoints
npm run full-migration:cleanup --days 7

# Archive migration logs
npm run full-migration:report -- <migration-id> --detailed
```

## Support and Maintenance

### Monitoring
- Migration logs: `logs/migration-*.log`
- Performance metrics: Built into CLI commands
- Error tracking: Comprehensive error categorization
- Health checks: Database connection monitoring

### Maintenance
- **Daily**: Check migration status for running operations
- **Weekly**: Clean up old checkpoints and logs
- **Monthly**: Review performance metrics and optimize
- **Quarterly**: Archive completed migration data

For additional support, review the comprehensive error messages and use the built-in help system:
```bash
npm run migrate:full-database -- --help
```