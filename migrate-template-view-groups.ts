import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function migrateTemplateViewGroups() {
  console.log('🚀 Migrating template view groups...\n');

  const sourceClient = new Client({
    host: process.env.SOURCE_DB_HOST!,
    port: parseInt(process.env.SOURCE_DB_PORT!),
    user: process.env.SOURCE_DB_USER!,
    password: process.env.SOURCE_DB_PASSWORD!,
    database: process.env.SOURCE_DB_NAME!,
  });

  try {
    await sourceClient.connect();

    // Get all template view groups from source
    const sourceGroups = await sourceClient.query(`
      SELECT
        id,
        name,
        description,
        is_active,
        created_at,
        updated_at
      FROM dispatch_template_view_groups
      ORDER BY id;
    `);

    console.log(`Found ${sourceGroups.rows.length} template view groups in source database`);

    if (sourceGroups.rows.length === 0) {
      console.log('No template view groups found to migrate');
      return;
    }

    // Transform data
    const transformedGroups = sourceGroups.rows.map(group => ({
      group_name: group.name,
      group_description: group.description || '',
      group_type: 'template_access',
      permissions: [],
      template_categories: [],
      is_active: group.is_active !== false,
      legacy_group_id: group.id,
      created_at: group.created_at,
      updated_at: group.updated_at,
      metadata: {
        legacy_data: true,
        migration_batch: 'template-view-groups-migration',
        source_table: 'dispatch_template_view_groups',
        original_name: group.name
      }
    }));

    console.log(`Transformed ${transformedGroups.length} template view groups`);

    // Insert in batches
    const batchSize = 50;
    let totalInserted = 0;

    for (let i = 0; i < transformedGroups.length; i += batchSize) {
      const batch = transformedGroups.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;

      try {
        const insertQuery = `
          INSERT INTO template_view_groups (
            group_name, group_description, group_type, permissions, template_categories,
            is_active, legacy_group_id, created_at, updated_at, metadata
          )
          SELECT * FROM jsonb_populate_recordset(null::template_view_groups, $1::jsonb)
          ON CONFLICT (legacy_group_id) DO NOTHING
        `;

        const { data, error } = await supabase.rpc('exec_sql', {
          sql: insertQuery,
          params: [JSON.stringify(batch)]
        });

        if (error) {
          console.error(`❌ Error inserting batch ${batchNumber}:`, error);
        } else {
          totalInserted += batch.length;
          console.log(`✅ Inserted batch ${batchNumber}: ${batch.length} groups (total: ${totalInserted})`);
        }

      } catch (error: any) {
        console.error(`❌ Exception inserting batch ${batchNumber}:`, error.message);
      }
    }

    // Validate results
    const { count: finalCount } = await supabase
      .from('template_view_groups')
      .select('*', { count: 'exact', head: true });

    console.log(`\n🎉 Migration completed! Inserted ${totalInserted} / ${sourceGroups.rows.length} template view groups`);
    console.log(`Final template_view_groups count: ${finalCount}`);

    if (finalCount === sourceGroups.rows.length) {
      console.log('✅ Template view groups migration completed successfully!');
    }

  } catch (error: any) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await sourceClient.end();
  }
}

// Run the migration
if (require.main === module) {
  migrateTemplateViewGroups().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default migrateTemplateViewGroups;