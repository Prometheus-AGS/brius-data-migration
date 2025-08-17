import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

const supabase = createClient(
  'http://localhost:8000', 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
);

// Source database connection
const sourceClient = new Client({
  host: 'test.brius.com',
  port: 5432,
  database: 'mdw_db',
  user: 'mdw_ai',
  password: 'xGXmckHY',
});

async function finalValidation() {
  try {
    await sourceClient.connect();
    
    // Get source count
    const sourceCount = await sourceClient.query('SELECT COUNT(*) as total FROM dispatch_record');
    const totalSourceRecords = parseInt(sourceCount.rows[0].total);
    
    // Get target count
    const { count: targetCount } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true });
    
    console.log('=== Migration Validation Summary ===');
    console.log(`Source (dispatch_record) total: ${totalSourceRecords.toLocaleString()}`);
    console.log(`Target (messages) total: ${targetCount?.toLocaleString()}`);
    console.log(`Successfully migrated: ${(targetCount || 0).toLocaleString()}`);
    console.log(`Skipped: ${(totalSourceRecords - (targetCount || 0)).toLocaleString()}`);
    console.log(`Migration rate: ${((targetCount || 0) / totalSourceRecords * 100).toFixed(2)}%`);
    
    // Get type distribution in target
    const { data: typeStats } = await supabase
      .from('messages')
      .select('message_type')
      .then(({ data, error }) => {
        if (error) return { data: null, error };
        
        const stats: { [key: string]: number } = {};
        data?.forEach((msg: any) => {
          stats[msg.message_type] = (stats[msg.message_type] || 0) + 1;
        });
        
        return { data: stats, error: null };
      });
      
    console.log('\n=== Message Type Distribution ===');
    Object.entries(typeStats || {}).forEach(([type, count]) => {
      console.log(`${type}: ${count.toLocaleString()}`);
    });
    
    // Get recipient type distribution
    const { data: recipientStats } = await supabase
      .from('messages')
      .select('recipient_type')
      .then(({ data, error }) => {
        if (error) return { data: null, error };
        
        const stats: { [key: string]: number } = {};
        data?.forEach((msg: any) => {
          stats[msg.recipient_type] = (stats[msg.recipient_type] || 0) + 1;
        });
        
        return { data: stats, error: null };
      });
      
    console.log('\n=== Recipient Type Distribution ===');
    Object.entries(recipientStats || {}).forEach(([type, count]) => {
      console.log(`${type}: ${count.toLocaleString()}`);
    });
    
    // Check for any messages with null sender_id or recipient_id
    const { count: nullSenderCount } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .is('sender_id', null);
      
    const { count: nullRecipientCount } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .is('recipient_id', null);
      
    console.log('\n=== Data Quality Check ===');
    console.log(`Messages with null sender_id: ${nullSenderCount?.toLocaleString()}`);
    console.log(`Messages with null recipient_id: ${nullRecipientCount?.toLocaleString()}`);
    
    // Verify legacy_record_id uniqueness
    const { data: duplicateCheck } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT legacy_record_id, COUNT(*) as count
        FROM messages 
        WHERE legacy_record_id IS NOT NULL
        GROUP BY legacy_record_id 
        HAVING COUNT(*) > 1
        LIMIT 5;
      `
    });
    
    console.log(`Legacy ID duplicates found: ${Array.isArray(duplicateCheck) ? duplicateCheck.length : 0}`);
    
    console.log('\n✅ Migration validation complete!');
    
  } catch (error) {
    console.error('Validation error:', error);
  } finally {
    await sourceClient.end();
  }
}

finalValidation().catch(console.error);
