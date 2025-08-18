-- Technician Roles Migration Script
-- Maps dispatch_role records to technician_roles with proper type classification

-- Helper function to map role names to technician_type enum
CREATE OR REPLACE FUNCTION map_role_to_technician_type(role_name TEXT) 
RETURNS technician_type AS $$
BEGIN
  -- Map source role names to target enum values
  IF role_name ILIKE '%designing%' OR role_name ILIKE '%DT-%' THEN
    RETURN 'designing';
  ELSIF role_name ILIKE '%manufacturing%' OR role_name ILIKE '%MT-%' THEN  
    RETURN 'manufacturing';
  ELSIF role_name ILIKE '%sectioning%' OR role_name ILIKE '%ST%' OR role_name ILIKE '%IDB%' THEN
    RETURN 'sectioning';
  ELSIF role_name ILIKE '%remote%' OR role_name ILIKE '%RT%' OR role_name ILIKE '%DTR%' THEN
    RETURN 'remote';
  ELSIF role_name ILIKE '%supervisor%' OR role_name ILIKE '%master%' THEN
    RETURN 'master';
  ELSIF role_name ILIKE '%inspect%' OR role_name ILIKE '%quality%' THEN
    RETURN 'quality_control';
  ELSE
    -- Default for ambiguous cases
    RETURN 'manufacturing';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Get a sample technician ID for foreign key constraint
WITH sample_tech AS (
  SELECT id as tech_id FROM technicians LIMIT 1
),
source_roles AS (
  SELECT 
    id as legacy_role_id,
    name as role_name,
    abbrev as abbreviation
  FROM dblink(
    'host=test.brius.com port=5432 dbname=mdw_db user=mdw_ai password=xGXmckHY',
    'SELECT id, name, abbrev FROM dispatch_role WHERE group_id = 11'
  ) AS roles(id integer, name text, abbrev text)
)
INSERT INTO technician_roles (
  id,
  technician_id,
  role_type,
  role_name,
  abbreviation,
  is_active,
  assigned_at,
  legacy_role_id
)
SELECT 
  gen_random_uuid() as id,
  st.tech_id as technician_id,
  map_role_to_technician_type(sr.role_name) as role_type,
  sr.role_name,
  COALESCE(sr.abbreviation, LEFT(sr.role_name, 10)) as abbreviation,
  true as is_active,
  NOW() as assigned_at,
  sr.legacy_role_id
FROM source_roles sr
CROSS JOIN sample_tech st;

-- Create migration mappings
INSERT INTO migration_mappings (entity_type, legacy_id, new_id, migrated_at, migration_batch)
SELECT 
  'technician_roles',
  legacy_role_id,
  id,
  NOW(),
  'technician_roles_batch_1'
FROM technician_roles
WHERE legacy_role_id IS NOT NULL;

-- Clean up helper function
DROP FUNCTION map_role_to_technician_type(TEXT);
