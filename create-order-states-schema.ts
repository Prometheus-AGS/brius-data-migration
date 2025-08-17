import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'http://localhost:8000', 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
);

async function createOrderStatesSchema() {
  console.log('Creating order_states table schema...');
  
  try {
    // Create the order_states table
    const createTableSQL = `
      DROP TABLE IF EXISTS order_states;
      
      CREATE TABLE order_states (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        
        -- State information
        status_code INTEGER NOT NULL, -- Maps to dispatch_state.status
        status_name VARCHAR(100), -- Human-readable status name
        is_active BOOLEAN NOT NULL DEFAULT true, -- Maps to dispatch_state.on
        
        -- Actor/user who made the change
        changed_by UUID REFERENCES profiles(id), -- Maps to dispatch_state.actor_id
        
        -- Timestamps
        changed_at TIMESTAMP WITH TIME ZONE NOT NULL, -- Maps to dispatch_state.changed_at
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        
        -- Legacy tracking
        legacy_state_id INTEGER NOT NULL, -- dispatch_state.id
        legacy_instruction_id INTEGER NOT NULL, -- dispatch_state.instruction_id
        legacy_actor_id INTEGER, -- dispatch_state.actor_id
        
        -- Additional metadata
        metadata JSONB DEFAULT '{}', -- For extensible state data
        notes TEXT -- For any additional state change notes
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
      CREATE INDEX idx_order_states_order ON order_states(order_id);
      CREATE INDEX idx_order_states_status ON order_states(status_code);
      CREATE INDEX idx_order_states_active ON order_states(is_active);
      CREATE INDEX idx_order_states_changed_by ON order_states(changed_by);
      CREATE INDEX idx_order_states_changed_at ON order_states(changed_at);
      CREATE INDEX idx_order_states_legacy_state ON order_states(legacy_state_id);
      CREATE INDEX idx_order_states_legacy_instruction ON order_states(legacy_instruction_id);
      CREATE INDEX idx_order_states_created ON order_states(created_at);
      
      -- Composite indexes for common queries
      CREATE INDEX idx_order_states_order_status ON order_states(order_id, status_code);
      CREATE INDEX idx_order_states_order_changed ON order_states(order_id, changed_at);
      CREATE INDEX idx_order_states_status_active ON order_states(status_code, is_active);
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
      CREATE OR REPLACE FUNCTION update_order_states_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';
      
      CREATE TRIGGER trigger_order_states_updated_at
        BEFORE UPDATE ON order_states
        FOR EACH ROW EXECUTE FUNCTION update_order_states_updated_at();
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
    
    // Create helper function to get human-readable status names
    const statusMappingSQL = `
      CREATE OR REPLACE FUNCTION get_status_name(status_code INTEGER)
      RETURNS VARCHAR(100) AS $$
      BEGIN
        CASE status_code
          WHEN 11 THEN RETURN 'review_approval';
          WHEN 12 THEN RETURN 'processing';
          ELSE RETURN 'unknown_' || status_code::VARCHAR;
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
      body: JSON.stringify({ sql: statusMappingSQL })
    });
    
    const functionResult = await functionResponse.text();
    console.log('Create status mapping function response:', functionResult);
    
    console.log('\n✅ order_states table schema creation completed!');
    
    // Verify table was created
    const { count, error } = await supabase
      .from('order_states')
      .select('*', { count: 'exact', head: true });
      
    if (error) {
      console.log('Error verifying table:', error.message);
    } else {
      console.log(`📋 Verified: order_states table exists with ${count || 0} records`);
    }
    
    // Create view for current order states (most recent state per order)
    const viewSQL = `
      CREATE OR REPLACE VIEW current_order_states AS
      SELECT DISTINCT ON (order_id)
        order_id,
        status_code,
        status_name,
        is_active,
        changed_by,
        changed_at,
        legacy_instruction_id
      FROM order_states
      ORDER BY order_id, changed_at DESC;
    `;
    
    const viewResponse = await fetch('http://localhost:8000/rest/v1/rpc/exec_sql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
      },
      body: JSON.stringify({ sql: viewSQL })
    });
    
    const viewResult = await viewResponse.text();
    console.log('Create current_order_states view response:', viewResult);
    
  } catch (error) {
    console.error('Error creating order_states schema:', error);
  }
}

createOrderStatesSchema().catch(console.error);
