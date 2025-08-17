-- Create treatment_plans table for storing treatment plan specific data
-- This table has a 1:1 relationship with projects where project_type = 'treatment_plan'

CREATE TABLE IF NOT EXISTS treatment_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
    order_id UUID REFERENCES orders(id),
    patient_id UUID REFERENCES profiles(id),
    doctor_id UUID REFERENCES profiles(id),
    
    -- Treatment plan specific fields
    plan_number INTEGER,
    plan_name VARCHAR(100),
    plan_notes TEXT,
    is_original BOOLEAN DEFAULT false,
    
    -- Treatment metadata
    treatment_type VARCHAR(50),
    revision_count INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    
    -- Legacy references for migration
    legacy_plan_id INTEGER UNIQUE,
    legacy_instruction_id INTEGER,
    
    -- Additional metadata
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_treatment_plans_project_id ON treatment_plans(project_id);
CREATE INDEX IF NOT EXISTS idx_treatment_plans_order_id ON treatment_plans(order_id);
CREATE INDEX IF NOT EXISTS idx_treatment_plans_patient_id ON treatment_plans(patient_id);
CREATE INDEX IF NOT EXISTS idx_treatment_plans_doctor_id ON treatment_plans(doctor_id);
CREATE INDEX IF NOT EXISTS idx_treatment_plans_legacy_plan_id ON treatment_plans(legacy_plan_id);
CREATE INDEX IF NOT EXISTS idx_treatment_plans_legacy_instruction_id ON treatment_plans(legacy_instruction_id);
CREATE INDEX IF NOT EXISTS idx_treatment_plans_is_original ON treatment_plans(is_original);

-- Add comments for documentation
COMMENT ON TABLE treatment_plans IS 'Treatment plan specific data linked to projects table';
COMMENT ON COLUMN treatment_plans.project_id IS 'Foreign key to projects table (1:1 relationship)';
COMMENT ON COLUMN treatment_plans.order_id IS 'Foreign key to orders table for treatment plan context';
COMMENT ON COLUMN treatment_plans.legacy_plan_id IS 'Original dispatch_plan.id for migration tracking';
COMMENT ON COLUMN treatment_plans.legacy_instruction_id IS 'Original dispatch_plan.instruction_id for migration tracking';
