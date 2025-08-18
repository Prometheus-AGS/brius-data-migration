# Migration Control Schema

The `migration_control` table is the backbone of the migration tracking system, providing comprehensive progress monitoring, error handling, and resume capabilities for all migration operations.

## Table Schema

```sql
CREATE TABLE migration_control (
  id SERIAL PRIMARY KEY,
  phase VARCHAR NOT NULL,
  table_name VARCHAR NOT NULL, 
  operation VARCHAR NOT NULL,
  status VARCHAR NOT NULL,
  records_processed INTEGER,
  total_records INTEGER,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  error_message TEXT,
  batch_size INTEGER,
  worker_id INTEGER,
  source_query TEXT,
  validation_query TEXT,
  
  -- Indexes for performance
  CONSTRAINT migration_control_phase_check 
    CHECK (phase IN ('discovery', 'planning', 'mapping', 'execution', 'validation', 'rollback')),
  CONSTRAINT migration_control_status_check 
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'paused', 'skipped'))
);

-- Performance indexes
CREATE INDEX idx_migration_control_phase ON migration_control(phase);
CREATE INDEX idx_migration_control_status ON migration_control(status);
CREATE INDEX idx_migration_control_table ON migration_control(table_name);
CREATE INDEX idx_migration_control_started_at ON migration_control(started_at);
```

## Field Definitions

### Core Identification Fields
- **`id`**: Auto-incrementing primary key for unique record identification
- **`phase`**: High-level migration phase (`discovery`, `planning`, `mapping`, `execution`, `validation`, `rollback`)
- **`table_name`**: Source or target table being processed
- **`operation`**: Specific operation being performed (e.g., `schema_analysis`, `batch_migration`, `count_validation`)

### Status Tracking Fields
- **`status`**: Current operation status
  - `pending`: Operation queued but not started
  - `running`: Operation currently in progress
  - `completed`: Operation finished successfully
  - `failed`: Operation encountered unrecoverable error
  - `paused`: Operation temporarily halted (user decision, resource constraints)
  - `skipped`: Operation intentionally bypassed

### Progress Tracking Fields
- **`records_processed`**: Number of records successfully processed in current operation
- **`total_records`**: Expected total number of records for this operation
- **`started_at`**: Timestamp when operation began
- **`completed_at`**: Timestamp when operation finished (success or failure)

### Error Handling Fields
- **`error_message`**: Detailed error description for failed operations
- **`batch_size`**: Number of records processed per batch (for execution operations)
- **`worker_id`**: Agent or process ID responsible for this operation

### Query Storage Fields
- **`source_query`**: SQL query used to extract source data
- **`validation_query`**: SQL query used to validate operation success

## Usage Patterns

### 1. Migration Phase Tracking

```sql
-- Track overall migration phases
INSERT INTO migration_control (phase, table_name, operation, status, started_at)
VALUES ('discovery', 'dispatch_bracket', 'schema_analysis', 'running', NOW());

-- Update phase completion
UPDATE migration_control 
SET status = 'completed', completed_at = NOW(), total_records = 1569
WHERE phase = 'discovery' AND table_name = 'dispatch_bracket' AND operation = 'schema_analysis';
```

### 2. Batch Migration Tracking

```sql
-- Start batch migration
INSERT INTO migration_control (
  phase, table_name, operation, status, 
  batch_size, total_records, started_at, worker_id
) VALUES (
  'execution', 'brackets', 'batch_migration', 'running',
  500, 1569, NOW(), 1
);

-- Update batch progress
UPDATE migration_control 
SET records_processed = 500, status = 'running'
WHERE phase = 'execution' AND table_name = 'brackets' AND worker_id = 1;

-- Complete migration
UPDATE migration_control
SET status = 'completed', completed_at = NOW(), records_processed = 1569
WHERE phase = 'execution' AND table_name = 'brackets' AND worker_id = 1;
```

### 3. Error Tracking and Recovery

```sql
-- Record migration failure
UPDATE migration_control
SET 
  status = 'failed',
  error_message = 'Foreign key constraint violation: case_id 1001 not found in target cases table',
  completed_at = NOW()
WHERE phase = 'execution' AND table_name = 'case_file_relationships' AND worker_id = 2;

-- Record retry attempt
INSERT INTO migration_control (
  phase, table_name, operation, status, 
  started_at, batch_size, worker_id
) VALUES (
  'execution', 'case_file_relationships', 'retry_batch_15', 'running',
  NOW(), 200, 2
);
```

## Real-World Examples

### Brackets Migration Tracking

```sql
-- Phase 1: Discovery
INSERT INTO migration_control VALUES 
(1, 'discovery', 'dispatch_bracket', 'table_analysis', 'completed', 
 0, 1569, '2024-01-15 10:00:00', '2024-01-15 10:00:05', 
 NULL, NULL, 1, 
 'SELECT COUNT(*) FROM dispatch_bracket', 
 'SELECT COUNT(*) FROM brackets');

-- Phase 2: Planning
INSERT INTO migration_control VALUES
(2, 'planning', 'brackets', 'migration_strategy', 'completed',
 0, 1569, '2024-01-15 10:00:05', '2024-01-15 10:00:10',
 NULL, 500, 1, NULL, NULL);

-- Phase 3: Execution (Batch 1)
INSERT INTO migration_control VALUES
(3, 'execution', 'brackets', 'batch_migration', 'completed',
 500, 1569, '2024-01-15 10:00:15', '2024-01-15 10:00:45',
 NULL, 500, 1, 
 'SELECT * FROM dispatch_bracket LIMIT 500 OFFSET 0',
 'SELECT COUNT(*) FROM brackets WHERE batch_id = 1');

-- Phase 3: Execution (Batch 2) 
INSERT INTO migration_control VALUES
(4, 'execution', 'brackets', 'batch_migration', 'completed',
 500, 1569, '2024-01-15 10:00:45', '2024-01-15 10:01:15',
 NULL, 500, 1,
 'SELECT * FROM dispatch_bracket LIMIT 500 OFFSET 500',
 'SELECT COUNT(*) FROM brackets WHERE batch_id = 2');

-- Continue for remaining batches...

-- Phase 4: Validation
INSERT INTO migration_control VALUES
(8, 'validation', 'brackets', 'count_verification', 'completed',
 1569, 1569, '2024-01-15 10:02:30', '2024-01-15 10:02:35',
 NULL, NULL, 1,
 'SELECT COUNT(*) FROM dispatch_bracket',
 'SELECT COUNT(*) FROM brackets');
```

### Junction Table Migration with Error Recovery

```sql
-- Initial junction table migration attempt
INSERT INTO migration_control VALUES
(10, 'execution', 'case_file_relationships', 'batch_migration', 'failed',
 2300, 15420, '2024-01-15 10:15:00', '2024-01-15 10:18:30',
 'Foreign key constraint violation on case_id', 200, 2,
 'SELECT * FROM case_files LIMIT 200 OFFSET 2300',
 NULL);

-- Error analysis phase
INSERT INTO migration_control VALUES
(11, 'validation', 'case_file_relationships', 'orphan_detection', 'completed',
 23, 23, '2024-01-15 10:18:30', '2024-01-15 10:18:45',
 NULL, NULL, 2,
 'SELECT cf.* FROM case_files cf LEFT JOIN cases c ON cf.case_id = c.legacy_id WHERE c.id IS NULL',
 NULL);

-- Recovery: Migrate missing parent records
INSERT INTO migration_control VALUES
(12, 'execution', 'cases', 'missing_parent_migration', 'completed',
 23, 23, '2024-01-15 10:20:00', '2024-01-15 10:21:00',
 NULL, 23, 2,
 'SELECT * FROM cases WHERE id IN (1001, 1002, 1003, ...)',
 'SELECT COUNT(*) FROM cases WHERE legacy_id IN (1001, 1002, 1003, ...)');

-- Retry junction table migration
INSERT INTO migration_control VALUES
(13, 'execution', 'case_file_relationships', 'batch_migration_retry', 'completed',
 200, 15420, '2024-01-15 10:21:00', '2024-01-15 10:21:30',
 NULL, 200, 2,
 'SELECT * FROM case_files LIMIT 200 OFFSET 2300',
 'SELECT COUNT(*) FROM case_file_relationships WHERE batch_id = 13');
```

## Monitoring and Reporting Queries

### Overall Migration Progress
```sql
SELECT 
  phase,
  COUNT(*) as operations,
  COUNT(*) FILTER (WHERE status = 'completed') as completed,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  COUNT(*) FILTER (WHERE status = 'running') as in_progress,
  SUM(records_processed) as total_records_processed,
  MIN(started_at) as phase_started,
  MAX(completed_at) as phase_completed
FROM migration_control
GROUP BY phase
ORDER BY 
  CASE phase 
    WHEN 'discovery' THEN 1
    WHEN 'planning' THEN 2 
    WHEN 'mapping' THEN 3
    WHEN 'execution' THEN 4
    WHEN 'validation' THEN 5
    WHEN 'rollback' THEN 6
  END;
```

### Table-Level Migration Status
```sql
SELECT 
  table_name,
  status,
  SUM(records_processed) as records_processed,
  MAX(total_records) as total_records,
  ROUND(
    (SUM(records_processed) * 100.0) / NULLIF(MAX(total_records), 0), 2
  ) as completion_percentage,
  MIN(started_at) as started_at,
  MAX(completed_at) as completed_at,
  MAX(EXTRACT(EPOCH FROM (completed_at - started_at))) as duration_seconds
FROM migration_control
WHERE phase = 'execution'
GROUP BY table_name, status
ORDER BY table_name;
```

### Error Analysis
```sql
SELECT 
  phase,
  table_name,
  operation,
  error_message,
  started_at,
  records_processed,
  total_records,
  worker_id
FROM migration_control
WHERE status = 'failed'
ORDER BY started_at DESC;
```

### Performance Analysis
```sql
SELECT 
  table_name,
  batch_size,
  AVG(records_processed::float / EXTRACT(EPOCH FROM (completed_at - started_at))) as records_per_second,
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_batch_duration,
  COUNT(*) as batch_count
FROM migration_control
WHERE phase = 'execution' 
  AND status = 'completed' 
  AND completed_at IS NOT NULL 
  AND started_at IS NOT NULL
GROUP BY table_name, batch_size
ORDER BY records_per_second DESC;
```

## Integration with Agents

### Agent Status Updates
Agents update migration_control through standardized functions:

```javascript
// Migration Execution Agent updating progress
const updateMigrationProgress = async (migrationId, recordsProcessed) => {
  await db.query(`
    UPDATE migration_control 
    SET records_processed = $1, status = 'running'
    WHERE id = $2
  `, [recordsProcessed, migrationId]);
};

// Orchestrator Agent checking overall progress
const getMigrationStatus = async (phase) => {
  return await db.query(`
    SELECT table_name, status, records_processed, total_records
    FROM migration_control 
    WHERE phase = $1
    ORDER BY started_at
  `, [phase]);
};
```

### Resume Capability
The migration_control table enables resuming interrupted migrations:

```javascript
const findIncompleteOperations = async () => {
  return await db.query(`
    SELECT * FROM migration_control
    WHERE status IN ('running', 'paused')
    ORDER BY started_at
  `);
};

const resumeFromLastCheckpoint = async (tableId) => {
  const lastCompleted = await db.query(`
    SELECT MAX(records_processed) as last_processed
    FROM migration_control
    WHERE table_name = $1 AND status = 'completed'
  `, [tableId]);
  
  // Resume migration from last_processed + 1
  return lastCompleted.rows[0].last_processed || 0;
};
```

---

*The migration_control table provides complete observability and control over the migration process, enabling reliable progress tracking, error recovery, and seamless resume capabilities.*
