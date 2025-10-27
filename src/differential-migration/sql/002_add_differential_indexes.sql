-- =================================================================
-- DIFFERENTIAL DATABASE MIGRATION SYSTEM - INDEX CREATION
-- =================================================================
-- Creates optimized indexes for differential migration performance
-- Version: 1.0.0
-- Date: 2025-10-26

-- =================================================================
-- MIGRATION CHECKPOINTS INDEXES
-- =================================================================

-- Primary lookup indexes for checkpoint retrieval
CREATE INDEX IF NOT EXISTS idx_migration_checkpoints_entity_run
ON migration_checkpoints (entity_type, migration_run_id);

CREATE INDEX IF NOT EXISTS idx_migration_checkpoints_last_processed
ON migration_checkpoints (last_processed_id)
WHERE last_processed_id IS NOT NULL;

-- Performance index for checkpoint status queries
CREATE INDEX IF NOT EXISTS idx_migration_checkpoints_created_at
ON migration_checkpoints (created_at DESC);

-- Composite index for resume operations
CREATE INDEX IF NOT EXISTS idx_migration_checkpoints_resume
ON migration_checkpoints (entity_type, records_remaining)
WHERE records_remaining > 0;

-- =================================================================
-- DIFFERENTIAL ANALYSIS RESULTS INDEXES
-- =================================================================

-- Primary lookup indexes for analysis results
CREATE INDEX IF NOT EXISTS idx_differential_analysis_entity_timestamp
ON differential_analysis_results (entity_type, analysis_timestamp DESC);

-- Performance index for baseline comparison
CREATE INDEX IF NOT EXISTS idx_differential_analysis_last_migration
ON differential_analysis_results (last_migration_timestamp DESC)
WHERE last_migration_timestamp IS NOT NULL;

-- Index for change detection queries
CREATE INDEX IF NOT EXISTS idx_differential_analysis_change_counts
ON differential_analysis_results (entity_type, source_record_count, destination_record_count);

-- GIN indexes for JSON array searches (new/modified/deleted records)
CREATE INDEX IF NOT EXISTS idx_differential_analysis_new_records
ON differential_analysis_results USING GIN (new_records);

CREATE INDEX IF NOT EXISTS idx_differential_analysis_modified_records
ON differential_analysis_results USING GIN (modified_records);

CREATE INDEX IF NOT EXISTS idx_differential_analysis_deleted_records
ON differential_analysis_results USING GIN (deleted_records);

-- =================================================================
-- MIGRATION STATUS TRACKING INDEXES
-- =================================================================

-- Primary lookup for migration sessions
CREATE INDEX IF NOT EXISTS idx_migration_status_session_id
ON migration_status_tracking (migration_session_id);

-- Status monitoring indexes
CREATE INDEX IF NOT EXISTS idx_migration_status_overall_status
ON migration_status_tracking (overall_status, started_at DESC);

-- Performance monitoring index
CREATE INDEX IF NOT EXISTS idx_migration_status_progress
ON migration_status_tracking (total_records_processed, total_records_remaining);

-- GIN indexes for entity arrays
CREATE INDEX IF NOT EXISTS idx_migration_status_entities_pending
ON migration_status_tracking USING GIN (entities_pending);

CREATE INDEX IF NOT EXISTS idx_migration_status_entities_running
ON migration_status_tracking USING GIN (entities_running);

CREATE INDEX IF NOT EXISTS idx_migration_status_entities_completed
ON migration_status_tracking USING GIN (entities_completed);

CREATE INDEX IF NOT EXISTS idx_migration_status_entities_failed
ON migration_status_tracking USING GIN (entities_failed);

-- Completion time tracking
CREATE INDEX IF NOT EXISTS idx_migration_status_completion_tracking
ON migration_status_tracking (started_at, completed_at, estimated_completion);

-- =================================================================
-- SCHEMA MAPPING DEFINITIONS INDEXES
-- =================================================================

-- Primary lookup for active mappings
CREATE INDEX IF NOT EXISTS idx_schema_mapping_entity_active
ON schema_mapping_definitions (entity_type, is_active)
WHERE is_active = true;

-- Version management index
CREATE INDEX IF NOT EXISTS idx_schema_mapping_version
ON schema_mapping_definitions (entity_type, version, created_at DESC);

-- Table mapping lookups
CREATE INDEX IF NOT EXISTS idx_schema_mapping_tables
ON schema_mapping_definitions (source_table, destination_table);

-- GIN indexes for field mappings and rules
CREATE INDEX IF NOT EXISTS idx_schema_mapping_field_mappings
ON schema_mapping_definitions USING GIN (field_mappings);

CREATE INDEX IF NOT EXISTS idx_schema_mapping_validation_rules
ON schema_mapping_definitions USING GIN (validation_rules);

-- =================================================================
-- MIGRATION EXECUTION LOGS INDEXES
-- =================================================================

-- Primary lookup for session logs
CREATE INDEX IF NOT EXISTS idx_migration_logs_session_timestamp
ON migration_execution_logs (migration_session_id, timestamp DESC);

-- Entity-specific log filtering
CREATE INDEX IF NOT EXISTS idx_migration_logs_entity_type
ON migration_execution_logs (entity_type, timestamp DESC)
WHERE entity_type IS NOT NULL;

-- Operation type filtering
CREATE INDEX IF NOT EXISTS idx_migration_logs_operation_type
ON migration_execution_logs (operation_type, timestamp DESC);

-- Log level filtering for error analysis
CREATE INDEX IF NOT EXISTS idx_migration_logs_log_level
ON migration_execution_logs (log_level, timestamp DESC);

-- Record-specific debugging
CREATE INDEX IF NOT EXISTS idx_migration_logs_record_id
ON migration_execution_logs (record_id, timestamp DESC)
WHERE record_id IS NOT NULL;

-- Error analysis index
CREATE INDEX IF NOT EXISTS idx_migration_logs_errors
ON migration_execution_logs (log_level, entity_type, timestamp DESC)
WHERE log_level IN ('error', 'warn');

-- Performance data analysis
CREATE INDEX IF NOT EXISTS idx_migration_logs_performance
ON migration_execution_logs (operation_type, timestamp DESC)
WHERE performance_data IS NOT NULL;

-- GIN indexes for JSON fields
CREATE INDEX IF NOT EXISTS idx_migration_logs_error_details
ON migration_execution_logs USING GIN (error_details)
WHERE error_details IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_migration_logs_context_data
ON migration_execution_logs USING GIN (context_data);

-- =================================================================
-- PARTIAL INDEXES FOR PERFORMANCE
-- =================================================================

-- Active checkpoints only
CREATE INDEX IF NOT EXISTS idx_migration_checkpoints_active
ON migration_checkpoints (entity_type, updated_at DESC)
WHERE records_remaining > 0;

-- Recent analysis results only (last 30 days)
CREATE INDEX IF NOT EXISTS idx_differential_analysis_recent
ON differential_analysis_results (entity_type, analysis_timestamp DESC)
WHERE analysis_timestamp > CURRENT_TIMESTAMP - INTERVAL '30 days';

-- Running/active migration sessions only
CREATE INDEX IF NOT EXISTS idx_migration_status_active
ON migration_status_tracking (migration_session_id, updated_at DESC)
WHERE overall_status IN ('running', 'paused');

-- Recent error logs only (last 7 days)
CREATE INDEX IF NOT EXISTS idx_migration_logs_recent_errors
ON migration_execution_logs (entity_type, timestamp DESC)
WHERE log_level = 'error' AND timestamp > CURRENT_TIMESTAMP - INTERVAL '7 days';

-- =================================================================
-- COMPOSITE INDEXES FOR COMPLEX QUERIES
-- =================================================================

-- Checkpoint recovery queries
CREATE INDEX IF NOT EXISTS idx_checkpoint_recovery
ON migration_checkpoints (migration_run_id, entity_type, batch_position, updated_at DESC);

-- Analysis result comparison queries
CREATE INDEX IF NOT EXISTS idx_analysis_comparison
ON differential_analysis_results (entity_type, last_migration_timestamp, analysis_timestamp DESC);

-- Migration progress monitoring
CREATE INDEX IF NOT EXISTS idx_migration_progress_monitoring
ON migration_status_tracking (overall_status, started_at, total_records_processed);

-- Log aggregation and reporting
CREATE INDEX IF NOT EXISTS idx_log_aggregation
ON migration_execution_logs (migration_session_id, entity_type, log_level, timestamp);

-- =================================================================
-- STATISTICS AND MAINTENANCE
-- =================================================================

-- Update table statistics for optimal query planning
ANALYZE migration_checkpoints;
ANALYZE differential_analysis_results;
ANALYZE migration_status_tracking;
ANALYZE schema_mapping_definitions;
ANALYZE migration_execution_logs;

-- =================================================================
-- INDEX MONITORING VIEWS
-- =================================================================

-- View for monitoring index usage
CREATE OR REPLACE VIEW differential_migration_index_usage AS
SELECT
    schemaname,
    tablename,
    indexname,
    idx_tup_read,
    idx_tup_fetch,
    idx_scan
FROM pg_stat_user_indexes
WHERE tablename IN (
    'migration_checkpoints',
    'differential_analysis_results',
    'migration_status_tracking',
    'schema_mapping_definitions',
    'migration_execution_logs'
)
ORDER BY idx_scan DESC;

-- View for monitoring table sizes and index sizes
CREATE OR REPLACE VIEW differential_migration_table_sizes AS
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) as index_size
FROM pg_tables
WHERE tablename IN (
    'migration_checkpoints',
    'differential_analysis_results',
    'migration_status_tracking',
    'schema_mapping_definitions',
    'migration_execution_logs'
)
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- =================================================================
-- SUCCESS MESSAGE
-- =================================================================

DO $$
BEGIN
    RAISE NOTICE 'SUCCESS: Differential migration indexes created successfully';
    RAISE NOTICE 'Primary indexes: entity lookup, timestamp ordering, session tracking';
    RAISE NOTICE 'Performance indexes: JSON fields (GIN), partial indexes for active records';
    RAISE NOTICE 'Composite indexes: complex query optimization';
    RAISE NOTICE 'Monitoring views: index usage, table sizes';
    RAISE NOTICE 'Table statistics updated for optimal query planning';
END $$;