-- =================================================================
-- DIFFERENTIAL DATABASE MIGRATION SYSTEM - FUNCTIONS
-- =================================================================
-- Creates utility functions for differential migration operations
-- Version: 1.0.0
-- Date: 2025-10-26

-- =================================================================
-- CHECKPOINT MANAGEMENT FUNCTIONS
-- =================================================================

-- Function to create or update a migration checkpoint
CREATE OR REPLACE FUNCTION create_migration_checkpoint(
    p_entity_type VARCHAR(100),
    p_migration_run_id VARCHAR(255),
    p_last_processed_id VARCHAR(255),
    p_batch_position INTEGER,
    p_records_processed INTEGER,
    p_records_remaining INTEGER,
    p_checkpoint_data JSONB DEFAULT '{}'
) RETURNS UUID AS $$
DECLARE
    checkpoint_id UUID;
BEGIN
    -- Insert or update checkpoint
    INSERT INTO migration_checkpoints (
        entity_type,
        migration_run_id,
        last_processed_id,
        batch_position,
        records_processed,
        records_remaining,
        checkpoint_data
    ) VALUES (
        p_entity_type,
        p_migration_run_id,
        p_last_processed_id,
        p_batch_position,
        p_records_processed,
        p_records_remaining,
        p_checkpoint_data
    )
    ON CONFLICT (entity_type, migration_run_id)
    DO UPDATE SET
        last_processed_id = EXCLUDED.last_processed_id,
        batch_position = EXCLUDED.batch_position,
        records_processed = EXCLUDED.records_processed,
        records_remaining = EXCLUDED.records_remaining,
        checkpoint_data = EXCLUDED.checkpoint_data,
        updated_at = CURRENT_TIMESTAMP
    RETURNING id INTO checkpoint_id;

    RETURN checkpoint_id;
END;
$$ LANGUAGE plpgsql;

-- Function to restore migration checkpoint
CREATE OR REPLACE FUNCTION get_migration_checkpoint(
    p_entity_type VARCHAR(100),
    p_migration_run_id VARCHAR(255)
) RETURNS TABLE (
    checkpoint_id UUID,
    last_processed_id VARCHAR(255),
    batch_position INTEGER,
    records_processed INTEGER,
    records_remaining INTEGER,
    checkpoint_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        mc.id,
        mc.last_processed_id,
        mc.batch_position,
        mc.records_processed,
        mc.records_remaining,
        mc.checkpoint_data,
        mc.created_at,
        mc.updated_at
    FROM migration_checkpoints mc
    WHERE mc.entity_type = p_entity_type
      AND mc.migration_run_id = p_migration_run_id
    ORDER BY mc.updated_at DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up old checkpoints
CREATE OR REPLACE FUNCTION cleanup_old_checkpoints(
    p_retention_days INTEGER DEFAULT 30
) RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM migration_checkpoints
    WHERE created_at < CURRENT_TIMESTAMP - (p_retention_days || ' days')::INTERVAL
      AND records_remaining = 0; -- Only clean up completed checkpoints

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- =================================================================
-- DIFFERENTIAL ANALYSIS FUNCTIONS
-- =================================================================

-- Function to store differential analysis results
CREATE OR REPLACE FUNCTION store_differential_analysis(
    p_entity_type VARCHAR(100),
    p_source_record_count INTEGER,
    p_destination_record_count INTEGER,
    p_new_records JSONB,
    p_modified_records JSONB,
    p_deleted_records JSONB,
    p_last_migration_timestamp TIMESTAMP WITH TIME ZONE,
    p_analysis_metadata JSONB DEFAULT '{}'
) RETURNS UUID AS $$
DECLARE
    analysis_id UUID;
BEGIN
    INSERT INTO differential_analysis_results (
        entity_type,
        source_record_count,
        destination_record_count,
        new_records,
        modified_records,
        deleted_records,
        last_migration_timestamp,
        analysis_metadata
    ) VALUES (
        p_entity_type,
        p_source_record_count,
        p_destination_record_count,
        p_new_records,
        p_modified_records,
        p_deleted_records,
        p_last_migration_timestamp,
        p_analysis_metadata
    )
    RETURNING id INTO analysis_id;

    RETURN analysis_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get latest analysis results for entity
CREATE OR REPLACE FUNCTION get_latest_analysis_results(
    p_entity_type VARCHAR(100)
) RETURNS TABLE (
    analysis_id UUID,
    analysis_timestamp TIMESTAMP WITH TIME ZONE,
    source_record_count INTEGER,
    destination_record_count INTEGER,
    new_record_count INTEGER,
    modified_record_count INTEGER,
    deleted_record_count INTEGER,
    change_percentage NUMERIC(5,2),
    new_records JSONB,
    modified_records JSONB,
    deleted_records JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        dar.id,
        dar.analysis_timestamp,
        dar.source_record_count,
        dar.destination_record_count,
        jsonb_array_length(dar.new_records) as new_record_count,
        jsonb_array_length(dar.modified_records) as modified_record_count,
        jsonb_array_length(dar.deleted_records) as deleted_record_count,
        CASE
            WHEN dar.source_record_count > 0 THEN
                ROUND(
                    ((jsonb_array_length(dar.new_records) + jsonb_array_length(dar.modified_records))::NUMERIC / dar.source_record_count::NUMERIC) * 100,
                    2
                )
            ELSE 0
        END as change_percentage,
        dar.new_records,
        dar.modified_records,
        dar.deleted_records
    FROM differential_analysis_results dar
    WHERE dar.entity_type = p_entity_type
    ORDER BY dar.analysis_timestamp DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- =================================================================
-- MIGRATION STATUS FUNCTIONS
-- =================================================================

-- Function to update migration status
CREATE OR REPLACE FUNCTION update_migration_status(
    p_migration_session_id UUID,
    p_overall_status VARCHAR(50),
    p_entities_pending JSONB DEFAULT '[]',
    p_entities_running JSONB DEFAULT '[]',
    p_entities_completed JSONB DEFAULT '[]',
    p_entities_failed JSONB DEFAULT '[]',
    p_total_records_processed INTEGER DEFAULT 0,
    p_total_records_remaining INTEGER DEFAULT 0,
    p_estimated_completion TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    p_error_summary JSONB DEFAULT '{}',
    p_performance_metrics JSONB DEFAULT '{}'
) RETURNS UUID AS $$
DECLARE
    status_id UUID;
BEGIN
    INSERT INTO migration_status_tracking (
        migration_session_id,
        overall_status,
        entities_pending,
        entities_running,
        entities_completed,
        entities_failed,
        total_records_processed,
        total_records_remaining,
        estimated_completion,
        error_summary,
        performance_metrics,
        started_at
    ) VALUES (
        p_migration_session_id,
        p_overall_status,
        p_entities_pending,
        p_entities_running,
        p_entities_completed,
        p_entities_failed,
        p_total_records_processed,
        p_total_records_remaining,
        p_estimated_completion,
        p_error_summary,
        p_performance_metrics,
        CASE WHEN p_overall_status = 'running' AND started_at IS NULL THEN CURRENT_TIMESTAMP ELSE started_at END
    )
    ON CONFLICT (migration_session_id)
    DO UPDATE SET
        overall_status = EXCLUDED.overall_status,
        entities_pending = EXCLUDED.entities_pending,
        entities_running = EXCLUDED.entities_running,
        entities_completed = EXCLUDED.entities_completed,
        entities_failed = EXCLUDED.entities_failed,
        total_records_processed = EXCLUDED.total_records_processed,
        total_records_remaining = EXCLUDED.total_records_remaining,
        estimated_completion = EXCLUDED.estimated_completion,
        error_summary = EXCLUDED.error_summary,
        performance_metrics = EXCLUDED.performance_metrics,
        completed_at = CASE WHEN EXCLUDED.overall_status IN ('completed', 'failed') THEN CURRENT_TIMESTAMP ELSE migration_status_tracking.completed_at END,
        updated_at = CURRENT_TIMESTAMP
    RETURNING id INTO status_id;

    RETURN status_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get migration session status
CREATE OR REPLACE FUNCTION get_migration_session_status(
    p_migration_session_id UUID
) RETURNS TABLE (
    session_id UUID,
    overall_status VARCHAR(50),
    entities_pending JSONB,
    entities_running JSONB,
    entities_completed JSONB,
    entities_failed JSONB,
    total_records_processed INTEGER,
    total_records_remaining INTEGER,
    progress_percentage NUMERIC(5,2),
    estimated_completion TIMESTAMP WITH TIME ZONE,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        mst.migration_session_id,
        mst.overall_status,
        mst.entities_pending,
        mst.entities_running,
        mst.entities_completed,
        mst.entities_failed,
        mst.total_records_processed,
        mst.total_records_remaining,
        CASE
            WHEN (mst.total_records_processed + mst.total_records_remaining) > 0 THEN
                ROUND((mst.total_records_processed::NUMERIC / (mst.total_records_processed + mst.total_records_remaining)::NUMERIC) * 100, 2)
            ELSE 0
        END as progress_percentage,
        mst.estimated_completion,
        mst.started_at,
        mst.completed_at,
        CASE
            WHEN mst.completed_at IS NOT NULL AND mst.started_at IS NOT NULL THEN
                EXTRACT(EPOCH FROM (mst.completed_at - mst.started_at))::INTEGER
            WHEN mst.started_at IS NOT NULL THEN
                EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - mst.started_at))::INTEGER
            ELSE NULL
        END as duration_seconds
    FROM migration_status_tracking mst
    WHERE mst.migration_session_id = p_migration_session_id;
END;
$$ LANGUAGE plpgsql;

-- =================================================================
-- LOGGING FUNCTIONS
-- =================================================================

-- Function to log migration operations
CREATE OR REPLACE FUNCTION log_migration_operation(
    p_migration_session_id UUID,
    p_entity_type VARCHAR(100),
    p_operation_type VARCHAR(100),
    p_log_level VARCHAR(20),
    p_message TEXT,
    p_record_id VARCHAR(255) DEFAULT NULL,
    p_error_details JSONB DEFAULT NULL,
    p_performance_data JSONB DEFAULT NULL,
    p_context_data JSONB DEFAULT '{}'
) RETURNS UUID AS $$
DECLARE
    log_id UUID;
BEGIN
    INSERT INTO migration_execution_logs (
        migration_session_id,
        entity_type,
        operation_type,
        record_id,
        log_level,
        message,
        error_details,
        performance_data,
        context_data
    ) VALUES (
        p_migration_session_id,
        p_entity_type,
        p_operation_type,
        p_record_id,
        p_log_level,
        p_message,
        p_error_details,
        p_performance_data,
        p_context_data
    )
    RETURNING id INTO log_id;

    RETURN log_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get logs for a migration session with filtering
CREATE OR REPLACE FUNCTION get_migration_logs(
    p_migration_session_id UUID,
    p_entity_type VARCHAR(100) DEFAULT NULL,
    p_log_level VARCHAR(20) DEFAULT NULL,
    p_operation_type VARCHAR(100) DEFAULT NULL,
    p_limit INTEGER DEFAULT 100,
    p_offset INTEGER DEFAULT 0
) RETURNS TABLE (
    log_id UUID,
    entity_type VARCHAR(100),
    operation_type VARCHAR(100),
    record_id VARCHAR(255),
    log_level VARCHAR(20),
    message TEXT,
    error_details JSONB,
    performance_data JSONB,
    context_data JSONB,
    timestamp TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        mel.id,
        mel.entity_type,
        mel.operation_type,
        mel.record_id,
        mel.log_level,
        mel.message,
        mel.error_details,
        mel.performance_data,
        mel.context_data,
        mel.timestamp
    FROM migration_execution_logs mel
    WHERE mel.migration_session_id = p_migration_session_id
      AND (p_entity_type IS NULL OR mel.entity_type = p_entity_type)
      AND (p_log_level IS NULL OR mel.log_level = p_log_level)
      AND (p_operation_type IS NULL OR mel.operation_type = p_operation_type)
    ORDER BY mel.timestamp DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- =================================================================
-- UTILITY FUNCTIONS
-- =================================================================

-- Function to get entity migration dependency order
CREATE OR REPLACE FUNCTION get_entity_dependency_order()
RETURNS TABLE (
    entity_type VARCHAR(100),
    dependency_level INTEGER,
    depends_on VARCHAR(100)[]
) AS $$
BEGIN
    RETURN QUERY
    VALUES
        ('offices', 1, ARRAY[]::VARCHAR[]),
        ('doctors', 2, ARRAY['offices']),
        ('doctor_offices', 3, ARRAY['offices', 'doctors']),
        ('patients', 4, ARRAY['doctors']),
        ('orders', 5, ARRAY['patients']),
        ('cases', 6, ARRAY['orders']),
        ('files', 6, ARRAY['orders']),
        ('case_files', 7, ARRAY['cases', 'files']),
        ('messages', 7, ARRAY['cases']),
        ('message_files', 8, ARRAY['messages', 'files']),
        ('jaw', 6, ARRAY['patients']),
        ('dispatch_records', 6, ARRAY['orders']),
        ('system_messages', 1, ARRAY[]::VARCHAR[]),
        ('message_attachments', 8, ARRAY['messages']),
        ('technician_roles', 2, ARRAY['offices']),
        ('order_cases', 7, ARRAY['orders', 'cases']),
        ('purchases', 6, ARRAY['orders']),
        ('treatment_discussions', 7, ARRAY['cases']),
        ('template_view_groups', 1, ARRAY[]::VARCHAR[]),
        ('template_view_roles', 2, ARRAY['template_view_groups'])
    ORDER BY dependency_level, entity_type;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate estimated completion time
CREATE OR REPLACE FUNCTION calculate_estimated_completion(
    p_records_processed INTEGER,
    p_records_remaining INTEGER,
    p_started_at TIMESTAMP WITH TIME ZONE,
    p_current_throughput NUMERIC DEFAULT NULL
) RETURNS TIMESTAMP WITH TIME ZONE AS $$
DECLARE
    throughput_per_second NUMERIC;
    seconds_elapsed INTEGER;
    estimated_seconds_remaining INTEGER;
BEGIN
    -- Calculate seconds elapsed
    seconds_elapsed := EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - p_started_at))::INTEGER;

    -- Use provided throughput or calculate from current progress
    IF p_current_throughput IS NOT NULL THEN
        throughput_per_second := p_current_throughput;
    ELSE
        IF seconds_elapsed > 0 AND p_records_processed > 0 THEN
            throughput_per_second := p_records_processed::NUMERIC / seconds_elapsed;
        ELSE
            -- Default conservative estimate: 10 records per second
            throughput_per_second := 10;
        END IF;
    END IF;

    -- Calculate estimated seconds remaining
    IF throughput_per_second > 0 THEN
        estimated_seconds_remaining := (p_records_remaining::NUMERIC / throughput_per_second)::INTEGER;
    ELSE
        estimated_seconds_remaining := p_records_remaining * 10; -- Conservative fallback
    END IF;

    -- Return estimated completion time
    RETURN CURRENT_TIMESTAMP + (estimated_seconds_remaining || ' seconds')::INTERVAL;
END;
$$ LANGUAGE plpgsql;

-- =================================================================
-- MAINTENANCE FUNCTIONS
-- =================================================================

-- Function to cleanup old analysis results
CREATE OR REPLACE FUNCTION cleanup_old_analysis_results(
    p_retention_days INTEGER DEFAULT 30
) RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM differential_analysis_results
    WHERE created_at < CURRENT_TIMESTAMP - (p_retention_days || ' days')::INTERVAL;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to cleanup old execution logs
CREATE OR REPLACE FUNCTION cleanup_old_execution_logs(
    p_retention_days INTEGER DEFAULT 7
) RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM migration_execution_logs
    WHERE created_at < CURRENT_TIMESTAMP - (p_retention_days || ' days')::INTERVAL;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- =================================================================
-- COMMENTS ON FUNCTIONS
-- =================================================================

COMMENT ON FUNCTION create_migration_checkpoint IS 'Creates or updates migration checkpoint for resumable operations';
COMMENT ON FUNCTION get_migration_checkpoint IS 'Retrieves latest checkpoint for entity and migration run';
COMMENT ON FUNCTION store_differential_analysis IS 'Stores results of differential analysis for later processing';
COMMENT ON FUNCTION get_latest_analysis_results IS 'Gets latest analysis results with calculated change metrics';
COMMENT ON FUNCTION update_migration_status IS 'Updates overall migration session status and progress';
COMMENT ON FUNCTION get_migration_session_status IS 'Retrieves comprehensive status for migration session';
COMMENT ON FUNCTION log_migration_operation IS 'Logs migration operations with structured data';
COMMENT ON FUNCTION get_migration_logs IS 'Retrieves filtered logs for migration session';
COMMENT ON FUNCTION get_entity_dependency_order IS 'Returns proper dependency order for entity migration';
COMMENT ON FUNCTION calculate_estimated_completion IS 'Calculates estimated completion time based on throughput';

-- =================================================================
-- SUCCESS MESSAGE
-- =================================================================

DO $$
BEGIN
    RAISE NOTICE 'SUCCESS: Differential migration functions created successfully';
    RAISE NOTICE 'Checkpoint functions: create, get, cleanup checkpoints';
    RAISE NOTICE 'Analysis functions: store and retrieve differential analysis results';
    RAISE NOTICE 'Status functions: update and monitor migration progress';
    RAISE NOTICE 'Logging functions: structured logging with filtering';
    RAISE NOTICE 'Utility functions: dependency order, completion estimation';
    RAISE NOTICE 'Maintenance functions: automated cleanup of old data';
END $$;