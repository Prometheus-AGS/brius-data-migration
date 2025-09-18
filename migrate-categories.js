/**
 * Categories Migration Script
 * Migrates data from source dispatch_category table to target categories table
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

async function migrateCategories() {
  let sourceClient, targetClient;
  
  try {
    console.log('🔄 Starting categories migration...');
    
    // Get connections
    sourceClient = await sourceDb.connect();
    targetClient = await targetDb.connect();
    
    // Begin transaction
    await targetClient.query('BEGIN');
    
    // Step 1: Fetch all source categories
    console.log('📋 Fetching source categories...');
    const sourceResult = await sourceClient.query(`
      SELECT id, name, parent_id
      FROM dispatch_category
      ORDER BY id
    `);
    
    const sourceCategories = sourceResult.rows;
    console.log(`Found ${sourceCategories.length} categories to migrate`);
    
    // Step 2: Create mapping for IDs (old ID -> new UUID)
    const idMapping = new Map();
    
    // Step 3: First pass - migrate categories without parent relationships
    console.log('🔄 First pass: Creating categories without parent relationships...');
    
    for (const category of sourceCategories) {
      const newId = await targetClient.query('SELECT gen_random_uuid() as id');
      const uuid = newId.rows[0].id;
      idMapping.set(category.id, uuid);
      
      await targetClient.query(`
        INSERT INTO categories (
          id, 
          name, 
          legacy_category_id,
          display_order,
          created_at, 
          updated_at
        )
        VALUES ($1, $2, $3, $4, NOW(), NOW())
      `, [
        uuid,
        category.name,
        category.id,
        category.id  // Use original id as display_order for now
      ]);
    }
    
    console.log('✅ First pass completed');
    
    // Step 4: Second pass - update parent relationships
    console.log('🔄 Second pass: Setting parent relationships...');
    
    let parentUpdates = 0;
    for (const category of sourceCategories) {
      if (category.parent_id) {
        const childUuid = idMapping.get(category.id);
        const parentUuid = idMapping.get(category.parent_id);
        
        if (childUuid && parentUuid) {
          await targetClient.query(`
            UPDATE categories 
            SET parent_id = $1, updated_at = NOW()
            WHERE id = $2
          `, [parentUuid, childUuid]);
          
          parentUpdates++;
        } else {
          console.warn(`⚠️ Could not find UUID mapping for category ${category.id} or parent ${category.parent_id}`);
        }
      }
    }
    
    console.log(`✅ Updated ${parentUpdates} parent relationships`);
    
    // Step 5: Validation
    console.log('🔍 Validating migration...');
    
    const targetCount = await targetClient.query('SELECT COUNT(*) as total FROM categories');
    const targetWithParents = await targetClient.query('SELECT COUNT(*) as total FROM categories WHERE parent_id IS NOT NULL');
    
    console.log(`Source categories: ${sourceCategories.length}`);
    console.log(`Target categories: ${targetCount.rows[0].total}`);
    console.log(`Categories with parents: ${targetWithParents.rows[0].total}`);
    
    // Show sample of migrated data
    console.log('\n📊 Sample migrated categories:');
    const sample = await targetClient.query(`
      SELECT 
        c1.name,
        c1.legacy_category_id,
        c2.name as parent_name,
        c1.display_order
      FROM categories c1
      LEFT JOIN categories c2 ON c1.parent_id = c2.id
      ORDER BY c1.display_order
      LIMIT 10
    `);
    
    console.table(sample.rows);
    
    // Commit transaction
    await targetClient.query('COMMIT');
    console.log('✅ Categories migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    if (targetClient) {
      await targetClient.query('ROLLBACK');
      console.log('🔄 Transaction rolled back');
    }
    throw error;
  } finally {
    if (sourceClient) sourceClient.release();
    if (targetClient) targetClient.release();
  }
}

async function validateCategoriesHierarchy() {
  try {
    console.log('\n🔍 Validating category hierarchy...');
    
    const client = await targetDb.connect();
    
    // Check for orphaned categories (parent_id points to non-existent category)
    const orphaned = await client.query(`
      SELECT c1.name, c1.legacy_category_id
      FROM categories c1
      WHERE c1.parent_id IS NOT NULL 
        AND NOT EXISTS (
          SELECT 1 FROM categories c2 WHERE c2.id = c1.parent_id
        )
    `);
    
    if (orphaned.rows.length > 0) {
      console.warn('⚠️ Found orphaned categories:');
      console.table(orphaned.rows);
    } else {
      console.log('✅ No orphaned categories found');
    }
    
    // Show hierarchy structure
    const hierarchy = await client.query(`
      WITH RECURSIVE category_tree AS (
        -- Root categories (no parent)
        SELECT 
          id, name, parent_id, legacy_category_id, 0 as level,
          name as path
        FROM categories 
        WHERE parent_id IS NULL
        
        UNION ALL
        
        -- Child categories
        SELECT 
          c.id, c.name, c.parent_id, c.legacy_category_id, ct.level + 1,
          ct.path || ' > ' || c.name
        FROM categories c
        INNER JOIN category_tree ct ON c.parent_id = ct.id
      )
      SELECT 
        legacy_category_id,
        REPEAT('  ', level) || name as indented_name,
        level,
        path
      FROM category_tree
      ORDER BY path
    `);
    
    console.log('\n🌳 Category hierarchy:');
    hierarchy.rows.forEach(row => {
      console.log(`${row.legacy_category_id}: ${row.indented_name}`);
    });
    
    client.release();
    
  } catch (error) {
    console.error('❌ Validation failed:', error);
  }
}

async function main() {
  try {
    await migrateCategories();
    await validateCategoriesHierarchy();
  } catch (error) {
    console.error('❌ Script failed:', error);
    process.exit(1);
  } finally {
    await sourceDb.end();
    await targetDb.end();
  }
}

// Run the migration
if (require.main === module) {
  main();
}
