import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

async function checkExistingProfile() {
    const targetClient = new Client({
        host: process.env.TARGET_DB_HOST!,
        port: parseInt(process.env.TARGET_DB_PORT!),
        user: process.env.TARGET_DB_USER!,
        password: process.env.TARGET_DB_PASSWORD!,
        database: process.env.TARGET_DB_NAME!,
    });
    await targetClient.connect();
    
    try {
        console.log('🔍 Checking existing profile for snytnikov+doctor...');
        
        const profile = await targetClient.query(`
            SELECT id, profile_type, username, email, first_name, last_name, legacy_user_id
            FROM profiles 
            WHERE username = 'snytnikov+doctor' OR legacy_user_id = 71
        `);
        
        if (profile.rows.length > 0) {
            console.table(profile.rows);
        } else {
            console.log('❌ No profile found');
        }

        console.log('\n🔍 Checking if doctor record exists...');
        const doctor = await targetClient.query(`
            SELECT d.id, d.legacy_user_id, d.doctor_number, p.username
            FROM doctors d
            LEFT JOIN profiles p ON d.profile_id = p.id
            WHERE d.legacy_user_id = 71 OR p.username = 'snytnikov+doctor'
        `);
        
        if (doctor.rows.length > 0) {
            console.table(doctor.rows);
        } else {
            console.log('❌ No doctor record found');
        }

    } finally {
        await targetClient.end();
    }
}

checkExistingProfile().catch(console.error);
