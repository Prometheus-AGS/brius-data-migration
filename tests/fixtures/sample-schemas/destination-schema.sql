-- Sample Destination Database Schema for Testing
-- Simulates the modern Supabase/PostgreSQL database structure with UUIDs

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Sample offices table (modern structure)
CREATE TABLE IF NOT EXISTS offices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    legacy_office_id INTEGER UNIQUE,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    phone VARCHAR(50),
    email VARCHAR(255),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Sample doctors table (modern structure)
CREATE TABLE IF NOT EXISTS doctors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    legacy_doctor_id INTEGER UNIQUE,
    office_id UUID REFERENCES offices(id),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Sample patients table (modern structure)
CREATE TABLE IF NOT EXISTS patients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    legacy_patient_id INTEGER UNIQUE,
    doctor_id UUID REFERENCES doctors(id),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    date_of_birth DATE,
    email VARCHAR(255),
    phone VARCHAR(50),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Sample migration control table (existing structure)
CREATE TABLE IF NOT EXISTS migration_control (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id VARCHAR(255) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    batch_number INTEGER NOT NULL,
    records_processed INTEGER NOT NULL DEFAULT 0,
    records_successful INTEGER NOT NULL DEFAULT 0,
    records_failed INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(50) DEFAULT 'running',
    error_details JSONB DEFAULT '{}',
    performance_metrics JSONB DEFAULT '{}'
);

-- Sample migration mappings table (existing structure)
CREATE TABLE IF NOT EXISTS migration_mappings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    legacy_id VARCHAR(255) NOT NULL,
    legacy_table VARCHAR(100) NOT NULL,
    target_id UUID NOT NULL,
    target_table VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    mapping_data JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (legacy_id, legacy_table, target_table)
);

-- Insert some sample migrated data for testing
INSERT INTO offices (legacy_office_id, name, address, phone, email) VALUES
(1, 'Test Office 1', '123 Main St', '555-0001', 'office1@test.com'),
(2, 'Test Office 2', '456 Oak Ave', '555-0002', 'office2@test.com')
ON CONFLICT (legacy_office_id) DO NOTHING;

-- Get the office UUIDs for reference
DO $$
DECLARE
    office1_uuid UUID;
    office2_uuid UUID;
    doctor1_uuid UUID;
    doctor2_uuid UUID;
BEGIN
    SELECT id INTO office1_uuid FROM offices WHERE legacy_office_id = 1;
    SELECT id INTO office2_uuid FROM offices WHERE legacy_office_id = 2;

    INSERT INTO doctors (legacy_doctor_id, office_id, first_name, last_name, email, phone) VALUES
    (1, office1_uuid, 'John', 'Smith', 'john.smith@test.com', '555-1001'),
    (2, office1_uuid, 'Jane', 'Doe', 'jane.doe@test.com', '555-1002'),
    (3, office2_uuid, 'Bob', 'Johnson', 'bob.johnson@test.com', '555-1003')
    ON CONFLICT (legacy_doctor_id) DO NOTHING;

    SELECT id INTO doctor1_uuid FROM doctors WHERE legacy_doctor_id = 1;
    SELECT id INTO doctor2_uuid FROM doctors WHERE legacy_doctor_id = 2;

    INSERT INTO patients (legacy_patient_id, doctor_id, first_name, last_name, date_of_birth, email, phone) VALUES
    (1, doctor1_uuid, 'Test', 'Patient1', '1990-01-01', 'patient1@test.com', '555-2001'),
    (2, doctor1_uuid, 'Test', 'Patient2', '1985-05-15', 'patient2@test.com', '555-2002'),
    (3, doctor2_uuid, 'Test', 'Patient3', '1992-12-25', 'patient3@test.com', '555-2003')
    ON CONFLICT (legacy_patient_id) DO NOTHING;
END $$;