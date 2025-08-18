import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

async function analyzeSourceData() {
    console.log('🔍 Analyzing source dispatch_file table and related data...\n');
    
    const sourceClient = new Client({
        host: process.env.SOURCE_DB_HOST!,
        port: parseInt(process.env.SOURCE_DB_PORT!),
        user: process.env.SOURCE_DB_USER!,
        password: process.env.SOURCE_DB_PASSWORD!,
        database: process.env.SOURCE_DB_NAME!,
    });
    
    try {
        await sourceClient.connect();
        
        console.log('📊 Summary from previous analysis:');
        console.log('- Total dispatch_file records: 294,818');
        console.log('- Files with instruction_id: 147,468');
        console.log('- Files with record_id: 6,571');
        console.log('- Files with product_id: 0\n');
        
        // Check if record_id maps to dispatch_order
        console.log('🔍 Checking relationships...');
        try {
            const orderCheck = await sourceClient.query(`
                SELECT COUNT(*) as count
                FROM dispatch_file df
                JOIN dispatch_order ord ON df.record_id = ord.id
                WHERE df.record_id IS NOT NULL;
            `);
            console.log(`Files linked to orders: ${orderCheck.rows[0].count}`);
        } catch (e) {
            console.log('Files linked to orders: Error checking');
        }
        
        // Check if record_id maps to dispatch_case  
        try {
            const caseCheck = await sourceClient.query(`
                SELECT COUNT(*) as count
                FROM dispatch_file df
                JOIN dispatch_case cas ON df.record_id = cas.id
                WHERE df.record_id IS NOT NULL;
            `);
            console.log(`Files linked to cases: ${caseCheck.rows[0].count}`);
        } catch (e) {
            console.log('Files linked to cases: Error checking');
        }
        
        // Check if instruction_id maps to dispatch_instruction
        try {
            const instructionCheck = await sourceClient.query(`
                SELECT COUNT(*) as count
                FROM dispatch_file df
                JOIN dispatch_instruction inst ON df.instruction_id = inst.id
                WHERE df.instruction_id IS NOT NULL;
            `);
            console.log(`Files linked to instructions: ${instructionCheck.rows[0].count}`);
        } catch (e) {
            console.log('Files linked to instructions: Error checking');
        }
        
        // Check what types exist
        console.log('\n📊 File types distribution:');
        const typeDistribution = await sourceClient.query(`
            SELECT type, COUNT(*) as count
            FROM dispatch_file
            GROUP BY type
            ORDER BY count DESC;
        `);
        
        typeDistribution.rows.forEach(row => {
            console.log(`  Type ${row.type}: ${row.count} files`);
        });
        
        // Check status distribution
        console.log('\n📊 File status distribution:');
        const statusDistribution = await sourceClient.query(`
            SELECT status, COUNT(*) as count
            FROM dispatch_file
            GROUP BY status
            ORDER BY count DESC;
        `);
        
        statusDistribution.rows.forEach(row => {
            console.log(`  Status ${row.status}: ${row.count} files`);
        });
        
        // Get sample of files with relationships
        console.log('\n📄 Sample files with relationships:');
        const relationshipSample = await sourceClient.query(`
            SELECT id, name, ext, instruction_id, record_id, created_at
            FROM dispatch_file
            WHERE instruction_id IS NOT NULL OR record_id IS NOT NULL
            ORDER BY id
            LIMIT 5;
        `);
        
        relationshipSample.rows.forEach((row, index) => {
            console.log(`File ${index + 1}: ${row.name} (instruction_id: ${row.instruction_id}, record_id: ${row.record_id})`);
        });
        
    } catch (error) {
        console.error('❌ Error analyzing source data:', error);
    } finally {
        await sourceClient.end();
    }
}

analyzeSourceData().catch(console.error);
