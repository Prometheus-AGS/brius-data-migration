-- Sample Source Database Schema for Testing
-- Simulates the legacy PostgreSQL database structure

-- Sample dispatch_office table
CREATE TABLE IF NOT EXISTS dispatch_office (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    phone VARCHAR(50),
    email VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sample dispatch_doctor table
CREATE TABLE IF NOT EXISTS dispatch_doctor (
    id SERIAL PRIMARY KEY,
    office_id INTEGER REFERENCES dispatch_office(id),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sample dispatch_patient table
CREATE TABLE IF NOT EXISTS dispatch_patient (
    id SERIAL PRIMARY KEY,
    doctor_id INTEGER REFERENCES dispatch_doctor(id),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    date_of_birth DATE,
    email VARCHAR(255),
    phone VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert sample test data
INSERT INTO dispatch_office (name, address, phone, email) VALUES
('Test Office 1', '123 Main St', '555-0001', 'office1@test.com'),
('Test Office 2', '456 Oak Ave', '555-0002', 'office2@test.com'),
('Test Office 3', '789 Pine St', '555-0003', 'office3@test.com')
ON CONFLICT DO NOTHING;

INSERT INTO dispatch_doctor (office_id, first_name, last_name, email, phone) VALUES
(1, 'John', 'Smith', 'john.smith@test.com', '555-1001'),
(1, 'Jane', 'Doe', 'jane.doe@test.com', '555-1002'),
(2, 'Bob', 'Johnson', 'bob.johnson@test.com', '555-1003'),
(3, 'Alice', 'Williams', 'alice.williams@test.com', '555-1004')
ON CONFLICT DO NOTHING;

INSERT INTO dispatch_patient (doctor_id, first_name, last_name, date_of_birth, email, phone) VALUES
(1, 'Test', 'Patient1', '1990-01-01', 'patient1@test.com', '555-2001'),
(1, 'Test', 'Patient2', '1985-05-15', 'patient2@test.com', '555-2002'),
(2, 'Test', 'Patient3', '1992-12-25', 'patient3@test.com', '555-2003'),
(2, 'Test', 'Patient4', '1988-07-10', 'patient4@test.com', '555-2004'),
(3, 'Test', 'Patient5', '1995-03-20', 'patient5@test.com', '555-2005')
ON CONFLICT DO NOTHING;