import { createClient } from '@supabase/supabase-js';
import { Client as PgClient } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

// Source database configuration
const sourceDb = new PgClient({
  host: process.env.SOURCE_DB_HOST!,
  port: parseInt(process.env.SOURCE_DB_PORT!),
  user: process.env.SOURCE_DB_USER!,
  password: process.env.SOURCE_DB_PASSWORD!,
  database: process.env.SOURCE_DB_NAME!,
});

async function analyzeJawData() {
  console.log('🦷 Analyzing jaw data patterns...\n');

  try {
    await sourceDb.connect();

    // Get overall statistics
    const statsQuery = `
      SELECT 
        COUNT(*) as total_jaws,
        COUNT(CASE WHEN labial = true THEN 1 END) as labial_jaws,
        COUNT(CASE WHEN reason IS NOT NULL THEN 1 END) as jaws_with_reason,
        COUNT(DISTINCT product_id) as unique_products
      FROM dispatch_jaw;
    `;

    const statsResult = await sourceDb.query(statsQuery);
    const stats = statsResult.rows[0];

    console.log('📊 Jaw Data Summary:');
    console.log(`Total jaws: ${stats.total_jaws}`);
    console.log(`Labial jaws: ${stats.labial_jaws}`);
    console.log(`Jaws with reason: ${stats.jaws_with_reason}`);
    console.log(`Unique products: ${stats.unique_products}\n`);

    // Reason distribution
    const reasonQuery = `
      SELECT 
        CASE 
          WHEN reason IS NULL THEN 'NULL (No reason)'
          WHEN reason = 1 THEN '1 (Reason 1)'
          WHEN reason = 2 THEN '2 (Reason 2)'  
          WHEN reason = 3 THEN '3 (Reason 3)'
          ELSE reason::text
        END as reason_desc,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
      FROM dispatch_jaw 
      GROUP BY reason 
      ORDER BY reason;
    `;

    const reasonResult = await sourceDb.query(reasonQuery);
    console.log('🔢 Reason Distribution:');
    reasonResult.rows.forEach(row => {
      console.log(`  ${row.reason_desc}: ${row.count} (${row.percentage}%)`);
    });
    console.log();

    // Product distribution
    const productQuery = `
      SELECT 
        dj.product_id,
        dp.name as product_name,
        COUNT(*) as jaw_count
      FROM dispatch_jaw dj
      LEFT JOIN dispatch_product dp ON dj.product_id = dp.id
      GROUP BY dj.product_id, dp.name
      ORDER BY jaw_count DESC;
    `;

    const productResult = await sourceDb.query(productQuery);
    console.log('🦷 Product Distribution:');
    productResult.rows.forEach(row => {
      console.log(`  Product ${row.product_id} (${row.product_name || 'Unknown'}): ${row.jaw_count} jaws`);
    });
    console.log();

    // Relationship analysis
    const relationshipQuery = `
      SELECT 
        COUNT(DISTINCT di.id) as total_orders,
        COUNT(CASE WHEN di.upper_jaw_id IS NOT NULL THEN 1 END) as orders_with_upper,
        COUNT(CASE WHEN di.lower_jaw_id IS NOT NULL THEN 1 END) as orders_with_lower,
        COUNT(CASE WHEN di.upper_jaw_id IS NOT NULL AND di.lower_jaw_id IS NOT NULL THEN 1 END) as orders_with_both
      FROM dispatch_instruction di;
    `;

    const relationshipResult = await sourceDb.query(relationshipQuery);
    const rel = relationshipResult.rows[0];

    console.log('🔗 Order-Jaw Relationships:');
    console.log(`Total orders: ${rel.total_orders}`);
    console.log(`Orders with upper jaw: ${rel.orders_with_upper}`);
    console.log(`Orders with lower jaw: ${rel.orders_with_lower}`);
    console.log(`Orders with both jaws: ${rel.orders_with_both}\n`);

    // Sample jaw data patterns
    const sampleQuery = `
      SELECT 
        id, 
        bond_teeth, 
        extract_teeth,
        reason,
        product_id,
        labial,
        CASE 
          WHEN bond_teeth != '0000000000000000' THEN 'Has bonding'
          ELSE 'No bonding'
        END as bonding_status,
        CASE 
          WHEN extract_teeth != '0000000000000000' THEN 'Has extraction'
          ELSE 'No extraction'
        END as extraction_status
      FROM dispatch_jaw 
      ORDER BY id 
      LIMIT 10;
    `;

    const sampleResult = await sourceDb.query(sampleQuery);
    console.log('📋 Sample Jaw Data:');
    console.log('ID | Bond Teeth       | Extract Teeth    | Reason | Product | Labial | Notes');
    console.log('---|------------------|------------------|--------|---------|--------|-------');
    
    sampleResult.rows.forEach(row => {
      const notes = `${row.bonding_status}, ${row.extraction_status}`;
      console.log(`${String(row.id).padStart(2)} | ${row.bond_teeth} | ${row.extract_teeth} | ${String(row.reason || '').padStart(6)} | ${String(row.product_id).padStart(7)} | ${row.labial ? 'Yes' : 'No '} | ${notes}`);
    });

    console.log('\n🎯 Key Migration Considerations:');
    console.log('1. Need to map jaw records to orders via dispatch_instruction relationships');
    console.log('2. Need to map product_id to migrated product UUIDs');
    console.log('3. Need to determine jaw_type (upper/lower) from dispatch_instruction references');
    console.log('4. Need to map reason codes to replacement_reason text values');
    console.log('5. Handle ~40,470 jaw records with proper batch processing');

  } catch (error) {
    console.error('❌ Error analyzing jaw data:', error);
  } finally {
    await sourceDb.end();
  }
}

analyzeJawData().catch(console.error);
