-- =====================================================
-- VERIFICATION SCRIPT - DRY RUN
-- Test the removal plan without actually removing anything
-- =====================================================

\echo '=== PRE-REMOVAL VERIFICATION ==='
\echo ''

-- 1. Check current state of clinical_communications
\echo '📊 CURRENT TABLE STATE:'
SELECT 
    'clinical_communications' as table_name,
    COUNT(*) as record_count,
    pg_size_pretty(pg_total_relation_size('clinical_communications')) as size
FROM clinical_communications;

-- 2. Check current views
\echo ''
\echo '👁️  CURRENT VIEWS:'
SELECT 
    schemaname || '.' || viewname as view_name,
    CASE 
        WHEN definition LIKE '%clinical_communications%' THEN 'References clinical_communications'
        ELSE 'Does not reference clinical_communications'
    END as dependency_status
FROM pg_views 
WHERE viewname LIKE '%communication%' 
    OR viewname LIKE '%v_all%'
ORDER BY schemaname, viewname;

-- 3. Test our new sem.v_all_communications
\echo ''
\echo '🧪 TESTING NEW SEM VIEWS:'
SELECT 
    'sem.v_all_communications' as view_name,
    COUNT(*) as total_records,
    COUNT(DISTINCT category) as categories
FROM sem.v_all_communications;

SELECT 
    category,
    COUNT(*) as count
FROM sem.v_all_communications
GROUP BY category
ORDER BY count DESC;

-- 4. Test the replacement view query (without creating it)
\echo ''
\echo '🔄 TESTING REPLACEMENT VIEW LOGIC:'
WITH replacement_view_test AS (
    SELECT 
        id,
        category,
        communication_type as type,
        subject,
        body,
        author_id,
        case_id as patient_id,
        order_id,
        NULL::vector as embedding,
        created_at,
        updated_at,
        source_table,
        is_urgent,
        requires_response,
        legacy_record_id
    FROM sem.v_all_communications
    LIMIT 5
)
SELECT 
    'Replacement view test' as test_name,
    COUNT(*) as sample_records,
    'SUCCESS' as status
FROM replacement_view_test;

-- 5. Check for any dependencies we might have missed
\echo ''
\echo '🔍 FINAL DEPENDENCY CHECK:'

-- Check for any materialized views
SELECT 
    schemaname || '.' || matviewname as matview_name,
    'Materialized View' as type
FROM pg_matviews 
WHERE definition LIKE '%clinical_communications%';

-- Check for any stored procedures/functions we missed
SELECT 
    n.nspname || '.' || p.proname as function_name,
    'Function' as type
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE pg_get_functiondef(p.oid) LIKE '%clinical_communications%'
    AND n.nspname NOT IN ('information_schema', 'pg_catalog');

\echo ''
\echo '✅ VERIFICATION COMPLETE'
\echo 'If all tests pass, you can proceed with remove_clinical_communications_table.sql'

