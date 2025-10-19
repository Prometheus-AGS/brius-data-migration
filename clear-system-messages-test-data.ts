import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function clearSystemMessagesTestData() {
  console.log('🧹 Clearing system_messages test data to prepare for full migration...\n');

  try {
    // Get current count
    const { count: currentCount } = await supabase
      .from('system_messages')
      .select('*', { count: 'exact', head: true });

    console.log(`📊 Current system_messages count: ${currentCount || 0}`);

    if (currentCount && currentCount > 0) {
      // Delete all test records
      const { error: deleteError } = await supabase
        .from('system_messages')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all records

      if (deleteError) {
        throw new Error(`Failed to clear test data: ${deleteError.message}`);
      }

      console.log(`✅ Cleared ${currentCount} test records from system_messages`);
    } else {
      console.log('📊 No test data to clear - table is already empty');
    }

    // Verify table is empty
    const { count: finalCount } = await supabase
      .from('system_messages')
      .select('*', { count: 'exact', head: true });

    console.log(`📦 Final system_messages count: ${finalCount || 0}`);
    console.log('✅ Ready for full migration!');

  } catch (error: any) {
    console.error('❌ Clear operation failed:', error);
    throw error;
  }
}

// Run the clear operation
if (require.main === module) {
  clearSystemMessagesTestData().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default clearSystemMessagesTestData;