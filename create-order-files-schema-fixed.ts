import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'http://localhost:8000', 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
);

async function createOrderFilesSchemaFixed() {
  console.log('Creating order_files table schema (fixed)...');
  
  try {
    // Create the table with VARCHAR category instead of enum to avoid complications
    const createTableSQL = `
      DROP TABLE IF EXISTS order_files;
      
      CREATE TABLE order_files (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        
        -- File categorization and metadata
        category VARCHAR(50) DEFAULT 'other',
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
        CONSTRAINT unique_order_file UNIQUE (order_id, file_id),
        
        -- Category constraint
        CONSTRAINT valid_category CHECK (category IN (
          'scan', 'image', 'document', 'package', 'model', 
          'simulation', 'analysis', 'final_package', 'other'
        ))
      );
    `;
    
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
      CREATE INDEX idx_order_files_order ON order_files(order_id);
      CREATE INDEX idx_order_files_file ON order_files(file_id);
      CREATE INDEX idx_order_files_category ON order_files(category);
      CREATE INDEX idx_order_files_type ON order_files(file_type);
      CREATE INDEX idx_order_files_legacy_file ON order_files(legacy_file_id);
      CREATE INDEX idx_order_files_legacy_instruction ON order_files(legacy_instruction_id);
      CREATE INDEX idx_order_files_uploaded ON order_files(uploaded_at);
      CREATE INDEX idx_order_files_created ON order_files(created_at);
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
    
  } catch (error) {
    console.error('Error creating order_files schema:', error);
  }
}

createOrderFilesSchemaFixed().catch(console.error);
