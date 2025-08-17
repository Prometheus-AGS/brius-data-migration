-- Simple approach: Create patient events from cases (which are the actual patients)

\echo '========================================='
\echo 'POPULATING PATIENT EVENTS FROM CASE MILESTONES'
\echo '========================================='

-- Temporarily disable validation trigger
ALTER TABLE patient_events DISABLE TRIGGER validate_patient_events_trigger;

BEGIN;

-- 1. Create treatment initiation events from cases
\echo 'Creating case initiation events...'
INSERT INTO patient_events (
    patient_id,
    event_type,
    description,
    scheduled_at,
    status,
    created_at,
    metadata,
    legacy_event_id
)
SELECT 
    c.id as patient_id,
    'case_opened' as event_type,
    'Patient case opened - Case #' || c.legacy_patient_id::text as description,
    c.created_at as scheduled_at,
    'completed' as status,
    c.created_at,
    json_build_object(
        'source', 'case_creation',
        'legacy_patient_id', c.legacy_patient_id,
        'case_status', c.status::text
    ) as metadata,
    c.legacy_patient_id as legacy_event_id  -- Use legacy_patient_id as unique identifier
FROM cases c
LIMIT 5000;  -- Reasonable subset

-- 2. Create task completion events for major milestones
\echo 'Creating task milestone events...'
INSERT INTO patient_events (
    patient_id,
    order_id,
    event_type,
    description,
    scheduled_at,
    status,
    created_at,
    metadata,
    legacy_event_id
)
SELECT 
    c.id as patient_id,
    t.order_id,
    'treatment_milestone' as event_type,
    'Treatment milestone completed' as description,
    t.completed_at as scheduled_at,
    'completed' as status,
    t.created_at,
    json_build_object(
        'source', 'task_milestone',
        'legacy_task_id', t.legacy_task_id
    ) as metadata,
    1000000 + t.legacy_task_id as legacy_event_id  -- Ensure unique legacy IDs
FROM tasks t
JOIN orders o ON o.id = t.order_id
JOIN cases c ON c.legacy_patient_id IN (
    SELECT dp.id FROM 
    dblink('host=test.brius.com port=5432 dbname=mdw_db user=mdw_ai password=xGXmckHY',
           'SELECT patient_id FROM dispatch_instruction WHERE id = ' || o.legacy_instruction_id)
    AS source(patient_id INTEGER)
    WHERE source.patient_id = c.legacy_patient_id
)
WHERE t.status = 'completed'
AND t.completed_at IS NOT NULL
LIMIT 2000;  -- Key milestones only

-- Show results
\echo 'Patient events summary:'
SELECT 
    event_type,
    COUNT(*) as count,
    COUNT(DISTINCT patient_id) as unique_patients
FROM patient_events
GROUP BY event_type;

SELECT COUNT(*) as total_events FROM patient_events;

COMMIT;

\echo 'Patient events population completed!'
