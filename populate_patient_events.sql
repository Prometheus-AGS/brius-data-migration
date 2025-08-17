-- Populate patient_events from existing milestone data
-- This creates a comprehensive patient event timeline

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
    'Treatment order created: ' || COALESCE(o.title, 'Order #' || o.legacy_instruction_id::text) as description,
    o.created_at as scheduled_at,
    'completed' as status,
    o.created_at,
    json_build_object(
        'source', 'order_creation',
        'legacy_instruction_id', o.legacy_instruction_id,
        'order_status', o.status
    ) as metadata
FROM orders o
WHERE o.patient_id IS NOT NULL
ON CONFLICT (legacy_event_id) DO NOTHING;

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
AND p.processed_at IS NOT NULL
ON CONFLICT (legacy_event_id) DO NOTHING;

-- 3. Create events from major task completions (treatment milestones)
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
    'Treatment milestone: ' || COALESCE(t.title, 'Task completed') as description,
    t.completed_at as scheduled_at,
    'completed' as status,
    t.created_at,
    json_build_object(
        'source', 'task_completion',
        'task_title', t.title,
        'legacy_task_id', t.legacy_task_id,
        'template_id', t.template_id
    ) as metadata
FROM tasks t
JOIN orders o ON o.id = t.order_id
WHERE t.status = 'completed'
AND t.completed_at IS NOT NULL
AND o.patient_id IS NOT NULL
-- Only include major milestones (not every single task)
AND (
    t.title LIKE '%Approved%' OR
    t.title LIKE '%Delivered%' OR  
    t.title LIKE '%Complete%' OR
    t.title LIKE '%Finished%' OR
    t.title LIKE '%Shipped%' OR
    EXTRACT(day FROM (t.completed_at - t.created_at)) > 1  -- Tasks that took more than 1 day
)
LIMIT 50000  -- Limit to avoid overwhelming the events table
ON CONFLICT (legacy_event_id) DO NOTHING;

-- 4. Create events from shipments (delivery events)
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
    CASE 
        WHEN s.delivered_at IS NOT NULL THEN 'completed'
        ELSE 'completed'  -- All shipments in our data are already shipped
    END as status,
    s.created_at,
    json_build_object(
        'source', 'shipment',
        'carrier', s.carrier,
        'tracking_number', s.tracking_number,
        'shipped_at', s.shipped_at,
        'delivered_at', s.delivered_at
    ) as metadata
FROM shipments s
JOIN orders o ON o.id = s.order_id
WHERE o.patient_id IS NOT NULL
ON CONFLICT (legacy_event_id) DO NOTHING;

-- 5. Create events from treatment discussions (consultation events)
\echo 'Creating treatment discussion events...'
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
    td.order_id,
    'consultation' as event_type,
    'Treatment consultation: ' || LEFT(td.comment_text, 100) || 
    CASE WHEN LENGTH(td.comment_text) > 100 THEN '...' ELSE '' END as description,
    td.created_at as scheduled_at,
    'completed' as status,
    td.created_at,
    json_build_object(
        'source', 'treatment_discussion',
        'comment_preview', LEFT(td.comment_text, 200),
        'legacy_comment_id', td.legacy_comment_id
    ) as metadata
FROM treatment_discussions td
JOIN orders o ON o.id = td.order_id  
WHERE o.patient_id IS NOT NULL
-- Only include substantial discussions
AND LENGTH(td.comment_text) > 50
LIMIT 10000  -- Reasonable subset
ON CONFLICT (legacy_event_id) DO NOTHING;

-- Show results
\echo 'Patient events population summary:'
SELECT 
    event_type,
    COUNT(*) as event_count,
    COUNT(DISTINCT patient_id) as unique_patients,
    MIN(scheduled_at) as earliest_event,
    MAX(scheduled_at) as latest_event
FROM patient_events
GROUP BY event_type
ORDER BY event_count DESC;

-- Overall summary
SELECT 
    COUNT(*) as total_patient_events,
    COUNT(DISTINCT patient_id) as patients_with_events,
    COUNT(DISTINCT order_id) as orders_with_events,
    MIN(scheduled_at) as earliest_event_date,
    MAX(scheduled_at) as latest_event_date
FROM patient_events;

COMMIT;

-- Log the patient events population
INSERT INTO migration_control (
    phase, table_name, operation, status,
    total_records, records_processed, started_at, completed_at
) VALUES (
    'phase_7_patient_events',
    'patient_events',
    'generated_from_milestones',
    'completed',
    (SELECT COUNT(*) FROM patient_events),
    (SELECT COUNT(*) FROM patient_events),
    now(),
    now()
) ON CONFLICT DO NOTHING;

\echo 'Patient events population completed successfully!'
