import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { readFileSync } from 'fs';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function executeSchemaModifications() {
  console.log('🔧 Executing schema modifications for migration compatibility...\n');

  try {
    // Read and execute the SQL file
    const schemaSQL = readFileSync('add-missing-schema-columns.sql', 'utf8');

    // Split the SQL into individual statements
    const statements = schemaSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

    console.log(`Executing ${statements.length} SQL statements...`);

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];

      if (statement.includes('SELECT') && statement.includes('column_count')) {
        // Skip the final reporting queries for now
        continue;
      }

      try {
        console.log(`${i + 1}/${statements.length}: ${statement.substring(0, 50)}...`);

        const { error } = await supabase.rpc('exec_sql', {
          sql: statement
        });

        if (error) {
          console.error(`   ❌ Error: ${error.message}`);
          errorCount++;
        } else {
          console.log(`   ✅ Success`);
          successCount++;
        }

      } catch (error: any) {
        console.error(`   ❌ Exception: ${error.message}`);
        errorCount++;
      }
    }

    console.log(`\n📊 Schema Modification Results:`);
    console.log(`   ✅ Successful statements: ${successCount}`);
    console.log(`   ❌ Failed statements: ${errorCount}`);

    if (successCount > 0) {
      console.log('\n✅ Schema modifications completed! Tables should now accept migration data.');
    }

    return { successCount, errorCount };

  } catch (error: any) {
    console.error('❌ Schema modification failed:', error);
    throw error;
  }
}

// Run the schema modifications
if (require.main === module) {
  executeSchemaModifications().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default executeSchemaModifications;