import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

async function checkDoctorOffice() {
    const sourceClient = new Client({
        host: process.env.SOURCE_DB_HOST!,
        port: parseInt(process.env.SOURCE_DB_PORT!),
        user: process.env.SOURCE_DB_USER!,
        password: process.env.SOURCE_DB_PASSWORD!,
        database: process.env.SOURCE_DB_NAME!,
    });
    await sourceClient.connect();
    
    try {
        // Check doctor 71 office relationships
        console.log('📋 Doctor 71 office relationships in source:');
        const doctorOffices = await sourceClient.query(`
            SELECT dod.id, dod.office_id, dod.user_id, o.name as office_name
            FROM dispatch_office_doctors dod
            LEFT JOIN dispatch_office o ON dod.office_id = o.id
            WHERE dod.user_id = 71
        `);
        
        if (doctorOffices.rows.length > 0) {
            console.table(doctorOffices.rows);
        } else {
            console.log('❌ No office relationships found for doctor 71');
        }

        // Check if doctor 71 appears in our doctor migration query
        console.log('\n📋 Doctor 71 in doctor migration query:');
        const migrationQuery = await sourceClient.query(`
            SELECT DISTINCT 
                u.id as user_id,
                u.username,
                u.email, 
                u.first_name,
                u.last_name,
                o.id as office_id,
                o.name as office_name
            FROM auth_user u
            JOIN dispatch_office_doctors dod ON u.id = dod.user_id
            JOIN dispatch_office o ON dod.office_id = o.id
            WHERE u.id = 71
        `);
        
        if (migrationQuery.rows.length > 0) {
            console.table(migrationQuery.rows);
        } else {
            console.log('❌ Doctor 71 not found in doctor migration query - this explains why it wasn\'t migrated');
        }

    } finally {
        await sourceClient.end();
    }
}

checkDoctorOffice().catch(console.error);
