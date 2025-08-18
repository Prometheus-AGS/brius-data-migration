import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

async function investigateDispatchBracket() {
  console.log('🔍 Investigating dispatch_bracket table in source database...\n');
  
  const sourceClient = new Client({
    host: process.env.SOURCE_DB_HOST!,
    port: parseInt(process.env.SOURCE_DB_PORT!),
    user: process.env.SOURCE_DB_USER!,
    password: process.env.SOURCE_DB_PASSWORD!,
    database: process.env.SOURCE_DB_NAME!,
  });
  
  try {
    await sourceClient.connect();
    
    // 1. Get table structure
    console.log('📋 Step 1: dispatch_bracket table structure:');
    
    const structure = await sourceClient.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'dispatch_bracket' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);
    
    structure.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'} ${col.column_default ? 'DEFAULT ' + col.column_default : ''}`);
    });
    
    // 2. Count total records
    const countResult = await sourceClient.query('SELECT COUNT(*) as count FROM dispatch_bracket');
    console.log(`\n📊 Total dispatch_bracket records: ${countResult.rows[0].count}`);
    
    // 3. Sample records
    const sampleData = await sourceClient.query(`
      SELECT * FROM dispatch_bracket
      ORDER BY id
      LIMIT 10;
    `);
    
    if (sampleData.rows.length > 0) {
      console.log('\n📄 Sample dispatch_bracket records:');
      sampleData.rows.forEach((row, index) => {
        console.log(`\nRecord ${index + 1}:`, JSON.stringify(row, null, 2));
      });
    } else {
      console.log('\n📄 No records found in dispatch_bracket table');
    }
    
    // 4. Check for foreign key relationships
    console.log('\n🔗 Analyzing potential relationships...');
    
    // Check if there are case_id, order_id, instruction_id, patient_id columns
    const relationshipColumns = ['case_id', 'order_id', 'instruction_id', 'patient_id', 'doctor_id'];
    const availableColumns = structure.rows.map(col => col.column_name);
    
    relationshipColumns.forEach(relCol => {
      if (availableColumns.includes(relCol)) {
        console.log(`✅ Found relationship column: ${relCol}`);
      } else {
        console.log(`❌ No ${relCol} column found`);
      }
    });
    
    // 5. If we have records, analyze the relationships
    if (sampleData.rows.length > 0 && countResult.rows[0].count > 0) {
      console.log('\n📊 Analyzing data patterns...');
      
      // Check for non-null foreign key columns
      for (const col of relationshipColumns) {
        if (availableColumns.includes(col)) {
          try {
            const nonNullCount = await sourceClient.query(`
              SELECT COUNT(*) as count 
              FROM dispatch_bracket 
              WHERE ${col} IS NOT NULL;
            `);
            console.log(`  ${col}: ${nonNullCount.rows[0].count} non-null values`);
          } catch (e) {
            console.log(`  ${col}: Error checking values`);
          }
        }
      }
      
      // Check unique values for key columns
      if (availableColumns.includes('name') || availableColumns.includes('type')) {
        try {
          const uniqueValues = await sourceClient.query(`
            SELECT 
              ${availableColumns.includes('name') ? 'name' : 'type'} as value,
              COUNT(*) as count
            FROM dispatch_bracket
            GROUP BY ${availableColumns.includes('name') ? 'name' : 'type'}
            ORDER BY count DESC
            LIMIT 10;
          `);
          
          console.log(`\n📊 Most common ${availableColumns.includes('name') ? 'names' : 'types'}:`);
          uniqueValues.rows.forEach(row => {
            console.log(`  ${row.value}: ${row.count} records`);
          });
        } catch (e) {
          console.log('Could not analyze unique values');
        }
      }
    }
    
    // 6. Check if brackets relate to cases/orders/instructions
    if (sampleData.rows.length > 0) {
      console.log('\n🔍 Testing relationships with other tables...');
      
      // If there's a case_id column, test the relationship
      if (availableColumns.includes('case_id')) {
        try {
          const caseRelation = await sourceClient.query(`
            SELECT COUNT(*) as count
            FROM dispatch_bracket db
            JOIN dispatch_case dc ON db.case_id = dc.id
            WHERE db.case_id IS NOT NULL
            LIMIT 100;
          `);
          console.log(`✅ Brackets linked to cases: ${caseRelation.rows[0].count}`);
        } catch (e) {
          console.log('❌ Error testing case relationship');
        }
      }
      
      // If there's an order_id column, test the relationship
      if (availableColumns.includes('order_id')) {
        try {
          const orderRelation = await sourceClient.query(`
            SELECT COUNT(*) as count
            FROM dispatch_bracket db
            JOIN dispatch_order do ON db.order_id = do.id
            WHERE db.order_id IS NOT NULL
            LIMIT 100;
          `);
          console.log(`✅ Brackets linked to orders: ${orderRelation.rows[0].count}`);
        } catch (e) {
          console.log('❌ Error testing order relationship');
        }
      }
      
      // If there's an instruction_id column, test the relationship
      if (availableColumns.includes('instruction_id')) {
        try {
          const instructionRelation = await sourceClient.query(`
            SELECT COUNT(*) as count
            FROM dispatch_bracket db
            JOIN dispatch_instruction di ON db.instruction_id = di.id
            WHERE db.instruction_id IS NOT NULL
            LIMIT 100;
          `);
          console.log(`✅ Brackets linked to instructions: ${instructionRelation.rows[0].count}`);
        } catch (e) {
          console.log('❌ Error testing instruction relationship');
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error investigating dispatch_bracket:', error);
  } finally {
    await sourceClient.end();
  }
}

investigateDispatchBracket().catch(console.error);
