-- Add missing columns to technicians table for completeness
-- This provides proper separation between profiles and technician-specific data

-- Create employment status enum if it doesn't exist
DO $$ BEGIN
    CREATE TYPE employment_status AS ENUM ('active', 'inactive', 'terminated', 'on_leave');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add missing columns to technicians table
ALTER TABLE technicians
ADD COLUMN IF NOT EXISTS employee_id VARCHAR(50),
ADD COLUMN IF NOT EXISTS status employment_status DEFAULT 'active',
ADD COLUMN IF NOT EXISTS legacy_technician_id INTEGER;

-- Add useful indexes
CREATE INDEX IF NOT EXISTS idx_technicians_employee_id ON technicians(employee_id);
CREATE INDEX IF NOT EXISTS idx_technicians_status ON technicians(status);
CREATE INDEX IF NOT EXISTS idx_technicians_legacy_technician_id ON technicians(legacy_technician_id);

-- Add unique constraints
ALTER TABLE technicians
ADD CONSTRAINT IF NOT EXISTS technicians_employee_id_key UNIQUE (employee_id),
ADD CONSTRAINT IF NOT EXISTS technicians_legacy_technician_id_key UNIQUE (legacy_technician_id);

-- Update existing records to have proper status
UPDATE technicians
SET status = CASE
    WHEN is_active = true THEN 'active'::employment_status
    ELSE 'inactive'::employment_status
END
WHERE status IS NULL;

-- Show updated schema
\d technicians;