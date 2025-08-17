import dotenv from 'dotenv';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

interface FileRecord {
    id: number;
    uid: string;
    name: string | null;
    ext: string | null;
    size: number;
    type: number;
    instruction_id: number | null;
    created_at: string;
    product_id: number | null;
    parameters: string;
    record_id: number | null;
    status: number;
}

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

async function migrateFilesWithSupabase() {
    console.log('🔄 Starting Files Migration: PG → Supabase (294K+ records)\n');
    
    // SOURCE: Direct PostgreSQL connection
    const sourceClient = new Client({
        host: process.env.SOURCE_DB_HOST!,
        port: parseInt(process.env.SOURCE_DB_PORT!),
        user: process.env.SOURCE_DB_USER!,
        password: process.env.SOURCE_DB_PASSWORD!,
        database: process.env.SOURCE_DB_NAME!,
    });
    await sourceClient.connect();

    // TARGET: Supabase client (admin rights)
    const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE!
    );
    
    const batchSize = 100; // Smaller batch for Supabase API
    let processed = 0;
    let inserted = 0;
    let skipped = 0;
    let errors = 0;
    
    try {
        // Step 1: Build order lookup map (instruction_id -> order_id)
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
        
        console.log(`   ✅ Built lookup map for ${orderMap.size} orders`);

        // Step 2: Get total count and existing files
        console.log('\n📊 Getting migration status...');
        const totalCount = await sourceClient.query('SELECT COUNT(*) as count FROM dispatch_file');
        const totalFiles = parseInt(totalCount.rows[0].count);
        
        const { count: alreadyMigrated, error: countError } = await supabase
            .from('files')
            .select('*', { count: 'exact', head: true })
            .not('legacy_file_id', 'is', null);
        
        if (countError) {
            throw new Error(`Failed to count existing files: ${countError.message}`);
        }
        
        console.log(`   Total source files: ${totalFiles}`);
        console.log(`   Already migrated: ${alreadyMigrated || 0}`);
        console.log(`   Remaining: ${totalFiles - (alreadyMigrated || 0)}`);

        if ((alreadyMigrated || 0) >= totalFiles) {
            console.log('   ✅ All files already migrated!');
            return;
        }

        // Step 3: Get list of already migrated file IDs
        const { data: migratedFiles, error: migratedError } = await supabase
            .from('files')
            .select('legacy_file_id')
            .not('legacy_file_id', 'is', null);
        
        if (migratedError) {
            throw new Error(`Failed to fetch migrated files: ${migratedError.message}`);
        }
        
        const migratedIds = new Set<number>();
        migratedFiles?.forEach(file => {
            if (file.legacy_file_id) migratedIds.add(file.legacy_file_id);
        });

        // Step 4: Process files in batches
        console.log(`\n📦 Starting batch processing (${batchSize} files per batch)...`);
        
        let offset = 0;
        const startTime = Date.now();

        while (offset < totalFiles) {
            const batchStart = Date.now();
            
            // Get batch of files from source
            const batchQuery = `
                SELECT id, uid, name, ext, size, type, instruction_id, 
                       created_at, product_id, parameters, record_id, status
                FROM dispatch_file
                ORDER BY id
                LIMIT $1 OFFSET $2
            `;
            
            const batch = await sourceClient.query(batchQuery, [batchSize, offset]);
            
            if (batch.rows.length === 0) break;

            // Filter out already migrated files
            const filesToProcess = batch.rows.filter(
                (file: FileRecord) => !migratedIds.has(file.id)
            );

            if (filesToProcess.length === 0) {
                offset += batch.rows.length;
                processed += batch.rows.length;
                skipped += batch.rows.length;
                continue;
            }

            // Prepare batch for Supabase
            try {
                const filesToInsert = filesToProcess.map((file: FileRecord) => {
                    const orderId = file.instruction_id ? orderMap.get(file.instruction_id) : null;
                    const filename = file.name || `file_${file.id}${file.ext || ''}`;
                    const mimeType = getMimeType(file.ext);
                    
                    // Build metadata object
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

                // Insert batch via Supabase
                const { data, error } = await supabase
                    .from('files')
                    .upsert(filesToInsert, { 
                        onConflict: 'legacy_file_id',
                        ignoreDuplicates: false 
                    });

                if (error) {
                    console.error(`❌ Batch error at offset ${offset}:`, error);
                    errors++;
                    
                    // Try individual inserts for this batch
                    for (const fileData of filesToInsert) {
                        try {
                            const { error: individualError } = await supabase
                                .from('files')
                                .upsert([fileData], { 
                                    onConflict: 'legacy_file_id',
                                    ignoreDuplicates: true 
                                });
                            
                            if (!individualError) {
                                inserted++;
                            } else {
                                console.error(`❌ Individual file error (ID ${fileData.legacy_file_id}):`, individualError.message);
                                errors++;
                            }
                        } catch (individualError) {
                            console.error(`❌ Individual file exception (ID ${fileData.legacy_file_id}):`, individualError);
                            errors++;
                        }
                    }
                } else {
                    inserted += filesToProcess.length;
                }

            } catch (error) {
                console.error(`❌ Batch processing error at offset ${offset}:`, error);
                errors++;
            }

            processed += batch.rows.length;
            skipped += (batch.rows.length - filesToProcess.length);
            offset += batch.rows.length;

            // Progress reporting
            const batchTime = Date.now() - batchStart;
            const totalTime = Date.now() - startTime;
            const progress = ((processed / totalFiles) * 100).toFixed(1);
            const eta = totalFiles > processed ? 
                ((totalTime / processed) * (totalFiles - processed) / 1000 / 60).toFixed(1) : 0;

            console.log(`   📈 Progress: ${processed}/${totalFiles} (${progress}%) | Inserted: ${inserted} | Skipped: ${skipped} | Errors: ${errors} | ETA: ${eta}min | Batch: ${batchTime}ms`);

            // Add small delay to avoid overwhelming Supabase
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Final summary
        const totalTime = (Date.now() - startTime) / 1000;
        console.log(`\n🎉 Migration completed in ${totalTime.toFixed(1)} seconds!`);
        console.log(`   📊 Total processed: ${processed}`);
        console.log(`   ✅ Successfully migrated: ${inserted}`);
        console.log(`   ⏭️  Skipped (already exists): ${skipped}`);
        console.log(`   ❌ Errors: ${errors}`);
        console.log(`   📈 Rate: ${(processed / totalTime).toFixed(0)} files/sec`);

        // Final verification
        const { count: finalCount, error: finalError } = await supabase
            .from('files')
            .select('*', { count: 'exact', head: true })
            .not('legacy_file_id', 'is', null);
        
        if (!finalError) {
            console.log(`   🔍 Total migrated files in target: ${finalCount || 0}`);
        }

    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    } finally {
        await sourceClient.end();
    }
}

migrateFilesWithSupabase().catch(console.error);
