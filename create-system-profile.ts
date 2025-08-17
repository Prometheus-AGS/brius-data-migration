import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE!
);

async function createSystemProfile() {
  console.log('🔧 Creating system profile for projects without creators...');

  // Check if system profile already exists
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', 'system@brius.com')
    .single();

  if (existingProfile) {
    console.log('✅ System profile already exists:', existingProfile.id);
    return existingProfile.id;
  }

  // Create system profile
  const { data: systemProfile, error } = await supabase
    .from('profiles')
    .insert({
      email: 'system@brius.com',
      first_name: 'System',
      last_name: 'Administrator',
      profile_type: 'master',
      legacy_user_id: -1, // Special marker for system user
    })
    .select('id')
    .single();

  if (error) {
    console.error('❌ Error creating system profile:', error);
    throw error;
  }

  console.log('✅ Created system profile:', systemProfile.id);
  return systemProfile.id;
}

createSystemProfile().catch(console.error);
