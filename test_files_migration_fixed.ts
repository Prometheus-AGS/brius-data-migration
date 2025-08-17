import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

function getMimeType(ext: string | null): string {
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
}

async function testFilesMigration() {
    console.log('🧪 Testing Files Migration (Fixed Schema)\n');
    
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
        // Test with 50 files
        console.log('📦 Testing migration with 50 files...');
        
        const testFiles = await sourceClient.query(`
            SELECT id, uid, name, ext, size, type, instruction_id, created_at, status
            FROM dispatch_file
            WHERE id NOT IN (SELECT COALESCE(legacy_file_id, 0) FROM files WHERE legacy_file_id IS NOT NULL)
            ORDER BY id
            LIMIT 50
        `);
        
        console.log(`   Found ${testFiles.rows.length} test files`);

        // Build order lookup
        const orderMap = new Map<number, string>();
        const orders = await targetClient.query(`
            SELECT legacy_instruction_id, id FROM orders WHERE legacy_instruction_id IS NOT NULL
        `);
        orders.rows.forEach(order => {
            orderMap.set(order.legacy_instruction_id, order.id);
        });
        console.log(`   Order lookup: ${orderMap.size} orders`);

        // Test single insert
        if (testFiles.rows.length > 0) {
            console.log('\n🔧 Testing single file insert...');
            const sampleFile = testFiles.rows[0];
            const orderId = sampleFile.instruction_id ? orderMap.get(sampleFile.instruction_id) : null;
            const filename = sampleFile.name || `file_${sampleFile.id}${sampleFile.ext || ''}`;
            const mimeType = getMimeType(sampleFile.ext);
            
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
                        mime_type, uploaded_at, metadata, legacy_file_id
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    ON CONFLICT (legacy_file_id) DO NOTHING
                `, [
                    sampleFile.uid, orderId, filename, sampleFile.ext, sampleFile.size,
                    mimeType, sampleFile.created_at, JSON.stringify(metadata), sampleFile.id
                ]);
                
                console.log('   ✅ Single insert successful');
                
                // Verify
                const verification = await targetClient.query(`
                    SELECT file_uid, filename, order_id, legacy_file_id
                    FROM files
                    WHERE legacy_file_id = $1
                `, [sampleFile.id]);
                
                if (verification.rows.length > 0) {
                    console.log('   ✅ Verification successful');
                } else {
                    console.log('   ❌ Verification failed');
                }
                
            } catch (error) {
                console.error('   ❌ Single insert failed:', error);
            }

            // Test batch insert with remaining files
            if (testFiles.rows.length > 1) {
                console.log('\n📦 Testing batch insert...');
                const batchFiles = testFiles.rows.slice(1, 21); // Test with 20 files
                
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
                        `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
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
                            mime_type, uploaded_at, metadata, legacy_file_id
                        ) VALUES ${placeholders.join(', ')}
                        ON CONFLICT (legacy_file_id) DO NOTHING
                    `;
                    
                    const result = await targetClient.query(insertQuery, values);
                    console.log(`   ✅ Batch insert successful: ${result.rowCount || 0} files inserted`);
                    
                } catch (error) {
                    console.error('   ❌ Batch insert failed:', error);
                }
            }
        }

        // Final test count
        const finalTestCount = await targetClient.query(`
            SELECT COUNT(*) as count
            FROM files
            WHERE legacy_file_id IN (${testFiles.rows.map(f => f.id).join(',')})
        `);
        
        console.log(`\n📊 Test Results:`);
        console.log(`   Test files attempted: ${testFiles.rows.length}`);
        console.log(`   Files successfully migrated: ${finalTestCount.rows[0].count}`);
        console.log(`   Success rate: ${testFiles.rows.length > 0 ? ((finalTestCount.rows[0].count / testFiles.rows.length) * 100).toFixed(1) : 0}%`);

        if (finalTestCount.rows[0].count >= Math.min(21, testFiles.rows.length)) {
            console.log('   🎉 Test successful - ready for full migration!');
        } else {
            console.log('   ⚠️  Test results need investigation');
        }

    } finally {
        await sourceClient.end();
        await targetClient.end();
    }
}

testFilesMigration().catch(console.error);
