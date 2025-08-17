import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkDoctors() {
    const missingDoctorIds = [
        71, 533, 696, 721, 855, 894, 1255, 1276, 1517, 1644, 
        1698, 1699, 1846, 1887, 2238, 2296, 2365, 2393, 2498, 
        2522, 2557, 2591, 2680, 2716, 2827, 2879, 3011, 3311, 
        3406, 3495, 4696, 5158, 5395, 5594, 6173, 6578, 6579, 
        6722, 9035, 9443
    ];

    console.log('🔍 Checking doctors in target system...');

    // Check mapping table
    const { data: mappings, error: mappingError } = await supabase
        .from('migration_mappings')
        .select('legacy_id, new_id')
        .eq('entity_type', 'doctor')
        .in('legacy_id', missingDoctorIds.map(id => id.toString()));

    if (mappingError) {
        console.error('❌ Error checking mappings:', mappingError);
        return;
    }

    console.log(`📊 Found ${mappings?.length || 0} mappings for missing doctors`);

    if (mappings && mappings.length > 0) {
        // Get the UUIDs and check doctors table
        const doctorUuids = mappings.map(m => m.new_id);
        
        const { data: doctors, error: doctorError } = await supabase
            .from('doctors')
            .select('id, legacy_user_id')
            .in('id', doctorUuids);

        if (doctorError) {
            console.error('❌ Error checking doctors:', doctorError);
            return;
        }

        console.log(`📋 Found ${doctors?.length || 0} doctors in doctors table`);
        console.log('Mappings sample:', mappings.slice(0, 5));
        console.log('Doctors sample:', doctors?.slice(0, 5));
    }

    // Also check directly by legacy_user_id
    const { data: directDoctors, error: directError } = await supabase
        .from('doctors')
        .select('id, legacy_user_id')
        .in('legacy_user_id', missingDoctorIds.map(id => id.toString()));

    if (directError) {
        console.error('❌ Error checking doctors by legacy_user_id:', directError);
        return;
    }

    console.log(`🎯 Found ${directDoctors?.length || 0} doctors by legacy_user_id`);

    process.exit(0);
}

checkDoctors().catch(console.error);
