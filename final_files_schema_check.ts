import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

async function finalFilesSchemaCheck() {
    const targetClient = new Client({
        host: process.env.TARGET_DB_HOST!,
        port: parseInt(process.env.TARGET_DB_PORT!),
        user: process.env.TARGET_DB_USER!,
        password: process.env.TARGET_DB_PASSWORD!,
        database: process.env.TARGET_DB_NAME!,
    });
    await targetClient.connect();
    
    try {
        console.log('📋 files table structure:');
        const result = await targetClient.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'files' 
            ORDER BY ordinal_position
        `);
        
        if (result.rows.length > 0) {
            console.table(result.rows);
            
            // Test simple insert
            console.log('\n🧪 Testing simple insert...');
            try {
                await targetClient.query(`
                    INSERT INTO files (file_uid, filename, legacy_file_id)
                    VALUES ('00000000-0000-0000-0000-000000000000', 'test.txt', -999)
                    ON CONFLICT (legacy_file_id) DO UPDATE SET filename = EXCLUDED.filename
                `);
                
                console.log('✅ Simple insert successful');
                
                // Clean up test
                await targetClient.query('DELETE FROM files WHERE legacy_file_id = -999');
                
            } catch (error) {
                console.error('❌ Simple insert failed:', error);
            }
            
        } else {
            console.log('❌ files table not found');
        }

        // Check current file count
        const count = await targetClient.query('SELECT COUNT(*) as count FROM files');
        console.log(`\nCurrent files count: ${count.rows[0].count}`);

    } finally {
        await targetClient.end();
    }
}

finalFilesSchemaCheck().catch(console.error);
