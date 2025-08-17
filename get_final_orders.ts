import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

async function getFinalOrders() {
    const targetClient = new Client({
        host: process.env.TARGET_DB_HOST!,
        port: parseInt(process.env.TARGET_DB_PORT!),
        user: process.env.TARGET_DB_USER!,
        password: process.env.TARGET_DB_PASSWORD!,
        database: process.env.TARGET_DB_NAME!,
    });
    await targetClient.connect();

    const sourceClient = new Client({
        host: process.env.SOURCE_DB_HOST!,
        port: parseInt(process.env.SOURCE_DB_PORT!),
        user: process.env.SOURCE_DB_USER!,
        password: process.env.SOURCE_DB_PASSWORD!,
        database: process.env.SOURCE_DB_NAME!,
    });
    await sourceClient.connect();

    console.log('🔍 Finding the final 3 missing orders...\n');

    // Get existing orders
    const existingOrdersResult = await targetClient.query(`
        SELECT legacy_instruction_id FROM orders WHERE legacy_instruction_id IS NOT NULL
        ORDER BY legacy_instruction_id
    `);
    const existingIds = new Set(existingOrdersResult.rows.map(row => row.legacy_instruction_id));
    
    // Find source orders that are NOT in target
    const sourceOrdersQuery = `
        SELECT 
            i.id as legacy_instruction_id,
            CONCAT(p.suffix, '-', i.id) as order_number,
            p.user_id as legacy_user_id,
            p.doctor_id as legacy_doctor_id,
            p.office_id as legacy_office_id,
            i.deleted,
            u.username as patient_username,
            u.email as patient_email,
            doc.username as doctor_username
            
        FROM dispatch_instruction i
        INNER JOIN dispatch_patient p ON i.patient_id = p.id
        LEFT JOIN auth_user u ON p.user_id = u.id
        LEFT JOIN auth_user doc ON p.doctor_id = doc.id
        
        WHERE i.id NOT IN (${Array.from(existingIds).join(',')})
        ORDER BY i.id
    `;

    const missingOrders = await sourceClient.query(sourceOrdersQuery);
    
    console.log(`📊 Found ${missingOrders.rows.length} orders missing from target:`);
    console.table(missingOrders.rows);

    // Build doctor lookup map
    const doctorMap = new Map<number, string>();
    const doctorResult = await targetClient.query(`
        SELECT legacy_user_id, id FROM profiles 
        WHERE profile_type = 'doctor' AND legacy_user_id IS NOT NULL
    `);
    doctorResult.rows.forEach(row => {
        doctorMap.set(row.legacy_user_id, row.id);
    });

    // Check if these users/doctors exist in target system
    for (const order of missingOrders.rows) {
        const userExists = doctorMap.has(order.legacy_user_id);
        const doctorExists = order.legacy_doctor_id ? doctorMap.has(order.legacy_doctor_id) : 'N/A';
        
        console.log(`\n🔍 Order ${order.legacy_instruction_id}:`);
        console.log(`   Patient/User ID ${order.legacy_user_id} exists as doctor: ${userExists}`);
        console.log(`   Doctor ID ${order.legacy_doctor_id} exists as doctor: ${doctorExists}`);
        console.log(`   Deleted: ${order.deleted}`);
        console.log(`   Patient: ${order.patient_username} (${order.patient_email})`);
        console.log(`   Doctor: ${order.doctor_username}`);
    }

    await sourceClient.end();
    await targetClient.end();
    
    process.exit(0);
}

getFinalOrders().catch(console.error);
