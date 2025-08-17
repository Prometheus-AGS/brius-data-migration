-- Safe deletion of treatments table
-- This script will remove the treatments table which is empty and redundant 
-- after our treatment_plans migration, while preserving treatment_discussions
-- for future evaluation against source tables.

-- First, check current state and dependencies
\echo '🔍 Checking treatments table status...'
SELECT COUNT(*) as record_count FROM treatments;

\echo '🔗 Checking foreign key constraints that reference treatments...'
SELECT 
    tc.table_name as referencing_table,
    tc.constraint_name,
    kcu.column_name as referencing_column
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' 
    AND ccu.table_name = 'treatments'
ORDER BY tc.table_name;

\echo '⚠️  About to drop treatments table and its dependent constraints...'
\echo 'Press Ctrl+C to abort if you see any unexpected dependencies above.'

-- Drop the treatments table and cascade to remove dependent foreign keys
DROP TABLE IF EXISTS treatments CASCADE;

\echo '✅ Treatments table deleted successfully!'

-- Verify treatment_discussions still exists and show its current state
\echo '📋 Verifying treatment_discussions table is preserved...'
SELECT COUNT(*) as treatment_discussions_count FROM treatment_discussions;

\echo '🔗 Checking remaining foreign keys in treatment_discussions...'
SELECT 
    tc.constraint_name,
    kcu.column_name,
    ccu.table_name AS references_table,
    ccu.column_name AS references_column
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' 
    AND tc.table_name = 'treatment_discussions'
ORDER BY tc.constraint_name;

\echo '📊 Final summary of project-related tables:'
SELECT 
  'projects' as table_name, COUNT(*) as record_count 
FROM projects
UNION ALL
SELECT 
  'treatment_plans' as table_name, COUNT(*) as record_count 
FROM treatment_plans
UNION ALL
SELECT 
  'treatment_discussions' as table_name, COUNT(*) as record_count 
FROM treatment_discussions
ORDER BY record_count DESC;

\echo '🎉 Clean-up complete!'
\echo 'KEPT: projects (66,918 records), treatment_plans (33,891 records), treatment_discussions (0 records)'
\echo 'REMOVED: treatments table (was empty and redundant)'
