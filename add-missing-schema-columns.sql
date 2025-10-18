-- Add missing columns to target tables for successful migration
-- Based on identified schema mismatches

-- 1. OPERATIONS table - Add missing columns
ALTER TABLE operations
ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'completed',
ADD COLUMN IF NOT EXISTS legacy_operation_id INTEGER,
ADD COLUMN IF NOT EXISTS amount DECIMAL(10,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS operation_data JSONB DEFAULT '{}';

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_operations_legacy_id ON operations(legacy_operation_id);
CREATE INDEX IF NOT EXISTS idx_operations_status ON operations(status);

-- 2. PAYMENTS table - Add missing columns
ALTER TABLE payments
ADD COLUMN IF NOT EXISTS payment_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS legacy_doctor_id INTEGER,
ADD COLUMN IF NOT EXISTS legacy_office_id INTEGER,
ADD COLUMN IF NOT EXISTS legacy_payment_id INTEGER,
ADD COLUMN IF NOT EXISTS legacy_instruction_id INTEGER,
ADD COLUMN IF NOT EXISTS subtotal_amount DECIMAL(10,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(10,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS transaction_reference VARCHAR(255);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_payments_legacy_id ON payments(legacy_payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_legacy_doctor ON payments(legacy_doctor_id);
CREATE INDEX IF NOT EXISTS idx_payments_payment_date ON payments(payment_date);

-- 3. GLOBAL_SETTINGS table - Add missing columns
ALTER TABLE global_settings
ADD COLUMN IF NOT EXISTS legacy_setting_id INTEGER,
ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT 'system';

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_global_settings_legacy_id ON global_settings(legacy_setting_id);

-- 4. ROLE_PERMISSIONS table - Add missing columns
ALTER TABLE role_permissions
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS legacy_role_id INTEGER,
ADD COLUMN IF NOT EXISTS legacy_permission_id INTEGER,
ADD COLUMN IF NOT EXISTS legacy_junction_id INTEGER;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_role_permissions_legacy_role ON role_permissions(legacy_role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_active ON role_permissions(is_active);

-- 5. TEMPLATE_EDIT_ROLES table - Add missing columns
ALTER TABLE template_edit_roles
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS legacy_junction_id INTEGER,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_template_edit_roles_legacy_id ON template_edit_roles(legacy_junction_id);
CREATE INDEX IF NOT EXISTS idx_template_edit_roles_active ON template_edit_roles(is_active);

-- 6. TEMPLATE_VIEW_GROUPS table - Add missing columns
ALTER TABLE template_view_groups
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS legacy_junction_id INTEGER,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_template_view_groups_legacy_id ON template_view_groups(legacy_junction_id);
CREATE INDEX IF NOT EXISTS idx_template_view_groups_active ON template_view_groups(is_active);

-- 7. TEMPLATE_PRODUCTS table - Add missing columns
ALTER TABLE template_products
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS legacy_junction_id INTEGER,
ADD COLUMN IF NOT EXISTS product_price DECIMAL(10,2) DEFAULT 0.00;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_template_products_legacy_id ON template_products(legacy_junction_id);

-- 8. ORDER_CASES table - Add missing columns
ALTER TABLE order_cases
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS relationship_type VARCHAR(50) DEFAULT 'primary',
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_order_cases_relationship ON order_cases(relationship_type);
CREATE INDEX IF NOT EXISTS idx_order_cases_active ON order_cases(is_active);

-- 9. TEAMS table - Verify schema (this one worked, so just add helpful columns)
ALTER TABLE teams
ADD COLUMN IF NOT EXISTS legacy_group_id INTEGER,
ADD COLUMN IF NOT EXISTS team_type VARCHAR(50) DEFAULT 'operational';

-- Add index
CREATE INDEX IF NOT EXISTS idx_teams_legacy_id ON teams(legacy_group_id);

-- Display updated schemas
SELECT 'Schema modifications completed for migration compatibility' as status;

-- Show column counts for each modified table
SELECT
  'operations' as table_name,
  COUNT(*) as column_count
FROM information_schema.columns
WHERE table_name = 'operations' AND table_schema = 'public'

UNION ALL

SELECT
  'payments' as table_name,
  COUNT(*) as column_count
FROM information_schema.columns
WHERE table_name = 'payments' AND table_schema = 'public'

UNION ALL

SELECT
  'global_settings' as table_name,
  COUNT(*) as column_count
FROM information_schema.columns
WHERE table_name = 'global_settings' AND table_schema = 'public'

ORDER BY table_name;