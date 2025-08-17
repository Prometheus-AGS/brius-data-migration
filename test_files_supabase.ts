import dotenv from 'dotenv';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

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

async function testFilesWithSupabase() {
    console.log('🧪 Testing Files Migration: PG → Supabase\n');
    
    // SOURCE: Direct PostgreSQL connection
    const sourceClient = new Client({
        host: process.env.SOURCE_DB_HOST!,
        port: parseInt(process.env.SOURCE_DB_PORT!),
        user: process.env.SOURCE_DB_USER!,
        password: process.env.SOURCE_DB_PASSWORD!,
        database: process.env.SOURCE_DB_NAME!,
    });

    // TARGET: Supabase client
    const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE!
    );
    
    try {
        await sourceClient.connect();
        console.log('✅ Connected to source database (PostgreSQL)\n');
        
        // Test Supabase connection
        console.log('📋 Testing Supabase connection...');
        const { count: currentCount, error: countError } = await supabase
            .from('files')
            .select('*', { count: 'exact', head: true });
        
        if (countError) {
            throw new Error(`Supabase connection failed: ${countError.message}`);
        }
        
        console.log(`   ✅ Supabase connected - Current files: ${currentCount || 0}\n`);

        // Build order lookup map
        console.log('🗺️  Building order lookup map...');
        const { data: orders, error: ordersError } = await supabase
            .from('orders')
            .select('legacy_instruction_id, id')
            .not('legacy_instruction_id', 'is', null);
        
        if (ordersError) {
            throw new Error(`Failed to fetch orders: ${ordersError.message}`);
        }
        
        const orderMap = new Map<number, string>();
        orders?.forEach(order => {
            orderMap.set(order.legacy_instruction_id, order.id);
        });
        
        console.log(`   ✅ Built lookup map for ${orderMap.size} orders\n`);

        // Get test batch from source (exclude already migrated)
        console.log('📦 Getting test batch from source...');
        
        // First, get already migrated IDs
        const { data: migratedFiles } = await supabase
            .from('files')
            .select('legacy_file_id')
            .not('legacy_file_id', 'is', null);
        
        const migratedIds = new Set<number>();
        migratedFiles?.forEach(file => {
            if (file.legacy_file_id) migratedIds.add(file.legacy_file_id);
        });
        
        console.log(`   Already migrated: ${migratedIds.size} files`);
        
        // Get test batch
        const testBatch = await sourceClient.query(`
            SELECT id, uid, name, ext, size, type, instruction_id, 
                   created_at, product_id, parameters, record_id, status
            FROM dispatch_file
            ORDER BY id
            LIMIT 20
        `);
        
        // Filter out migrated ones
        const filesToTest = testBatch.rows.filter(file => !migratedIds.has(file.id));
        
        console.log(`   Found ${filesToTest.length} new files to test\n`);
        
        if (filesToTest.length === 0) {
            console.log('   ℹ️  No new files to test - first 20 may already be migrated');
            
            // Try to get files from higher IDs
            const higherBatch = await sourceClient.query(`
                SELECT id, uid, name, ext, size, type, instruction_id, 
                       created_at, product_id, parameters, record_id, status
                FROM dispatch_file
                WHERE id > 1000
                ORDER BY id
                LIMIT 10
            `);
            
            const higherFilesToTest = higherBatch.rows.filter(file => !migratedIds.has(file.id));
            
            if (higherFilesToTest.length > 0) {
                filesToTest.push(...higherFilesToTest.slice(0, 5));
                console.log(`   Found ${higherFilesToTest.length} files from higher IDs to test\n`);
            }
        }

        if (filesToTest.length === 0) {
            console.log('   ⚠️  No files available for testing');
            return;
        }

        // Test individual inserts
        console.log('🔧 Testing individual file inserts...');
        let successCount = 0;
        
        for (const file of filesToTest.slice(0, 5)) {  // Test only 5 files
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

                const fileData = {
                    file_uid: file.uid,
                    order_id: orderId,
                    filename: filename,
                    file_type: file.ext,
                    file_size_bytes: file.size,
                    mime_type: mimeType,
                    uploaded_at: file.created_at,
                    metadata: metadata,
                    legacy_file_id: file.id
                };

                const { error } = await supabase
                    .from('files')
                    .upsert([fileData], { 
                        onConflict: 'legacy_file_id',
                        ignoreDuplicates: false 
                    });
                
                if (error) {
                    console.error(`   ❌ File ${file.id} failed:`, error.message);
                } else {
                    successCount++;
                    console.log(`   ✅ File ${file.id}: ${filename} (${file.size} bytes)`);
                }
                
            } catch (error) {
                console.error(`   ❌ File ${file.id} exception:`, error);
            }
        }

        // Test batch insert
        if (filesToTest.length > 5) {
            console.log('\n📦 Testing batch insert...');
            const batchFiles = filesToTest.slice(5, 10);
            
            const batchData = batchFiles.map(file => {
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

                return {
                    file_uid: file.uid,
                    order_id: orderId,
                    filename: filename,
                    file_type: file.ext,
                    file_size_bytes: file.size,
                    mime_type: mimeType,
                    uploaded_at: file.created_at,
                    metadata: metadata,
                    legacy_file_id: file.id
                };
            });

            const { error: batchError } = await supabase
                .from('files')
                .upsert(batchData, { 
                    onConflict: 'legacy_file_id',
                    ignoreDuplicates: false 
                });
            
            if (batchError) {
                console.error(`   ❌ Batch insert failed:`, batchError.message);
            } else {
                successCount += batchFiles.length;
                console.log(`   ✅ Batch insert successful: ${batchFiles.length} files`);
            }
        }

        // Verify results
        console.log('\n🔍 Verifying test results...');
        const testIds = filesToTest.slice(0, 10).map(f => f.id);
        const { data: verifyData, error: verifyError } = await supabase
            .from('files')
            .select('legacy_file_id')
            .in('legacy_file_id', testIds);
        
        if (verifyError) {
            console.error('   ❌ Verification failed:', verifyError.message);
        } else {
            const verifiedCount = verifyData?.length || 0;
            console.log(`   ✅ Verified ${verifiedCount} files in target`);
        }

        const attempted = Math.min(10, filesToTest.length);
        console.log(`\n📊 Test Results:`);
        console.log(`   Files attempted: ${attempted}`);
        console.log(`   Files successful: ${successCount}`);
        console.log(`   Success rate: ${attempted > 0 ? ((successCount / attempted) * 100).toFixed(1) : 0}%`);

        if (successCount >= attempted * 0.8) {
            console.log('\n🎉 Test successful! Ready for full migration.');
        } else {
            console.log('\n⚠️  Test results need investigation before full migration.');
        }

    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        await sourceClient.end();
    }
}

testFilesWithSupabase().catch(console.error);
