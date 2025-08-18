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
        
        // 1. Check dispatch_file table structure
        console.log('📋 dispatch_file table structure:');
        const fileStructure = await sourceClient.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = 'dispatch_file' AND table_schema = 'public'
            ORDER BY ordinal_position;
        `);
        
        fileStructure.rows.forEach(col => {
            console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}`);
        });
        
        // 2. Count total records
        const fileCount = await sourceClient.query('SELECT COUNT(*) as count FROM dispatch_file');
        console.log(`\n📊 Total dispatch_file records: ${fileCount.rows[0].count}`);
        
        // 3. Sample records to understand data
        const sampleFiles = await sourceClient.query(`
            SELECT * FROM dispatch_file
            ORDER BY id
            LIMIT 3;
        `);
        
        if (sampleFiles.rows.length > 0) {
            console.log('\n📄 Sample dispatch_file records:');
            sampleFiles.rows.forEach((row, index) => {
                console.log(`\nRecord ${index + 1}:`, JSON.stringify(row, null, 2));
            });
        }
        
        // 4. Analyze relationships to other tables
        console.log('\n🔗 Analyzing relationships...');
        
        // Check instruction_id relationships
        const instructionLinks = await sourceClient.query(`
            SELECT COUNT(*) as count 
            FROM dispatch_file df 
            WHERE df.instruction_id IS NOT NULL;
        `);
        console.log(`Files with instruction_id: ${instructionLinks.rows[0].count}`);
        
        // Check record_id relationships (might link to orders, patients, etc.)
        const recordLinks = await sourceClient.query(`
            SELECT COUNT(*) as count 
            FROM dispatch_file df 
            WHERE df.record_id IS NOT NULL;
        `);
        console.log(`Files with record_id: ${recordLinks.rows[0].count}`);
        
        // Check product_id relationships
        const productLinks = await sourceClient.query(`
            SELECT COUNT(*) as count 
            FROM dispatch_file df 
            WHERE df.product_id IS NOT NULL;
        `);
        console.log(`Files with product_id: ${productLinks.rows[0].count}`);
        
        // 5. Check what record_id might refer to by sampling some values
        const recordIdSample = await sourceClient.query(`
            SELECT DISTINCT record_id, COUNT(*) as count
            FROM dispatch_file 
            WHERE record_id IS NOT NULL
            GROUP BY record_id
            ORDER BY count DESC
            LIMIT 10;
        `);
        
        console.log('\n📊 Most common record_id values (might indicate case/order links):');
        recordIdSample.rows.forEach(row => {
            console.log(`  record_id ${row.record_id}: ${row.count} files`);
        });
        
        // 6. Check if we can find cases/orders that these files belong to
        console.log('\n🔍 Checking for case/order relationships...');
        
        // Check if record_id maps to dispatch_order
        const orderCheck = await sourceClient.query(`
            SELECT COUNT(*) as count
            FROM dispatch_file df
            JOIN dispatch_order do ON df.record_id = do.id
            WHERE df.record_id IS NOT NULL;
        `);
        console.log(`Files linked to orders: ${orderCheck.rows[0].count}`);
        
        // Check if record_id maps to dispatch_case  
        const caseCheck = await sourceClient.query(`
            SELECT COUNT(*) as count
            FROM dispatch_file df
            JOIN dispatch_case dc ON df.record_id = dc.id
            WHERE df.record_id IS NOT NULL;
        `);
        console.log(`Files linked to cases: ${caseCheck.rows[0].count}`);
        
        // Check if instruction_id maps to dispatch_instruction
        const instructionCheck = await sourceClient.query(`
            SELECT COUNT(*) as count
            FROM dispatch_file df
            JOIN dispatch_instruction di ON df.instruction_id = di.id
            WHERE df.instruction_id IS NOT NULL;
        `);
        console.log(`Files linked to instructions: ${instructionCheck.rows[0].count}`);
        
    } catch (error) {
        console.error('❌ Error analyzing source data:', error);
    } finally {
        await sourceClient.end();
    }
}

analyzeSourceData().catch(console.error);
