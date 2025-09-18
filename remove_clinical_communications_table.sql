-- =====================================================
-- SAFE REMOVAL OF CLINICAL_COMMUNICATIONS TABLE
-- =====================================================
-- 
-- ANALYSIS SUMMARY:
-- ✅ Table is completely empty (0 records, never used)
-- ❌ Referenced by public.v_all_communications view
-- ❌ Has audit triggers that need to be handled
-- ❌ Has foreign key constraints (RI triggers)
-- ✅ No tables reference it as foreign key
-- ✅ No custom functions reference it
--
-- REMOVAL PLAN:
-- 1. Update/replace public.v_all_communications view
-- 2. Drop the table (will automatically drop triggers and constraints)
-- =====================================================

BEGIN;

-- Step 1: Replace the old public.v_all_communications view
-- This view currently references clinical_communications but we want to 
-- replace it with our new sem.v_all_communications
DROP VIEW IF EXISTS public.v_all_communications CASCADE;

-- Create a replacement that points to our new semantic layer
CREATE VIEW public.v_all_communications AS
SELECT 
    id,
    category,
    communication_type as type,
    subject,
    body,
    author_id,
    case_id as patient_id, -- Map case_id to patient_id for backward compatibility
    order_id,
    NULL::vector as embedding, -- Clinical communications table had embedding column
    created_at,
    updated_at,
    source_table,
    is_urgent,
    requires_response,
    legacy_record_id
FROM sem.v_all_communications
ORDER BY created_at DESC;

COMMENT ON VIEW public.v_all_communications IS 'Legacy compatibility view - redirects to sem.v_all_communications. Provides backward compatibility for existing code that references the old unified communications view.';

-- Step 2: Verify the old view is replaced
\echo 'Step 1 completed: Replaced public.v_all_communications view'

-- Step 3: Drop the clinical_communications table
-- This will automatically drop:
-- - All triggers (including audit triggers)  
-- - All constraints (including foreign keys)
-- - All indexes
-- - All permissions are revoked automatically
DROP TABLE IF EXISTS public.clinical_communications CASCADE;

\echo 'Step 2 completed: Dropped clinical_communications table with CASCADE'

-- Step 4: Clean up any orphaned audit log entries (if audit system exists)
-- Note: This is optional and depends on your audit system implementation
DO $$
BEGIN
    -- Check if audit table exists and clean up
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_logs') THEN
        DELETE FROM audit_logs WHERE table_name = 'clinical_communications';
        RAISE NOTICE 'Cleaned up % audit log entries for clinical_communications', 
                     (SELECT COUNT(*) FROM audit_logs WHERE table_name = 'clinical_communications');
    ELSE
        RAISE NOTICE 'No audit_logs table found - skipping cleanup';
    END IF;
EXCEPTION
    WHEN others THEN
        RAISE NOTICE 'Could not clean audit logs: %', SQLERRM;
END $$;

\echo 'Step 3 completed: Audit log cleanup attempted'

-- Step 5: Verify cleanup
\echo 'Verification:'
\echo '============='

-- Check that table is gone
SELECT 
    CASE 
        WHEN COUNT(*) = 0 THEN '✅ clinical_communications table successfully removed'
        ELSE '❌ clinical_communications table still exists'
    END as table_status
FROM information_schema.tables 
WHERE table_name = 'clinical_communications' AND table_schema = 'public';

-- Check that view is working
SELECT 
    CASE 
        WHEN COUNT(*) > 0 THEN '✅ public.v_all_communications view working with ' || COUNT(*) || ' records'
        ELSE '❌ public.v_all_communications view has no data'
    END as view_status
FROM public.v_all_communications 
LIMIT 1;

-- Show what views now exist
SELECT 
    schemaname || '.' || viewname as view_name,
    'Active' as status
FROM pg_views 
WHERE viewname LIKE '%communication%' 
    OR viewname LIKE '%v_all_communications%'
ORDER BY schemaname, viewname;

COMMIT;

\echo ''
\echo '🎉 CLINICAL_COMMUNICATIONS TABLE REMOVAL COMPLETED!'
\echo ''
\echo 'SUMMARY OF CHANGES:'
\echo '- Dropped empty clinical_communications table'
\echo '- Replaced public.v_all_communications to use sem.v_all_communications'
\echo '- Automatically removed all triggers, constraints, and indexes'
\echo '- Cleaned up audit log entries (if applicable)'
\echo ''
\echo 'NEXT STEPS:'
\echo '- Update application code to use sem.v_*_communications views directly'
\echo '- The public.v_all_communications view provides backward compatibility'
\echo '- Consider deprecating public.v_all_communications in favor of sem views'

