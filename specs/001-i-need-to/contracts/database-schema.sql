-- Database Schema Contracts for Migration and Synchronization System
-- These tables extend the existing migration infrastructure

-- Migration Checkpoints Table
-- Tracks progress and state for all migration operations
CREATE TABLE IF NOT EXISTS migration_checkpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_type VARCHAR(50) NOT NULL CHECK (operation_type IN ('differential_migration', 'sync_operation', 'validation')),
    entity_type VARCHAR(100) NOT NULL,
    last_processed_id VARCHAR(255),
    records_processed INTEGER NOT NULL DEFAULT 0,
    records_total INTEGER,
    batch_size INTEGER NOT NULL DEFAULT 500,
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'paused')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    error_message TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT chk_records_processed_valid CHECK (records_processed >= 0),
    CONSTRAINT chk_records_total_valid CHECK (records_total IS NULL OR records_total >= records_processed),
    CONSTRAINT chk_completed_after_started CHECK (completed_at IS NULL OR completed_at >= started_at),
    CONSTRAINT chk_error_message_on_failed CHECK (
        (status = 'failed' AND error_message IS NOT NULL) OR
        (status != 'failed')
    )
);

-- Indexes for migration checkpoints
CREATE INDEX IF NOT EXISTS idx_checkpoint_status_entity ON migration_checkpoints(status, entity_type);
CREATE INDEX IF NOT EXISTS idx_checkpoint_operation_type ON migration_checkpoints(operation_type, created_at);
CREATE INDEX IF NOT EXISTS idx_checkpoint_updated_at ON migration_checkpoints(updated_at);

-- Data Differentials Table
-- Stores comparison results between source and target databases
CREATE TABLE IF NOT EXISTS data_differentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_table VARCHAR(100) NOT NULL,
    target_table VARCHAR(100) NOT NULL,
    comparison_type VARCHAR(50) NOT NULL CHECK (comparison_type IN ('missing_records', 'conflicted_records', 'deleted_records')),
    legacy_ids JSONB NOT NULL DEFAULT '[]',
    record_count INTEGER NOT NULL DEFAULT 0,
    comparison_criteria JSONB DEFAULT '{}',
    resolution_strategy VARCHAR(50) NOT NULL CHECK (resolution_strategy IN ('source_wins', 'target_wins', 'manual_review', 'skip')),
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}',

    -- Constraints
    CONSTRAINT chk_record_count_positive CHECK (record_count >= 0),
    CONSTRAINT chk_resolved_at_when_resolved CHECK (
        (resolved = TRUE AND resolved_at IS NOT NULL) OR
        (resolved = FALSE)
    )
);

-- Indexes for data differentials
CREATE INDEX IF NOT EXISTS idx_differential_table_type ON data_differentials(source_table, comparison_type);
CREATE INDEX IF NOT EXISTS idx_differential_resolved ON data_differentials(resolved, created_at);
CREATE INDEX IF NOT EXISTS idx_differential_resolution_strategy ON data_differentials(resolution_strategy);

-- Synchronization Jobs Table
-- Manages scheduled and manual synchronization operations
CREATE TABLE IF NOT EXISTS synchronization_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_name VARCHAR(100) NOT NULL UNIQUE,
    job_type VARCHAR(50) NOT NULL CHECK (job_type IN ('scheduled_sync', 'manual_sync', 'differential_migration')),
    schedule_config JSONB DEFAULT '{}',
    entities_to_sync JSONB NOT NULL DEFAULT '[]',
    sync_direction VARCHAR(20) NOT NULL CHECK (sync_direction IN ('source_to_target', 'bidirectional')) DEFAULT 'source_to_target',
    conflict_resolution VARCHAR(20) NOT NULL CHECK (conflict_resolution IN ('source_wins', 'target_wins', 'manual')) DEFAULT 'source_wins',
    max_records_per_batch INTEGER NOT NULL DEFAULT 50000,
    status VARCHAR(20) NOT NULL CHECK (status IN ('scheduled', 'running', 'completed', 'failed', 'paused', 'cancelled')),
    last_run_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,
    total_records_synced INTEGER NOT NULL DEFAULT 0,
    success_rate DECIMAL(5,2) DEFAULT 0.00,
    average_duration_ms INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}',

    -- Constraints
    CONSTRAINT chk_max_records_positive CHECK (max_records_per_batch > 0),
    CONSTRAINT chk_success_rate_range CHECK (success_rate >= 0.00 AND success_rate <= 100.00),
    CONSTRAINT chk_total_records_positive CHECK (total_records_synced >= 0),
    CONSTRAINT chk_average_duration_positive CHECK (average_duration_ms >= 0),
    CONSTRAINT chk_next_run_after_last CHECK (
        next_run_at IS NULL OR last_run_at IS NULL OR next_run_at > last_run_at
    ),
    CONSTRAINT chk_schedule_config_required CHECK (
        (job_type = 'scheduled_sync' AND schedule_config != '{}') OR
        (job_type != 'scheduled_sync')
    )
);

-- Indexes for synchronization jobs
CREATE INDEX IF NOT EXISTS idx_sync_job_status ON synchronization_jobs(status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_sync_job_type_schedule ON synchronization_jobs(job_type, next_run_at);
CREATE INDEX IF NOT EXISTS idx_sync_job_updated_at ON synchronization_jobs(updated_at);

-- Migration Validation Reports Table
-- Stores comprehensive validation results
CREATE TABLE IF NOT EXISTS migration_validation_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    validation_type VARCHAR(50) NOT NULL CHECK (validation_type IN ('data_integrity', 'relationship_integrity', 'completeness_check', 'performance_check')),
    source_entity VARCHAR(100) NOT NULL,
    target_entity VARCHAR(100) NOT NULL,
    records_validated INTEGER NOT NULL DEFAULT 0,
    validation_passed BOOLEAN NOT NULL DEFAULT FALSE,
    discrepancies_found INTEGER NOT NULL DEFAULT 0,
    discrepancy_details JSONB DEFAULT '{}',
    validation_criteria JSONB DEFAULT '{}',
    execution_time_ms INTEGER NOT NULL DEFAULT 0,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    metadata JSONB DEFAULT '{}',

    -- Constraints
    CONSTRAINT chk_records_validated_positive CHECK (records_validated >= 0),
    CONSTRAINT chk_discrepancies_positive CHECK (discrepancies_found >= 0),
    CONSTRAINT chk_execution_time_positive CHECK (execution_time_ms > 0),
    CONSTRAINT chk_expires_after_generated CHECK (expires_at > generated_at),
    CONSTRAINT chk_validation_consistency CHECK (
        (validation_passed = TRUE AND discrepancies_found = 0) OR
        (validation_passed = FALSE) OR
        (discrepancies_found > 0)
    ),
    CONSTRAINT chk_discrepancy_details_required CHECK (
        (discrepancies_found > 0 AND discrepancy_details != '{}') OR
        (discrepancies_found = 0)
    )
);

-- Indexes for validation reports
CREATE INDEX IF NOT EXISTS idx_validation_type_entity ON migration_validation_reports(validation_type, source_entity);
CREATE INDEX IF NOT EXISTS idx_validation_generated_at ON migration_validation_reports(generated_at);
CREATE INDEX IF NOT EXISTS idx_validation_expires_at ON migration_validation_reports(expires_at);
CREATE INDEX IF NOT EXISTS idx_validation_passed ON migration_validation_reports(validation_passed, generated_at);

-- Sync Run History Table
-- Detailed history of individual sync runs for monitoring and troubleshooting
CREATE TABLE IF NOT EXISTS sync_run_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES synchronization_jobs(id) ON DELETE CASCADE,
    run_type VARCHAR(20) NOT NULL CHECK (run_type IN ('scheduled', 'manual', 'retry')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    records_synced INTEGER NOT NULL DEFAULT 0,
    records_failed INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
    error_summary TEXT,
    performance_metrics JSONB DEFAULT '{}',
    entities_processed JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT chk_records_synced_positive CHECK (records_synced >= 0),
    CONSTRAINT chk_records_failed_positive CHECK (records_failed >= 0),
    CONSTRAINT chk_completed_after_started CHECK (completed_at IS NULL OR completed_at >= started_at),
    CONSTRAINT chk_error_summary_on_failed CHECK (
        (status = 'failed' AND error_summary IS NOT NULL) OR
        (status != 'failed')
    )
);

-- Indexes for sync run history
CREATE INDEX IF NOT EXISTS idx_sync_run_job_id ON sync_run_history(job_id, started_at);
CREATE INDEX IF NOT EXISTS idx_sync_run_status ON sync_run_history(status, started_at);
CREATE INDEX IF NOT EXISTS idx_sync_run_started_at ON sync_run_history(started_at);

-- Trigger to update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply update triggers to relevant tables
CREATE TRIGGER update_migration_checkpoints_updated_at
    BEFORE UPDATE ON migration_checkpoints
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_synchronization_jobs_updated_at
    BEFORE UPDATE ON synchronization_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create views for common queries
CREATE OR REPLACE VIEW active_sync_jobs AS
SELECT
    id,
    job_name,
    job_type,
    status,
    next_run_at,
    total_records_synced,
    success_rate,
    created_at
FROM synchronization_jobs
WHERE status IN ('scheduled', 'running', 'paused')
ORDER BY next_run_at ASC NULLS LAST;

CREATE OR REPLACE VIEW recent_sync_activity AS
SELECT
    srh.id as run_id,
    sj.job_name,
    srh.run_type,
    srh.started_at,
    srh.completed_at,
    srh.records_synced,
    srh.records_failed,
    srh.status,
    EXTRACT(EPOCH FROM (srh.completed_at - srh.started_at)) * 1000 as duration_ms
FROM sync_run_history srh
JOIN synchronization_jobs sj ON srh.job_id = sj.id
WHERE srh.started_at >= NOW() - INTERVAL '7 days'
ORDER BY srh.started_at DESC;

CREATE OR REPLACE VIEW migration_progress_summary AS
SELECT
    entity_type,
    operation_type,
    COUNT(*) as total_operations,
    COUNT(*) FILTER (WHERE status = 'completed') as completed_operations,
    COUNT(*) FILTER (WHERE status = 'failed') as failed_operations,
    COUNT(*) FILTER (WHERE status = 'in_progress') as active_operations,
    SUM(records_processed) as total_records_processed,
    MAX(updated_at) as last_activity
FROM migration_checkpoints
GROUP BY entity_type, operation_type
ORDER BY entity_type, operation_type;

-- Grant permissions for the migration system
-- Note: Adjust these permissions based on your specific user setup
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO postgres;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO postgres;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO postgres;