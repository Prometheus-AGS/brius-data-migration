import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function createBracketsSchema() {
  console.log('🏗️  Creating proper brackets table schema...\n');
  
  // Drop existing table if it exists (to start fresh)
  console.log('📋 Step 1: Dropping existing brackets table if it exists...');
  
  const dropTableSQL = `
    DROP TABLE IF EXISTS brackets CASCADE;
  `;
  
  const { error: dropError } = await supabase.rpc('exec_sql', { sql: dropTableSQL });
  
  if (dropError) {
    console.error('Error dropping table:', dropError);
  } else {
    console.log('✅ Existing brackets table dropped (if it existed)');
  }
  
  // Create new brackets table with proper structure
  console.log('\n📋 Step 2: Creating new brackets table with proper schema...');
  
  const createTableSQL = `
    -- Create brackets table for orthodontic bracket catalog
    CREATE TABLE brackets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      
      -- Core bracket information
      name VARCHAR(255) NOT NULL,
      bracket_type VARCHAR(100) NOT NULL DEFAULT 'standard',
      description TEXT,
      
      -- Technical specifications
      material VARCHAR(100), -- e.g., 'ceramic', 'metal', 'composite'
      slot_size DECIMAL(4,3), -- e.g., 0.022, 0.018 (in inches)
      torque INTEGER, -- torque value in degrees
      angulation INTEGER, -- angulation in degrees
      prescription VARCHAR(50), -- e.g., 'Roth', 'MBT', 'Andrews'
      
      -- Physical properties
      base_shape VARCHAR(50), -- e.g., 'square', 'round', 'anatomical'
      height_mm DECIMAL(5,2), -- height in millimeters
      width_mm DECIMAL(5,2), -- width in millimeters
      thickness_mm DECIMAL(5,2), -- thickness in millimeters
      
      -- Clinical information
      tooth_position VARCHAR(20), -- e.g., 'central', 'lateral', 'canine', 'premolar', 'molar'
      arch_type VARCHAR(10), -- 'upper', 'lower', 'both'
      
      -- Business information
      manufacturer VARCHAR(100),
      model_number VARCHAR(100),
      sku VARCHAR(100),
      unit_cost DECIMAL(10,2),
      active BOOLEAN DEFAULT true,
      
      -- Legacy data preservation
      legacy_bracket_id INTEGER,
      legacy_project_id INTEGER,
      
      -- Audit fields
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      created_by UUID, -- References profiles(id)
      
      -- Metadata
      metadata JSONB DEFAULT '{}'::jsonb
    );
    
    -- Create indexes for performance
    CREATE INDEX idx_brackets_name ON brackets(name);
    CREATE INDEX idx_brackets_type ON brackets(bracket_type);
    CREATE INDEX idx_brackets_material ON brackets(material);
    CREATE INDEX idx_brackets_prescription ON brackets(prescription);
    CREATE INDEX idx_brackets_tooth_position ON brackets(tooth_position);
    CREATE INDEX idx_brackets_arch_type ON brackets(arch_type);
    CREATE INDEX idx_brackets_active ON brackets(active);
    CREATE INDEX idx_brackets_legacy_id ON brackets(legacy_bracket_id);
    CREATE INDEX idx_brackets_manufacturer ON brackets(manufacturer);
    CREATE INDEX idx_brackets_created_at ON brackets(created_at);
    
    -- Composite indexes for common queries
    CREATE INDEX idx_brackets_type_arch ON brackets(bracket_type, arch_type);
    CREATE INDEX idx_brackets_tooth_prescription ON brackets(tooth_position, prescription);
    CREATE INDEX idx_brackets_material_active ON brackets(material, active);
    
    -- Add RLS policy
    ALTER TABLE brackets ENABLE ROW LEVEL SECURITY;
    
    -- Add update trigger for updated_at
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
    END;
    $$ language 'plpgsql';
    
    CREATE TRIGGER update_brackets_updated_at 
        BEFORE UPDATE ON brackets 
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    
    -- Add constraints
    ALTER TABLE brackets ADD CONSTRAINT brackets_name_not_empty 
      CHECK (LENGTH(TRIM(name)) > 0);
    
    ALTER TABLE brackets ADD CONSTRAINT brackets_slot_size_valid 
      CHECK (slot_size IS NULL OR (slot_size > 0 AND slot_size < 1));
    
    ALTER TABLE brackets ADD CONSTRAINT brackets_arch_type_valid 
      CHECK (arch_type IS NULL OR arch_type IN ('upper', 'lower', 'both'));
    
    -- Add some helpful comments
    COMMENT ON TABLE brackets IS 'Catalog of orthodontic brackets and appliances';
    COMMENT ON COLUMN brackets.slot_size IS 'Bracket slot size in inches (e.g., 0.022)';
    COMMENT ON COLUMN brackets.torque IS 'Built-in torque value in degrees';
    COMMENT ON COLUMN brackets.angulation IS 'Built-in angulation in degrees';
    COMMENT ON COLUMN brackets.legacy_bracket_id IS 'Original ID from dispatch_bracket table';
  `;
  
  const { error: createError } = await supabase.rpc('exec_sql', { sql: createTableSQL });
  
  if (createError) {
    console.error('❌ Error creating brackets table:', createError);
    return;
  }
  
  console.log('✅ brackets table created successfully with comprehensive schema');
  
  // Test the new schema by inserting a sample record
  console.log('\n📋 Step 3: Testing schema with sample record...');
  
  const sampleBracket = {
    name: 'Test SPEED Bracket',
    bracket_type: 'self-ligating',
    description: 'Test bracket for schema validation',
    material: 'metal',
    slot_size: 0.022,
    torque: 17,
    angulation: 5,
    prescription: 'MBT',
    base_shape: 'square',
    tooth_position: 'canine',
    arch_type: 'both',
    manufacturer: 'Test Manufacturer',
    model_number: 'TEST-001',
    legacy_bracket_id: 999999,
    legacy_project_id: 999999,
    metadata: {
      test_record: true,
      migration_schema_test: true
    }
  };
  
  const { data: testInsert, error: testError } = await supabase
    .from('brackets')
    .insert(sampleBracket)
    .select();
    
  if (testError) {
    console.error('❌ Error testing schema:', testError);
  } else {
    console.log('✅ Schema test successful!');
    console.log('Sample record inserted:', testInsert[0]);
    
    // Clean up test record
    if (testInsert[0]?.id) {
      await supabase
        .from('brackets')
        .delete()
        .eq('id', testInsert[0].id);
      console.log('✅ Test record cleaned up');
    }
  }
  
  // Verify final table structure
  console.log('\n📋 Step 4: Verifying final table structure...');
  
  const { count: finalCount } = await supabase
    .from('brackets')
    .select('*', { count: 'exact', head: true });
    
  console.log(`Final brackets table record count: ${finalCount}`);
  
  console.log('\n🎉 brackets table schema setup complete!');
  console.log('\n📝 Schema Summary:');
  console.log('- ✅ Primary key: id (UUID)');
  console.log('- ✅ Core fields: name, bracket_type, description');
  console.log('- ✅ Technical specs: material, slot_size, torque, angulation');
  console.log('- ✅ Clinical info: tooth_position, arch_type, prescription');
  console.log('- ✅ Business data: manufacturer, model_number, unit_cost');
  console.log('- ✅ Legacy mapping: legacy_bracket_id, legacy_project_id');
  console.log('- ✅ Audit trail: created_at, updated_at, created_by');
  console.log('- ✅ Flexible metadata: JSON field for additional properties');
  console.log('- ✅ Performance: 12 indexes for common queries');
  console.log('- ✅ Data integrity: Constraints and validation rules');
}

createBracketsSchema().catch(console.error);
