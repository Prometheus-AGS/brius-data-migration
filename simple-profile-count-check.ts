import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'https://gyyottknjakkagswebwh.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function simpleProfileCountCheck() {
  console.log('🔍 SIMPLE PROFILE COUNT CHECK');
  console.log('=' .repeat(40));

  try {
    // Method 1: Count with count=exact
    const { count: profileCountExact, error: countError } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error('Error with count=exact:', countError.message);
    } else {
      console.log(`Method 1 (count=exact): ${profileCountExact} profiles`);
    }

    // Method 2: Select all and count
    const { data: allProfiles, error: selectError } = await supabase
      .from('profiles')
      .select('id, profile_type');

    if (selectError) {
      console.error('Error with select all:', selectError.message);
    } else {
      console.log(`Method 2 (select all): ${allProfiles?.length || 0} profiles`);

      if (allProfiles) {
        const typeDistribution = allProfiles.reduce((acc, profile) => {
          acc[profile.profile_type] = (acc[profile.profile_type] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        console.log('Profile type distribution:');
        Object.entries(typeDistribution).forEach(([type, count]) => {
          console.log(`   ${type}: ${count}`);
        });
      }
    }

    // Method 3: Check with pagination
    let totalWithPagination = 0;
    let hasMore = true;
    let page = 0;
    const pageSize = 1000;

    while (hasMore) {
      const { data: pageData, error: pageError } = await supabase
        .from('profiles')
        .select('id')
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (pageError) {
        console.error(`Error with pagination page ${page}:`, pageError.message);
        break;
      }

      if (pageData && pageData.length > 0) {
        totalWithPagination += pageData.length;
        hasMore = pageData.length === pageSize;
        page++;
      } else {
        hasMore = false;
      }
    }

    console.log(`Method 3 (pagination): ${totalWithPagination} profiles`);

    // Also check specialized record counts
    const [doctorCount, patientCount, technicianCount] = await Promise.all([
      supabase.from('doctors').select('*', { count: 'exact', head: true }),
      supabase.from('patients').select('*', { count: 'exact', head: true }),
      supabase.from('technicians').select('*', { count: 'exact', head: true })
    ]);

    console.log(`\nSpecialized record counts:`);
    console.log(`   Doctors: ${doctorCount.count}`);
    console.log(`   Patients: ${patientCount.count}`);
    console.log(`   Technicians: ${technicianCount.count}`);
    console.log(`   Total: ${(doctorCount.count || 0) + (patientCount.count || 0) + (technicianCount.count || 0)}`);

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

if (require.main === module) {
  simpleProfileCountCheck();
}