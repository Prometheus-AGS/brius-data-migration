import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function debugOrdersFK() {
    // Get target database connection
    const targetClient = new Client({
        host: process.env.TARGET_DB_HOST!,
        port: parseInt(process.env.TARGET_DB_PORT!),
        user: process.env.TARGET_DB_USER!,
        password: process.env.TARGET_DB_PASSWORD!,
        database: process.env.TARGET_DB_NAME!,
    });
    await targetClient.connect();

    console.log('🔍 Debugging Orders FK Constraint Issue...\n');

    // 1. Check doctor lookup map like the orders migration does
    console.log('1️⃣ Building doctor lookup map (like orders migration)...');
    const doctorMap = new Map<number, string>();
    const doctorResult = await targetClient.query(`
      SELECT legacy_user_id, id 
      FROM profiles 
      WHERE profile_type = 'doctor' AND legacy_user_id IS NOT NULL
    `);
    doctorResult.rows.forEach(row => {
        doctorMap.set(row.legacy_user_id, row.id);
    });
    console.log(`   📊 Doctor lookup map size: ${doctorMap.size}`);

    // 2. Test a specific doctor ID that we know exists
    const testLegacyId = 533;
    const testDoctorUuid = doctorMap.get(testLegacyId);
    console.log(`   🧪 Test doctor ${testLegacyId} -> UUID: ${testDoctorUuid}`);

    if (testDoctorUuid) {
        // 3. Check if this UUID exists in doctors table
        const doctorCheck = await targetClient.query('SELECT id FROM doctors WHERE id = $1', [testDoctorUuid]);
        console.log(`   ✅ Doctor exists in doctors table: ${doctorCheck.rows.length > 0}`);

        // 4. Get a real patient ID
        const patientResult = await targetClient.query('SELECT id FROM patients LIMIT 1');
        const testPatientId = patientResult.rows[0]?.id;
        console.log(`   🧪 Test patient ID: ${testPatientId}`);

        if (testPatientId) {
            // 5. Try to insert a test order
            console.log('\n2️⃣ Testing order insertion...');
            try {
                const testOrderData = {
                    order_number: `TEST-${Date.now()}`,
                    patient_id: testPatientId,
                    doctor_id: testDoctorUuid,
                    course_type: 'main',
                    status: 'submitted',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };

                const insertResult = await targetClient.query(`
                    INSERT INTO orders (order_number, patient_id, doctor_id, course_type, status, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    RETURNING id
                `, [
                    testOrderData.order_number,
                    testOrderData.patient_id, 
                    testOrderData.doctor_id,
                    testOrderData.course_type,
                    testOrderData.status,
                    testOrderData.created_at,
                    testOrderData.updated_at
                ]);

                console.log(`   ✅ Test order inserted successfully! ID: ${insertResult.rows[0].id}`);
                
                // Clean up test order
                await targetClient.query('DELETE FROM orders WHERE id = $1', [insertResult.rows[0].id]);
                console.log('   🧹 Test order cleaned up');

            } catch (error) {
                console.log(`   ❌ Test order insertion failed: ${(error as Error).message}`);
            }
        }
    }

    // 6. Check for UUID type issues
    console.log('\n3️⃣ Checking for type issues...');
    const typeCheck = await targetClient.query(`
        SELECT 
            column_name,
            data_type,
            is_nullable
        FROM information_schema.columns 
        WHERE table_name = 'orders' AND column_name IN ('doctor_id', 'patient_id')
        ORDER BY column_name
    `);
    console.log('   📋 Orders table column types:');
    console.table(typeCheck.rows);

    await targetClient.end();
    process.exit(0);
}

debugOrdersFK().catch(console.error);
