import dotenv from 'dotenv';
import { Client } from 'pg';

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

async function migrateFiles() {
    console.log('🔄 Starting Files Migration (294K+ records)\n');
    
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
    
    const batchSize = 1000; // Process 1000 files at a time
    let processed = 0;
    let inserted = 0;
    let skipped = 0;
    let errors = 0;
    
    try {
        // Step 1: Build order lookup map (instruction_id -> order_id)
        console.log('🗺️  Building order lookup map...');
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

        // Step 2: Get total count and existing files
        console.log('\n📊 Getting migration status...');
        const totalCount = await sourceClient.query('SELECT COUNT(*) as count FROM dispatch_file');
        const totalFiles = parseInt(totalCount.rows[0].count);
        
        const existingFiles = await targetClient.query('SELECT COUNT(*) as count FROM files WHERE legacy_file_id IS NOT NULL');
        const alreadyMigrated = parseInt(existingFiles.rows[0].count);
        
        console.log(`   Total source files: ${totalFiles}`);
        console.log(`   Already migrated: ${alreadyMigrated}`);
        console.log(`   Remaining: ${totalFiles - alreadyMigrated}`);

        if (alreadyMigrated >= totalFiles) {
            console.log('   ✅ All files already migrated!');
            return;
        }

        // Step 3: Get list of already migrated file IDs
        const migratedIds = new Set<number>();
        if (alreadyMigrated > 0) {
            const migrated = await targetClient.query('SELECT legacy_file_id FROM files WHERE legacy_file_id IS NOT NULL');
            migrated.rows.forEach(row => migratedIds.add(row.legacy_file_id));
        }

        // Step 4: Process files in batches
        console.log(`\n📦 Starting batch processing (${batchSize} files per batch)...`);
        
        let offset = 0;
        const startTime = Date.now();

        while (offset < totalFiles) {
            const batchStart = Date.now();
            
            // Get batch of files
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

            // Prepare batch insert
            await targetClient.query('BEGIN');
            
            try {
                // Build values array for batch insert
                const values: any[] = [];
                const placeholders: string[] = [];
                let paramIndex = 1;

                for (const file of filesToProcess) {
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

                    // Add to batch
                    placeholders.push(
                        `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, NOW(), NOW(), $${paramIndex++})`
                    );
                    
                    values.push(
                        file.uid,                    // file_uid
                        orderId,                     // order_id (nullable)
                        filename,                    // filename
                        file.ext,                    // file_type
                        file.size,                   // file_size_bytes
                        mimeType,                    // mime_type
                        file.created_at,             // uploaded_at
                        JSON.stringify(metadata),    // metadata
                        file.id                      // legacy_file_id
                    );
                }

                // Execute batch insert
                if (values.length > 0) {
                    const insertQuery = `
                        INSERT INTO files (
                            file_uid, order_id, filename, file_type, file_size_bytes, 
                            mime_type, uploaded_at, created_at, updated_at, metadata, legacy_file_id
                        ) VALUES ${placeholders.join(', ')}
                        ON CONFLICT (legacy_file_id) DO NOTHING
                    `;
                    
                    const result = await targetClient.query(insertQuery, values);
                    const batchInserted = result.rowCount || 0;
                    inserted += batchInserted;
                }

                await targetClient.query('COMMIT');

            } catch (error) {
                await targetClient.query('ROLLBACK');
                console.error(`❌ Batch error at offset ${offset}:`, error);
                errors++;
                
                // Try to continue with individual inserts for this batch
                for (const file of filesToProcess) {
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
                                mime_type, uploaded_at, created_at, updated_at, metadata, legacy_file_id
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), $8, $9)
                            ON CONFLICT (legacy_file_id) DO NOTHING
                        `, [
                            file.uid, orderId, filename, file.ext, file.size,
                            mimeType, file.created_at, JSON.stringify(metadata), file.id
                        ]);
                        
                        inserted++;
                    } catch (individualError) {
                        console.error(`❌ Individual file error (ID ${file.id}):`, individualError);
                        errors++;
                    }
                }
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
        const finalCount = await targetClient.query('SELECT COUNT(*) as count FROM files');
        console.log(`   🔍 Total files in target: ${finalCount.rows[0].count}`);

    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    } finally {
        await sourceClient.end();
        await targetClient.end();
    }
}

migrateFiles().catch(console.error);
