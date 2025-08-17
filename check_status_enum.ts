import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

async function checkStatusEnum() {
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
    
    try {
        console.log('🔍 Checking order_status enum values...');
        const enumValues = await targetClient.query(`
            SELECT unnest(enum_range(NULL::order_status)) as status_value;
        `);
        
        console.log('Valid order_status values:');
        enumValues.rows.forEach(row => {
            console.log(`  - ${row.status_value}`);
        });

        console.log('\n🔍 Checking source order statuses for our 3 orders...');
        const sourceStatuses = await sourceClient.query(`
            SELECT i.id, i.status, i.notes
            FROM dispatch_instruction i
            WHERE i.id IN (491, 23845, 23881)
        `);
        
        console.log('Source order statuses:');
        sourceStatuses.rows.forEach(row => {
            console.log(`  - Order ${row.id}: status='${row.status}' notes='${row.notes || 'null'}'`);
        });

    } finally {
        await targetClient.end();
        await sourceClient.end();
    }
}

checkStatusEnum().catch(console.error);
