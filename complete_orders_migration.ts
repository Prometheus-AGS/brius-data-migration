import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

async function completeOrdersMigration() {
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

    console.log('🚀 Completing orders migration - final push!\n');

    // Build lookup maps
    console.log('🗺️ Building UUID lookup maps...');
    
    const patientMap = new Map<number, string>();
    const patientResult = await targetClient.query(`
        SELECT legacy_user_id, id FROM patients WHERE legacy_user_id IS NOT NULL
    `);
    patientResult.rows.forEach(row => {
        patientMap.set(row.legacy_user_id, row.id);
    });

    const doctorMap = new Map<number, string>();
    const doctorResult = await targetClient.query(`
        SELECT legacy_user_id, id FROM profiles 
        WHERE profile_type = 'doctor' AND legacy_user_id IS NOT NULL
    `);
    doctorResult.rows.forEach(row => {
        doctorMap.set(row.legacy_user_id, row.id);
    });

    const officeMap = new Map<number, string>();
    const officeResult = await targetClient.query(`
        SELECT legacy_office_id, id FROM offices WHERE legacy_office_id IS NOT NULL
    `);
    officeResult.rows.forEach(row => {
        officeMap.set(row.legacy_office_id, row.id);
    });

    console.log(`✓ Built patient lookup map: ${patientMap.size} entries`);
    console.log(`✓ Built doctor lookup map: ${doctorMap.size} entries`);
    console.log(`✓ Built office lookup map: ${officeMap.size} entries`);

    // Get existing orders
    const existingOrdersResult = await targetClient.query(`
        SELECT legacy_instruction_id FROM orders WHERE legacy_instruction_id IS NOT NULL
    `);
    const existingIds = new Set(existingOrdersResult.rows.map(row => row.legacy_instruction_id));
    console.log(`📋 Found ${existingIds.size} existing orders in target`);

    // Get orders that need to be migrated
    const sourceOrdersQuery = `
        SELECT 
            i.id as legacy_instruction_id,
            CONCAT(p.suffix, '-', i.id) as order_number,
            p.user_id as legacy_user_id,
            p.doctor_id as legacy_doctor_id,  
            p.office_id as legacy_office_id,
            
            CASE 
              WHEN i.course_id = 1 THEN 'main'
              WHEN i.course_id = 2 THEN 'refinement'
              WHEN i.course_id = 3 THEN 'replacement'
              WHEN i.course_id = 4 THEN 'any'
              WHEN i.course_id = 7 THEN 'invoice'
              WHEN i.course_id = 8 THEN 'merchandise'
              ELSE 'main'
            END as course_type,
            
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
            i.updated_at
            
        FROM dispatch_instruction i
        INNER JOIN dispatch_patient p ON i.patient_id = p.id
        
        WHERE i.deleted = false
        AND i.id NOT IN (${Array.from(existingIds).join(',')})
        ORDER BY i.id
    `;

    console.log(`\n📦 Extracting remaining orders...`);
    const sourceOrders = await sourceClient.query(sourceOrdersQuery);
    console.log(`📦 Found ${sourceOrders.rows.length} orders to migrate`);

    let successCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // Migrate in batches with progress reporting
    const batchSize = 100;
    for (let i = 0; i < sourceOrders.rows.length; i += batchSize) {
        const batch = sourceOrders.rows.slice(i, i + batchSize);
        console.log(`\n🔄 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(sourceOrders.rows.length/batchSize)} (${batch.length} orders)...`);

        for (const order of batch) {
            const legacyUserId = order.legacy_user_id;
            const legacyDoctorId = order.legacy_doctor_id;
            const legacyOfficeId = order.legacy_office_id;

            const patientUuid = patientMap.get(legacyUserId);
            const doctorUuid = doctorMap.get(legacyUserId) || (legacyDoctorId ? doctorMap.get(legacyDoctorId) : null);
            const officeUuid = legacyOfficeId ? officeMap.get(legacyOfficeId) : null;

            if (!patientUuid) {
                skippedCount++;
                continue;
            }

            if (!doctorUuid) {
                skippedCount++;
                continue;
            }

            try {
                await targetClient.query(`
                    INSERT INTO orders (
                        order_number, patient_id, doctor_id, office_id, course_type, status,
                        notes, complaint, amount, submitted_at, created_at, updated_at, 
                        metadata, exports, legacy_instruction_id
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, '{}'::jsonb, '{}'::jsonb, $12)
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
                    order.legacy_instruction_id
                ]);

                successCount++;

            } catch (error) {
                errorCount++;
                if (errorCount <= 5) {
                    console.log(`❌ Error on order ${order.legacy_instruction_id}: ${(error as Error).message.slice(0, 80)}`);
                }
            }
        }

        console.log(`   ✅ Batch complete: ${successCount} success, ${skippedCount} skipped, ${errorCount} errors so far`);
    }

    await sourceClient.end();
    await targetClient.end();

    console.log(`\n🎉 FINAL Migration Results:`);
    console.log(`✅ Successfully migrated: ${successCount}`);
    console.log(`⚠️ Skipped (missing refs): ${skippedCount}`);
    console.log(`❌ Errors: ${errorCount}`);

    const finalTotal = existingIds.size + successCount;
    console.log(`🎯 Total orders in system: ${finalTotal}`);

    process.exit(0);
}

completeOrdersMigration().catch(console.error);
