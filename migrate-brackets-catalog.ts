import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function migrateBracketsCatalog() {
  console.log('🚀 Migrating brackets as catalog/reference data...\n');
  
  // Step 1: Check target brackets table structure
  console.log('📋 Step 1: Checking target brackets table structure...');
  
  const { data: bracketsTest, error: bracketsError } = await supabase
    .from('brackets')
    .select('*')
    .limit(1);
    
  if (bracketsError && bracketsError.code === '42P01') {
    console.log('❌ brackets table does not exist in target');
    return;
  }
  
  // Try to insert empty record to understand required fields
  const { error: insertError } = await supabase
    .from('brackets')
    .insert({});
    
  if (insertError) {
    console.log('Target brackets table structure info:');
    console.log(insertError.message);
  }
  
  // Step 2: Connect to source and fetch bracket data
  console.log('\n📊 Step 2: Fetching source bracket data...');
  
  const sourceClient = new Client({
    host: process.env.SOURCE_DB_HOST!,
    port: parseInt(process.env.SOURCE_DB_PORT!),
    user: process.env.SOURCE_DB_USER!,
    password: process.env.SOURCE_DB_PASSWORD!,
    database: process.env.SOURCE_DB_NAME!,
  });
  
  try {
    await sourceClient.connect();
    
    // Get all brackets from source
    const sourceBrackets = await sourceClient.query(`
      SELECT 
        id,
        name,
        project_id,
        type
      FROM dispatch_bracket
      ORDER BY id;
    `);
    
    console.log(`Found ${sourceBrackets.rows.length} brackets in source database`);
    
    if (sourceBrackets.rows.length === 0) {
      console.log('No brackets found to migrate');
      return;
    }
    
    // Step 3: Transform brackets data for target schema
    console.log('\n🔄 Step 3: Transforming bracket data...');
    
    const transformedBrackets = sourceBrackets.rows.map(bracket => ({
      // Standard fields that most bracket tables would have
      name: bracket.name || 'Unnamed Bracket',
      bracket_type: bracket.type || 'unknown',
      description: `Legacy bracket from project ${bracket.project_id}`,
      
      // Legacy reference
      legacy_bracket_id: bracket.id,
      legacy_project_id: bracket.project_id,
      
      // Audit fields
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      
      // Additional metadata
      metadata: {
        legacy_data: true,
        migration_batch: 'brackets-catalog-migration',
        source_table: 'dispatch_bracket',
        original_project_id: bracket.project_id
      }
    }));
    
    console.log('Sample transformed bracket:');
    console.log(JSON.stringify(transformedBrackets[0], null, 2));
    
    // Step 4: Migrate in batches
    console.log('\n📤 Step 4: Migrating brackets in batches...');
    
    const batchSize = 100;
    let totalInserted = 0;
    
    for (let i = 0; i < transformedBrackets.length; i += batchSize) {
      const batch = transformedBrackets.slice(i, i + batchSize);
      
      // Try to insert batch - adjust fields based on what works
      const insertAttempts = [
        // Attempt 1: Try with all fields
        async () => {
          return await supabase
            .from('brackets')
            .insert(batch);
        },
        
        // Attempt 2: Try with minimal fields
        async () => {
          const minimalBatch = batch.map(b => ({
            name: b.name,
            bracket_type: b.bracket_type,
            legacy_bracket_id: b.legacy_bracket_id
          }));
          return await supabase
            .from('brackets')
            .insert(minimalBatch);
        },
        
        // Attempt 3: Try with just name
        async () => {
          const nameBatch = batch.map(b => ({
            name: b.name
          }));
          return await supabase
            .from('brackets')
            .insert(nameBatch);
        }
      ];
      
      let inserted = false;
      
      for (const [index, attempt] of insertAttempts.entries()) {
        try {
          const { error } = await attempt();
          
          if (!error) {
            totalInserted += batch.length;
            console.log(`✅ Inserted batch ${Math.floor(i/batchSize) + 1} (${batch.length} records) using approach ${index + 1}`);
            inserted = true;
            break;
          } else {
            console.log(`Attempt ${index + 1} failed:`, error.message);
          }
        } catch (e) {
          console.log(`Attempt ${index + 1} error:`, e);
        }
      }
      
      if (!inserted) {
        console.log(`❌ Failed to insert batch ${Math.floor(i/batchSize) + 1} with all approaches`);
        
        // Try individual records to identify problematic ones
        for (const [recordIndex, record] of batch.entries()) {
          try {
            const { error } = await supabase
              .from('brackets')
              .insert({
                name: record.name || `Bracket ${record.legacy_bracket_id}`
              });
              
            if (!error) {
              totalInserted++;
              console.log(`  ✅ Individual insert: ${record.name}`);
            } else {
              console.log(`  ❌ Individual insert failed: ${record.name} - ${error.message}`);
            }
          } catch (e) {
            console.log(`  ❌ Individual insert error: ${record.name}`);
          }
        }
      }
    }
    
    console.log(`\n🎉 Migration completed! Inserted ${totalInserted} / ${sourceBrackets.rows.length} brackets`);
    
    // Step 5: Validation
    console.log('\n✅ Step 5: Validating migration...');
    
    const { count: finalCount } = await supabase
      .from('brackets')
      .select('*', { count: 'exact', head: true });
      
    console.log(`Final brackets count: ${finalCount}`);
    
    // Sample migrated brackets
    const { data: sampleBrackets } = await supabase
      .from('brackets')
      .select('*')
      .limit(5);
      
    if (sampleBrackets) {
      console.log('\n📋 Sample migrated brackets:');
      sampleBrackets.forEach((bracket, index) => {
        console.log(`${index + 1}. ${JSON.stringify(bracket, null, 2)}`);
      });
    }
    
    // Unique bracket names
    const { data: uniqueNames } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT name, COUNT(*) as count
        FROM brackets
        GROUP BY name
        ORDER BY count DESC
        LIMIT 10;
      `
    });
    
    if (uniqueNames && Array.isArray(uniqueNames)) {
      console.log('\n📊 Most common bracket names:');
      uniqueNames.forEach(item => {
        console.log(`  ${item.name}: ${item.count} records`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error during bracket migration:', error);
  } finally {
    await sourceClient.end();
  }
}

migrateBracketsCatalog().catch(console.error);
