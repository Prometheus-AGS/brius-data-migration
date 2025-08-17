import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

async function checkFilesSchemaDetailed() {
    const targetClient = new Client({
        host: process.env.TARGET_DB_HOST!,
        port: parseInt(process.env.TARGET_DB_PORT!),
        user: process.env.TARGET_DB_USER!,
        password: process.env.TARGET_DB_PASSWORD!,
        database: process.env.TARGET_DB_NAME!,
    });
    await targetClient.connect();
    
    try {
        console.log('📋 Detailed target files table schema:');
        const targetColumns = await targetClient.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'files' 
            ORDER BY ordinal_position
        `);
        
        targetColumns.rows.forEach((row, index) => {
            console.log(`   ${index + 1}. ${row.column_name} (${row.data_type}) ${row.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'} ${row.column_default ? `DEFAULT ${row.column_default}` : ''}`);
        });

        // Check constraints
        console.log('\n📋 Table constraints:');
        const constraints = await targetClient.query(`
            SELECT constraint_name, constraint_type
            FROM information_schema.table_constraints
            WHERE table_name = 'files'
        `);
        
        constraints.rows.forEach(row => {
            console.log(`   - ${row.constraint_name} (${row.constraint_type})`);
        });

        // Check indexes
        console.log('\n📋 Table indexes:');
        const indexes = await targetClient.query(`
            SELECT indexname, indexdef
            FROM pg_indexes
            WHERE tablename = 'files'
        `);
        
        indexes.rows.forEach(row => {
            console.log(`   - ${row.indexname}`);
        });

    } finally {
        await targetClient.end();
    }
}

checkFilesSchemaDetailed().catch(console.error);
