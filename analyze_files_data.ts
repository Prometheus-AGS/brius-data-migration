import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

async function analyzeFilesData() {
    console.log('🔍 Analyzing Files Data Patterns\n');
    
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
        // 1. File type distribution
        console.log('📊 File type distribution:');
        const typeDistribution = await sourceClient.query(`
            SELECT type, COUNT(*) as count
            FROM dispatch_file
            GROUP BY type
            ORDER BY count DESC
        `);
        
        typeDistribution.rows.forEach(row => {
            console.log(`   Type ${row.type}: ${row.count} files`);
        });

        // 2. File extension analysis
        console.log('\n📊 File extension analysis:');
        const extDistribution = await sourceClient.query(`
            SELECT ext, COUNT(*) as count
            FROM dispatch_file
            GROUP BY ext
            ORDER BY count DESC
            LIMIT 10
        `);
        
        extDistribution.rows.forEach(row => {
            console.log(`   ${row.ext || 'NULL'}: ${row.count} files`);
        });

        // 3. File size analysis
        console.log('\n📊 File size analysis:');
        const sizeStats = await sourceClient.query(`
            SELECT 
                MIN(size) as min_size,
                MAX(size) as max_size,
                AVG(size)::bigint as avg_size,
                COUNT(*) as total_files,
                SUM(size) as total_size
            FROM dispatch_file
        `);
        
        const stats = sizeStats.rows[0];
        console.log(`   Min size: ${stats.min_size} bytes`);
        console.log(`   Max size: ${stats.max_size} bytes`);
        console.log(`   Avg size: ${stats.avg_size} bytes`);
        console.log(`   Total files: ${stats.total_files}`);
        console.log(`   Total size: ${(stats.total_size / (1024 * 1024 * 1024)).toFixed(2)} GB`);

        // 4. Instruction relationships
        console.log('\n📊 Instruction relationships:');
        const instructionStats = await sourceClient.query(`
            SELECT 
                COUNT(*) as total_files,
                COUNT(instruction_id) as files_with_instruction,
                COUNT(*) - COUNT(instruction_id) as files_without_instruction
            FROM dispatch_file
        `);
        
        const instrStats = instructionStats.rows[0];
        console.log(`   Total files: ${instrStats.total_files}`);
        console.log(`   Files with instruction_id: ${instrStats.files_with_instruction}`);
        console.log(`   Files without instruction_id: ${instrStats.files_without_instruction}`);

        // 5. Check if these instructions exist in our migrated orders
        console.log('\n🔗 Instruction ID mapping analysis:');
        const mappedInstructions = await sourceClient.query(`
            SELECT COUNT(DISTINCT df.instruction_id) as unique_instruction_ids
            FROM dispatch_file df
            WHERE df.instruction_id IS NOT NULL
        `);
        
        console.log(`   Unique instruction IDs: ${mappedInstructions.rows[0].unique_instruction_ids}`);

        // Check how many of these exist in target orders
        const existingOrders = await targetClient.query(`
            SELECT COUNT(DISTINCT legacy_instruction_id) as migrated_instructions
            FROM orders
        `);
        
        console.log(`   Migrated instructions in target: ${existingOrders.rows[0].migrated_instructions}`);

        // 6. Status analysis
        console.log('\n📊 Status distribution:');
        const statusDistribution = await sourceClient.query(`
            SELECT status, COUNT(*) as count
            FROM dispatch_file
            GROUP BY status
            ORDER BY status
        `);
        
        statusDistribution.rows.forEach(row => {
            console.log(`   Status ${row.status}: ${row.count} files`);
        });

        // 7. Date range analysis
        console.log('\n📅 Date range analysis:');
        const dateRange = await sourceClient.query(`
            SELECT 
                MIN(created_at) as earliest_file,
                MAX(created_at) as latest_file,
                COUNT(*) as total_files
            FROM dispatch_file
        `);
        
        const dates = dateRange.rows[0];
        console.log(`   Earliest file: ${dates.earliest_file}`);
        console.log(`   Latest file: ${dates.latest_file}`);
        console.log(`   Total files: ${dates.total_files}`);

        // 8. Sample of files with different characteristics
        console.log('\n📄 Sample files with instruction_id:');
        const samplesWithInstr = await sourceClient.query(`
            SELECT id, uid, name, ext, size, type, instruction_id, status
            FROM dispatch_file
            WHERE instruction_id IS NOT NULL
            ORDER BY id
            LIMIT 3
        `);
        
        console.table(samplesWithInstr.rows);

        console.log('\n📄 Sample files without instruction_id:');
        const samplesWithoutInstr = await sourceClient.query(`
            SELECT id, uid, name, ext, size, type, instruction_id, status
            FROM dispatch_file
            WHERE instruction_id IS NULL
            ORDER BY id
            LIMIT 3
        `);
        
        console.table(samplesWithoutInstr.rows);

    } finally {
        await sourceClient.end();
        await targetClient.end();
    }
}

analyzeFilesData().catch(console.error);
