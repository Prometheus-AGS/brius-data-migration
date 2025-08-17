import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

async function migrateMissingDoctor71() {
    console.log('🏥 Migrating Missing Doctor 71 (snytnikov+doctor)...\n');
    
    const sourceClient = new Client({
        host: process.env.SOURCE_DB_HOST!,
        port: parseInt(process.env.SOURCE_DB_PORT!),
        user: process.env.SOURCE_DB_USER!,
        password: process.env.SOURCE_DB_PASSWORD!,
        database: process.env.SOURCE_DB_NAME!,
    });
    await sourceClient.connect();

    const targetClient = new Client({
        host: process.env.TARGET_DB_HOST!,
        port: parseInt(process.env.TARGET_DB_PORT!),
        user: process.env.TARGET_DB_USER!,
        password: process.env.TARGET_DB_PASSWORD!,
        database: process.env.TARGET_DB_NAME!,
    });
    await targetClient.connect();
    
    try {
        await targetClient.query('BEGIN');

        // Step 1: Get doctor details from source
        console.log('📋 Fetching Doctor 71 from source...');
        const sourceDoctor = await sourceClient.query(`
            SELECT id, username, email, first_name, last_name, is_active, date_joined 
            FROM auth_user 
            WHERE id = 71
        `);
        
        if (sourceDoctor.rows.length === 0) {
            throw new Error('Doctor 71 not found in source database');
        }
        
        const doctor = sourceDoctor.rows[0];
        console.log(`   ✅ Found: ${doctor.username} (${doctor.email})`);
        
        // Step 2: Check if doctor already exists in target
        const existingDoctor = await targetClient.query(`
            SELECT id FROM doctors WHERE legacy_user_id = 71
        `);
        
        if (existingDoctor.rows.length > 0) {
            console.log('   ℹ️  Doctor 71 already exists in target, skipping...');
            await targetClient.query('COMMIT');
            return;
        }

        // Step 3: Find existing profile (we know it exists)
        console.log('👤 Finding existing profile...');
        const existingProfile = await targetClient.query(`
            SELECT id, profile_type, username, email 
            FROM profiles 
            WHERE legacy_user_id = 71
        `);
        
        if (existingProfile.rows.length === 0) {
            throw new Error('Profile for doctor 71 not found in target database');
        }
        
        const profileId = existingProfile.rows[0].id;
        console.log(`   ✅ Using existing profile: ${profileId} (${existingProfile.rows[0].username})`);
        
        // Step 4: Update profile to be doctor type
        if (existingProfile.rows[0].profile_type !== 'doctor') {
            console.log('🔄 Updating profile type to doctor...');
            await targetClient.query(`
                UPDATE profiles 
                SET profile_type = 'doctor', updated_at = NOW()
                WHERE id = $1
            `, [profileId]);
            console.log('   ✅ Profile updated to doctor type');
        }

        // Step 5: Find a suitable office (use the first available office)
        console.log('🏢 Finding a suitable office...');
        const office = await targetClient.query(`
            SELECT id, legacy_office_id, name 
            FROM offices 
            ORDER BY created_at 
            LIMIT 1
        `);
        
        if (office.rows.length === 0) {
            throw new Error('No offices found in target database');
        }
        
        const primaryOfficeId = office.rows[0].id;
        console.log(`   ✅ Using office: ${office.rows[0].name} (${primaryOfficeId})`);

        // Step 6: Create doctor record
        console.log('👨‍⚕️ Creating doctor record...');
        const doctorNumber = `DR-${doctor.id.toString().padStart(6, '0')}`;
        
        const doctorResult = await targetClient.query(`
            INSERT INTO doctors (
                legacy_user_id, profile_id, doctor_number,
                primary_office_id, status, is_accepting_patients,
                joined_practice_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
            RETURNING id
        `, [
            doctor.id,
            profileId,
            doctorNumber,
            primaryOfficeId,
            'active',
            true,
            doctor.date_joined,
        ]);
        
        const doctorId = doctorResult.rows[0].id;
        console.log(`   ✅ Doctor created: ${doctorId} (${doctorNumber})`);

        // Step 7: Verify the creation
        console.log('🔍 Verifying doctor creation...');
        const verifyDoctor = await targetClient.query(`
            SELECT d.id, d.legacy_user_id, d.doctor_number, p.username, p.email, o.name as office_name
            FROM doctors d
            LEFT JOIN profiles p ON d.profile_id = p.id
            LEFT JOIN offices o ON d.primary_office_id = o.id
            WHERE d.legacy_user_id = 71
        `);
        
        if (verifyDoctor.rows.length > 0) {
            console.table(verifyDoctor.rows);
            console.log('   ✅ Doctor migration completed successfully!');
        } else {
            throw new Error('Doctor verification failed');
        }

        await targetClient.query('COMMIT');
        console.log('\n🎉 Doctor 71 migration completed! You can now re-run the orders migration to include the missing orders.');

    } catch (error) {
        await targetClient.query('ROLLBACK');
        console.error('❌ Migration failed:', error);
        throw error;
    } finally {
        await sourceClient.end();
        await targetClient.end();
    }
}

migrateMissingDoctor71().catch(console.error);
