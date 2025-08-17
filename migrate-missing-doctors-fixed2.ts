import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { randomUUID } from 'crypto';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function migrateMissingDoctors() {
    const sourceClient = new Client({
        host: process.env.SOURCE_DB_HOST!,
        port: parseInt(process.env.SOURCE_DB_PORT!),
        user: process.env.SOURCE_DB_USER!,
        password: process.env.SOURCE_DB_PASSWORD!,
        database: process.env.SOURCE_DB_NAME!,
    });

    await sourceClient.connect();

    const missingDoctorIds = [
        71, 533, 696, 721, 855, 894, 1255, 1276, 1517, 1644, 
        1698, 1699, 1846, 1887, 2238, 2296, 2365, 2393, 2498, 
        2522, 2557, 2591, 2680, 2716, 2827, 2879, 3011, 3311, 
        3406, 3495, 4696, 5158, 5395, 5594, 6173, 6578, 6579, 
        6722, 9035, 9443
    ];

    console.log('🚀 Starting missing doctors migration...');
    console.log(`📊 Migrating ${missingDoctorIds.length} missing doctors`);

    // Fetch doctor data from source
    const doctorQuery = `
        SELECT 
            u.id,
            u.username,
            u.email,
            u.first_name,
            u.last_name,
            u.is_active,
            u.date_joined
        FROM auth_user u
        JOIN auth_user_groups ug ON u.id = ug.user_id
        JOIN auth_group g ON ug.group_id = g.id
        WHERE u.id = ANY($1) AND g.name = 'Doctor'
        ORDER BY u.id
    `;

    const doctorResult = await sourceClient.query(doctorQuery, [missingDoctorIds]);
    console.log(`📥 Retrieved ${doctorResult.rows.length} doctor records from source`);

    let successCount = 0;

    for (const doctor of doctorResult.rows) {
        try {
            // Check if doctor already exists (by legacy_user_id)
            const { data: existingDoctor } = await supabase
                .from('doctors')
                .select('id')
                .eq('legacy_user_id', doctor.id.toString())
                .single();

            if (existingDoctor) {
                console.log(`⏭️  Doctor ${doctor.id} already exists, skipping`);
                continue;
            }

            // Check if mapping already exists for this doctor
            const { data: existingMapping } = await supabase
                .from('migration_mappings')
                .select('*')
                .eq('entity_type', 'doctor')
                .eq('legacy_id', doctor.id)
                .single();

            if (existingMapping) {
                console.log(`⏭️  Doctor mapping ${doctor.id} already exists, skipping`);
                continue;
            }

            // Generate UUID for the new doctor
            const doctorId = randomUUID();

            // Insert into profiles table first
            const profileData = {
                id: doctorId,
                username: doctor.username,
                profile_type: 'doctor',
                email: doctor.email,
                first_name: doctor.first_name,
                last_name: doctor.last_name,
                is_active: doctor.is_active,
                created_at: doctor.date_joined
            };

            const { error: profileError } = await supabase
                .from('profiles')
                .insert(profileData);

            if (profileError) {
                console.error(`❌ Failed to insert profile for doctor ${doctor.id}:`, profileError.message);
                continue;
            }

            // Insert into doctors table
            const doctorData = {
                id: doctorId,
                profile_id: doctorId,
                doctor_number: `DOC${doctor.id.toString().padStart(6, '0')}`,
                status: 'active',
                is_accepting_patients: true,
                joined_practice_at: doctor.date_joined,
                legacy_user_id: doctor.id.toString()
            };

            const { error: doctorError } = await supabase
                .from('doctors')
                .insert(doctorData);

            if (doctorError) {
                console.error(`❌ Failed to insert doctor ${doctor.id}:`, doctorError.message);
                // Clean up profile if doctor insert failed
                await supabase
                    .from('profiles')
                    .delete()
                    .eq('id', doctorId);
                continue;
            }

            // Create migration mapping for doctor
            const mappingData = {
                entity_type: 'doctor',
                legacy_id: doctor.id,
                new_id: doctorId,
                migrated_at: new Date().toISOString(),
                migration_batch: 'missing_doctors_fix'
            };

            const { error: mappingError } = await supabase
                .from('migration_mappings')
                .insert(mappingData);

            if (mappingError) {
                console.error(`❌ Failed to create mapping for doctor ${doctor.id}:`, mappingError.message);
                // Don't fail the migration if mapping fails, just log it
            }

            console.log(`✅ Successfully migrated doctor ${doctor.id} (${doctor.first_name} ${doctor.last_name})`);
            successCount++;

        } catch (error) {
            console.error(`❌ Failed to migrate doctor ${doctor.id}:`, (error as Error).message);
        }
    }

    await sourceClient.end();

    console.log(`\n🎉 Migration completed!`);
    console.log(`   Migrated doctors: ${successCount}/${doctorResult.rows.length}`);

    // Verification
    const { data: verificationData, error: verificationError } = await supabase
        .from('doctors')
        .select('legacy_user_id')
        .in('legacy_user_id', missingDoctorIds.map(id => id.toString()));

    if (!verificationError) {
        console.log(`✅ Verification: ${verificationData?.length || 0} doctors now in target system`);
    }

    process.exit(0);
}

migrateMissingDoctors().catch(console.error);
