import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'http://localhost:8000', 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
);

async function verifyTestMessages() {
  console.log('Verifying test messages...');
  
  // Get count
  const { count, error: countError } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true });
    
  if (countError) {
    console.log('Error getting count:', countError);
    return;
  }
  
  console.log(`Total messages in table: ${count}`);
  
  // Get sample messages
  const { data: messages, error: messagesError } = await supabase
    .from('messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(3);
    
  if (messagesError) {
    console.log('Error getting messages:', messagesError);
    return;
  }
  
  console.log('\nSample messages:');
  messages?.forEach((msg, i) => {
    console.log(`\n--- Message ${i + 1} ---`);
    console.log(`ID: ${msg.id}`);
    console.log(`Type: ${msg.message_type}`);
    console.log(`Recipient: ${msg.recipient_type} (${msg.recipient_id})`);
    console.log(`Sender: ${msg.sender_id}`);
    console.log(`Content: ${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}`);
    console.log(`Legacy Record ID: ${msg.legacy_record_id}`);
    console.log(`Metadata:`, msg.metadata);
    console.log(`Created: ${msg.created_at}`);
  });
  
  // Check message types distribution
  const { data: typeStats, error: typeError } = await supabase
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
    
  if (typeError) {
    console.log('Error getting type stats:', typeError);
  } else {
    console.log('\nMessage type distribution:');
    Object.entries(typeStats || {}).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });
  }
}

verifyTestMessages().catch(console.error);
