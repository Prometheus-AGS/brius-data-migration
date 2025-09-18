-- =====================================================
-- COMMUNICATION VIEWS DESIGN - SEM SCHEMA
-- Based on analysis of existing migrated data
-- All views in sem schema with v_ prefix
-- =====================================================

-- Ensure sem schema exists
CREATE SCHEMA IF NOT EXISTS sem;

-- =====================================================
-- 1. CLINICAL COMMUNICATIONS VIEW
-- Aggregates all clinical-related communications
-- =====================================================

CREATE OR REPLACE VIEW sem.v_clinical_communications AS
SELECT 
    -- Unified fields across all clinical communication sources
    id,
    'case_message' as source_table,
    message_type as communication_type,
    subject,
    content as body,
    sender_id as author_id,
    recipient_id,
    case_id,
    NULL::uuid as patient_id, -- Will join through case
    NULL::uuid as order_id,
    is_urgent,
    requires_response,
    is_confidential as is_private,
    priority,
    read_at,
    responded_at,
    sent_at as created_at,
    sent_at as updated_at,
    legacy_record_id,
    metadata,
    related_tooth_numbers,
    treatment_phase,
    parent_message_id,
    thread_root_id
FROM public.case_messages
WHERE message_type IN ('clinical_note', 'patient_question', 'doctor_response', 'treatment_update')
   AND deleted = false

UNION ALL

SELECT 
    id,
    'comment' as source_table,
    comment_type as communication_type,
    CASE 
        WHEN LENGTH(content) > 100 THEN LEFT(content, 100) || '...'
        ELSE content
    END as subject,
    content as body,
    author_id,
    NULL::uuid as recipient_id,
    NULL::uuid as case_id, -- Comments don't have direct case relationship
    NULL::uuid as patient_id,
    NULL::uuid as order_id,
    false as is_urgent,
    false as requires_response,
    false as is_private,
    1 as priority,
    NULL::timestamp with time zone as read_at,
    NULL::timestamp with time zone as responded_at,
    created_at,
    updated_at,
    legacy_id as legacy_record_id,
    NULL::jsonb as metadata,
    NULL::jsonb as related_tooth_numbers,
    NULL::text as treatment_phase,
    parent_comment_id as parent_message_id,
    NULL::uuid as thread_root_id
FROM public.comments
WHERE comment_type IN ('doctor_note', 'treatment_discussion')

UNION ALL

SELECT 
    id,
    'message' as source_table,
    message_type as communication_type,
    title as subject,
    content as body,
    sender_id as author_id,
    recipient_id,
    NULL::uuid as case_id,
    NULL::uuid as patient_id,
    NULL::uuid as order_id,
    false as is_urgent,
    false as requires_response,
    private as is_private,
    1 as priority,
    NULL::timestamp with time zone as read_at,
    NULL::timestamp with time zone as updated_at,
    created_at,
    updated_at,
    legacy_record_id,
    metadata,
    NULL::jsonb as related_tooth_numbers,
    NULL::text as treatment_phase,
    NULL::uuid as parent_message_id,
    NULL::uuid as thread_root_id
FROM public.messages
WHERE message_type = 'clinical_note'
   AND recipient_type = 'patient';

-- =====================================================
-- 2. OPERATIONAL COMMUNICATIONS VIEW  
-- Aggregates all operations/workflow related communications
-- =====================================================

CREATE OR REPLACE VIEW sem.v_operational_communications AS
SELECT 
    id,
    'team_communication' as source_table,
    communication_type,
    subject,
    body,
    author_id,
    NULL::uuid as recipient_id,
    team_id,
    department,
    order_id,
    project_id,
    task_id,
    triggers_workflow,
    workflow_action,
    approval_required,
    approved_by,
    approved_at,
    is_broadcast,
    visibility,
    created_at,
    created_at as updated_at,
    legacy_record_id,
    NULL::jsonb as metadata
FROM public.team_communications

UNION ALL

SELECT 
    id,
    'message' as source_table,
    message_type as communication_type,
    title as subject,
    content as body,
    sender_id as author_id,
    recipient_id,
    NULL::uuid as team_id,
    'System' as department,
    NULL::uuid as order_id,
    NULL::uuid as project_id,
    NULL::uuid as task_id,
    false as triggers_workflow,
    NULL::character varying as workflow_action,
    false as approval_required,
    NULL::uuid as approved_by,
    NULL::timestamp with time zone as approved_at,
    false as is_broadcast,
    recipient_type as visibility,
    created_at,
    updated_at,
    legacy_record_id,
    metadata
FROM public.messages
WHERE message_type IN ('status_update', 'notification')
   AND recipient_type IN ('user', 'system');

-- =====================================================
-- 3. SALES/SUPPORT COMMUNICATIONS VIEW
-- Aggregates all customer-facing sales and support communications
-- =====================================================

CREATE OR REPLACE VIEW sem.v_sales_communications AS
SELECT 
    id,
    'message' as source_table,
    message_type as communication_type,
    'Customer Service' as category,
    title as subject,
    content as body,
    sender_id as author_id,
    recipient_id,
    recipient_type,
    is_read,
    private as is_private,
    created_at,
    updated_at,
    legacy_record_id,
    metadata,
    -- Sales specific fields
    CASE 
        WHEN message_type = 'support' THEN 'support'
        WHEN message_type = 'billing' THEN 'billing'  
        ELSE 'general'
    END as inquiry_type,
    false as is_resolved, -- Would need to be determined by business logic
    NULL::timestamp with time zone as resolved_at,
    NULL::uuid as assigned_to
FROM public.messages
WHERE message_type IN ('support', 'sales', 'billing', 'inquiry')

UNION ALL

-- Future: Could include other sales-related communications from other tables
-- This is where CRM integration would go
SELECT 
    id,
    'case_message' as source_table,
    'customer_inquiry' as communication_type,
    'Patient Communication' as category,
    subject,
    content as body,
    sender_id as author_id,
    recipient_id,
    'patient' as recipient_type,
    CASE WHEN read_at IS NOT NULL THEN true ELSE false END as is_read,
    is_confidential as is_private,
    sent_at as created_at,
    sent_at as updated_at,
    legacy_record_id,
    metadata,
    'patient_inquiry' as inquiry_type,
    CASE WHEN responded_at IS NOT NULL THEN true ELSE false END as is_resolved,
    responded_at as resolved_at,
    recipient_id as assigned_to
FROM public.case_messages
WHERE message_type = 'patient_question'
   AND deleted = false;

-- =====================================================
-- 4. UNIFIED COMMUNICATIONS VIEW (Enhanced version of existing v_all_communications)
-- Provides a single view across all communication types
-- =====================================================

CREATE OR REPLACE VIEW sem.v_all_communications AS
SELECT 
    id,
    'clinical' as category,
    communication_type,
    subject,
    body,
    author_id,
    case_id,
    patient_id,
    order_id,
    created_at,
    updated_at,
    source_table,
    is_urgent,
    requires_response,
    legacy_record_id
FROM sem.v_clinical_communications

UNION ALL

SELECT 
    id,
    'operational' as category,
    communication_type,
    subject,
    body,
    author_id,
    NULL::uuid as case_id,
    NULL::uuid as patient_id,
    order_id,
    created_at,
    updated_at,
    source_table,
    false as is_urgent,
    approval_required as requires_response,
    legacy_record_id
FROM sem.v_operational_communications

UNION ALL

SELECT 
    id,
    'sales' as category,
    communication_type,
    subject,
    body,
    author_id,
    NULL::uuid as case_id,
    NULL::uuid as patient_id,
    NULL::uuid as order_id,
    created_at,
    updated_at,
    source_table,
    false as is_urgent,
    NOT is_resolved as requires_response,
    legacy_record_id
FROM sem.v_sales_communications;

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- Create indexes on commonly queried columns in base tables
-- =====================================================

-- Indexes for case_messages (if they don't already exist)
CREATE INDEX IF NOT EXISTS idx_case_messages_case_id_type ON public.case_messages(case_id, message_type, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_messages_sender_type ON public.case_messages(sender_id, message_type, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_messages_urgent ON public.case_messages(is_urgent, sent_at DESC) WHERE is_urgent = true;

-- Indexes for comments (if they don't already exist)  
CREATE INDEX IF NOT EXISTS idx_comments_type_date ON public.comments(comment_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_author_type ON public.comments(author_id, comment_type, created_at DESC);

-- Indexes for messages (if they don't already exist)
CREATE INDEX IF NOT EXISTS idx_messages_type_recipient ON public.messages(message_type, recipient_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender_type ON public.messages(sender_id, message_type, created_at DESC);

-- Indexes for team_communications (if they don't already exist)
CREATE INDEX IF NOT EXISTS idx_team_comm_type_dept ON public.team_communications(communication_type, department, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_team_comm_approval ON public.team_communications(approval_required, created_at DESC) WHERE approval_required = true;

-- =====================================================
-- COMMENTS AND DOCUMENTATION
-- =====================================================

COMMENT ON SCHEMA sem IS 'Semantic layer schema containing business logic views and aggregations';

COMMENT ON VIEW sem.v_clinical_communications IS 'Unified view of all clinical communications from case_messages, comments, and messages tables. Includes patient questions, clinical notes, doctor responses, and treatment updates.';

COMMENT ON VIEW sem.v_operational_communications IS 'Unified view of all operational/workflow communications from team_communications and messages tables. Includes production notes, status updates, and notifications.';  

COMMENT ON VIEW sem.v_sales_communications IS 'Unified view of all sales and support communications from messages and case_messages tables. Includes support requests, patient inquiries, and customer service interactions.';

COMMENT ON VIEW sem.v_all_communications IS 'Master view combining all communication categories (clinical, operational, sales) with standardized schema for unified querying across all communication types.';

-- =====================================================
-- GRANT PERMISSIONS (adjust as needed for your environment)
-- =====================================================

-- Grant usage on schema
-- GRANT USAGE ON SCHEMA sem TO your_app_role;

-- Grant select on views
-- GRANT SELECT ON ALL TABLES IN SCHEMA sem TO your_app_role;

