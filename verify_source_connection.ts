import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

async function verifySourceConnection() {
    console.log('🔍 Verifying Direct Source Database Connection\n');
    
    // Show connection details (without sensitive info)
    console.log('📋 Source connection configuration:');
    console.log(`   Host: ${process.env.SOURCE_DB_HOST}`);
    console.log(`   Port: ${process.env.SOURCE_DB_PORT}`);
    console.log(`   User: ${process.env.SOURCE_DB_USER}`);
    console.log(`   Database: ${process.env.SOURCE_DB_NAME}`);
    
    const sourceClient = new Client({
        host: process.env.SOURCE_DB_HOST!,
        port: parseInt(process.env.SOURCE_DB_PORT!),
        user: process.env.SOURCE_DB_USER!,
        password: process.env.SOURCE_DB_PASSWORD!,
        database: process.env.SOURCE_DB_NAME!,
    });

    try {
        await sourceClient.connect();
        console.log('✅ Connected to source database successfully\n');
        
        // Check for dispatch_file table (singular)
        console.log('📋 Checking for dispatch_file table:');
        const tableExists = await sourceClient.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'dispatch_file'
            );
        `);
        
        console.log(`   dispatch_file table exists: ${tableExists.rows[0].exists}`);
        
        if (tableExists.rows[0].exists) {
            // Get table schema
            console.log('\n📋 dispatch_file table schema:');
            const columns = await sourceClient.query(`
                SELECT column_name, data_type, is_nullable
                FROM information_schema.columns 
                WHERE table_schema = 'public' AND table_name = 'dispatch_file' 
                ORDER BY ordinal_position
            `);
            
            columns.rows.forEach((col, index) => {
                console.log(`   ${index + 1}. ${col.column_name} (${col.data_type}) ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
            });
            
            // Get count
            const count = await sourceClient.query('SELECT COUNT(*) as count FROM dispatch_file');
            console.log(`\n📊 Total records in dispatch_file: ${count.rows[0].count}`);
            
            // Get sample records
            console.log('\n📄 Sample records from dispatch_file:');
            const sample = await sourceClient.query(`
                SELECT id, uid, name, ext, size, type, instruction_id, created_at, status
                FROM dispatch_file 
                ORDER BY id 
                LIMIT 5
            `);
            
            console.table(sample.rows);
            
            // Check instruction_id relationships
            console.log('\n🔗 Instruction ID analysis:');
            const instrStats = await sourceClient.query(`
                SELECT 
                    COUNT(*) as total_files,
                    COUNT(instruction_id) as files_with_instruction,
                    COUNT(DISTINCT instruction_id) as unique_instructions
                FROM dispatch_file
            `);
            
            const stats = instrStats.rows[0];
            console.log(`   Total files: ${stats.total_files}`);
            console.log(`   Files with instruction_id: ${stats.files_with_instruction}`);
            console.log(`   Files without instruction_id: ${stats.total_files - stats.files_with_instruction}`);
            console.log(`   Unique instruction IDs: ${stats.unique_instructions}`);
            
        } else {
            // Check for dispatch_files (plural) as fallback
            console.log('\n📋 Checking for dispatch_files table (plural):');
            const pluralExists = await sourceClient.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'dispatch_files'
                );
            `);
            
            console.log(`   dispatch_files table exists: ${pluralExists.rows[0].exists}`);
            
            if (!pluralExists.rows[0].exists) {
                // List all file-related tables
                console.log('\n📋 Looking for file-related tables:');
                const fileTables = await sourceClient.query(`
                    SELECT table_name
                    FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name ILIKE '%file%'
                    ORDER BY table_name
                `);
                
                if (fileTables.rows.length > 0) {
                    fileTables.rows.forEach(row => {
                        console.log(`   - ${row.table_name}`);
                    });
                } else {
                    console.log('   ❌ No file-related tables found');
                }
            }
        }
        
    } catch (error) {
        console.error('❌ Source database connection failed:', error);
    } finally {
        await sourceClient.end();
    }
}

verifySourceConnection().catch(console.error);
