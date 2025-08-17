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

async function analyzeProductData() {
  console.log('🔍 Analyzing product data patterns...\n');

  try {
    await sourceDb.connect();

    // Get all products with their course information
    const productsQuery = `
      SELECT 
        p.id,
        p.name,
        p.description,
        p.free,
        p.deleted,
        p.customization,
        p.type,
        p.substitute,
        p.course_id,
        c.name as course_name
      FROM dispatch_product p
      LEFT JOIN dispatch_course c ON p.course_id = c.id
      ORDER BY p.id;
    `;

    const result = await sourceDb.query(productsQuery);
    const products = result.rows;

    console.log('📊 Product Data Summary:');
    console.log(`Total products: ${products.length}`);
    console.log(`Active products: ${products.filter(p => !p.deleted).length}`);
    console.log(`Deleted products: ${products.filter(p => p.deleted).length}`);
    console.log(`Free products: ${products.filter(p => p.free).length}`);
    console.log(`Substitute products: ${products.filter(p => p.substitute).length}\n`);

    // Course distribution
    console.log('📈 Course Distribution:');
    const courseGroups = products.reduce((acc: Record<string, number>, p) => {
      const key = `${p.course_id} (${p.course_name})`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    
    Object.entries(courseGroups).forEach(([course, count]) => {
      console.log(`  ${course}: ${count} products`);
    });
    console.log();

    // Type distribution  
    console.log('🏷️  Type Distribution:');
    const typeGroups = products.reduce((acc: Record<string, number>, p) => {
      acc[p.type || 'null'] = (acc[p.type || 'null'] || 0) + 1;
      return acc;
    }, {});
    
    Object.entries(typeGroups).forEach(([type, count]) => {
      console.log(`  Type ${type}: ${count} products`);
    });
    console.log();

    // Detailed product information
    console.log('📋 Detailed Product Information:');
    console.log('ID | Name | Course | Type | Free | Substitute | Deleted');
    console.log('---|------|--------|------|------|------------|--------');
    
    products.forEach(p => {
      console.log(`${String(p.id).padStart(2)} | ${(p.name || '').padEnd(28)} | ${String(p.course_id).padStart(6)} | ${String(p.type || '').padStart(4)} | ${p.free ? 'Yes' : 'No '} | ${p.substitute ? 'Yes' : 'No '}.padEnd(10)} | ${p.deleted ? 'Yes' : 'No '}`);
    });

    console.log('\n🔗 Customization Data:');
    products.forEach(p => {
      if (p.customization && p.customization.trim() !== '') {
        console.log(`Product ${p.id} (${p.name}): ${p.customization.substring(0, 100)}${p.customization.length > 100 ? '...' : ''}`);
      }
    });

  } catch (error) {
    console.error('❌ Error analyzing product data:', error);
  } finally {
    await sourceDb.end();
  }
}

analyzeProductData().catch(console.error);
