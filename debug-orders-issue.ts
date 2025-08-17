import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function debugIssue() {
    const targetPool = new Pool({
        host: process.env.TARGET_DB_HOST || 'localhost',
        port: parseInt(process.env.TARGET_DB_PORT || '5432'),
        database: process.env.TARGET_DB_NAME || 'brius_target',
        user: process.env.TARGET_DB_USER || 'postgres',
        password: process.env.TARGET_DB_PASSWORD || 'password',
    });

    try {
        // Check patients table structure and sample data
        console.log("=== PATIENTS TABLE STRUCTURE ===");
        const patientsInfo = await targetPool.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'patients' 
            ORDER BY ordinal_position
        `);
        console.table(patientsInfo.rows);

        console.log("\n=== SAMPLE PATIENTS DATA ===");
        const samplePatients = await targetPool.query(`
            SELECT id, legacy_user_id 
            FROM patients 
            WHERE legacy_user_id IS NOT NULL 
            LIMIT 3
        `);
        console.table(samplePatients.rows);

        // Check orders table constraints
        console.log("\n=== ORDERS TABLE FOREIGN KEY CONSTRAINTS ===");
        const constraints = await targetPool.query(`
            SELECT tc.constraint_name, kcu.column_name, ccu.table_name AS referenced_table_name, ccu.column_name AS referenced_column_name
            FROM information_schema.table_constraints tc 
            JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
            WHERE tc.table_name = 'orders' AND tc.constraint_type = 'FOREIGN KEY'
        `);
        console.table(constraints.rows);
        
        // Check if there are any orders in the table
        console.log("\n=== ORDERS COUNT ===");
        const ordersCount = await targetPool.query(`SELECT COUNT(*) FROM orders`);
        console.log(`Total orders in table: ${ordersCount.rows[0].count}`);

    } catch (error) {
        console.error("Error:", error);
    } finally {
        await targetPool.end();
    }
}

debugIssue();
