import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

async function analyzeSourceUsers() {
    const sourceClient = new Client({
        host: process.env.SOURCE_DB_HOST!,
        port: parseInt(process.env.SOURCE_DB_PORT!),
        user: process.env.SOURCE_DB_USER!,
        password: process.env.SOURCE_DB_PASSWORD!,
        database: process.env.SOURCE_DB_NAME!,
    });

    await sourceClient.connect();

    const missingDoctorIds = [71, 533, 696, 721, 855];

    // Check what these users are in the source system
    const userQuery = `
        SELECT 
            u.id,
            u.username,
            u.email,
            u.is_active,
            u.is_staff,
            u.is_superuser,
            u.first_name,
            u.last_name
        FROM auth_user u
        WHERE u.id = ANY($1)
        ORDER BY u.id
    `;

    const userResult = await sourceClient.query(userQuery, [missingDoctorIds]);
    
    console.log('📊 Source user details:');
    console.table(userResult.rows);

    // Check if they appear in any Django groups or permissions
    const groupQuery = `
        SELECT 
            u.id,
            u.username,
            g.name as group_name
        FROM auth_user u
        JOIN auth_user_groups ug ON u.id = ug.user_id
        JOIN auth_group g ON ug.group_id = g.id
        WHERE u.id = ANY($1)
        ORDER BY u.id, g.name
    `;

    const groupResult = await sourceClient.query(groupQuery, [missingDoctorIds]);
    
    console.log('👥 User groups:');
    console.table(groupResult.rows);

    await sourceClient.end();
    process.exit(0);
}

analyzeSourceUsers().catch(console.error);
