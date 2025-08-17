import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

// Source database connection
const sourceClient = new Client({
  host: 'test.brius.com',
  port: 5432,
  database: 'mdw_db',
  user: 'mdw_ai',
  password: 'xGXmckHY',
});

// Target database connection via Supabase
const supabase = createClient(
  'http://localhost:8000', 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
);

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '50');
const TEST_MODE = process.env.TEST_MODE === 'true';

interface DispatchFile {
  id: number;
  uid: string;
  name: string;
  ext: string;
  size: number;
  type: number;
  instruction_id: number;
  created_at: Date;
  product_id: number | null;
  parameters: string;
  record_id: number | null;
  status: number;
}

interface OrderMapping {
  [legacyOrderId: number]: string; // UUID
}

interface FileMapping {
  [legacyFileId: number]: string; // UUID
}

// File categorization function
function categorizeFile(fileName: string, fileType: number): string {
  const lowerName = fileName.toLowerCase();
  
  if (lowerName.endsWith('.stl') || lowerName.endsWith('.ply')) {
    return 'scan';
  }
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg') || lowerName.endsWith('.png') || lowerName.endsWith('.gif')) {
    if (lowerName.includes('_full.jpg') || lowerName.includes('package') || lowerName.includes('final')) {
      return 'final_package';
    }
    return 'image';
  }
  if (lowerName.endsWith('.pdf')) {
    return 'document';
  }
  if (lowerName.endsWith('.zip') || lowerName.endsWith('.rar') || lowerName.includes('.tar')) {
    return 'package';
  }
  
  // Categorize by file type if extension doesn't match
  if (fileType === 7 || fileType === 6) {
    return 'scan';
  }
  if (fileType === 8) {
    return 'image';
  }
  
  return 'other';
}

async function buildLookupMappings(): Promise<{ orders: OrderMapping; files: FileMapping }> {
  console.log('Building lookup mappings...');
  
  // Build order mappings (legacy_instruction_id -> order.id)
  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('id, legacy_instruction_id');
    
  if (ordersError) {
    throw new Error(`Failed to fetch orders: ${ordersError.message}`);
  }
  
  const orderMappings: OrderMapping = {};
  orders?.forEach((o: any) => {
    if (o.legacy_instruction_id) {
      orderMappings[o.legacy_instruction_id] = o.id;
    }
  });
  
  console.log(`  Built ${Object.keys(orderMappings).length} order mappings`);
  
  // Build file mappings (legacy_file_id -> file.id)
  const { data: files, error: filesError } = await supabase
    .from('files')
    .select('id, legacy_file_id');
    
  if (filesError) {
    throw new Error(`Failed to fetch files: ${filesError.message}`);
  }
  
  const fileMappings: FileMapping = {};
  files?.forEach((f: any) => {
    if (f.legacy_file_id) {
      fileMappings[f.legacy_file_id] = f.id;
    }
  });
  
  console.log(`  Built ${Object.keys(fileMappings).length} file mappings`);
  
  return { orders: orderMappings, files: fileMappings };
}

async function migrateOrderFiles() {
  try {
    await sourceClient.connect();
    console.log('Connected to source database');
    
    // Build lookup mappings
    const { orders: orderMappings, files: fileMappings } = await buildLookupMappings();
    
    // Get total count for progress tracking
    const countResult = await sourceClient.query(`
      SELECT COUNT(*) as total 
      FROM dispatch_file 
      WHERE instruction_id IS NOT NULL
    `);
    const totalRecords = parseInt(countResult.rows[0].total);
    console.log(`Total file-order relationships to migrate: ${totalRecords.toLocaleString()}`);
    
    if (TEST_MODE) {
      console.log('TEST MODE: Processing first 10 records only');
    }
    
    let processed = 0;
    let successful = 0;
    let skipped = 0;
    let errors = 0;
    
    // Process in batches
    const limit = TEST_MODE ? 10 : totalRecords;
    
    for (let offset = 0; offset < limit; offset += BATCH_SIZE) {
      console.log(`\nProcessing batch: ${offset + 1} to ${Math.min(offset + BATCH_SIZE, limit)}`);
      
      // Fetch batch from source
      const batchResult = await sourceClient.query(`
        SELECT id, uid, name, ext, size, type, instruction_id, created_at, 
               product_id, parameters, record_id, status
        FROM dispatch_file 
        WHERE instruction_id IS NOT NULL
        ORDER BY id ASC
        LIMIT $1 OFFSET $2
      `, [BATCH_SIZE, offset]);
      
      if (batchResult.rows.length === 0) {
        break;
      }
      
      // Process each file in the batch
      const orderFilesToInsert = [];
      
      for (const file of batchResult.rows as DispatchFile[]) {
        processed++;
        
        // Resolve order UUID
        const orderUuid = orderMappings[file.instruction_id];
        if (!orderUuid) {
          console.log(`    Skipping file ${file.id}: No mapping for order ${file.instruction_id}`);
          skipped++;
          continue;
        }
        
        // Resolve file UUID
        const fileUuid = fileMappings[file.id];
        if (!fileUuid) {
          console.log(`    Skipping file ${file.id}: No mapping for file ${file.id}`);
          skipped++;
          continue;
        }
        
        // Categorize file
        const category = categorizeFile(file.name, file.type);
        
        // Parse parameters JSON
        let parameters = {};
        try {
          parameters = JSON.parse(file.parameters);
        } catch (e) {
          parameters = {};
        }
        
        // Prepare order_file for insertion
        const orderFile = {
          order_id: orderUuid,
          file_id: fileUuid,
          category: category,
          file_type: file.type,
          status: file.status,
          parameters: parameters,
          metadata: {
            original_name: file.name,
            extension: file.ext,
            size_bytes: file.size
          },
          product_id: file.product_id,
          record_id: file.record_id,
          uploaded_at: file.created_at.toISOString(),
          legacy_file_id: file.id,
          legacy_instruction_id: file.instruction_id
        };
        
        orderFilesToInsert.push(orderFile);
      }
      
      // Batch insert to target
      if (orderFilesToInsert.length > 0) {
        const { data, error } = await supabase
          .from('order_files')
          .insert(orderFilesToInsert)
          .select('id');
          
        if (error) {
          console.error(`    Batch insert error:`, error);
          errors += orderFilesToInsert.length;
        } else {
          successful += orderFilesToInsert.length;
          console.log(`    Successfully inserted ${orderFilesToInsert.length} order-file relationships`);
        }
      }
      
      // Progress update
      const progressPercent = ((offset + BATCH_SIZE) / limit * 100).toFixed(1);
      console.log(`Progress: ${progressPercent}% (${processed}/${limit}) - Success: ${successful}, Skipped: ${skipped}, Errors: ${errors}`);
      
      // Small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`\n=== Migration Complete ===`);
    console.log(`Total processed: ${processed.toLocaleString()}`);
    console.log(`Successfully migrated: ${successful.toLocaleString()}`);
    console.log(`Skipped: ${skipped.toLocaleString()}`);
    console.log(`Errors: ${errors.toLocaleString()}`);
    
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await sourceClient.end();
  }
}

migrateOrderFiles().catch(console.error);
