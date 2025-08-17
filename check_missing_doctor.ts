import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

async function checkMissingDoctor() {
    console.log('🔍 Checking Doctor ID 71...\n');
    
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
        // Check doctor in source
        console.log('📋 Source database (Doctor ID 71):');
        const sourceDoctor = await sourceClient.query(`
            SELECT id, username, email, first_name, last_name, is_active, date_joined 
            FROM auth_user 
            WHERE id = 71
        `);
        
        if (sourceDoctor.rows.length > 0) {
            console.table(sourceDoctor.rows);
        } else {
            console.log('❌ Doctor ID 71 not found in source');
        }
        
        // Check if this doctor was migrated to target (need to use profiles table for user info)
        console.log('\n📋 Target database (legacy_user_id = 71):');
        const targetDoctor = await targetClient.query(`
            SELECT d.id, d.legacy_user_id, p.username, p.email, p.first_name, p.last_name, d.joined_practice_at 
            FROM doctors d
            LEFT JOIN profiles p ON d.profile_id = p.id
            WHERE d.legacy_user_id = 71
        `);
        
        if (targetDoctor.rows.length > 0) {
            console.table(targetDoctor.rows);
        } else {
            console.log('❌ Doctor with legacy_user_id = 71 not found in target');
        }
        
        // Check the non-deleted orders specifically
        console.log('\n📋 Detailed analysis of non-deleted orders:');
        const nonDeletedOrders = [
            { legacy_instruction_id: 491, legacy_user_id: 634, legacy_doctor_id: 71 },
            { legacy_instruction_id: 23845, legacy_user_id: 9637, legacy_doctor_id: 71 },
            { legacy_instruction_id: 23881, legacy_user_id: 9665, legacy_doctor_id: 71 }
        ];
        
        for (const order of nonDeletedOrders) {
            console.log(`\n🔍 Order ${order.legacy_instruction_id}:`);
            
            // Check patient in source
            console.log(`  👤 Patient ${order.legacy_user_id} in source:`);
            const sourcePatient = await sourceClient.query(`
                SELECT id, username, email, first_name, last_name, is_active 
                FROM auth_user 
                WHERE id = $1
            `, [order.legacy_user_id]);
            
            if (sourcePatient.rows.length > 0) {
                console.table(sourcePatient.rows);
            } else {
                console.log(`    ❌ Not found`);
            }
            
            // Check if patient was migrated
            console.log(`  👤 Patient ${order.legacy_user_id} in target:`);
            const targetPatient = await targetClient.query(`
                SELECT pt.id, pt.legacy_user_id, p.username, p.email, p.first_name, p.last_name, p.created_at 
                FROM patients pt
                LEFT JOIN profiles p ON pt.profile_id = p.id
                WHERE pt.legacy_user_id = $1
            `, [order.legacy_user_id]);
            
            if (targetPatient.rows.length > 0) {
                console.table(targetPatient.rows);
            } else {
                console.log(`    ❌ Not found in target`);
            }
        }

        // Check if doctor 71 exists in any office relationships
        console.log('\n📋 Doctor 71 office relationships in source:');
        const doctorOffices = await sourceClient.query(`
            SELECT do.id, do.office_id, do.user_id, o.name as office_name
            FROM dispatch_office_doctors do
            LEFT JOIN dispatch_office o ON do.office_id = o.id
            WHERE do.user_id = 71
        `);
        
        if (doctorOffices.rows.length > 0) {
            console.table(doctorOffices.rows);
        } else {
            console.log('❌ No office relationships found for doctor 71');
        }

    } finally {
        await sourceClient.end();
        await targetClient.end();
    }
}

checkMissingDoctor().catch(console.error);
