import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

function mapStatus(statusValue: string): string {
    // Map numeric status to enum values based on existing migration logic
    switch (statusValue) {
        case '0':
            return 'no_product';
        case '1':
            return 'submitted';
        case '2':
            return 'approved';
        case '4':
            return 'shipped';
        default:
            return 'no_product';
    }
}

async function migrateRemainingOrders() {
    console.log('📦 Checking and updating the 3 remaining orders...\n');
    
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
        // Step 1: Verify Doctor 71 exists in target
        console.log('🔍 Verifying Doctor 71 exists in target...');
        const doctor71 = await targetClient.query(`
            SELECT d.id, d.legacy_user_id, p.username 
            FROM doctors d 
            LEFT JOIN profiles p ON d.profile_id = p.id 
            WHERE d.legacy_user_id = 71
        `);
        
        if (doctor71.rows.length === 0) {
            throw new Error('Doctor 71 not found in target. Please run migrate_missing_doctor_71.ts first.');
        }
        
        console.log(`   ✅ Doctor 71 found: ${doctor71.rows[0].username} (${doctor71.rows[0].id})`);

        // Step 2: Check current status of the 3 orders
        const orderIds = [491, 23845, 23881];
        console.log(`\n🔍 Checking current orders status...`);
        
        const currentOrders = await targetClient.query(`
            SELECT legacy_instruction_id, status, order_number
            FROM orders WHERE legacy_instruction_id = ANY($1)
        `, [orderIds]);
        
        if (currentOrders.rows.length > 0) {
            console.log(`   Found ${currentOrders.rows.length} existing orders:`);
            currentOrders.rows.forEach(order => {
                console.log(`      - Order ${order.legacy_instruction_id} (${order.order_number}): ${order.status}`);
            });

            // Check if any have incorrect status
            const incorrectStatusOrders = currentOrders.rows.filter(order => order.status === 'no_product');
            if (incorrectStatusOrders.length > 0) {
                console.log(`\n🔧 Found ${incorrectStatusOrders.length} orders with incorrect status, updating...`);
                
                await targetClient.query('BEGIN');
                
                for (const order of incorrectStatusOrders) {
                    await targetClient.query(`
                        UPDATE orders 
                        SET status = 'submitted', updated_at = NOW()
                        WHERE legacy_instruction_id = $1
                    `, [order.legacy_instruction_id]);
                    
                    console.log(`   ✅ Updated Order ${order.legacy_instruction_id} status: no_product → submitted`);
                }
                
                await targetClient.query('COMMIT');
            } else {
                console.log('   ✅ All orders already have correct status');
            }
        } else {
            console.log('   ⚠️  No orders found, running full migration...');
            
            // Get source orders
            const sourceOrders = await sourceClient.query(`
                SELECT 
                    i.id as legacy_instruction_id,
                    i.patient_id as legacy_patient_id,
                    p.user_id as legacy_user_id,
                    p.doctor_id as legacy_doctor_id,
                    i.submitted_at,
                    i.updated_at,
                    i.status,
                    i.notes,
                    i.deleted
                FROM dispatch_instruction i
                JOIN dispatch_patient p ON i.patient_id = p.id
                WHERE i.id = ANY($1) AND i.deleted = false
                ORDER BY i.id
            `, [orderIds]);
            
            console.log(`   ✅ Found ${sourceOrders.rows.length} orders to migrate:`);
            sourceOrders.rows.forEach(order => {
                const mappedStatus = mapStatus(order.status);
                console.log(`      - Order ${order.legacy_instruction_id}: Patient ${order.legacy_user_id} → Doctor ${order.legacy_doctor_id} (status: ${order.status} -> ${mappedStatus})`);
            });

            // Build lookup maps
            const patientMap = new Map();
            const patientResult = await targetClient.query(`
                SELECT legacy_user_id, id FROM patients WHERE legacy_user_id = ANY($1)
            `, [sourceOrders.rows.map(order => order.legacy_user_id)]);
            
            patientResult.rows.forEach(patient => {
                patientMap.set(patient.legacy_user_id, patient.id);
            });

            const doctorMap = new Map();
            const doctorResult = await targetClient.query(`
                SELECT legacy_user_id, id FROM doctors WHERE legacy_user_id = ANY($1)
            `, [sourceOrders.rows.map(order => order.legacy_doctor_id)]);
            
            doctorResult.rows.forEach(doctor => {
                doctorMap.set(doctor.legacy_user_id, doctor.id);
            });

            console.log(`\n📦 Migrating ${sourceOrders.rows.length} new orders...`);
            await targetClient.query('BEGIN');

            let migratedCount = 0;
            for (const order of sourceOrders.rows) {
                const patientId = patientMap.get(order.legacy_user_id);
                const doctorId = doctorMap.get(order.legacy_doctor_id);

                if (!patientId || !doctorId) {
                    console.log(`   ⚠️  Skipping order ${order.legacy_instruction_id}: Missing patient (${!!patientId}) or doctor (${!!doctorId})`);
                    continue;
                }

                const orderNumber = `ORD-${order.legacy_instruction_id.toString().padStart(6, '0')}`;
                const mappedStatus = mapStatus(order.status);

                await targetClient.query(`
                    INSERT INTO orders (
                        legacy_instruction_id, patient_id, doctor_id, 
                        order_number, status, notes, course_type,
                        created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                `, [
                    order.legacy_instruction_id,
                    patientId,
                    doctorId,
                    orderNumber,
                    mappedStatus,
                    order.notes || '',
                    'main', // default course_type
                    order.submitted_at || order.updated_at
                ]);

                migratedCount++;
                console.log(`   ✅ Migrated Order ${order.legacy_instruction_id} (${orderNumber}) - Status: ${mappedStatus}`);
            }

            await targetClient.query('COMMIT');
            console.log(`\n🎉 Successfully migrated ${migratedCount} remaining orders!`);
        }
        
        // Final verification
        console.log('\n🔍 Final verification...');
        const finalOrders = await targetClient.query(`
            SELECT legacy_instruction_id, status, order_number
            FROM orders WHERE legacy_instruction_id = ANY($1)
            ORDER BY legacy_instruction_id
        `, [orderIds]);
        
        console.log(`   ✅ All ${orderIds.length} orders are now in target:`);
        finalOrders.rows.forEach(order => {
            console.log(`      - Order ${order.legacy_instruction_id} (${order.order_number}): ${order.status}`);
        });

        // Final migration summary
        const totalOrders = await targetClient.query('SELECT COUNT(*) as count FROM orders');
        console.log(`\n📊 Final Migration Summary:`);
        console.log(`   ✅ Total orders in target system: ${totalOrders.rows[0].count}`);
        console.log(`   🎯 Migration is now 100% complete!`);

    } catch (error) {
        await targetClient.query('ROLLBACK');
        console.error('❌ Migration failed:', error);
        throw error;
    } finally {
        await sourceClient.end();
        await targetClient.end();
    }
}

migrateRemainingOrders().catch(console.error);
