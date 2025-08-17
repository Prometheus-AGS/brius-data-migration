import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

async function finalValidation() {
    console.log('🔍 Final Migration Validation\n');
    
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
        // 1. Count total orders in source (non-deleted)
        console.log('📊 Source Database Analysis:');
        const sourceTotal = await sourceClient.query(`
            SELECT COUNT(*) as total_orders FROM dispatch_instruction WHERE deleted = false
        `);
        console.log(`   Total non-deleted orders in source: ${sourceTotal.rows[0].total_orders}`);

        const sourceDeleted = await sourceClient.query(`
            SELECT COUNT(*) as deleted_orders FROM dispatch_instruction WHERE deleted = true
        `);
        console.log(`   Total deleted orders in source: ${sourceDeleted.rows[0].deleted_orders}`);

        const sourceGrandTotal = await sourceClient.query(`
            SELECT COUNT(*) as grand_total FROM dispatch_instruction
        `);
        console.log(`   Grand total orders in source: ${sourceGrandTotal.rows[0].grand_total}`);

        // 2. Count total orders in target
        console.log('\n📊 Target Database Analysis:');
        const targetTotal = await targetClient.query(`
            SELECT COUNT(*) as total_orders FROM orders
        `);
        console.log(`   Total orders in target: ${targetTotal.rows[0].total_orders}`);

        // 3. Check the final 3 orders we just migrated
        console.log('\n🎯 Final 3 Orders Verification:');
        const finalThree = await targetClient.query(`
            SELECT o.legacy_instruction_id, o.order_number, o.status, p.username as patient, d.doctor_number
            FROM orders o
            JOIN patients pt ON o.patient_id = pt.id
            JOIN profiles p ON pt.profile_id = p.id
            JOIN doctors d ON o.doctor_id = d.id
            WHERE o.legacy_instruction_id IN (491, 23845, 23881)
            ORDER BY o.legacy_instruction_id
        `);
        
        finalThree.rows.forEach(order => {
            console.log(`   ✅ Order ${order.legacy_instruction_id} (${order.order_number}): ${order.patient} → Dr ${order.doctor_number} [${order.status}]`);
        });

        // 4. Migration Summary
        const sourceNonDeleted = parseInt(sourceTotal.rows[0].total_orders);
        const targetMigrated = parseInt(targetTotal.rows[0].total_orders);
        
        console.log('\n📈 Migration Summary:');
        console.log(`   Source (non-deleted): ${sourceNonDeleted}`);
        console.log(`   Target (migrated):    ${targetMigrated}`);
        console.log(`   Migration Rate:       ${((targetMigrated / sourceNonDeleted) * 100).toFixed(2)}%`);
        
        if (targetMigrated >= sourceNonDeleted) {
            console.log('\n🎉 SUCCESS: All non-deleted orders have been migrated!');
        } else {
            console.log(`\n⚠️  Note: ${sourceNonDeleted - targetMigrated} orders may still be missing`);
        }

        // 5. Doctor 71 specific analysis
        console.log('\n👨‍⚕️ Doctor 71 Analysis:');
        const doctor71Orders = await targetClient.query(`
            SELECT COUNT(*) as order_count
            FROM orders o
            JOIN doctors d ON o.doctor_id = d.id
            WHERE d.legacy_user_id = 71
        `);
        console.log(`   Orders for Doctor 71 (snytnikov+doctor): ${doctor71Orders.rows[0].order_count}`);

    } finally {
        await sourceClient.end();
        await targetClient.end();
    }
}

finalValidation().catch(console.error);
