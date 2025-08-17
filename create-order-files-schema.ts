import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'http://localhost:8000', 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
);

async function createOrderFilesSchema() {
  console.log('Creating order_files table schema...');
  
  // Create enum for file categories
  const createEnumSQL = `
    CREATE TYPE IF NOT EXISTS order_file_category AS ENUM (
      'scan',           -- STL, PLY scan files
      'image',          -- JPG, PNG images  
      'document',       -- PDF documents
      'package',        -- ZIP archives
      'model',          -- 3D model files
      'simulation',     -- Simulation files
      'analysis',       -- Analysis results
      'final_package',  -- Images of final packages/deliverables
      'other'           -- Other file types
    );
  `;
  
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS order_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      
      -- File categorization and metadata
      category order_file_category DEFAULT 'other',
      file_type INTEGER, -- Maps to dispatch_file.type
      status INTEGER DEFAULT 0, -- Maps to dispatch_file.status
      
      -- Additional metadata from source
      parameters JSONB DEFAULT '{}', -- From dispatch_file.parameters
      metadata JSONB DEFAULT '{}',   -- Additional metadata
      
      -- Relationships
      product_id INTEGER, -- Legacy product_id if any
      record_id INTEGER,  -- Legacy record_id if any
      
      -- Timestamps
      uploaded_at TIMESTAMP WITH TIME ZONE, -- From dispatch_file.created_at
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      
      -- Legacy tracking
      legacy_file_id INTEGER NOT NULL, -- dispatch_file.id
      legacy_instruction_id INTEGER NOT NULL, -- dispatch_file.instruction_id
      
      -- Ensure unique order-file combinations
      CONSTRAINT unique_order_file UNIQUE (order_id, file_id)
    );
  `;
  
  try {
    // Create enum first
    const enumResponse = await fetch('http://localhost:8000/rest/v1/rpc/exec_sql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
      },
      body: JSON.stringify({ sql: createEnumSQL })
    });
    
    const enumResult = await enumResponse.text();
    console.log('Create enum response:', enumResult);
    
    // Create table
    const tableResponse = await fetch('http://localhost:8000/rest/v1/rpc/exec_sql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
      },
      body: JSON.stringify({ sql: createTableSQL })
    });
    
    const tableResult = await tableResponse.text();
    console.log('Create table response:', tableResult);
    
    // Create indexes for performance
    const indexSQL = `
      CREATE INDEX IF NOT EXISTS idx_order_files_order ON order_files(order_id);
      CREATE INDEX IF NOT EXISTS idx_order_files_file ON order_files(file_id);
      CREATE INDEX IF NOT EXISTS idx_order_files_category ON order_files(category);
      CREATE INDEX IF NOT EXISTS idx_order_files_type ON order_files(file_type);
      CREATE INDEX IF NOT EXISTS idx_order_files_legacy_file ON order_files(legacy_file_id);
      CREATE INDEX IF NOT EXISTS idx_order_files_legacy_instruction ON order_files(legacy_instruction_id);
      CREATE INDEX IF NOT EXISTS idx_order_files_uploaded ON order_files(uploaded_at);
      CREATE INDEX IF NOT EXISTS idx_order_files_created ON order_files(created_at);
    `;
    
    const indexResponse = await fetch('http://localhost:8000/rest/v1/rpc/exec_sql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
      },
      body: JSON.stringify({ sql: indexSQL })
    });
    
    const indexResult = await indexResponse.text();
    console.log('Create indexes response:', indexResult);
    
    // Create trigger for updated_at
    const triggerSQL = `
      CREATE OR REPLACE FUNCTION update_order_files_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';
      
      DROP TRIGGER IF EXISTS trigger_order_files_updated_at ON order_files;
      CREATE TRIGGER trigger_order_files_updated_at
        BEFORE UPDATE ON order_files
        FOR EACH ROW EXECUTE FUNCTION update_order_files_updated_at();
    `;
    
    const triggerResponse = await fetch('http://localhost:8000/rest/v1/rpc/exec_sql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
      },
      body: JSON.stringify({ sql: triggerSQL })
    });
    
    const triggerResult = await triggerResponse.text();
    console.log('Create trigger response:', triggerResult);
    
    console.log('\n✅ order_files table schema creation completed!');
    
    // Verify table was created
    const { count, error } = await supabase
      .from('order_files')
      .select('*', { count: 'exact', head: true });
      
    if (error) {
      console.log('Error verifying table:', error.message);
    } else {
      console.log(`📋 Verified: order_files table exists with ${count || 0} records`);
    }
    
    // Create a helper function to categorize files by extension
    const categorizeFunctionSQL = `
      CREATE OR REPLACE FUNCTION categorize_order_file(file_name TEXT, file_type INTEGER)
      RETURNS order_file_category AS $$
      BEGIN
        -- Categorize by file extension and type
        CASE 
          WHEN LOWER(file_name) LIKE '%.stl' OR LOWER(file_name) LIKE '%.ply' THEN
            RETURN 'scan';
          WHEN LOWER(file_name) LIKE '%.jpg' OR LOWER(file_name) LIKE '%.jpeg' OR LOWER(file_name) LIKE '%.png' OR LOWER(file_name) LIKE '%.gif' THEN
            -- Check if it's a final package image
            IF file_name LIKE '%_full.jpg' OR file_name LIKE '%package%' OR file_name LIKE '%final%' THEN
              RETURN 'final_package';
            ELSE  
              RETURN 'image';
            END IF;
          WHEN LOWER(file_name) LIKE '%.pdf' THEN
            RETURN 'document';
          WHEN LOWER(file_name) LIKE '%.zip' OR LOWER(file_name) LIKE '%.rar' OR LOWER(file_name) LIKE '%.tar%' THEN
            RETURN 'package';
          WHEN file_type = 7 OR file_type = 6 THEN -- Based on sample data showing STL files with types 6,7
            RETURN 'scan';
          WHEN file_type = 8 THEN -- Based on sample showing images with type 8
            RETURN 'image';
          ELSE
            RETURN 'other';
        END CASE;
      END;
      $$ LANGUAGE plpgsql;
    `;
    
    const functionResponse = await fetch('http://localhost:8000/rest/v1/rpc/exec_sql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
      },
      body: JSON.stringify({ sql: categorizeFunctionSQL })
    });
    
    const functionResult = await functionResponse.text();
    console.log('Create categorization function response:', functionResult);
    
  } catch (error) {
    console.error('Error creating order_files schema:', error);
  }
}

createOrderFilesSchema().catch(console.error);
