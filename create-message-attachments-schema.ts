import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'http://localhost:8000', 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
);

async function createMessageAttachmentsSchema() {
  console.log('Creating message_attachments table schema...');
  
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS message_attachments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      attachment_type VARCHAR(50) DEFAULT 'file',
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      
      -- Legacy tracking fields
      legacy_attachment_id INTEGER, -- For dispatch_record_attachments.id
      legacy_record_id INTEGER,     -- For dispatch_record.id reference
      legacy_file_id INTEGER,       -- For dispatch_file.id reference
      
      -- Ensure unique message-file combinations
      CONSTRAINT unique_message_file UNIQUE (message_id, file_id)
    );
  `;
  
  try {
    const response = await fetch('http://localhost:8000/rest/v1/rpc/exec_sql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
      },
      body: JSON.stringify({ sql: createTableSQL })
    });
    
    const result = await response.text();
    console.log('Create table response:', result);
    
    // Create indexes
    const indexSQL = `
      CREATE INDEX IF NOT EXISTS idx_message_attachments_message ON message_attachments(message_id);
      CREATE INDEX IF NOT EXISTS idx_message_attachments_file ON message_attachments(file_id);
      CREATE INDEX IF NOT EXISTS idx_message_attachments_legacy_record ON message_attachments(legacy_record_id);
      CREATE INDEX IF NOT EXISTS idx_message_attachments_legacy_file ON message_attachments(legacy_file_id);
      CREATE INDEX IF NOT EXISTS idx_message_attachments_created ON message_attachments(created_at);
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
      CREATE OR REPLACE FUNCTION update_message_attachments_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';
      
      DROP TRIGGER IF EXISTS trigger_message_attachments_updated_at ON message_attachments;
      CREATE TRIGGER trigger_message_attachments_updated_at
        BEFORE UPDATE ON message_attachments
        FOR EACH ROW EXECUTE FUNCTION update_message_attachments_updated_at();
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
    
    console.log('\n✅ message_attachments table schema creation completed!');
    
    // Verify table was created
    const { count, error } = await supabase
      .from('message_attachments')
      .select('*', { count: 'exact', head: true });
      
    if (error) {
      console.log('Error verifying table:', error.message);
    } else {
      console.log(`📋 Verified: message_attachments table exists with ${count || 0} records`);
    }
    
  } catch (error) {
    console.error('Error creating message_attachments schema:', error);
  }
}

createMessageAttachmentsSchema().catch(console.error);
