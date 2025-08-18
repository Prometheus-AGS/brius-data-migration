import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

async function analyzeSourceBracketData() {
  console.log('🔍 Analyzing source database for bracket-related data...\n');
  
  const sourceClient = new Client({
    host: process.env.SOURCE_DB_HOST!,
    port: parseInt(process.env.SOURCE_DB_PORT!),
    user: process.env.SOURCE_DB_USER!,
    password: process.env.SOURCE_DB_PASSWORD!,
    database: process.env.SOURCE_DB_NAME!,
  });
  
  try {
    await sourceClient.connect();
    
    // 1. Look for bracket-related tables
    console.log('📋 Step 1: Looking for bracket-related tables...');
    
    const bracketTables = await sourceClient.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND (
        table_name LIKE '%bracket%' OR
        table_name LIKE '%appliance%' OR
        table_name LIKE '%device%' OR
        table_name LIKE '%hardware%'
      )
      ORDER BY table_name;
    `);
    
    console.log('Found bracket-related tables:');
    bracketTables.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });
    
    // 2. Check dispatch_case for bracket fields
    console.log('\n📋 Step 2: Checking dispatch_case for bracket-related fields...');
    
    const caseStructure = await sourceClient.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'dispatch_case' AND table_schema = 'public'
      AND (
        column_name LIKE '%bracket%' OR
        column_name LIKE '%appliance%' OR
        column_name LIKE '%device%' OR
        column_name LIKE '%hardware%'
      )
      ORDER BY column_name;
    `);
    
    if (caseStructure.rows.length > 0) {
      console.log('Found bracket-related fields in dispatch_case:');
      caseStructure.rows.forEach(row => {
        console.log(`  - ${row.column_name}: ${row.data_type}`);
      });
    } else {
      console.log('No obvious bracket-related fields found in dispatch_case');
    }
    
    // 3. Check dispatch_order for bracket fields
    console.log('\n📋 Step 3: Checking dispatch_order for bracket-related fields...');
    
    const orderStructure = await sourceClient.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'dispatch_order' AND table_schema = 'public'
      AND (
        column_name LIKE '%bracket%' OR
        column_name LIKE '%appliance%' OR
        column_name LIKE '%device%' OR
        column_name LIKE '%hardware%'
      )
      ORDER BY column_name;
    `);
    
    if (orderStructure.rows.length > 0) {
      console.log('Found bracket-related fields in dispatch_order:');
      orderStructure.rows.forEach(row => {
        console.log(`  - ${row.column_name}: ${row.data_type}`);
      });
    } else {
      console.log('No obvious bracket-related fields found in dispatch_order');
    }
    
    // 4. Check dispatch_instruction for bracket data
    console.log('\n📋 Step 4: Checking dispatch_instruction for bracket-related fields...');
    
    const instructionStructure = await sourceClient.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'dispatch_instruction' AND table_schema = 'public'
      AND (
        column_name LIKE '%bracket%' OR
        column_name LIKE '%appliance%' OR
        column_name LIKE '%device%' OR
        column_name LIKE '%hardware%'
      )
      ORDER BY column_name;
    `);
    
    if (instructionStructure.rows.length > 0) {
      console.log('Found bracket-related fields in dispatch_instruction:');
      instructionStructure.rows.forEach(row => {
        console.log(`  - ${row.column_name}: ${row.data_type}`);
      });
    } else {
      console.log('No obvious bracket-related fields found in dispatch_instruction');
    }
    
    // 5. Look for any table with bracket in the name or columns
    console.log('\n📋 Step 5: Comprehensive search for bracket-related data...');
    
    const allTables = await sourceClient.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    
    console.log(`\nSearching ${allTables.rows.length} tables for bracket-related columns...`);
    
    let bracketColumns = [];
    
    for (const table of allTables.rows) {
      try {
        const columns = await sourceClient.query(`
          SELECT column_name, data_type
          FROM information_schema.columns
          WHERE table_name = $1 AND table_schema = 'public'
          AND (
            column_name ILIKE '%bracket%' OR
            column_name ILIKE '%appliance%' OR
            column_name ILIKE '%device%' OR
            column_name ILIKE '%hardware%' OR
            column_name ILIKE '%aligner%' OR
            column_name ILIKE '%retainer%'
          );
        `, [table.table_name]);
        
        if (columns.rows.length > 0) {
          bracketColumns.push({
            table: table.table_name,
            columns: columns.rows
          });
        }
      } catch (e) {
        // Skip tables we can't access
      }
    }
    
    if (bracketColumns.length > 0) {
      console.log('\n🎯 Found bracket-related columns:');
      bracketColumns.forEach(tableInfo => {
        console.log(`\n📋 Table: ${tableInfo.table}`);
        tableInfo.columns.forEach(col => {
          console.log(`  - ${col.column_name}: ${col.data_type}`);
        });
      });
    }
    
    // 6. Check for enumerated values or lookup tables
    console.log('\n📋 Step 6: Looking for bracket types or categories...');
    
    // Check if there are any enum or lookup tables for bracket types
    const enumTables = await sourceClient.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND (
        table_name LIKE '%type%' OR
        table_name LIKE '%category%' OR
        table_name LIKE '%lookup%'
      )
      ORDER BY table_name;
    `);
    
    console.log('Found potential enum/lookup tables:');
    enumTables.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });
    
    // 7. Sample some data to understand structure
    if (bracketColumns.length > 0) {
      console.log('\n📊 Step 7: Sampling data from bracket-related tables...');
      
      for (const tableInfo of bracketColumns.slice(0, 3)) { // Just first 3 tables
        try {
          const sampleData = await sourceClient.query(`
            SELECT * FROM ${tableInfo.table}
            LIMIT 3;
          `);
          
          if (sampleData.rows.length > 0) {
            console.log(`\n📄 Sample data from ${tableInfo.table}:`);
            sampleData.rows.forEach((row, index) => {
              console.log(`Record ${index + 1}:`, JSON.stringify(row, null, 2));
            });
          }
        } catch (e) {
          console.log(`Could not sample data from ${tableInfo.table}`);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error analyzing source bracket data:', error);
  } finally {
    await sourceClient.end();
  }
}

analyzeSourceBracketData().catch(console.error);
