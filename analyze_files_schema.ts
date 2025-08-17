import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

async function analyzeFilesSchema() {
    console.log('🔍 Analyzing Files Schema for Migration\n');
    
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
        // 1. Analyze source dispatch_files table
        console.log('📋 Source: dispatch_files table schema:');
        const sourceColumns = await sourceClient.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'dispatch_file' 
            ORDER BY ordinal_position
        `);
        
        if (sourceColumns.rows.length === 0) {
            // Try dispatch_files (plural)
            const sourceColumnsPlural = await sourceClient.query(`
                SELECT column_name, data_type, is_nullable, column_default
                FROM information_schema.columns 
                WHERE table_name = 'dispatch_files' 
                ORDER BY ordinal_position
            `);
            
            if (sourceColumnsPlural.rows.length > 0) {
                console.log('   Table name: dispatch_files');
                sourceColumnsPlural.rows.forEach(row => {
                    console.log(`   - ${row.column_name} (${row.data_type}) ${row.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
                });
            } else {
                console.log('   ❌ Table not found with either name');
            }
        } else {
            console.log('   Table name: dispatch_file');
            sourceColumns.rows.forEach(row => {
                console.log(`   - ${row.column_name} (${row.data_type}) ${row.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
            });
        }

        // 2. Get record count
        console.log('\n📊 Source data analysis:');
        try {
            const sourceCount = await sourceClient.query('SELECT COUNT(*) as count FROM dispatch_file');
            console.log(`   Total records in dispatch_file: ${sourceCount.rows[0].count}`);
        } catch (e) {
            try {
                const sourceCountPlural = await sourceClient.query('SELECT COUNT(*) as count FROM dispatch_files');
                console.log(`   Total records in dispatch_files: ${sourceCountPlural.rows[0].count}`);
            } catch (e2) {
                console.log('   ❌ Could not count records');
            }
        }

        // 3. Analyze target files table
        console.log('\n📋 Target: files table schema:');
        const targetColumns = await targetClient.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'files' 
            ORDER BY ordinal_position
        `);
        
        if (targetColumns.rows.length > 0) {
            targetColumns.rows.forEach(row => {
                console.log(`   - ${row.column_name} (${row.data_type}) ${row.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
            });
        } else {
            console.log('   ❌ files table not found in target');
        }

        // 4. Get target record count
        try {
            const targetCount = await targetClient.query('SELECT COUNT(*) as count FROM files');
            console.log(`\n   Current records in target files table: ${targetCount.rows[0].count}`);
        } catch (e) {
            console.log('\n   ❌ Could not count target records');
        }

        // 5. Sample data from source
        console.log('\n📄 Sample records from source:');
        try {
            const sampleData = await sourceClient.query(`
                SELECT * FROM dispatch_file ORDER BY id LIMIT 3
            `);
            
            if (sampleData.rows.length > 0) {
                console.table(sampleData.rows);
            } else {
                console.log('   No data found');
            }
        } catch (e) {
            try {
                const sampleDataPlural = await sourceClient.query(`
                    SELECT * FROM dispatch_files ORDER BY id LIMIT 3
                `);
                
                if (sampleDataPlural.rows.length > 0) {
                    console.table(sampleDataPlural.rows);
                } else {
                    console.log('   No data found');
                }
            } catch (e2) {
                console.log('   ❌ Could not fetch sample data');
            }
        }

    } finally {
        await sourceClient.end();
        await targetClient.end();
    }
}

analyzeFilesSchema().catch(console.error);
