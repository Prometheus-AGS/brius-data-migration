/**
 * Test script to debug purchase mapping issues
 */

const { Pool } = require('pg');
require('dotenv').config();

// Database connections
const sourceDb = new Pool({
  host: process.env.SOURCE_DB_HOST,
  port: process.env.SOURCE_DB_PORT,
  user: process.env.SOURCE_DB_USER,
  password: process.env.SOURCE_DB_PASSWORD,
  database: process.env.SOURCE_DB_NAME
});

const targetDb = new Pool({
  host: process.env.TARGET_DB_HOST,
  port: process.env.TARGET_DB_PORT,
  user: process.env.TARGET_DB_USER,
  password: process.env.TARGET_DB_PASSWORD,
  database: process.env.TARGET_DB_NAME
});

async function testMappings() {
  let sourceClient, targetClient;
  
  try {
    sourceClient = await sourceDb.connect();
    targetClient = await targetDb.connect();
    
    // Test sample payment
    const testPayment = await sourceClient.query(`
      SELECT 
        dp.id,
        dp.instruction_id,
        di.course_id,
        dc.name as course_name,
        dp.total_price
      FROM dispatch_payment dp
      LEFT JOIN dispatch_instruction di ON dp.instruction_id = di.id
      LEFT JOIN dispatch_course dc ON di.course_id = dc.id
      WHERE dp.id = 79
    `);
    
    console.log('Test Payment:');
    console.table(testPayment.rows);
    
    // Check order mapping
    const orderMapping = await targetClient.query(`
      SELECT id, legacy_instruction_id
      FROM orders 
      WHERE legacy_instruction_id = $1
    `, [testPayment.rows[0].instruction_id]);
    
    console.log('Order Mapping:');
    console.table(orderMapping.rows);
    
    // Check product mapping  
    const productMapping = await targetClient.query(`
      SELECT id, legacy_course_id, name
      FROM products 
      WHERE legacy_course_id = $1
    `, [testPayment.rows[0].course_id]);
    
    console.log('Product Mapping:');
    console.table(productMapping.rows);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    if (sourceClient) sourceClient.release();
    if (targetClient) targetClient.release();
    await sourceDb.end();
    await targetDb.end();
  }
}

testMappings();
