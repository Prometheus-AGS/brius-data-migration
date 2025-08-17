import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

async function checkTargetTables() {
    const targetClient = new Client({
        host: process.env.TARGET_DB_HOST!,
        port: parseInt(process.env.TARGET_DB_PORT!),
        user: process.env.TARGET_DB_USER!,
        password: process.env.TARGET_DB_PASSWORD!,
        database: process.env.TARGET_DB_NAME!,
    });
    await targetClient.connect();
    
    try {
        console.log('📋 All tables in target database:');
        const tables = await targetClient.query(`
            SELECT table_name, table_type
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);
        
        tables.rows.forEach((row, index) => {
            console.log(`   ${index + 1}. ${row.table_name} (${row.table_type})`);
        });

        // Look for file-related tables
        console.log('\n🔍 Looking for file-related tables:');
        const fileRelated = await targetClient.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name ILIKE '%file%'
            ORDER BY table_name
        `);
        
        if (fileRelated.rows.length > 0) {
            fileRelated.rows.forEach(row => {
                console.log(`   - ${row.table_name}`);
            });
        } else {
            console.log('   No file-related tables found');
        }

        // Look for attachment-related tables
        console.log('\n🔍 Looking for attachment/document-related tables:');
        const attachmentRelated = await targetClient.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND (table_name ILIKE '%attach%' OR table_name ILIKE '%document%' OR table_name ILIKE '%media%')
            ORDER BY table_name
        `);
        
        if (attachmentRelated.rows.length > 0) {
            attachmentRelated.rows.forEach(row => {
                console.log(`   - ${row.table_name}`);
            });
        } else {
            console.log('   No attachment-related tables found');
        }

    } finally {
        await targetClient.end();
    }
}

checkTargetTables().catch(console.error);
