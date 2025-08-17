import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function fixOrdersMigration() {
    // Get target database connection
    const targetClient = new Client({
        host: process.env.TARGET_DB_HOST!,
        port: parseInt(process.env.TARGET_DB_PORT!),
        user: process.env.TARGET_DB_USER!,
        password: process.env.TARGET_DB_PASSWORD!,
        database: process.env.TARGET_DB_NAME!,
    });
    await targetClient.connect();

    // Get source database connection
    const sourceClient = new Client({
        host: process.env.SOURCE_DB_HOST!,
        port: parseInt(process.env.SOURCE_DB_PORT!),
        user: process.env.SOURCE_DB_USER!,
        password: process.env.SOURCE_DB_PASSWORD!,
        database: process.env.SOURCE_DB_NAME!,
    });
    await sourceClient.connect();

    console.log('🚀 Starting FIXED orders migration...\n');

    // 1. Get current orders count
    const currentResult = await targetClient.query('SELECT COUNT(*) FROM orders');
    const currentCount = parseInt(currentResult.rows[0].count);
    console.log(`📊 Current orders in target: ${currentCount}`);

    // 2. Build lookup maps
    console.log('🗺️ Building UUID lookup maps...');
    const patientMap = new Map<string, string>();
    const patientResult = await targetClient.query(`
        SELECT legacy_user_id::text, id FROM patients WHERE legacy_user_id IS NOT NULL
    `);
    patientResult.rows.forEach(row => {
        patientMap.set(row.legacy_user_id, row.id);
    });
    console.log(`✓ Built patient lookup map: ${patientMap.size} entries`);

    const doctorMap = new Map<string, string>();
    const doctorResult = await targetClient.query(`
        SELECT legacy_user_id::text, id FROM profiles 
        WHERE profile_type = 'doctor' AND legacy_user_id IS NOT NULL
    `);
    doctorResult.rows.forEach(row => {
        doctorMap.set(row.legacy_user_id, row.id);
    });
    console.log(`✓ Built doctor lookup map: ${doctorMap.size} entries`);

    const officeMap = new Map<string, string>();
    const officeResult = await targetClient.query(`
        SELECT legacy_office_id::text, id FROM offices WHERE legacy_office_id IS NOT NULL
    `);
    officeResult.rows.forEach(row => {
        officeMap.set(row.legacy_office_id, row.id);
    });
    console.log(`✓ Built office lookup map: ${officeMap.size} entries`);

    // 3. Get orders that need to be migrated (excluding already migrated ones)
    console.log('\n📦 Extracting orders to migrate...');
    const existingOrdersResult = await targetClient.query(`
        SELECT legacy_instruction_id FROM orders WHERE legacy_instruction_id IS NOT NULL
    `);
    const existingIds = new Set(existingOrdersResult.rows.map(row => row.legacy_instruction_id));

    const sourceOrdersQuery = `
        SELECT 
            di.id as instruction_id,
            di.created_date,
            di.updated_date,
            di.user_id,
            di.patient_id,
            di.office_id,
            di.notes,
            di.complaint,
            di.amount,
            di.submitted_date,
            di.approved_date,
            di.shipped_date,
            di.treatment_type
        FROM dispatch_instruction di
        WHERE di.id NOT IN (${Array.from(existingIds).join(',')})
        ORDER BY di.id
        LIMIT 500
    `;

    const sourceOrders = await sourceClient.query(sourceOrdersQuery);
    console.log(`📦 Found ${sourceOrders.rows.length} new orders to migrate`);

    let successCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // 4. Migrate orders one by one with detailed logging
    for (const [index, order] of sourceOrders.rows.entries()) {
        const patientLegacyId = order.patient_id.toString();
        const doctorLegacyId = order.user_id.toString();
        const officeLegacyId = order.office_id ? order.office_id.toString() : null;

        const patientUuid = patientMap.get(patientLegacyId);
        const doctorUuid = doctorMap.get(doctorLegacyId);
        const officeUuid = officeLegacyId ? officeMap.get(officeLegacyId) : null;

        if (!patientUuid) {
            console.log(`⚠️ Skipping order ${order.instruction_id}: Patient not found for ID ${patientLegacyId}`);
            skippedCount++;
            continue;
        }

        if (!doctorUuid) {
            console.log(`⚠️ Skipping order ${order.instruction_id}: Doctor not found for ID ${doctorLegacyId}`);
            skippedCount++;
            continue;
        }

        // Determine course type
        let courseType = 'main';
        if (order.treatment_type === 'Refinement') courseType = 'refinement';
        else if (order.treatment_type === 'Replacement') courseType = 'replacement';

        // Create order number
        const orderNumber = `ORD${order.instruction_id.toString().padStart(8, '0')}`;

        try {
            const insertResult = await targetClient.query(`
                INSERT INTO orders (
                    order_number, patient_id, doctor_id, office_id, course_type, status,
                    notes, complaint, amount, submitted_at, approved_at, shipped_at,
                    created_at, updated_at, legacy_instruction_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                RETURNING id
            `, [
                orderNumber,
                patientUuid,
                doctorUuid,
                officeUuid,
                courseType,
                'submitted',
                order.notes,
                order.complaint,
                order.amount,
                order.submitted_date,
                order.approved_date,
                order.shipped_date,
                order.created_date,
                order.updated_date,
                order.instruction_id
            ]);

            successCount++;
            if ((index + 1) % 50 === 0) {
                console.log(`✅ Progress: ${index + 1}/${sourceOrders.rows.length} (${successCount} success, ${skippedCount} skipped, ${errorCount} errors)`);
            }

        } catch (error) {
            errorCount++;
            console.log(`❌ Failed to insert order ${order.instruction_id}: ${(error as Error).message.slice(0, 100)}`);
            if (errorCount < 5) { // Show first few errors for debugging
                console.log(`   Doctor UUID: ${doctorUuid}, Patient UUID: ${patientUuid}`);
            }
        }
    }

    await sourceClient.end();
    await targetClient.end();

    console.log(`\n🎉 Migration completed!`);
    console.log(`✅ Successfully migrated: ${successCount}`);
    console.log(`⚠️ Skipped: ${skippedCount}`);
    console.log(`❌ Errors: ${errorCount}`);

    process.exit(0);
}

fixOrdersMigration().catch(console.error);
