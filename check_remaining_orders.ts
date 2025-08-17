import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

async function checkRemainingOrders() {
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

    console.log('📊 Checking remaining orders to migrate...\n');

    // Get total source orders
    const sourceTotal = await sourceClient.query(`
        SELECT COUNT(*) as count 
        FROM dispatch_instruction i
        INNER JOIN dispatch_patient p ON i.patient_id = p.id
        WHERE i.deleted = false
    `);

    // Get target orders count
    const targetTotal = await targetClient.query(`
        SELECT COUNT(*) as count FROM orders
    `);

    // Get target orders with legacy IDs
    const targetWithLegacy = await targetClient.query(`
        SELECT COUNT(*) as count FROM orders WHERE legacy_instruction_id IS NOT NULL
    `);

    // Get existing legacy instruction IDs
    const existingIds = await targetClient.query(`
        SELECT legacy_instruction_id FROM orders WHERE legacy_instruction_id IS NOT NULL
        ORDER BY legacy_instruction_id DESC LIMIT 10
    `);

    console.log(`📈 Source orders (total): ${sourceTotal.rows[0].count}`);
    console.log(`📊 Target orders (total): ${targetTotal.rows[0].count}`);
    console.log(`🔗 Target orders with legacy IDs: ${targetWithLegacy.rows[0].count}`);
    console.log(`📋 Latest migrated legacy IDs: ${existingIds.rows.map(r => r.legacy_instruction_id).join(', ')}`);

    const remaining = parseInt(sourceTotal.rows[0].count) - parseInt(targetWithLegacy.rows[0].count);
    console.log(`⏳ Estimated remaining: ${remaining}`);

    await sourceClient.end();
    await targetClient.end();
    
    process.exit(0);
}

checkRemainingOrders().catch(console.error);
