import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

async function testFilesMigration() {
    console.log('🧪 Testing Files Migration with Small Batch\n');
    
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
        // Test with first 100 files
        console.log('📦 Testing migration with first 100 files...');
        
        // Get test data
        const testFiles = await sourceClient.query(`
            SELECT id, uid, name, ext, size, type, instruction_id, created_at, status
            FROM dispatch_file
            ORDER BY id
            LIMIT 100
        `);
        
        console.log(`   Found ${testFiles.rows.length} test files`);

        // Check current state
        const existingTest = await targetClient.query(`
            SELECT COUNT(*) as count
            FROM files
            WHERE legacy_file_id BETWEEN $1 AND $2
        `, [testFiles.rows[0].id, testFiles.rows[testFiles.rows.length - 1].id]);
        
        console.log(`   ${existingTest.rows[0].count} already exist in target`);

        // Build order lookup
        console.log('\n🗺️  Building order lookup for test...');
        const orderMap = new Map<number, string>();
        
        const orders = await targetClient.query(`
            SELECT legacy_instruction_id, id
            FROM orders
            WHERE legacy_instruction_id IS NOT NULL
        `);
        
        orders.rows.forEach(order => {
            orderMap.set(order.legacy_instruction_id, order.id);
        });
        
        console.log(`   Built lookup for ${orderMap.size} orders`);

        // Test MIME type function
        const getMimeType = (ext: string | null): string => {
            if (!ext) return 'application/octet-stream';
            
            const mimeMap: { [key: string]: string } = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.stl': 'model/stl',
                '.zip': 'application/zip',
                '.dxf': 'application/dxf'
            };
            
            return mimeMap[ext.toLowerCase()] || 'application/octet-stream';
        };

        // Show sample transformation
        console.log('\n📋 Sample data transformation:');
        const sampleFile = testFiles.rows[0];
        const orderId = sampleFile.instruction_id ? orderMap.get(sampleFile.instruction_id) : null;
        const filename = sampleFile.name || `file_${sampleFile.id}${sampleFile.ext || ''}`;
        const mimeType = getMimeType(sampleFile.ext);
        
        console.log('   Source:');
        console.table([{
            id: sampleFile.id,
            uid: sampleFile.uid,
            name: sampleFile.name,
            ext: sampleFile.ext,
            size: sampleFile.size,
            instruction_id: sampleFile.instruction_id
        }]);
        
        console.log('   Target (transformed):');
        console.table([{
            file_uid: sampleFile.uid,
            order_id: orderId,
            filename: filename,
            file_type: sampleFile.ext,
            file_size_bytes: sampleFile.size,
            mime_type: mimeType,
            legacy_file_id: sampleFile.id
        }]);

        // Test single insert
        console.log('\n🔧 Testing single file insert...');
        
        const metadata = {
            migration: {
                source_table: 'dispatch_file',
                migrated_at: new Date().toISOString(),
                original_type: sampleFile.type,
                original_status: sampleFile.status
            }
        };

        try {
            await targetClient.query(`
                INSERT INTO files (
                    file_uid, order_id, filename, file_type, file_size_bytes, 
                    mime_type, uploaded_at, created_at, updated_at, metadata, legacy_file_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), $8, $9)
                ON CONFLICT (legacy_file_id) DO UPDATE SET
                    updated_at = NOW()
            `, [
                sampleFile.uid, orderId, filename, sampleFile.ext, sampleFile.size,
                mimeType, sampleFile.created_at, JSON.stringify(metadata), sampleFile.id
            ]);
            
            console.log('   ✅ Single insert test successful');
            
            // Verify the insert
            const verification = await targetClient.query(`
                SELECT file_uid, filename, order_id, legacy_file_id, metadata
                FROM files
                WHERE legacy_file_id = $1
            `, [sampleFile.id]);
            
            if (verification.rows.length > 0) {
                console.log('   ✅ Verification successful');
                console.table(verification.rows);
            } else {
                console.log('   ❌ Verification failed - record not found');
            }
            
        } catch (error) {
            console.error('   ❌ Single insert test failed:', error);
        }

        // Test batch insert with 10 files
        console.log('\n📦 Testing batch insert with 10 files...');
        
        const batchFiles = testFiles.rows.slice(1, 11); // Skip first one we already inserted
        const values: any[] = [];
        const placeholders: string[] = [];
        let paramIndex = 1;

        for (const file of batchFiles) {
            const orderId = file.instruction_id ? orderMap.get(file.instruction_id) : null;
            const filename = file.name || `file_${file.id}${file.ext || ''}`;
            const mimeType = getMimeType(file.ext);
            
            const metadata = {
                migration: {
                    source_table: 'dispatch_file',
                    migrated_at: new Date().toISOString(),
                    original_type: file.type,
                    original_status: file.status
                }
            };

            placeholders.push(
                `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, NOW(), NOW(), $${paramIndex++}, $${paramIndex++})`
            );
            
            values.push(
                file.uid, orderId, filename, file.ext, file.size,
                mimeType, file.created_at, JSON.stringify(metadata), file.id
            );
        }

        try {
            const insertQuery = `
                INSERT INTO files (
                    file_uid, order_id, filename, file_type, file_size_bytes, 
                    mime_type, uploaded_at, created_at, updated_at, metadata, legacy_file_id
                ) VALUES ${placeholders.join(', ')}
                ON CONFLICT (legacy_file_id) DO NOTHING
            `;
            
            const result = await targetClient.query(insertQuery, values);
            console.log(`   ✅ Batch insert successful: ${result.rowCount || 0} files inserted`);
            
        } catch (error) {
            console.error('   ❌ Batch insert test failed:', error);
        }

        // Final test summary
        const finalTestCount = await targetClient.query(`
            SELECT COUNT(*) as count
            FROM files
            WHERE legacy_file_id BETWEEN $1 AND $2
        `, [testFiles.rows[0].id, testFiles.rows[testFiles.rows.length - 1].id]);
        
        console.log(`\n📊 Test Results:`);
        console.log(`   Test files processed: ${testFiles.rows.length}`);
        console.log(`   Files now in target: ${finalTestCount.rows[0].count}`);
        console.log(`   Success rate: ${((finalTestCount.rows[0].count / testFiles.rows.length) * 100).toFixed(1)}%`);

        if (finalTestCount.rows[0].count >= testFiles.rows.length * 0.9) {
            console.log('   🎉 Test successful - ready for full migration!');
        } else {
            console.log('   ⚠️  Test results need investigation before full migration');
        }

    } finally {
        await sourceClient.end();
        await targetClient.end();
    }
}

testFilesMigration().catch(console.error);
