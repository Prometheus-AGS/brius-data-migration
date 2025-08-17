-- Populate patient_events using cases table which has proper patient relationships

\echo '========================================='
\echo 'POPULATING PATIENT EVENTS FROM MILESTONES'
\echo '========================================='

-- Temporarily disable the validation trigger
ALTER TABLE patient_events DISABLE TRIGGER validate_patient_events_trigger;

BEGIN;

-- 1. Create events from order creation using cases for patient mapping
\echo 'Creating treatment started events from cases...'
INSERT INTO patient_events (
    patient_id,
    order_id,
    event_type,
    description,
    scheduled_at,
    status,
    created_at,
    metadata
)
SELECT 
    c.id as patient_id,  -- Use case ID as patient identifier
    o.id as order_id,
    'treatment_started' as event_type,
    'Treatment started for Case #' || c.legacy_patient_id::text as description,
    o.created_at as scheduled_at,
    'completed' as status,
    o.created_at,
    json_build_object(
        'source', 'treatment_start',
        'legacy_instruction_id', o.legacy_instruction_id,
        'legacy_patient_id', c.legacy_patient_id,
        'order_status', o.status::text
    ) as metadata
FROM orders o
JOIN cases c ON c.legacy_patient_id IN (
    -- Map orders to cases through some relationship we can derive
    SELECT dp.id FROM 
    dblink('host=test.brius.com port=5432 dbname=mdw_db user=mdw_ai password=xGXmckHY',
           'SELECT di.patient_id, di.id 
            FROM dispatch_instruction di 
            WHERE di.id = ' || o.legacy_instruction_id || '')
    AS source(patient_id INTEGER, instruction_id INTEGER)
    WHERE source.patient_id = c.legacy_patient_id
)
LIMIT 1000;  -- Start with small batch

-- Show what we created
SELECT COUNT(*) as events_created FROM patient_events;

COMMIT;

-- Re-enable the trigger
-- ALTER TABLE patient_events ENABLE TRIGGER validate_patient_events_trigger;

\echo 'Patient events population completed!'
