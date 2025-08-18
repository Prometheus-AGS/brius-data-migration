# Migration Mappings Schema

The `migration_mappings` table maintains the critical relationship between source system legacy IDs and target system UUIDs, enabling complete data traceability and supporting complex transformation scenarios.

## Table Schema

```sql
CREATE TABLE migration_mappings (
  entity_type VARCHAR NOT NULL,
  legacy_id INTEGER,
  new_id UUID,
  migrated_at TIMESTAMP NOT NULL,
  migration_batch VARCHAR NOT NULL,
  
  -- Composite primary key ensures uniqueness per entity type and legacy ID
  PRIMARY KEY (entity_type, legacy_id),
  
  -- Unique constraint on new_id to prevent duplicate UUID mappings
  UNIQUE(new_id),
  
  -- Indexes for efficient lookups during migration
  INDEX idx_migration_mappings_entity_legacy (entity_type, legacy_id),
  INDEX idx_migration_mappings_new_id (new_id),
  INDEX idx_migration_mappings_batch (migration_batch)
);

-- Additional indexes for common query patterns
CREATE INDEX idx_migration_mappings_migrated_at ON migration_mappings(migrated_at);
CREATE INDEX idx_migration_mappings_entity_type ON migration_mappings(entity_type);
```

## Field Definitions

### Core Mapping Fields
- **`entity_type`**: Type of entity being mapped (e.g., `cases`, `files`, `brackets`, `orders`)
- **`legacy_id`**: Original INTEGER primary key from source system
- **`new_id`**: Generated UUID primary key in target system
- **`migrated_at`**: Timestamp when this mapping was created
- **`migration_batch`**: Batch identifier for grouping related migrations

## Usage Patterns

### 1. Creating New Mappings During Migration

```sql
-- Creating mappings during brackets migration
INSERT INTO migration_mappings (entity_type, legacy_id, new_id, migrated_at, migration_batch)
VALUES 
  ('brackets', 1, gen_random_uuid(), NOW(), 'brackets_batch_1'),
  ('brackets', 2, gen_random_uuid(), NOW(), 'brackets_batch_1'),
  ('brackets', 3, gen_random_uuid(), NOW(), 'brackets_batch_1');

-- Bulk mapping creation with specific UUIDs
INSERT INTO migration_mappings (entity_type, legacy_id, new_id, migrated_at, migration_batch)
SELECT 
  'cases' as entity_type,
  c.id as legacy_id,
  gen_random_uuid() as new_id,
  NOW() as migrated_at,
  'cases_batch_' || CEIL(ROW_NUMBER() OVER (ORDER BY c.id) / 100.0) as migration_batch
FROM cases c;
```

### 2. Looking Up Mappings During Junction Table Migration

```sql
-- Finding UUID mappings for junction table relationships
SELECT 
  cm.new_id as case_uuid,
  fm.new_id as file_uuid
FROM case_files cf
JOIN migration_mappings cm ON (cm.entity_type = 'cases' AND cm.legacy_id = cf.case_id)  
JOIN migration_mappings fm ON (fm.entity_type = 'files' AND fm.legacy_id = cf.file_id)
WHERE cf.id BETWEEN 1001 AND 1200; -- Specific batch range
```

### 3. Verification and Validation Queries

```sql
-- Verify all legacy IDs have mappings
SELECT 
  s.entity_type,
  s.legacy_count,
  COALESCE(m.mapped_count, 0) as mapped_count,
  s.legacy_count - COALESCE(m.mapped_count, 0) as missing_mappings
FROM (
  SELECT 'cases' as entity_type, COUNT(*) as legacy_count FROM cases
  UNION ALL
  SELECT 'files' as entity_type, COUNT(*) as legacy_count FROM files  
  UNION ALL
  SELECT 'brackets' as entity_type, COUNT(*) as legacy_count FROM dispatch_bracket
) s
LEFT JOIN (
  SELECT entity_type, COUNT(*) as mapped_count
  FROM migration_mappings 
  GROUP BY entity_type
) m ON s.entity_type = m.entity_type;
```

## Real-World Examples

### Brackets Migration Mappings

```sql
-- Sample mappings created during brackets migration (1,569 records)
INSERT INTO migration_mappings VALUES
('brackets', 1, '550e8400-e29b-41d4-a716-446655440001', '2024-01-15 10:00:30', 'brackets_batch_1'),
('brackets', 2, '550e8400-e29b-41d4-a716-446655440002', '2024-01-15 10:00:30', 'brackets_batch_1'),
('brackets', 3, '550e8400-e29b-41d4-a716-446655440003', '2024-01-15 10:00:30', 'brackets_batch_1'),
-- ... continuing for all 1,569 bracket records

-- Query to verify brackets mapping completeness
SELECT 
  COUNT(*) as source_brackets,
  (SELECT COUNT(*) FROM migration_mappings WHERE entity_type = 'brackets') as mapped_brackets
FROM dispatch_bracket;
-- Expected result: source_brackets = 1569, mapped_brackets = 1569
```

### Junction Table Foreign Key Resolution

```sql
-- Before: Legacy junction table with INTEGER foreign keys
SELECT case_id, file_id FROM case_files WHERE id = 1001;
-- Result: case_id = 5001, file_id = 3001

-- Resolve to UUIDs using migration_mappings
SELECT 
  cf.id as original_id,
  cm.new_id as case_uuid,
  fm.new_id as file_uuid
FROM case_files cf
JOIN migration_mappings cm ON (cm.entity_type = 'cases' AND cm.legacy_id = cf.case_id)
JOIN migration_mappings fm ON (fm.entity_type = 'files' AND fm.legacy_id = cf.file_id)
WHERE cf.id = 1001;

-- Result: 
-- original_id: 1001
-- case_uuid: 550e8400-e29b-41d4-a716-446655440123
-- file_uuid: 550e8400-e29b-41d4-a716-446655440456
```

### Complex Multi-Level Relationship Resolution

```sql
-- Orders referencing cases, customers, and brackets
-- Source: orders table with legacy IDs
SELECT id, case_id, customer_id, bracket_id FROM orders WHERE id = 2001;

-- Target: Resolve all foreign key references to UUIDs
SELECT 
  o.id as legacy_order_id,
  cm.new_id as case_uuid,
  custm.new_id as customer_uuid, 
  bm.new_id as bracket_uuid
FROM orders o
LEFT JOIN migration_mappings cm ON (cm.entity_type = 'cases' AND cm.legacy_id = o.case_id)
LEFT JOIN migration_mappings custm ON (custm.entity_type = 'customers' AND custm.legacy_id = o.customer_id)  
LEFT JOIN migration_mappings bm ON (bm.entity_type = 'brackets' AND bm.legacy_id = o.bracket_id)
WHERE o.id = 2001;
```

## Batch Tracking and Management

### Batch-Based Processing
```sql
-- Track migration progress by batch
SELECT 
  migration_batch,
  entity_type,
  COUNT(*) as records_in_batch,
  MIN(migrated_at) as batch_started,
  MAX(migrated_at) as batch_completed
FROM migration_mappings
WHERE entity_type = 'brackets'
GROUP BY migration_batch, entity_type
ORDER BY batch_started;

-- Results show bracket migration batches:
-- brackets_batch_1: 500 records (10:00:30 - 10:00:45)
-- brackets_batch_2: 500 records (10:00:45 - 10:01:00)  
-- brackets_batch_3: 500 records (10:01:00 - 10:01:15)
-- brackets_batch_4: 69 records (10:01:15 - 10:01:20)
```

### Rollback Support
```sql
-- Remove mappings for failed batch (enables clean rollback)
DELETE FROM migration_mappings 
WHERE migration_batch = 'cases_batch_15' AND entity_type = 'cases';

-- Verify batch removal
SELECT COUNT(*) FROM migration_mappings 
WHERE migration_batch = 'cases_batch_15';
-- Should return 0
```

## Performance Optimization

### Efficient ID Resolution Functions
```sql
-- PostgreSQL function for fast UUID lookup
CREATE OR REPLACE FUNCTION get_uuid_for_legacy_id(
  p_entity_type VARCHAR, 
  p_legacy_id INTEGER
) RETURNS UUID AS $$
DECLARE
  result_uuid UUID;
BEGIN
  SELECT new_id INTO result_uuid
  FROM migration_mappings 
  WHERE entity_type = p_entity_type AND legacy_id = p_legacy_id;
  
  RETURN result_uuid;
END;
$$ LANGUAGE plpgsql;

-- Usage in migration queries
SELECT 
  cf.id,
  get_uuid_for_legacy_id('cases', cf.case_id) as case_uuid,
  get_uuid_for_legacy_id('files', cf.file_id) as file_uuid
FROM case_files cf
LIMIT 1000;
```

### Batch UUID Resolution
```sql
-- Efficient batch resolution for large datasets
WITH resolved_ids AS (
  SELECT 
    cf.id as junction_id,
    cf.case_id as legacy_case_id,
    cf.file_id as legacy_file_id,
    cm.new_id as case_uuid,
    fm.new_id as file_uuid
  FROM case_files cf
  JOIN migration_mappings cm ON (cm.entity_type = 'cases' AND cm.legacy_id = cf.case_id)
  JOIN migration_mappings fm ON (fm.entity_type = 'files' AND fm.legacy_id = cf.file_id)
  WHERE cf.id BETWEEN ? AND ? -- Batch range parameters
)
INSERT INTO case_file_relationships (case_id, file_id, created_at, migrated_from_legacy_id)
SELECT case_uuid, file_uuid, NOW(), junction_id
FROM resolved_ids;
```

## Data Integrity and Validation

### Mapping Completeness Validation
```sql
-- Comprehensive validation query
WITH validation_summary AS (
  SELECT 
    entity_type,
    COUNT(*) as mapping_count,
    COUNT(DISTINCT legacy_id) as unique_legacy_ids,
    COUNT(DISTINCT new_id) as unique_new_ids,
    MIN(migrated_at) as first_migration,
    MAX(migrated_at) as last_migration
  FROM migration_mappings
  GROUP BY entity_type
)
SELECT 
  vs.*,
  CASE 
    WHEN vs.mapping_count = vs.unique_legacy_ids 
     AND vs.mapping_count = vs.unique_new_ids 
    THEN 'VALID'
    ELSE 'INVALID - Duplicate mappings detected'
  END as validation_status
FROM validation_summary vs
ORDER BY vs.entity_type;
```

### Orphan Detection
```sql
-- Find junction table records that can't be resolved
SELECT 
  'case_files' as table_name,
  cf.id as orphaned_record_id,
  cf.case_id as missing_case_id,
  cf.file_id as missing_file_id,
  CASE WHEN cm.new_id IS NULL THEN 'missing_case' ELSE '' END ||
  CASE WHEN fm.new_id IS NULL THEN 'missing_file' ELSE '' END as missing_mappings
FROM case_files cf
LEFT JOIN migration_mappings cm ON (cm.entity_type = 'cases' AND cm.legacy_id = cf.case_id)  
LEFT JOIN migration_mappings fm ON (fm.entity_type = 'files' AND fm.legacy_id = cf.file_id)
WHERE cm.new_id IS NULL OR fm.new_id IS NULL;
```

## Integration with Migration Agents

### Data Mapping Agent Usage
```javascript
// Data Mapping Agent creating new mappings
const createEntityMapping = async (entityType, legacyId, batchId) => {
  const newUuid = uuidv4();
  
  await db.query(`
    INSERT INTO migration_mappings (entity_type, legacy_id, new_id, migrated_at, migration_batch)
    VALUES ($1, $2, $3, NOW(), $4)
    ON CONFLICT (entity_type, legacy_id) DO NOTHING
  `, [entityType, legacyId, newUuid, batchId]);
  
  return newUuid;
};

// Migration Execution Agent resolving foreign keys
const resolveForeignKeys = async (junctionRecord) => {
  const caseUuid = await db.query(`
    SELECT new_id FROM migration_mappings 
    WHERE entity_type = 'cases' AND legacy_id = $1
  `, [junctionRecord.case_id]);
  
  const fileUuid = await db.query(`
    SELECT new_id FROM migration_mappings
    WHERE entity_type = 'files' AND legacy_id = $1  
  `, [junctionRecord.file_id]);
  
  return {
    case_id: caseUuid.rows[0]?.new_id,
    file_id: fileUuid.rows[0]?.new_id
  };
};
```

### Validation Agent Verification
```javascript
// Validation Agent checking mapping completeness
const validateMappingCompleteness = async (entityType, expectedCount) => {
  const mappingCount = await db.query(`
    SELECT COUNT(*) as count FROM migration_mappings 
    WHERE entity_type = $1
  `, [entityType]);
  
  return {
    entityType,
    expectedCount, 
    actualMappings: mappingCount.rows[0].count,
    complete: mappingCount.rows[0].count === expectedCount
  };
};
```

---

*The migration_mappings table is essential for maintaining data integrity during ID transformation migrations, providing the bridge between legacy INTEGER keys and modern UUID identifiers while supporting complex relationship resolution.*
