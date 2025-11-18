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

async function investigateTechnicianProfileMismatch() {
  console.log('🔍 INVESTIGATING TECHNICIAN-PROFILE MISMATCH');
  console.log('=' .repeat(50));

  try {
    // 1. Get all technician records
    const { data: technicians, error: techError } = await supabase
      .from('technicians')
      .select('id, profile_id, legacy_user_id, legacy_technician_id, employee_id')
      .limit(10);

    if (techError) {
      throw new Error(`Error fetching technicians: ${techError.message}`);
    }

    console.log(`\n📋 First 10 technician records:`);
    technicians?.forEach(tech => {
      console.log(`   ID: ${tech.id}, profile_id: ${tech.profile_id || 'NULL'}, legacy_user_id: ${tech.legacy_user_id}, employee_id: ${tech.employee_id}`);
    });

    // 2. Check if profiles exist with these legacy_user_ids but different profile_types
    if (technicians && technicians.length > 0) {
      const techLegacyIds = technicians.map(t => t.legacy_user_id).filter(id => id);

      const { data: existingProfiles, error: profileError } = await supabase
        .from('profiles')
        .select('id, legacy_user_id, profile_type, first_name, last_name, email')
        .in('legacy_user_id', techLegacyIds);

      if (profileError) {
        throw new Error(`Error fetching profiles: ${profileError.message}`);
      }

      console.log(`\n👤 Profiles found for these technicians:`);
      existingProfiles?.forEach(profile => {
        const tech = technicians.find(t => t.legacy_user_id === profile.legacy_user_id);
        console.log(`   Profile ${profile.id}: legacy_user_id=${profile.legacy_user_id}, type="${profile.profile_type}", name="${profile.first_name} ${profile.last_name}" (technician_id: ${tech?.id})`);
      });

      // 3. Check profile type distribution
      const profileTypes = existingProfiles?.reduce((acc, profile) => {
        acc[profile.profile_type] = (acc[profile.profile_type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      console.log(`\n📊 Profile types for these technician users:`);
      Object.entries(profileTypes || {}).forEach(([type, count]) => {
        console.log(`   ${type}: ${count}`);
      });

      // 4. Check which technicians have profile_id set correctly
      const techniciansWithProfiles = technicians.filter(t => t.profile_id);
      const techniciansWithoutProfiles = technicians.filter(t => !t.profile_id);

      console.log(`\n🔗 Profile linking status:`);
      console.log(`   Technicians with profile_id set: ${techniciansWithProfiles.length}`);
      console.log(`   Technicians without profile_id: ${techniciansWithoutProfiles.length}`);

      if (techniciansWithoutProfiles.length > 0) {
        console.log(`\n❌ Technicians missing profile links:`);
        techniciansWithoutProfiles.forEach(tech => {
          const profile = existingProfiles?.find(p => p.legacy_user_id === tech.legacy_user_id);
          if (profile) {
            console.log(`   Technician ${tech.id} (legacy_user_id: ${tech.legacy_user_id}) has profile ${profile.id} but not linked`);
          } else {
            console.log(`   Technician ${tech.id} (legacy_user_id: ${tech.legacy_user_id}) has NO profile at all`);
          }
        });
      }
    }

    // 5. Get overall counts to understand the scope
    const [profileCount, technicianCount] = await Promise.all([
      supabase.from('profiles').select('profile_type', { count: 'exact' }),
      supabase.from('technicians').select('id', { count: 'exact', head: true })
    ]);

    const profilesByType = profileCount.data?.reduce((acc, profile) => {
      acc[profile.profile_type] = (acc[profile.profile_type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log(`\n📈 OVERALL DATABASE STATE:`);
    console.log(`Total profiles: ${profileCount.data?.length || 0}`);
    Object.entries(profilesByType || {}).forEach(([type, count]) => {
      console.log(`   ${type} profiles: ${count}`);
    });
    console.log(`Total technicians: ${technicianCount.count || 0}`);

    // 6. Check how many technicians actually need their profile links fixed
    const { data: allTechnicians } = await supabase
      .from('technicians')
      .select('id, profile_id, legacy_user_id');

    const techniciansNeedingLinks = allTechnicians?.filter(t => !t.profile_id && t.legacy_user_id) || [];

    console.log(`\n🔧 REMEDIATION NEEDED:`);
    console.log(`Total technicians needing profile links: ${techniciansNeedingLinks.length}`);

    if (techniciansNeedingLinks.length > 0) {
      console.log(`Sample of technicians needing links:`);
      techniciansNeedingLinks.slice(0, 5).forEach(tech => {
        console.log(`   Technician ${tech.id}: legacy_user_id=${tech.legacy_user_id}, profile_id=${tech.profile_id || 'NULL'}`);
      });
    }

  } catch (error: any) {
    console.error('❌ Investigation failed:', error.message);
  }
}

if (require.main === module) {
  investigateTechnicianProfileMismatch();
}