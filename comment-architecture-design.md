# Comment Architecture Design Analysis

## Key Findings

### Data Overview
- **dispatch_comment**: 15,074 records linked to treatment plans
  - 13,337 unique treatment plans commented on
  - 362 unique authors
  - Date range: 2018-03-22 to 2025-06-20
  - Clear threading patterns (multiple comments per plan per day)

- **dispatch_note**: 963 records linked to doctors
  - 21 unique authors
  - Date range: 2021-05-04 to 2025-06-11
  - Different purpose: doctor-specific notes/communications

- **Other text fields**: Found in dispatch_notification, dispatch_record, dispatch_task

## Architecture Decision

Based on the analysis, **NORMALIZED COMMENT ARCHITECTURE** is recommended:

### 1. Root Comments Table
```sql
CREATE TABLE comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    comment_type comment_type_enum NOT NULL,
    author_id UUID REFERENCES profiles(id),
    parent_comment_id UUID REFERENCES comments(id), -- For threading
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    legacy_id INTEGER, -- For migration mapping
    legacy_table VARCHAR(50) -- Source table name
);

CREATE TYPE comment_type_enum AS ENUM (
    'treatment_discussion',
    'doctor_note', 
    'task_note',
    'notification_context',
    'record_annotation'
);
```

### 2. Specialized Relationship Tables

#### Treatment Discussions
```sql
CREATE TABLE treatment_discussions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
    treatment_plan_id UUID REFERENCES treatment_plans(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Doctor Notes
```sql
CREATE TABLE doctor_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
    doctor_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3. Migration Strategy

#### Phase 1: Create Tables and Enums
- Create comment_type_enum
- Create comments table
- Create relationship tables (treatment_discussions, doctor_notes)

#### Phase 2: Migrate dispatch_comment
- Map plan_id to treatment_plan_id via projects lookup
- Set comment_type = 'treatment_discussion'
- Create corresponding treatment_discussions records

#### Phase 3: Migrate dispatch_note
- Map doctor_id to profile UUID
- Set comment_type = 'doctor_note'
- Create corresponding doctor_notes records

#### Phase 4: Validation and Cleanup
- Verify all relationships
- Add indexes for performance
- Test threading queries

## Benefits of This Architecture

1. **Extensible**: Easy to add new comment types
2. **Unified**: Single place for all comment content
3. **Relational**: Proper foreign keys and relationships
4. **Threading**: Built-in support via parent_comment_id
5. **Auditable**: Legacy mapping preserved
6. **Performant**: Specialized relationship tables for efficient queries

## Threading Support
The parent_comment_id field enables:
- Reply threads
- Comment hierarchies  
- Conversation flows
- Discussion organization

## Query Examples

### Get all treatment plan discussions
```sql
SELECT c.*, td.treatment_plan_id, p.name as author_name
FROM comments c
JOIN treatment_discussions td ON c.id = td.comment_id
JOIN profiles p ON c.author_id = p.id
WHERE td.treatment_plan_id = $1
ORDER BY c.created_at;
```

### Get comment threads
```sql
WITH RECURSIVE comment_thread AS (
    SELECT c.*, 0 as level
    FROM comments c
    WHERE c.parent_comment_id IS NULL
    AND c.id IN (SELECT comment_id FROM treatment_discussions WHERE treatment_plan_id = $1)
    
    UNION ALL
    
    SELECT c.*, ct.level + 1
    FROM comments c
    JOIN comment_thread ct ON c.parent_comment_id = ct.id
)
SELECT * FROM comment_thread ORDER BY level, created_at;
```

This architecture provides a robust foundation for all comment types while maintaining clean separation of concerns and excellent query performance.
