import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

// Target database connection
const targetClient = new Client({
  host: process.env.TARGET_DB_HOST,
  port: parseInt(process.env.TARGET_DB_PORT || '5432'),
  database: process.env.TARGET_DB_NAME,
  user: process.env.TARGET_DB_USER,
  password: process.env.TARGET_DB_PASSWORD,
});

async function createOrderStatesSchema() {
  try {
    await targetClient.connect();
    console.log('Connected to target database');
    console.log('Creating order_states table schema...');

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
        legacy_state_id INTEGER UNIQUE NOT NULL, -- dispatch_state.id
        legacy_instruction_id INTEGER NOT NULL, -- dispatch_state.instruction_id
        legacy_actor_id INTEGER, -- dispatch_state.actor_id

        -- Additional metadata
        metadata JSONB DEFAULT '{}', -- For extensible state data
        notes TEXT -- For any additional state change notes
      );
    `;

    await targetClient.query(createTableSQL);
    console.log('✅ order_states table created successfully');

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

    await targetClient.query(indexSQL);
    console.log('✅ Indexes created successfully');

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

    await targetClient.query(triggerSQL);
    console.log('✅ Trigger created successfully');

    // Create helper function to get human-readable status names
    const statusMappingSQL = `
      CREATE OR REPLACE FUNCTION get_status_name(status_code INTEGER)
      RETURNS VARCHAR(100) AS $$
      BEGIN
        RETURN CASE status_code
          WHEN 11 THEN 'review_approval'
          WHEN 12 THEN 'processing'
          WHEN 13 THEN 'manufacturing'
          WHEN 14 THEN 'shipped'
          WHEN 15 THEN 'delivered'
          WHEN 16 THEN 'completed'
          WHEN 17 THEN 'cancelled'
          WHEN 18 THEN 'on_hold'
          WHEN 19 THEN 'returned'
          WHEN 20 THEN 'refunded'
          ELSE 'unknown_' || status_code::VARCHAR
        END;
      END;
      $$ LANGUAGE plpgsql;
    `;

    await targetClient.query(statusMappingSQL);
    console.log('✅ Status mapping function created successfully');

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

    await targetClient.query(viewSQL);
    console.log('✅ current_order_states view created successfully');

    // Verify table was created
    const countResult = await targetClient.query(`
      SELECT COUNT(*) as count FROM order_states
    `);
    console.log(`📋 Verified: order_states table exists with ${countResult.rows[0].count} records`);

    console.log('\n✅ order_states table schema creation completed successfully!');

  } catch (error) {
    console.error('Error creating order_states schema:', error);
    process.exit(1);
  } finally {
    await targetClient.end();
  }
}

createOrderStatesSchema();