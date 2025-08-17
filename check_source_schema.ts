import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

async function checkSourceSchema() {
    const sourceClient = new Client({
        host: process.env.SOURCE_DB_HOST!,
        port: parseInt(process.env.SOURCE_DB_PORT!),
        user: process.env.SOURCE_DB_USER!,
        password: process.env.SOURCE_DB_PASSWORD!,
        database: process.env.SOURCE_DB_NAME!,
    });
    await sourceClient.connect();
    
    try {
        console.log('📋 Tables in source database:');
        const tables = await sourceClient.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);
        
        tables.rows.forEach(row => console.log(`  - ${row.table_name}`));
        
        // Check for user-related tables
        console.log('\n🔍 Looking for user-related tables:');
        const userTables = await sourceClient.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name ILIKE '%user%'
            ORDER BY table_name
        `);
        
        if (userTables.rows.length > 0) {
            userTables.rows.forEach(row => console.log(`  - ${row.table_name}`));
        } else {
            console.log('  No user-related tables found');
        }

    } finally {
        await sourceClient.end();
    }
}

checkSourceSchema().catch(console.error);
