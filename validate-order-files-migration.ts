import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

const sourceClient = new Client({
  host: 'test.brius.com',
  port: 5432,
  database: 'mdw_db',
  user: 'mdw_ai',
  password: 'xGXmckHY',
});

const supabase = createClient(
  'http://localhost:8000', 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoiYnJpdXMiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.7c2CsGc9j4oSSgxshmdreykpW2HyKu36UUE38u1HdRk'
);

async function validateOrderFilesMigration() {
  try {
    await sourceClient.connect();
    
    console.log('=== Order Files Migration Validation ===\n');
    
    // Get source count
    const sourceCount = await sourceClient.query(`
      SELECT COUNT(*) as total FROM dispatch_file WHERE instruction_id IS NOT NULL
    `);
    const totalSourceFiles = parseInt(sourceCount.rows[0].total);
    
    // Get target count
    const { count: targetCount } = await supabase
      .from('order_files')
      .select('*', { count: 'exact', head: true });
    
    console.log('Migration Summary:');
    console.log(`  Source files with orders: ${totalSourceFiles.toLocaleString()}`);
    console.log(`  Migrated order_files: ${(targetCount || 0).toLocaleString()}`);
    console.log(`  Success rate: ${((targetCount || 0) / totalSourceFiles * 100).toFixed(2)}%`);
    console.log(`  Missing: ${(totalSourceFiles - (targetCount || 0)).toLocaleString()}`);
    
    // Category distribution
    const { data: categoryStats } = await supabase
      .from('order_files')
      .select('category')
      .then(({ data, error }) => {
        if (error) return { data: null, error };
        const stats: { [key: string]: number } = {};
        data?.forEach((of: any) => {
          stats[of.category] = (stats[of.category] || 0) + 1;
        });
        return { data: stats, error: null };
      });
    
    console.log('\nFile Category Distribution:');
    Object.entries(categoryStats || {})
      .sort(([,a], [,b]) => (b as number) - (a as number))
      .forEach(([category, count]) => {
        console.log(`  ${category}: ${(count as number).toLocaleString()}`);
      });
    
    // File type distribution
    const { data: typeStats } = await supabase
      .from('order_files')
      .select('file_type')
      .then(({ data, error }) => {
        if (error) return { data: null, error };
        const stats: { [key: string]: number } = {};
        data?.forEach((of: any) => {
          stats[of.file_type] = (stats[of.file_type] || 0) + 1;
        });
        return { data: stats, error: null };
      });
    
    console.log('\nFile Type Distribution:');
    Object.entries(typeStats || {})
      .sort(([,a], [,b]) => (b as number) - (a as number))
      .forEach(([type, count]) => {
        console.log(`  Type ${type}: ${(count as number).toLocaleString()}`);
      });
    
    // Orders with most files
    const { data: topOrders } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT 
          o.legacy_instruction_id,
          COUNT(*) as file_count
        FROM order_files of
        JOIN orders o ON of.order_id = o.id
        GROUP BY o.legacy_instruction_id
        ORDER BY file_count DESC
        LIMIT 10;
      `
    });
    
    if (Array.isArray(topOrders)) {
      console.log('\nOrders with Most Files:');
      topOrders.forEach((order: any, i: number) => {
        console.log(`  ${i + 1}. Order ${order.legacy_instruction_id}: ${order.file_count} files`);
      });
    }
    
    // Sample order_files with relationships
    const { data: sampleOrderFiles } = await supabase
      .from('order_files')
      .select(`
        id, category, file_type, uploaded_at, legacy_file_id, legacy_instruction_id,
        orders!inner(legacy_instruction_id),
        files!inner(filename, file_size_bytes)
      `)
      .limit(3);
    
    console.log('\nSample Order-File Relationships:');
    sampleOrderFiles?.forEach((of, i) => {
      console.log(`\n  ${i + 1}. Category: ${of.category}, Type: ${of.file_type}`);
      console.log(`     File: ${of.files.filename} (${of.files.file_size_bytes} bytes)`);
      console.log(`     Order: ${of.orders.legacy_instruction_id}`);
      console.log(`     Legacy IDs: file=${of.legacy_file_id}, order=${of.legacy_instruction_id}`);
    });
    
    // Data integrity checks
    const { count: nullOrderCount } = await supabase
      .from('order_files')
      .select('*', { count: 'exact', head: true })
      .is('order_id', null);
      
    const { count: nullFileCount } = await supabase
      .from('order_files')
      .select('*', { count: 'exact', head: true })
      .is('file_id', null);
    
    console.log('\nData Integrity:');
    console.log(`  Records with null order_id: ${nullOrderCount || 0}`);
    console.log(`  Records with null file_id: ${nullFileCount || 0}`);
    
    if ((targetCount || 0) >= totalSourceFiles * 0.99) {
      console.log('\n✅ Order files migration appears SUCCESSFUL (99%+ success rate)');
    } else if ((targetCount || 0) >= totalSourceFiles * 0.95) {
      console.log('\n⚠️ Order files migration mostly complete (95%+ success rate)');
    } else {
      console.log('\n❌ Order files migration needs attention (< 95% success rate)');
    }
    
  } catch (error) {
    console.error('Validation error:', error);
  } finally {
    await sourceClient.end();
  }
}

validateOrderFilesMigration().catch(console.error);
