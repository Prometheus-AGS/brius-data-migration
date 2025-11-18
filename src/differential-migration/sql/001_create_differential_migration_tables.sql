-- =================================================================
-- DIFFERENTIAL DATABASE MIGRATION SYSTEM - TABLE CREATION
-- =================================================================
-- Creates core tables for differential migration functionality
-- Version: 1.0.0
-- Date: 2025-10-26

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =================================================================
-- MIGRATION CHECKPOINTS TABLE
-- =================================================================
-- Stores resumable state information for interrupted migration operations
CREATE TABLE IF NOT EXISTS migration_checkpoints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type VARCHAR(100) NOT NULL,
    migration_run_id VARCHAR(255) NOT NULL,
    last_processed_id VARCHAR(255),
    batch_position INTEGER NOT NULL DEFAULT 0,
    records_processed INTEGER NOT NULL DEFAULT 0,
    records_remaining INTEGER NOT NULL DEFAULT 0,
    checkpoint_data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT chk_records_processed_non_negative CHECK (records_processed >= 0),
    CONSTRAINT chk_records_remaining_non_negative CHECK (records_remaining >= 0),
    CONSTRAINT chk_batch_position_non_negative CHECK (batch_position >= 0),
    CONSTRAINT chk_entity_type_valid CHECK (entity_type IN (
        'offices', 'doctors', 'doctor_offices', 'patients', 'orders',
        'cases', 'files', 'case_files', 'messages', 'message_files',
        'jaw', 'dispatch_records', 'system_messages', 'message_attachments',
        'technician_roles', 'order_cases', 'purchases', 'treatment_discussions',
        'template_view_groups', 'template_view_roles'
    ))
);

-- =================================================================
-- DIFFERENTIAL ANALYSIS RESULTS TABLE
-- =================================================================
-- Contains lists of new, modified, and deleted records identified for migration
CREATE TABLE IF NOT EXISTS differential_analysis_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type VARCHAR(100) NOT NULL,
    analysis_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    source_record_count INTEGER NOT NULL DEFAULT 0,
    destination_record_count INTEGER NOT NULL DEFAULT 0,
    new_records JSONB NOT NULL DEFAULT '[]',
    modified_records JSONB NOT NULL DEFAULT '[]',
    deleted_records JSONB NOT NULL DEFAULT '[]',
    last_migration_timestamp TIMESTAMP WITH TIME ZONE,
    analysis_metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT chk_source_record_count_non_negative CHECK (source_record_count >= 0),
    CONSTRAINT chk_destination_record_count_non_negative CHECK (destination_record_count >= 0),
    CONSTRAINT chk_analysis_timestamp_reasonable CHECK (analysis_timestamp <= CURRENT_TIMESTAMP + INTERVAL '1 hour'),
    CONSTRAINT chk_entity_type_valid_analysis CHECK (entity_type IN (
        'offices', 'doctors', 'doctor_offices', 'patients', 'orders',
        'cases', 'files', 'case_files', 'messages', 'message_files',
        'jaw', 'dispatch_records', 'system_messages', 'message_attachments',
        'technician_roles', 'order_cases', 'purchases', 'treatment_discussions',
        'template_view_groups', 'template_view_roles'
    ))
);

-- =================================================================
-- MIGRATION STATUS TRACKING TABLE
-- =================================================================
-- Tracks overall migration execution status across all entities
CREATE TABLE IF NOT EXISTS migration_status_tracking (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    migration_session_id UUID NOT NULL DEFAULT uuid_generate_v4(),
    overall_status VARCHAR(50) NOT NULL DEFAULT 'pending',
    entities_pending JSONB NOT NULL DEFAULT '[]',
    entities_running JSONB NOT NULL DEFAULT '[]',
    entities_completed JSONB NOT NULL DEFAULT '[]',
    entities_failed JSONB NOT NULL DEFAULT '[]',
    total_records_processed INTEGER NOT NULL DEFAULT 0,
    total_records_remaining INTEGER NOT NULL DEFAULT 0,
    estimated_completion TIMESTAMP WITH TIME ZONE,
    error_summary JSONB NOT NULL DEFAULT '{}',
    performance_metrics JSONB NOT NULL DEFAULT '{}',
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT chk_overall_status_valid CHECK (overall_status IN ('pending', 'running', 'paused', 'completed', 'failed')),
    CONSTRAINT chk_total_records_processed_non_negative CHECK (total_records_processed >= 0),
    CONSTRAINT chk_total_records_remaining_non_negative CHECK (total_records_remaining >= 0),
    CONSTRAINT chk_completed_after_started CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
);

-- =================================================================
-- SCHEMA MAPPING DEFINITIONS TABLE
-- =================================================================
-- Defines field transformations and relationships between source and destination schemas
CREATE TABLE IF NOT EXISTS schema_mapping_definitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type VARCHAR(100) NOT NULL,
    source_table VARCHAR(255) NOT NULL,
    destination_table VARCHAR(255) NOT NULL,
    field_mappings JSONB NOT NULL DEFAULT '[]',
    validation_rules JSONB NOT NULL DEFAULT '[]',
    transformation_functions JSONB NOT NULL DEFAULT '[]',
    version VARCHAR(50) NOT NULL DEFAULT '1.0.0',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT chk_entity_type_valid_mapping CHECK (entity_type IN (
        'offices', 'doctors', 'doctor_offices', 'patients', 'orders',
        'cases', 'files', 'case_files', 'messages', 'message_files',
        'jaw', 'dispatch_records', 'system_messages', 'message_attachments',
        'technician_roles', 'order_cases', 'purchases', 'treatment_discussions',
        'template_view_groups', 'template_view_roles'
    )),
    CONSTRAINT chk_version_format CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$')
);

-- =================================================================
-- MIGRATION EXECUTION LOGS TABLE
-- =================================================================
-- Detailed logs of all migration operations including errors, warnings, and performance metrics
CREATE TABLE IF NOT EXISTS migration_execution_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    migration_session_id UUID NOT NULL,
    entity_type VARCHAR(100),
    operation_type VARCHAR(100) NOT NULL,
    record_id VARCHAR(255),
    log_level VARCHAR(20) NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    error_details JSONB,
    performance_data JSONB,
    context_data JSONB NOT NULL DEFAULT '{}',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT chk_operation_type_valid CHECK (operation_type IN (
        'baseline_analysis', 'differential_detection', 'record_migration',
        'validation', 'checkpoint_save', 'checkpoint_restore'
    )),
    CONSTRAINT chk_log_level_valid CHECK (log_level IN ('error', 'warn', 'info', 'debug')),
    CONSTRAINT chk_timestamp_reasonable CHECK (timestamp <= CURRENT_TIMESTAMP + INTERVAL '1 hour')
);

-- =================================================================
-- UPDATE TRIGGERS
-- =================================================================
-- Automatically update updated_at timestamps

-- Function to update updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add triggers to all tables with updated_at column
CREATE TRIGGER update_migration_checkpoints_updated_at
    BEFORE UPDATE ON migration_checkpoints
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_differential_analysis_results_updated_at
    BEFORE UPDATE ON differential_analysis_results
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_migration_status_tracking_updated_at
    BEFORE UPDATE ON migration_status_tracking
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_schema_mapping_definitions_updated_at
    BEFORE UPDATE ON schema_mapping_definitions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =================================================================
-- INITIAL DATA
-- =================================================================

-- Insert default schema mappings for key entities
INSERT INTO schema_mapping_definitions (entity_type, source_table, destination_table, field_mappings, is_active) VALUES
('offices', 'dispatch_office', 'offices', '[
    {"source_field": "id", "destination_field": "legacy_office_id", "data_type": "integer", "is_required": true},
    {"source_field": "name", "destination_field": "name", "data_type": "string", "is_required": true},
    {"source_field": "address", "destination_field": "address", "data_type": "string", "is_required": false},
    {"source_field": "phone", "destination_field": "phone", "data_type": "string", "is_required": false},
    {"source_field": "email", "destination_field": "email", "data_type": "string", "is_required": false}
]', true),
('doctors', 'dispatch_doctor', 'doctors', '[
    {"source_field": "id", "destination_field": "legacy_doctor_id", "data_type": "integer", "is_required": true},
    {"source_field": "first_name", "destination_field": "first_name", "data_type": "string", "is_required": true},
    {"source_field": "last_name", "destination_field": "last_name", "data_type": "string", "is_required": true},
    {"source_field": "email", "destination_field": "email", "data_type": "string", "is_required": false},
    {"source_field": "phone", "destination_field": "phone", "data_type": "string", "is_required": false}
]', true),
('patients', 'dispatch_patient', 'patients', '[
    {"source_field": "id", "destination_field": "legacy_patient_id", "data_type": "integer", "is_required": true},
    {"source_field": "first_name", "destination_field": "first_name", "data_type": "string", "is_required": true},
    {"source_field": "last_name", "destination_field": "last_name", "data_type": "string", "is_required": true},
    {"source_field": "date_of_birth", "destination_field": "date_of_birth", "data_type": "date", "is_required": false},
    {"source_field": "email", "destination_field": "email", "data_type": "string", "is_required": false}
]', true)
ON CONFLICT DO NOTHING;

-- =================================================================
-- COMMENTS
-- =================================================================

COMMENT ON TABLE migration_checkpoints IS 'Stores resumable state information for interrupted migration operations';
COMMENT ON TABLE differential_analysis_results IS 'Contains lists of new, modified, and deleted records identified for migration';
COMMENT ON TABLE migration_status_tracking IS 'Tracks overall migration execution status across all entities';
COMMENT ON TABLE schema_mapping_definitions IS 'Defines field transformations and relationships between source and destination schemas';
COMMENT ON TABLE migration_execution_logs IS 'Detailed logs of all migration operations including errors, warnings, and performance metrics';

COMMENT ON COLUMN migration_checkpoints.checkpoint_data IS 'Serialized state data for resumption including batch position, processed IDs, etc.';
COMMENT ON COLUMN differential_analysis_results.new_records IS 'JSON array of source record IDs that are new since last migration';
COMMENT ON COLUMN differential_analysis_results.modified_records IS 'JSON array of source record IDs that have been modified';
COMMENT ON COLUMN differential_analysis_results.deleted_records IS 'JSON array of source record IDs that have been deleted';
COMMENT ON COLUMN migration_status_tracking.performance_metrics IS 'JSON object containing throughput, timing, and resource usage metrics';
COMMENT ON COLUMN schema_mapping_definitions.field_mappings IS 'JSON array of field mapping configurations with transformations';

-- =================================================================
-- SUCCESS MESSAGE
-- =================================================================

DO $$
BEGIN
    RAISE NOTICE 'SUCCESS: Differential migration tables created successfully';
    RAISE NOTICE 'Tables created: migration_checkpoints, differential_analysis_results, migration_status_tracking, schema_mapping_definitions, migration_execution_logs';
    RAISE NOTICE 'Triggers added: automated updated_at timestamp updates';
    RAISE NOTICE 'Default data: schema mappings for offices, doctors, patients';
END $$;