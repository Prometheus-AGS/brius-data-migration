# Research: Differential Database Migration System

**Date**: 2025-10-26
**Feature**: Differential Database Migration System
**Branch**: `001-continue-migration-all`

## Executive Summary

Research findings for implementing an efficient differential database migration system that builds on existing migration infrastructure while providing incremental synchronization capabilities. Key areas investigated: differential detection algorithms, checkpoint mechanisms, performance optimization strategies, and integration with existing TypeScript/PostgreSQL migration patterns.

## Technology Decisions

### Differential Detection Strategy

**Decision**: Timestamp-based change detection with content hash verification
**Rationale**:
- Source database has `updated_at` timestamps on most tables
- Content hashing provides verification for timestamp edge cases
- Proven scalable approach for large datasets (3.5M+ records)
- Compatible with existing migration control table patterns

**Alternatives considered**:
- Change Data Capture (CDC): Too complex for existing infrastructure
- Full table comparison: Prohibitive performance cost for large datasets
- Log-based replication: Requires source database modifications not available

### Checkpoint Mechanism

**Decision**: Batch-level checkpointing with entity-specific resume points
**Rationale**:
- Aligns with existing batch processing patterns (500-2000 records/batch)
- Granular enough for precise resumption without excessive overhead
- Integrates with existing `migration_control` table structure
- Supports parallel processing of independent entities

**Alternatives considered**:
- Record-level checkpointing: Too granular, excessive storage overhead
- Phase-level checkpointing: Too coarse, significant rework on interruption
- File-based checkpointing: Doesn't integrate with database audit trail

### Performance Optimization

**Decision**: Parallel entity processing with dependency-aware scheduling
**Rationale**:
- Existing dependency order well-established: offices → doctors → patients → orders
- Independent entities (jaw, system_messages) can process in parallel
- Memory-efficient streaming with configurable batch sizes
- Maintains existing performance characteristics (1000+ records/second)

**Alternatives considered**:
- Single-threaded sequential processing: Simpler but 3-5x slower
- Full parallelization: Risk of foreign key violations
- Queue-based processing: Added complexity without clear benefits

### Database Connection Strategy

**Decision**: Connection pooling with separate source/destination pools
**Rationale**:
- Existing pg connection patterns proven stable
- Separate pools prevent resource contention
- Configurable pool sizes for different workloads
- Built-in retry logic for connection failures

**Alternatives considered**:
- Single connection per operation: Poor performance, connection overhead
- Shared connection pool: Risk of resource starvation between source/dest
- Transaction-per-record: Excessive overhead, poor performance

## Integration Patterns

### Existing Migration Script Reuse

**Decision**: Wrapper pattern with enhanced differential logic
**Rationale**:
- Preserve proven transformation logic from existing `migrate-*.ts` scripts
- Add differential filtering layer before existing migration functions
- Maintain audit trail compatibility with current `migration_control` schema
- Zero risk of regression in established migration patterns

**Implementation approach**:
```typescript
// Existing migration function signature preserved
async function migrateEntity(records: SourceRecord[]): Promise<MigrationResult>

// New differential wrapper
async function migrateDifferential(entity: string): Promise<DifferentialResult> {
  const changes = await detectChanges(entity);
  return await migrateEntity(changes.newRecords);
}
```

### Schema Evolution Handling

**Decision**: Schema drift detection with manual intervention
**Rationale**:
- Source schema changes are infrequent but high-impact
- Automatic schema migration too risky for production data
- Manual review ensures data integrity and business logic preservation
- Alert-based workflow fits existing operational practices

**Detection strategy**:
- Column addition/removal detection via information_schema comparison
- Data type change detection via pg_attribute analysis
- Foreign key relationship change detection via pg_constraint analysis

## Performance Benchmarks

### Target Performance Metrics

Based on existing migration system performance and requirements:

- **Baseline Analysis**: Complete assessment of 3.5M records in <5 minutes
- **Differential Detection**: Identify changes in 100K records in <2 minutes
- **Migration Throughput**: Maintain 1000+ records/second for differential processing
- **Memory Usage**: <512MB peak usage regardless of dataset size
- **Checkpoint Overhead**: <5% performance impact for resumable operations

### Scalability Considerations

**Database Query Optimization**:
- Indexed timestamp queries for efficient change detection
- Batch processing with configurable sizes (500-2000 records)
- Connection pooling to handle concurrent operations
- Prepared statements for repeated operations

**Memory Management**:
- Streaming processing to avoid loading full datasets
- Garbage collection optimization for large batch processing
- Connection pool sizing based on available system resources

## Error Handling Strategy

### Failure Recovery Patterns

**Network Failures**: Automatic retry with exponential backoff
**Data Integrity Errors**: Stop processing, log detailed context, manual intervention required
**Partial Batch Failures**: Record-level error tracking, continue processing remaining records
**Schema Mismatches**: Alert and halt, require manual schema synchronization

### Monitoring and Alerting

**Progress Tracking**: Real-time batch completion status with ETA calculation
**Error Categorization**: Technical errors vs. data quality issues vs. business rule violations
**Audit Trail**: Complete record of all operations for compliance and debugging

## Security Considerations

### Data Protection

**Connection Security**: SSL/TLS required for all database connections
**Credential Management**: Environment-based configuration, no hardcoded secrets
**Data Masking**: PII identification and optional masking for non-production migrations
**Access Control**: Role-based access to migration operations and logs

### Compliance Requirements

**Data Residency**: Maintain data location requirements during migration
**Audit Requirements**: Complete trail of all data movements and transformations
**Retention Policies**: Log retention and data lifecycle management

## Next Steps

Phase 0 research complete. All technical unknowns resolved with specific implementation decisions. Ready to proceed to Phase 1 design and contract generation.

**Key Outputs for Phase 1**:
1. Data model definitions for checkpoint and differential result entities
2. CLI contract specifications for baseline, differential, and migration operations
3. Service interface contracts for core differential migration services
4. Integration specifications with existing migration infrastructure