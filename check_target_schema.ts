import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

async function checkTargetSchema() {
    const targetClient = new Client({
        host: process.env.TARGET_DB_HOST!,
        port: parseInt(process.env.TARGET_DB_PORT!),
        user: process.env.TARGET_DB_USER!,
        password: process.env.TARGET_DB_PASSWORD!,
        database: process.env.TARGET_DB_NAME!,
    });
    await targetClient.connect();
    
    try {
        console.log('📋 Doctors table columns:');
        const doctorsColumns = await targetClient.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'doctors' 
            ORDER BY ordinal_position
        `);
        
        doctorsColumns.rows.forEach(row => console.log(`  - ${row.column_name} (${row.data_type})`));

    } finally {
        await targetClient.end();
    }
}

checkTargetSchema().catch(console.error);
