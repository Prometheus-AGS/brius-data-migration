# Research: Full Database Migration with Schema Updates

**Date**: 2025-11-17
**Purpose**: Research technical decisions and patterns for comprehensive database migration system

---

## 1. Schema Column Removal Strategy

### Decision: 4-Phase Gradual Removal with Column-Specific Risk Assessment

**Rationale**: Based on comprehensive codebase analysis, a gradual approach is essential due to varying risk levels per column:

- **profiles.legacy_patient_id**: **CRITICAL - DO NOT REMOVE** (242 occurrences across 53 files, fundamental to migration traceability)
- **profiles.insurance_info**: LOW RISK - Safe to remove with gradual strategy
- **profiles.medical_history**: LOW RISK - Safe to remove after data migration to new schema
- **products.sku**: MEDIUM RISK - Remove only after template_products migration completion

**Implementation Strategy**:
1. **Phase 1**: Pre-removal validation (dependency analysis, backup creation)
2. **Phase 2**: Mark columns as deprecated (comments, TypeScript warnings)
3. **Phase 3**: Remove application dependencies (code updates, deployment)
4. **Phase 4**: Schema migration (actual column removal with rollback capability)

**Alternatives Considered**:
- **Immediate removal**: Rejected due to high risk of breaking existing functionality
- **Keep all columns**: Rejected due to schema standardization requirements
- **Archive-only approach**: Rejected for insurance_info/medical_history due to minimal usage

**Implementation Considerations**:
- Backup tables required for rollback capability
- Zero-downtime deployment with blue-green or feature flag approaches
- PostgreSQL DROP COLUMN acquires ACCESS EXCLUSIVE lock (typically <1 second for unused columns)
- 2-3 week timeline with intensive monitoring during first 48 hours post-deployment

---

## 2. Incremental Migration Detection

### Decision: Hybrid Timestamp + Checkpoint-Based Approach

**Rationale**: Combines reliability of timestamp-based detection with precision of checkpoint tracking for large-scale enterprise migrations.

**Core Strategy**:
- **Primary**: `updated_at` timestamp comparison against last migration checkpoint
- **Secondary**: Migration control table tracking with batch-level granularity
- **Fallback**: Hash-based comparison for critical entities where timestamp may be unreliable

**Implementation Pattern**:
```typescript
interface IncrementalDetection {
  lastMigrationTimestamp: Date;
  checkpointBatchId: string;
  entitySpecificWatermarks: Map<string, Date>;
}

// Detection logic per entity
const newRecords = await sourceDb.query(`
  SELECT * FROM ${sourceTable}
  WHERE updated_at > $1
    OR created_at > $1
    OR id > $2  -- fallback for ID-based detection
`, [lastTimestamp, lastProcessedId]);
```

**Alternatives Considered**:
- **Pure timestamp-based**: Rejected due to clock skew and bulk update scenarios
- **Hash/checksum comparison**: Rejected as primary due to performance overhead on 1M+ records
- **Change data capture (CDC)**: Rejected due to source system limitations (legacy PostgreSQL)

**Implementation Considerations**:
- Handle clock skew with configurable buffer periods (5-10 minutes)
- Support for bulk operations that may have stale timestamps
- Efficient indexing strategy on timestamp columns
- Batch watermarking to enable resume capability

---

## 3. Comment Hierarchy Migration

### Decision: Relationship Reconstruction with Legacy Mapping Preservation

**Rationale**: Source dispatch_comment table lacks hierarchical structure, but destination supports parent-child relationships. Migration should establish proper hierarchy while preserving data integrity.

**Migration Strategy**:
1. **Direct Migration**: Simple dispatch_comment → comments with author mapping
2. **Relationship Analysis**: Check for potential hierarchy indicators (reply patterns, threading)
3. **UUID Generation**: Create new comment IDs with legacy_id preservation
4. **Author Mapping**: Link to profiles via legacy_user_id relationships

**Data Flow**:
```typescript
interface CommentMigration {
  source: DispatchComment;  // Simple structure: id, text, author_id, plan_id
  destination: Comment;     // Hierarchical: id, content, author_id, parent_comment_id
}

// Migration logic
const migratedComment = {
  id: generateUUID(),
  content: source.text,
  author_id: await mapLegacyUser(source.author_id),
  parent_comment_id: null,  // No existing hierarchy in source
  legacy_id: source.id,
  legacy_table: 'dispatch_comment'
};
```

**Alternatives Considered**:
- **Hierarchy inference from content**: Rejected due to unreliable pattern matching
- **Manual hierarchy establishment**: Rejected due to scale (thousands of comments)
- **Flatten destination structure**: Rejected as it reduces system capability

**Implementation Considerations**:
- Batch processing with author relationship validation
- Foreign key integrity checks during migration
- Support for future hierarchy establishment via admin tools
- Preserve plan_id relationships in metadata for business context

---

## 4. Large-Scale Migration Performance Optimization

### Decision: Multi-Tier Batch Processing with Adaptive Sizing

**Rationale**: 50+ tables with 1M+ records require sophisticated performance optimization to meet 4-hour completion target and 1000+ records/second throughput.

**Core Performance Strategy**:
- **Adaptive Batch Sizing**: 500-2000 records per batch based on table characteristics
- **Connection Pooling**: Separate pools for source and destination (8-12 connections each)
- **Parallel Processing**: Up to 4 concurrent entity migrations (respecting dependencies)
- **Memory Management**: Streaming results with <512MB memory constraint

**Optimization Techniques**:
```typescript
interface PerformanceOptimization {
  batchSizing: {
    smallTables: 2000;     // profiles, offices
    mediumTables: 1000;    // doctors, patients
    largeTables: 500;      // orders, cases, files
  };
  concurrency: {
    maxParallelTables: 4;
    connectionPoolSize: 12;
    memoryBufferSize: 512 * 1024 * 1024; // 512MB
  };
}
```

**Database-Specific Optimizations**:
- **Source (PostgreSQL)**: Read-only transactions, connection reuse, query plan caching
- **Destination (Supabase)**: Bulk inserts, batch upserts, RLS-aware operations
- **Network**: Connection pooling, compression, retry logic with exponential backoff

**Alternatives Considered**:
- **Single-threaded processing**: Rejected due to time constraints (would take 12+ hours)
- **Aggressive parallelization**: Rejected due to database connection limits and complexity
- **ETL tool integration**: Rejected to maintain TypeScript ecosystem consistency

**Implementation Considerations**:
- Dynamic batch size adjustment based on processing speed
- Memory pressure monitoring with circuit breaker pattern
- Progress tracking with detailed metrics (rows/second, errors, retries)
- Checkpoint creation every 10,000 records for resume capability

---

## 5. Migration Error Recovery and Rollback Strategies

### Decision: Multi-Layer Recovery with Granular Rollback Capability

**Rationale**: Enterprise-grade system requires comprehensive error handling at multiple levels: transaction, batch, entity, and system-wide recovery.

**Recovery Architecture**:
```typescript
interface RecoveryStrategy {
  transactionLevel: 'immediate_rollback';           // Per-batch transactions
  batchLevel: 'checkpoint_and_retry';              // Batch-level retry with exponential backoff
  entityLevel: 'continue_or_skip';                 // Entity-level error handling
  systemLevel: 'resume_from_checkpoint';           // Full system recovery
}
```

**Error Recovery Tiers**:

1. **Transaction Recovery** (Milliseconds)
   - PostgreSQL transaction rollback for batch failures
   - Automatic retry with exponential backoff (3 attempts)
   - Dead letter queue for persistent failures

2. **Batch Recovery** (Seconds to Minutes)
   - Checkpoint-based resume from last successful batch
   - Individual record error isolation
   - Detailed error logging with context preservation

3. **Entity Recovery** (Minutes to Hours)
   - Entity-level rollback procedures
   - Data integrity validation and repair
   - Dependency relationship reconstruction

4. **System Recovery** (Hours)
   - Full migration rollback to pre-migration state
   - Point-in-time recovery from database backups
   - Emergency procedures with stakeholder notification

**Checkpoint Strategy**:
```typescript
interface CheckpointData {
  migrationId: string;
  entityType: string;
  lastProcessedId: string;
  batchNumber: number;
  recordsProcessed: number;
  timestamp: Date;
  systemState: MigrationState;
}
```

**Alternatives Considered**:
- **No rollback capability**: Rejected due to production system requirements
- **Simple transaction rollback only**: Rejected due to complexity of multi-table dependencies
- **External ETL tool recovery**: Rejected to maintain system consistency

**Implementation Considerations**:
- Rollback scripts for each migration phase
- Automated recovery testing in staging environments
- Incident response procedures with clear escalation paths
- Recovery time objectives: <5 minutes for batch recovery, <1 hour for entity recovery

---

## Research Summary

### Key Technical Decisions Made:

1. **Schema Cleanup**: 4-phase gradual removal (DO NOT remove legacy_patient_id)
2. **Incremental Detection**: Hybrid timestamp + checkpoint approach
3. **Comment Migration**: Direct migration with relationship infrastructure ready
4. **Performance**: Multi-tier batch processing with adaptive sizing
5. **Recovery**: Multi-layer recovery with granular rollback capability

### Critical Implementation Requirements:

- **Timeline**: 2-3 weeks for schema cleanup, 4 hours for full migration execution
- **Performance**: 1000+ records/second sustained throughput
- **Reliability**: 99.5% success rate with comprehensive error recovery
- **Safety**: Multiple rollback strategies and extensive backup procedures

### Next Phase Dependencies:

All research findings feed into Phase 1 data model and contract design, with particular emphasis on:
- Migration control entity relationships
- Checkpoint and recovery data structures
- Performance monitoring and metrics interfaces
- Error handling and notification contracts