import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function migrateBracketsWithSchema() {
  console.log('🚀 Migrating brackets data to newly created schema...\n');
  
  // Step 1: Connect to source and fetch bracket data
  console.log('📊 Step 1: Fetching source bracket data...');
  
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
    
    // Step 2: Transform brackets data for new schema
    console.log('\n🔄 Step 2: Transforming bracket data for new schema...');
    
    const transformedBrackets = sourceBrackets.rows.map(bracket => {
      // Parse bracket name to extract useful information
      const name = bracket.name || 'Unnamed Bracket';
      const type = bracket.type || '';
      
      // Try to extract information from the name
      const bracketInfo = parseNameForBracketInfo(name);
      
      return {
        // Core information
        name: name,
        bracket_type: bracketInfo.bracketType || 'standard',
        description: `Legacy bracket from project ${bracket.project_id}`,
        
        // Technical specifications (inferred from name where possible)
        material: bracketInfo.material || 'metal',
        slot_size: bracketInfo.slotSize || null,
        torque: bracketInfo.torque || null,
        angulation: bracketInfo.angulation || null,
        prescription: bracketInfo.prescription || null,
        
        // Physical properties
        base_shape: bracketInfo.baseShape || null,
        height_mm: null,
        width_mm: null,
        thickness_mm: null,
        
        // Clinical information
        tooth_position: bracketInfo.toothPosition || null,
        arch_type: bracketInfo.archType || 'both',
        
        // Business information
        manufacturer: bracketInfo.manufacturer || 'Unknown',
        model_number: bracketInfo.modelNumber || null,
        sku: null,
        unit_cost: null,
        active: true,
        
        // Legacy data preservation
        legacy_bracket_id: bracket.id,
        legacy_project_id: bracket.project_id,
        
        // Audit fields
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: null,
        
        // Metadata
        metadata: {
          legacy_data: true,
          migration_batch: 'brackets-migration-v2',
          source_table: 'dispatch_bracket',
          original_type: type,
          original_project_id: bracket.project_id,
          parsed_info: bracketInfo
        }
      };
    });
    
    console.log(`Transformed ${transformedBrackets.length} brackets`);
    console.log('Sample transformed bracket:');
    console.log(JSON.stringify(transformedBrackets[0], null, 2));
    
    // Step 3: Insert in batches using direct SQL (to avoid Supabase cache issues)
    console.log('\n📤 Step 3: Inserting brackets using direct SQL...');
    
    const batchSize = 50;
    let totalInserted = 0;
    
    for (let i = 0; i < transformedBrackets.length; i += batchSize) {
      const batch = transformedBrackets.slice(i, i + batchSize);
      
      // Build SQL INSERT statement
      const values = batch.map(bracket => {
        return `(
          '${bracket.name.replace(/'/g, "''")}',
          '${bracket.bracket_type}',
          '${bracket.description.replace(/'/g, "''")}',
          '${bracket.material}',
          ${bracket.slot_size || 'NULL'},
          ${bracket.torque || 'NULL'},
          ${bracket.angulation || 'NULL'},
          ${bracket.prescription ? "'" + bracket.prescription + "'" : 'NULL'},
          ${bracket.base_shape ? "'" + bracket.base_shape + "'" : 'NULL'},
          ${bracket.height_mm || 'NULL'},
          ${bracket.width_mm || 'NULL'},
          ${bracket.thickness_mm || 'NULL'},
          ${bracket.tooth_position ? "'" + bracket.tooth_position + "'" : 'NULL'},
          '${bracket.arch_type}',
          '${bracket.manufacturer.replace(/'/g, "''")}',
          ${bracket.model_number ? "'" + bracket.model_number.replace(/'/g, "''") + "'" : 'NULL'},
          ${bracket.sku ? "'" + bracket.sku + "'" : 'NULL'},
          ${bracket.unit_cost || 'NULL'},
          ${bracket.active},
          ${bracket.legacy_bracket_id},
          ${bracket.legacy_project_id},
          '${bracket.created_at}',
          '${bracket.updated_at}',
          ${bracket.created_by || 'NULL'},
          '${JSON.stringify(bracket.metadata).replace(/'/g, "''")}'
        )`;
      }).join(',\n        ');
      
      const insertSQL = `
        INSERT INTO brackets (
          name, bracket_type, description, material, slot_size, torque, angulation, 
          prescription, base_shape, height_mm, width_mm, thickness_mm, 
          tooth_position, arch_type, manufacturer, model_number, sku, unit_cost, 
          active, legacy_bracket_id, legacy_project_id, created_at, updated_at, 
          created_by, metadata
        ) VALUES 
        ${values};
      `;
      
      const { error: insertError } = await supabase.rpc('exec_sql', { sql: insertSQL });
      
      if (insertError) {
        console.error(`❌ Error inserting batch ${Math.floor(i/batchSize) + 1}:`, insertError);
        // Try individual inserts for this batch
        for (const bracket of batch) {
          try {
            const singleInsertSQL = `
              INSERT INTO brackets (
                name, bracket_type, description, material, arch_type, manufacturer,
                active, legacy_bracket_id, legacy_project_id, created_at, updated_at, metadata
              ) VALUES (
                '${bracket.name.replace(/'/g, "''")}',
                '${bracket.bracket_type}',
                '${bracket.description.replace(/'/g, "''")}',
                '${bracket.material}',
                '${bracket.arch_type}',
                '${bracket.manufacturer.replace(/'/g, "''")}',
                ${bracket.active},
                ${bracket.legacy_bracket_id},
                ${bracket.legacy_project_id},
                '${bracket.created_at}',
                '${bracket.updated_at}',
                '${JSON.stringify(bracket.metadata).replace(/'/g, "''")}'
              );
            `;
            
            const { error: singleError } = await supabase.rpc('exec_sql', { sql: singleInsertSQL });
            
            if (!singleError) {
              totalInserted++;
              console.log(`  ✅ Individual insert: ${bracket.name}`);
            } else {
              console.log(`  ❌ Individual insert failed: ${bracket.name} - ${singleError.message}`);
            }
          } catch (e) {
            console.log(`  ❌ Individual insert error: ${bracket.name}`);
          }
        }
      } else {
        totalInserted += batch.length;
        console.log(`✅ Inserted batch ${Math.floor(i/batchSize) + 1}: ${batch.length} brackets (total: ${totalInserted})`);
      }
    }
    
    console.log(`\n🎉 Migration completed! Inserted ${totalInserted} / ${sourceBrackets.rows.length} brackets`);
    
  } catch (error) {
    console.error('❌ Error during bracket migration:', error);
  } finally {
    await sourceClient.end();
  }
  
  // Step 4: Validation
  console.log('\n✅ Step 4: Validating migration...');
  
  const { count: finalCount } = await supabase
    .from('brackets')
    .select('*', { count: 'exact', head: true });
    
  console.log(`Final brackets count: ${finalCount}`);
  
  // Sample migrated brackets using direct SQL to avoid cache issues
  const { data: sampleBrackets, error: sampleError } = await supabase.rpc('exec_sql', {
    sql: `SELECT * FROM brackets ORDER BY name LIMIT 5;`
  });
  
  if (sampleBrackets && Array.isArray(sampleBrackets)) {
    console.log('\n📋 Sample migrated brackets:');
    sampleBrackets.forEach((bracket, index) => {
      console.log(`${index + 1}. ${bracket.name} (${bracket.bracket_type}) - Manufacturer: ${bracket.manufacturer}`);
    });
  }
  
  // Get statistics
  const { data: stats, error: statsError } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT 
        bracket_type,
        material,
        manufacturer,
        COUNT(*) as count
      FROM brackets
      GROUP BY bracket_type, material, manufacturer
      ORDER BY count DESC
      LIMIT 10;
    `
  });
  
  if (stats && Array.isArray(stats)) {
    console.log('\n📊 Bracket statistics:');
    stats.forEach(stat => {
      console.log(`  ${stat.bracket_type} | ${stat.material} | ${stat.manufacturer}: ${stat.count} brackets`);
    });
  }
  
  console.log('\n🎉 Brackets migration completed successfully!');
}

function parseNameForBracketInfo(name: string) {
  const info: any = {};
  const lowerName = name.toLowerCase();
  
  // Extract bracket type
  if (lowerName.includes('speed')) {
    info.bracketType = 'self-ligating';
    info.manufacturer = 'Dentsply Sirona';
  } else if (lowerName.includes('alias')) {
    info.bracketType = 'ceramic';
    info.manufacturer = 'Dentsply Sirona';
  } else if (lowerName.includes('square')) {
    info.bracketType = 'metal';
    info.baseShape = 'square';
  } else if (lowerName.includes('composite')) {
    info.bracketType = 'composite';
    info.material = 'composite';
  } else if (lowerName.includes('ceramic')) {
    info.bracketType = 'ceramic';
    info.material = 'ceramic';
  } else if (lowerName.includes('hook')) {
    info.bracketType = 'hook';
  }
  
  // Extract material
  if (lowerName.includes('ceramic')) {
    info.material = 'ceramic';
  } else if (lowerName.includes('composite')) {
    info.material = 'composite';
  } else {
    info.material = 'metal';
  }
  
  // Extract tooth position
  if (lowerName.includes('canine')) {
    info.toothPosition = 'canine';
  } else if (lowerName.includes('incisors')) {
    info.toothPosition = 'incisor';
  } else if (lowerName.includes('molars')) {
    info.toothPosition = 'molar';
  }
  
  // Extract arch type
  if (lowerName.includes('upper')) {
    info.archType = 'upper';
  } else if (lowerName.includes('lower')) {
    info.archType = 'lower';
  } else {
    info.archType = 'both';
  }
  
  // Extract version/model
  const versionMatch = name.match(/V(\d+)/i);
  if (versionMatch) {
    info.modelNumber = `Version ${versionMatch[1]}`;
  }
  
  return info;
}

migrateBracketsWithSchema().catch(console.error);
