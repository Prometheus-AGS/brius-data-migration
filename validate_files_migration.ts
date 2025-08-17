import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

async function validateFilesMigration() {
    console.log('🔍 Validating Files Migration\n');
    
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
        // 1. Count comparison
        console.log('📊 Record count comparison:');
        const sourceCount = await sourceClient.query('SELECT COUNT(*) as count FROM dispatch_file');
        const targetCount = await targetClient.query('SELECT COUNT(*) as count FROM files WHERE legacy_file_id IS NOT NULL');
        
        console.log(`   Source files: ${sourceCount.rows[0].count}`);
        console.log(`   Migrated files: ${targetCount.rows[0].count}`);
        console.log(`   Migration rate: ${((targetCount.rows[0].count / sourceCount.rows[0].count) * 100).toFixed(2)}%`);

        // 2. Data integrity checks
        console.log('\n🔍 Data integrity validation:');
        
        // Check for duplicate legacy_file_ids
        const duplicates = await targetClient.query(`
            SELECT legacy_file_id, COUNT(*) as count
            FROM files 
            WHERE legacy_file_id IS NOT NULL
            GROUP BY legacy_file_id
            HAVING COUNT(*) > 1
            LIMIT 5
        `);
        
        if (duplicates.rows.length > 0) {
            console.log('   ❌ Found duplicate legacy_file_ids:');
            console.table(duplicates.rows);
        } else {
            console.log('   ✅ No duplicate legacy_file_ids found');
        }

        // Check for missing file_uids
        const missingUids = await targetClient.query(`
            SELECT COUNT(*) as count
            FROM files 
            WHERE legacy_file_id IS NOT NULL AND file_uid IS NULL
        `);
        
        console.log(`   ${missingUids.rows[0].count === 0 ? '✅' : '❌'} Missing file_uids: ${missingUids.rows[0].count}`);

        // Check order relationships
        console.log('\n🔗 Order relationship validation:');
        const filesWithOrders = await targetClient.query(`
            SELECT COUNT(*) as count
            FROM files f
            WHERE f.legacy_file_id IS NOT NULL AND f.order_id IS NOT NULL
        `);
        
        const filesWithValidOrders = await targetClient.query(`
            SELECT COUNT(*) as count
            FROM files f
            JOIN orders o ON f.order_id = o.id
            WHERE f.legacy_file_id IS NOT NULL
        `);
        
        console.log(`   Files with order_id: ${filesWithOrders.rows[0].count}`);
        console.log(`   Files with valid orders: ${filesWithValidOrders.rows[0].count}`);
        
        if (filesWithOrders.rows[0].count === filesWithValidOrders.rows[0].count) {
            console.log('   ✅ All order relationships are valid');
        } else {
            const orphaned = filesWithOrders.rows[0].count - filesWithValidOrders.rows[0].count;
            console.log(`   ⚠️  ${orphaned} files have invalid order references`);
        }

        // 3. Sample data verification
        console.log('\n📄 Sample data verification:');
        const sampleComparison = await sourceClient.query(`
            SELECT id, uid, name, ext, size, type, instruction_id, created_at, status
            FROM dispatch_file
            ORDER BY id
            LIMIT 3
        `);
        
        for (const sourceFile of sampleComparison.rows) {
            const targetFile = await targetClient.query(`
                SELECT file_uid, filename, file_type, file_size_bytes, order_id, uploaded_at, metadata
                FROM files
                WHERE legacy_file_id = $1
            `, [sourceFile.id]);
            
            if (targetFile.rows.length > 0) {
                const target = targetFile.rows[0];
                const metadata = JSON.parse(target.metadata);
                
                console.log(`\n   📝 File ID ${sourceFile.id}:`);
                console.log(`      UID: ${sourceFile.uid} → ${target.file_uid} ${sourceFile.uid === target.file_uid ? '✅' : '❌'}`);
                console.log(`      Name: ${sourceFile.name} → ${target.filename} ${sourceFile.name === target.filename ? '✅' : '❌'}`);
                console.log(`      Size: ${sourceFile.size} → ${target.file_size_bytes} ${sourceFile.size.toString() === target.file_size_bytes ? '✅' : '❌'}`);
                console.log(`      Type: ${sourceFile.type} → ${metadata.migration.original_type} ${sourceFile.type === metadata.migration.original_type ? '✅' : '❌'}`);
                console.log(`      Date: ${sourceFile.created_at} → ${target.uploaded_at} ${sourceFile.created_at === target.uploaded_at ? '✅' : '❌'}`);
            } else {
                console.log(`   ❌ File ID ${sourceFile.id} not found in target`);
            }
        }

        // 4. File size analysis
        console.log('\n📊 File size validation:');
        const sourceSizeSum = await sourceClient.query('SELECT SUM(size) as total_size FROM dispatch_file');
        const targetSizeSum = await targetClient.query(`
            SELECT SUM(file_size_bytes) as total_size 
            FROM files 
            WHERE legacy_file_id IS NOT NULL
        `);
        
        const sourceTotal = parseInt(sourceSizeSum.rows[0].total_size || '0');
        const targetTotal = parseInt(targetSizeSum.rows[0].total_size || '0');
        
        console.log(`   Source total size: ${(sourceTotal / (1024*1024*1024)).toFixed(2)} GB`);
        console.log(`   Target total size: ${(targetTotal / (1024*1024*1024)).toFixed(2)} GB`);
        console.log(`   Size match: ${sourceTotal === targetTotal ? '✅' : '❌'} (${((targetTotal / sourceTotal) * 100).toFixed(2)}%)`);

        // 5. File type distribution validation
        console.log('\n📊 File type distribution:');
        const sourceTypes = await sourceClient.query(`
            SELECT ext, COUNT(*) as count
            FROM dispatch_file
            GROUP BY ext
            ORDER BY count DESC
            LIMIT 5
        `);
        
        for (const typeRow of sourceTypes.rows) {
            const targetTypeCount = await targetClient.query(`
                SELECT COUNT(*) as count
                FROM files
                WHERE legacy_file_id IS NOT NULL AND file_type = $1
            `, [typeRow.ext]);
            
            const sourceCount = parseInt(typeRow.count);
            const targetCount = parseInt(targetTypeCount.rows[0].count);
            const match = sourceCount === targetCount;
            
            console.log(`   ${typeRow.ext || 'NULL'}: ${sourceCount} → ${targetCount} ${match ? '✅' : '❌'}`);
        }

        // 6. Missing files analysis
        console.log('\n🔍 Missing files analysis:');
        const missingFiles = await sourceClient.query(`
            SELECT df.id, df.uid, df.name, df.instruction_id
            FROM dispatch_file df
            LEFT JOIN (
                SELECT legacy_file_id FROM files WHERE legacy_file_id IS NOT NULL
            ) f ON df.id = f.legacy_file_id
            WHERE f.legacy_file_id IS NULL
            LIMIT 5
        `);
        
        if (missingFiles.rows.length > 0) {
            console.log('   ⚠️  Sample missing files:');
            console.table(missingFiles.rows);
        } else {
            console.log('   ✅ No missing files detected');
        }

        // 7. Final summary
        const migrationRate = (targetCount.rows[0].count / sourceCount.rows[0].count) * 100;
        console.log('\n📈 Migration Summary:');
        if (migrationRate >= 100) {
            console.log('   🎉 Migration is COMPLETE!');
        } else if (migrationRate >= 95) {
            console.log('   ✅ Migration is mostly complete');
        } else {
            console.log('   ⚠️  Migration needs attention');
        }

    } finally {
        await sourceClient.end();
        await targetClient.end();
    }
}

validateFilesMigration().catch(console.error);
