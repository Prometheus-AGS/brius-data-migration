-- Migration Coverage Database Initialization
-- Creates essential tables for migration tracking and coverage analysis

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create migration_mappings table for ID traceability
CREATE TABLE IF NOT EXISTS migration_mappings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type VARCHAR(50) NOT NULL,
    legacy_id INTEGER NOT NULL,
    modern_id UUID NOT NULL,
    migration_batch VARCHAR(100) NOT NULL,
    migrated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_legacy_mapping UNIQUE (entity_type, legacy_id),
    CONSTRAINT unique_modern_mapping UNIQUE (entity_type, modern_id)
);

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_migration_mappings_entity_legacy
    ON migration_mappings (entity_type, legacy_id);
CREATE INDEX IF NOT EXISTS idx_migration_mappings_entity_modern
    ON migration_mappings (entity_type, modern_id);
CREATE INDEX IF NOT EXISTS idx_migration_mappings_batch
    ON migration_mappings (migration_batch);

-- Create migration_control table for operation tracking
CREATE TABLE IF NOT EXISTS migration_control (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    script_name VARCHAR(255) NOT NULL,
    operation_type VARCHAR(50) NOT NULL, -- migrate, validate, rollback
    status VARCHAR(50) NOT NULL, -- pending, running, completed, failed
    start_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    end_time TIMESTAMP WITH TIME ZONE,
    records_processed INTEGER DEFAULT 0,
    records_successful INTEGER DEFAULT 0,
    records_failed INTEGER DEFAULT 0,
    error_details JSONB,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for migration_control
CREATE INDEX IF NOT EXISTS idx_migration_control_script
    ON migration_control (script_name);
CREATE INDEX IF NOT EXISTS idx_migration_control_status
    ON migration_control (status);
CREATE INDEX IF NOT EXISTS idx_migration_control_operation
    ON migration_control (operation_type);

-- Create migration_checkpoints table for resumable operations
CREATE TABLE IF NOT EXISTS migration_checkpoints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    script_name VARCHAR(255) NOT NULL,
    checkpoint_name VARCHAR(255) NOT NULL,
    checkpoint_data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_script_checkpoint UNIQUE (script_name, checkpoint_name)
);

-- Create data_differentials table for tracking changes
CREATE TABLE IF NOT EXISTS data_differentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_table VARCHAR(100) NOT NULL,
    target_table VARCHAR(100) NOT NULL,
    comparison_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    source_count INTEGER NOT NULL,
    target_count INTEGER NOT NULL,
    missing_in_target INTEGER DEFAULT 0,
    extra_in_target INTEGER DEFAULT 0,
    data_hash_source VARCHAR(64),
    data_hash_target VARCHAR(64),
    differences JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create synchronization_jobs table for ongoing sync operations
CREATE TABLE IF NOT EXISTS synchronization_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_name VARCHAR(255) NOT NULL,
    job_type VARCHAR(50) NOT NULL, -- full_sync, incremental, validation
    status VARCHAR(50) NOT NULL, -- pending, running, completed, failed, paused
    source_config JSONB NOT NULL,
    target_config JSONB NOT NULL,
    schedule_cron VARCHAR(100),
    last_run_at TIMESTAMP WITH TIME ZONE,
    next_run_at TIMESTAMP WITH TIME ZONE,
    run_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    settings JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create migration_validation_reports table
CREATE TABLE IF NOT EXISTS migration_validation_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_name VARCHAR(255) NOT NULL,
    validation_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    total_rules INTEGER NOT NULL DEFAULT 0,
    passed_rules INTEGER NOT NULL DEFAULT 0,
    failed_rules INTEGER NOT NULL DEFAULT 0,
    critical_failures INTEGER NOT NULL DEFAULT 0,
    warning_count INTEGER NOT NULL DEFAULT 0,
    overall_score DECIMAL(5,2) DEFAULT 0,
    execution_time INTEGER DEFAULT 0, -- milliseconds
    report_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create sync_run_history table for detailed run logs
CREATE TABLE IF NOT EXISTS sync_run_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES synchronization_jobs(id) ON DELETE CASCADE,
    run_number INTEGER NOT NULL,
    start_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    end_time TIMESTAMP WITH TIME ZONE,
    status VARCHAR(50) NOT NULL,
    records_processed INTEGER DEFAULT 0,
    records_successful INTEGER DEFAULT 0,
    records_failed INTEGER DEFAULT 0,
    errors JSONB,
    performance_metrics JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create performance monitoring view
CREATE OR REPLACE VIEW migration_performance_summary AS
SELECT
    mc.script_name,
    mc.operation_type,
    COUNT(*) as total_runs,
    AVG(mc.records_processed) as avg_records_processed,
    AVG(EXTRACT(EPOCH FROM (mc.end_time - mc.start_time))) as avg_duration_seconds,
    AVG(CASE WHEN mc.records_processed > 0
         THEN mc.records_successful::DECIMAL / mc.records_processed
         ELSE 0 END) as avg_success_rate,
    MAX(mc.end_time) as last_execution,
    SUM(mc.records_successful) as total_records_migrated
FROM migration_control mc
WHERE mc.status = 'completed'
GROUP BY mc.script_name, mc.operation_type;

-- Create coverage monitoring view
CREATE OR REPLACE VIEW migration_coverage_overview AS
SELECT
    mm.entity_type,
    COUNT(DISTINCT mm.id) as total_mappings,
    COUNT(DISTINCT mm.legacy_id) as unique_legacy_ids,
    COUNT(DISTINCT mm.modern_id) as unique_modern_ids,
    MAX(mm.migrated_at) as last_migration_date,
    COUNT(DISTINCT mm.migration_batch) as migration_batches
FROM migration_mappings mm
GROUP BY mm.entity_type
ORDER BY total_mappings DESC;

-- Create data quality monitoring view
CREATE OR REPLACE VIEW data_quality_summary AS
SELECT
    dd.source_table,
    dd.target_table,
    dd.comparison_date,
    dd.source_count,
    dd.target_count,
    dd.missing_in_target,
    dd.extra_in_target,
    CASE
        WHEN dd.source_count = dd.target_count AND dd.missing_in_target = 0 AND dd.extra_in_target = 0
        THEN 'perfect'
        WHEN dd.missing_in_target = 0 AND dd.extra_in_target = 0
        THEN 'consistent'
        WHEN dd.missing_in_target > 0 OR dd.extra_in_target > 0
        THEN 'inconsistent'
        ELSE 'unknown'
    END as data_quality_status,
    CASE
        WHEN dd.source_count > 0
        THEN ROUND((dd.target_count::DECIMAL / dd.source_count * 100), 2)
        ELSE 0
    END as migration_percentage
FROM data_differentials dd
ORDER BY dd.comparison_date DESC;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_migration_control_time_range
    ON migration_control (start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_migration_mappings_migrated_at
    ON migration_mappings (migrated_at);
CREATE INDEX IF NOT EXISTS idx_data_differentials_comparison_date
    ON data_differentials (comparison_date);
CREATE INDEX IF NOT EXISTS idx_sync_run_history_job_run
    ON sync_run_history (job_id, run_number);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers
CREATE TRIGGER update_migration_mappings_updated_at
    BEFORE UPDATE ON migration_mappings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_migration_control_updated_at
    BEFORE UPDATE ON migration_control
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_synchronization_jobs_updated_at
    BEFORE UPDATE ON synchronization_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert initial data for testing (optional)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM migration_control LIMIT 1) THEN
        INSERT INTO migration_control (script_name, operation_type, status, records_processed, records_successful)
        VALUES
            ('migrate-offices', 'migrate', 'completed', 150, 150),
            ('migrate-profiles', 'migrate', 'completed', 320, 318),
            ('migrate-doctors', 'migrate', 'completed', 85, 85),
            ('migrate-patients', 'migrate', 'in_progress', 12000, 11800),
            ('migrate-orders', 'migrate', 'pending', 0, 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM migration_mappings LIMIT 1) THEN
        INSERT INTO migration_mappings (entity_type, legacy_id, modern_id, migration_batch)
        VALUES
            ('office', 1, uuid_generate_v4(), 'batch_001'),
            ('office', 2, uuid_generate_v4(), 'batch_001'),
            ('profile', 100, uuid_generate_v4(), 'batch_002'),
            ('profile', 101, uuid_generate_v4(), 'batch_002');
    END IF;
END
$$;

-- Create function to clean old data (for maintenance)
CREATE OR REPLACE FUNCTION cleanup_old_migration_data(days_to_keep INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER := 0;
BEGIN
    -- Clean old migration control records
    DELETE FROM migration_control
    WHERE created_at < NOW() - INTERVAL '1 day' * days_to_keep
    AND status IN ('completed', 'failed');

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    -- Clean old validation reports
    DELETE FROM migration_validation_reports
    WHERE created_at < NOW() - INTERVAL '1 day' * days_to_keep;

    -- Clean old sync run history (keep recent runs)
    DELETE FROM sync_run_history
    WHERE created_at < NOW() - INTERVAL '1 day' * days_to_keep
    AND status = 'completed';

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions (adjust user as needed)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO postgres;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO postgres;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO postgres;

-- Create monitoring user (read-only for dashboards)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_monitor') THEN
        CREATE ROLE migration_monitor WITH LOGIN PASSWORD 'monitor_password_here';
        GRANT CONNECT ON DATABASE migration_coverage TO migration_monitor;
        GRANT USAGE ON SCHEMA public TO migration_monitor;
        GRANT SELECT ON ALL TABLES IN SCHEMA public TO migration_monitor;
        GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO migration_monitor;
    END IF;
END
$$;