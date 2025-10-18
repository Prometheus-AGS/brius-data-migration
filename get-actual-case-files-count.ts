import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function getActualCaseFilesCount() {
  console.log('🔍 Getting actual case_files count using alternative approach...\n');

  // Try using regular Supabase query instead of raw SQL
  const { data: filesWithOrders, error: filesError } = await supabase
    .from('files')
    .select(`
      id,
      order_id,
      orders!inner(
        id,
        patient_id,
        cases!inner(
          id
        )
      )
    `)
    .not('order_id', 'is', null)
    .limit(10);

  if (filesError) {
    console.error('❌ Error with Supabase query:', filesError);
  } else {
    console.log(`✅ Found ${filesWithOrders?.length || 0} files in sample that can link to cases`);

    if (filesWithOrders && filesWithOrders.length > 0) {
      console.log('Sample file with case relationship:');
      console.log(JSON.stringify(filesWithOrders[0], null, 2));
    }
  }

  // Get count using head request
  const { count: relationshipCount, error: countError } = await supabase
    .from('files')
    .select('id', { count: 'exact', head: true })
    .not('order_id', 'is', null);

  if (!countError) {
    console.log(`📊 Total files with order_id: ${relationshipCount}`);
  }

  // Test if we can get files that can actually link to cases
  const { count: linkableCount, error: linkError } = await supabase
    .from('files')
    .select(`
      id,
      orders!inner(
        patient_id,
        cases!inner(id)
      )
    `, { count: 'exact', head: true })
    .not('order_id', 'is', null);

  if (!linkError) {
    console.log(`📊 Files that can link to cases: ${linkableCount}`);
  } else {
    console.error('❌ Error getting linkable count:', linkError);
  }
}

getActualCaseFilesCount().catch(console.error);