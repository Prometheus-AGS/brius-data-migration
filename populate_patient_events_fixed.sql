-- Populate patient_events from existing milestone data (FIXED VERSION)

\echo '========================================='
\echo 'POPULATING PATIENT EVENTS FROM MILESTONES'
\echo '========================================='

BEGIN;

-- 1. Create events from order creation (treatment started)
\echo 'Creating order creation events...'
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
    o.patient_id,
    o.id as order_id,
    'treatment_started' as event_type,
    'Treatment order created - Order #' || o.legacy_instruction_id::text as description,
    o.created_at as scheduled_at,
    'completed' as status,
    o.created_at,
    json_build_object(
        'source', 'order_creation',
        'legacy_instruction_id', o.legacy_instruction_id,
        'order_status', o.status::text
    ) as metadata
FROM orders o
WHERE o.patient_id IS NOT NULL
LIMIT 20000;  -- Reasonable limit

-- 2. Create events from completed payments (payment milestones)
\echo 'Creating payment completion events...'
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
    p.patient_id,
    p.order_id,
    'payment_completed' as event_type,
    'Payment completed: $' || p.amount::text as description,
    p.processed_at as scheduled_at,
    'completed' as status,
    p.created_at,
    json_build_object(
        'source', 'payment_completion',
        'amount', p.amount,
        'payment_method', p.payment_method,
        'legacy_payment_id', p.legacy_payment_id
    ) as metadata
FROM payments p
WHERE p.status = 'completed' 
AND p.patient_id IS NOT NULL
AND p.processed_at IS NOT NULL;

-- 3. Create events from shipments (delivery events) 
\echo 'Creating shipment events...'
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
    o.patient_id,
    s.order_id,
    'treatment_shipped' as event_type,
    'Treatment shipped via ' || s.carrier || ' - Tracking: ' || s.tracking_number as description,
    s.shipped_at as scheduled_at,
    'completed' as status,
    s.created_at,
    json_build_object(
        'source', 'shipment',
        'carrier', s.carrier,
        'tracking_number', s.tracking_number,
        'shipped_at', s.shipped_at
    ) as metadata
FROM shipments s
JOIN orders o ON o.id = s.order_id
WHERE o.patient_id IS NOT NULL;

-- 4. Create events from major task completions (only key milestones)
\echo 'Creating major task completion events...'
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
    o.patient_id,
    t.order_id,
    'treatment_milestone' as event_type,
    'Treatment milestone completed' as description,
    t.completed_at as scheduled_at,
    'completed' as status,
    t.created_at,
    json_build_object(
        'source', 'task_completion',
        'legacy_task_id', t.legacy_task_id
    ) as metadata
FROM tasks t
JOIN orders o ON o.id = t.order_id
WHERE t.status = 'completed'
AND t.completed_at IS NOT NULL
AND o.patient_id IS NOT NULL
-- Only major milestones - tasks that took significant time
AND EXTRACT(day FROM (t.completed_at - t.created_at)) >= 1
LIMIT 15000;  -- Reasonable subset of major milestones

-- Show results
\echo 'Patient events population summary:'
SELECT 
    event_type,
    COUNT(*) as event_count,
    COUNT(DISTINCT patient_id) as unique_patients
FROM patient_events
GROUP BY event_type
ORDER BY event_count DESC;

-- Overall summary
SELECT 
    COUNT(*) as total_patient_events,
    COUNT(DISTINCT patient_id) as patients_with_events,
    COUNT(DISTINCT order_id) as orders_with_events
FROM patient_events;

COMMIT;

\echo 'Patient events population completed successfully!'
