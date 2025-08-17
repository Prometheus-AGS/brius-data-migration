import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE!,
  { auth: { persistSession: false } }
);

const sourceClient = new Client({
  host: process.env.SOURCE_DB_HOST,
  port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
  database: process.env.SOURCE_DB_NAME,
  user: process.env.SOURCE_DB_USER,
  password: process.env.SOURCE_DB_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

async function checkStatus() {
  try {
    // Connect to source
    await sourceClient.connect();
    
    // Get source count
    const sourceResult = await sourceClient.query('SELECT COUNT(*) FROM dispatch_file');
    const sourceCount = parseInt(sourceResult.rows[0].count);
    
    // Get target count
    const { count: targetCount } = await supabase
      .from('files')
      .select('*', { count: 'exact', head: true });
    
    console.log('📊 Files Migration Status:');
    console.log('   Source files (dispatch_file):', sourceCount.toLocaleString());
    console.log('   Target files (files):', targetCount?.toLocaleString() || 0);
    console.log('   Migration completion:', targetCount ? ((targetCount/sourceCount)*100).toFixed(2) + '%' : '0%');
    console.log('   Remaining files:', (sourceCount - (targetCount || 0)).toLocaleString());
    
    if (targetCount === sourceCount) {
      console.log('   ✅ Migration COMPLETE!');
    } else if (targetCount && targetCount > 0) {
      console.log('   🔄 Migration IN PROGRESS or INCOMPLETE');
    } else {
      console.log('   ❌ Migration NOT STARTED');
    }
    
  } catch (error) {
    console.error('❌ Error checking status:', error);
  } finally {
    await sourceClient.end();
  }
}

checkStatus();
