import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

function getMimeType(ext: string | null): string {
    if (!ext) return 'application/octet-stream';
    
    const mimeMap: { [key: string]: string } = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.stl': 'model/stl',
        '.zip': 'application/zip',
        '.dxf': 'application/dxf',
        '.dcm': 'application/dicom',
        '.pdf': 'application/pdf',
        '.txt': 'text/plain',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.irk': 'application/octet-stream'
    };
    
    return mimeMap[ext.toLowerCase()] || 'application/octet-stream';
}

async function testFilesMigrationSimple() {
    console.log('🧪 Testing Files Migration - Simple Version\n');
    
    // SOURCE connection (direct pg)
    const sourceClient = new Client({
        host: process.env.SOURCE_DB_HOST!,
        port: parseInt(process.env.SOURCE_DB_PORT!),
        user: process.env.SOURCE_DB_USER!,
        password: process.env.SOURCE_DB_PASSWORD!,
        database: process.env.SOURCE_DB_NAME!,
    });

    // TARGET connection (direct pg)  
    const targetClient = new Client({
        host: process.env.TARGET_DB_HOST!,
        port: parseInt(process.env.TARGET_DB_PORT!),
        user: process.env.TARGET_DB_USER!,
        password: process.env.TARGET_DB_PASSWORD!,
        database: process.env.TARGET_DB_NAME!,
    });
    
    try {
        await sourceClient.connect();
        await targetClient.connect();
        console.log('✅ Connected to both databases\n');
        
        // Verify target table
        console.log('📋 Verifying target files table...');
        const targetCount = await targetClient.query('SELECT COUNT(*) as count FROM files');
        console.log(`   Current files in target: ${targetCount.rows[0].count}`);
        
        // Build order lookup map
        console.log('\n🗺️  Building order lookup map...');
        const orderMap = new Map<number, string>();
        
        const orders = await targetClient.query(`
            SELECT legacy_instruction_id, id
            FROM orders
            WHERE legacy_instruction_id IS NOT NULL
        `);
        
        orders.rows.forEach(order => {
            orderMap.set(order.legacy_instruction_id, order.id);
        });
        
        console.log(`   ✅ Built lookup map for ${orderMap.size} orders`);

        // Get test batch from source
        console.log('\n📦 Getting test batch from source...');
        const testBatch = await sourceClient.query(`
            SELECT id, uid, name, ext, size, type, instruction_id, 
                   created_at, product_id, parameters, record_id, status
            FROM dispatch_file
            WHERE id NOT IN (
                SELECT COALESCE(legacy_file_id, 0) 
                FROM files 
                WHERE legacy_file_id IS NOT NULL
            )
            ORDER BY id
            LIMIT 10
        `);
        
        console.log(`   Found ${testBatch.rows.length} files to test`);
        
        if (testBatch.rows.length === 0) {
            console.log('   ℹ️  No new files to test - all may already be migrated');
            return;
        }

        // Test individual inserts
        console.log('\n🔧 Testing individual file inserts...');
        let successCount = 0;
        
        for (const file of testBatch.rows) {
            try {
                const orderId = file.instruction_id ? orderMap.get(file.instruction_id) : null;
                const filename = file.name || `file_${file.id}${file.ext || ''}`;
                const mimeType = getMimeType(file.ext);
                
                const metadata = {
                    migration: {
                        source_table: 'dispatch_file',
                        migrated_at: new Date().toISOString(),
                        original_type: file.type,
                        original_status: file.status,
                        product_id: file.product_id,
                        record_id: file.record_id,
                        parameters: file.parameters
                    }
                };

                await targetClient.query(`
                    INSERT INTO files (
                        file_uid, order_id, filename, file_type, file_size_bytes, 
                        mime_type, uploaded_at, metadata, legacy_file_id
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    ON CONFLICT (legacy_file_id) DO NOTHING
                `, [
                    file.uid,
                    orderId,
                    filename,
                    file.ext,
                    file.size,
                    mimeType,
                    file.created_at,
                    JSON.stringify(metadata),
                    file.id
                ]);
                
                successCount++;
                console.log(`   ✅ File ${file.id}: ${filename} (${file.size} bytes)`);
                
            } catch (error) {
                console.error(`   ❌ File ${file.id} failed:`, (error as Error).message);
            }
        }

        // Verify results
        console.log('\n🔍 Verifying test results...');
        const verifyCount = await targetClient.query(`
            SELECT COUNT(*) as count
            FROM files
            WHERE legacy_file_id IN (${testBatch.rows.map(f => f.id).join(',')})
        `);
        
        console.log(`\n📊 Test Results:`);
        console.log(`   Files attempted: ${testBatch.rows.length}`);
        console.log(`   Files successful: ${successCount}`);
        console.log(`   Files verified in target: ${verifyCount.rows[0].count}`);
        console.log(`   Success rate: ${((successCount / testBatch.rows.length) * 100).toFixed(1)}%`);

        if (successCount >= testBatch.rows.length * 0.9) {
            console.log('\n🎉 Test successful! Ready for full migration.');
        } else {
            console.log('\n⚠️  Test results need investigation before full migration.');
        }

    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        await sourceClient.end();
        await targetClient.end();
    }
}

testFilesMigrationSimple().catch(console.error);
