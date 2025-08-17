import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

dotenv.config();

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

    console.log('🚀 Starting FIXED orders migration v2...\n');

    // 1. Get current orders count
    const currentResult = await targetClient.query('SELECT COUNT(*) FROM orders');
    const currentCount = parseInt(currentResult.rows[0].count);
    console.log(`📊 Current orders in target: ${currentCount}`);

    // 2. Build lookup maps correctly
    console.log('🗺️ Building UUID lookup maps...');
    
    const patientMap = new Map<number, string>();
    const patientResult = await targetClient.query(`
        SELECT legacy_user_id, id FROM patients WHERE legacy_user_id IS NOT NULL
    `);
    patientResult.rows.forEach(row => {
        patientMap.set(row.legacy_user_id, row.id);
    });
    console.log(`✓ Built patient lookup map: ${patientMap.size} entries`);

    const doctorMap = new Map<number, string>();
    const doctorResult = await targetClient.query(`
        SELECT legacy_user_id, id FROM profiles 
        WHERE profile_type = 'doctor' AND legacy_user_id IS NOT NULL
    `);
    doctorResult.rows.forEach(row => {
        doctorMap.set(row.legacy_user_id, row.id);
    });
    console.log(`✓ Built doctor lookup map: ${doctorMap.size} entries`);

    const officeMap = new Map<number, string>();
    const officeResult = await targetClient.query(`
        SELECT legacy_office_id, id FROM offices WHERE legacy_office_id IS NOT NULL
    `);
    officeResult.rows.forEach(row => {
        officeMap.set(row.legacy_office_id, row.id);
    });
    console.log(`✓ Built office lookup map: ${officeMap.size} entries`);

    // 3. Get orders that need to be migrated (using the same query as the main script)
    console.log('\n📦 Extracting orders to migrate...');
    
    const sourceOrdersQuery = `
        SELECT 
            i.id as legacy_instruction_id,
            CONCAT(p.suffix, '-', i.id) as order_number,
            
            -- Keep legacy IDs for later resolution
            p.user_id as legacy_user_id,
            p.doctor_id as legacy_doctor_id,  
            p.office_id as legacy_office_id,
            
            -- Map course_id to course_type enum
            CASE 
              WHEN i.course_id = 1 THEN 'main'
              WHEN i.course_id = 2 THEN 'refinement'
              WHEN i.course_id = 3 THEN 'replacement'
              WHEN i.course_id = 4 THEN 'any'
              WHEN i.course_id = 7 THEN 'invoice'
              WHEN i.course_id = 8 THEN 'merchandise'
              ELSE 'main'
            END as course_type,
            
            -- Map status integer to enum
            CASE 
              WHEN i.status = 0 THEN 'no_product'
              WHEN i.status = 1 THEN 'submitted'
              WHEN i.status = 2 THEN 'approved'
              WHEN i.status = 4 THEN 'shipped'
              ELSE 'no_product'
            END as status,
            
            i.notes,
            i.complaint,
            i.price as amount,
            i.submitted_at,
            i.updated_at,
            
            -- Try to extract more metadata
            '{}'::jsonb as metadata,
            '{}'::jsonb as exports
            
        FROM dispatch_instruction i
        INNER JOIN dispatch_patient p ON i.patient_id = p.id
        
        WHERE i.deleted = false
        ORDER BY i.id
        LIMIT 1000
    `;

    const sourceOrders = await sourceClient.query(sourceOrdersQuery);
    console.log(`📦 Found ${sourceOrders.rows.length} orders from source`);

    // 4. Get existing orders to avoid duplicates
    const existingOrdersResult = await targetClient.query(`
        SELECT legacy_instruction_id FROM orders WHERE legacy_instruction_id IS NOT NULL
    `);
    const existingIds = new Set(existingOrdersResult.rows.map(row => row.legacy_instruction_id));
    console.log(`📋 Found ${existingIds.size} existing orders in target`);

    let successCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // 5. Migrate orders one by one
    for (const [index, order] of sourceOrders.rows.entries()) {
        // Skip if already exists
        if (existingIds.has(order.legacy_instruction_id)) {
            skippedCount++;
            continue;
        }

        const legacyUserId = order.legacy_user_id;
        const legacyDoctorId = order.legacy_doctor_id;
        const legacyOfficeId = order.legacy_office_id;

        const patientUuid = patientMap.get(legacyUserId);
        const doctorUuid = doctorMap.get(legacyUserId) || (legacyDoctorId ? doctorMap.get(legacyDoctorId) : null);
        const officeUuid = legacyOfficeId ? officeMap.get(legacyOfficeId) : null;

        if (!patientUuid) {
            console.log(`⚠️ Skipping order ${order.legacy_instruction_id}: Patient not found for user_id ${legacyUserId}`);
            skippedCount++;
            continue;
        }

        if (!doctorUuid) {
            console.log(`⚠️ Skipping order ${order.legacy_instruction_id}: Doctor not found for user_id ${legacyUserId} or doctor_id ${legacyDoctorId}`);
            skippedCount++;
            continue;
        }

        try {
            const insertResult = await targetClient.query(`
                INSERT INTO orders (
                    order_number, patient_id, doctor_id, office_id, course_type, status,
                    notes, complaint, amount, submitted_at, created_at, updated_at, 
                    metadata, exports, legacy_instruction_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12, $13, $14)
                RETURNING id
            `, [
                order.order_number,
                patientUuid,
                doctorUuid,
                officeUuid,
                order.course_type,
                order.status,
                order.notes,
                order.complaint,
                order.amount,
                order.submitted_at,
                order.updated_at,
                order.metadata,
                order.exports,
                order.legacy_instruction_id
            ]);

            successCount++;
            if ((index + 1) % 100 === 0) {
                console.log(`✅ Progress: ${index + 1}/${sourceOrders.rows.length} (${successCount} success, ${skippedCount} skipped, ${errorCount} errors)`);
            }

        } catch (error) {
            errorCount++;
            if (errorCount <= 3) { // Show first few errors for debugging
                console.log(`❌ Failed to insert order ${order.legacy_instruction_id}: ${(error as Error).message}`);
                console.log(`   Patient UUID: ${patientUuid}, Doctor UUID: ${doctorUuid}`);
            }
        }
    }

    await sourceClient.end();
    await targetClient.end();

    console.log(`\n🎉 Migration batch completed!`);
    console.log(`✅ Successfully migrated: ${successCount}`);
    console.log(`⚠️ Skipped (already exist): ${skippedCount}`);
    console.log(`❌ Errors: ${errorCount}`);

    if (successCount > 0) {
        console.log('\n🔄 You can run this script multiple times to migrate more orders!');
    }

    process.exit(0);
}

fixOrdersMigration().catch(console.error);
