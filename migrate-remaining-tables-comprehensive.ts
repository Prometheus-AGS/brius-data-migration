import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

interface MigrationResult {
  tableName: string;
  sourceCount: number;
  migrated: number;
  success: boolean;
  error?: string;
}

async function migrateRemainingTablesComprehensive() {
  console.log('🚀 Starting comprehensive migration of remaining tables...\n');

  const sourceClient = new Client({
    host: process.env.SOURCE_DB_HOST!,
    port: parseInt(process.env.SOURCE_DB_PORT!),
    user: process.env.SOURCE_DB_USER!,
    password: process.env.SOURCE_DB_PASSWORD!,
    database: process.env.SOURCE_DB_NAME!,
  });

  const results: MigrationResult[] = [];

  try {
    await sourceClient.connect();
    console.log('✅ Connected to source database\n');

    // 1. PATIENT EVENTS MIGRATION
    await migrateTable(sourceClient, {
      name: 'patient_events',
      sourceTable: 'dispatch_patient_event',
      selectQuery: `
        SELECT
          id,
          patient_id,
          event_type,
          event_data,
          created_at,
          updated_at,
          created_by
        FROM dispatch_patient_event
        ORDER BY id
      `,
      transformFn: (row: any) => ({
        patient_id: row.patient_id, // UUID from patients table
        event_type: row.event_type || 'general',
        event_data: row.event_data || {},
        event_timestamp: row.created_at,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        legacy_event_id: row.id,
        metadata: {
          migrationDate: new Date().toISOString(),
          sourceTable: 'dispatch_patient_event'
        }
      })
    }, results);

    // 2. TEAMS MIGRATION
    await migrateTable(sourceClient, {
      name: 'teams',
      sourceTable: 'auth_group', // Teams are typically stored as groups
      selectQuery: `
        SELECT
          id,
          name,
          COALESCE(permissions, '{}') as permissions
        FROM auth_group
        WHERE name LIKE '%team%' OR name LIKE '%group%'
        ORDER BY id
      `,
      transformFn: (row: any) => ({
        team_name: row.name,
        team_description: `Migrated team: ${row.name}`,
        team_type: 'operational',
        is_active: true,
        permissions: Array.isArray(row.permissions) ? row.permissions : [],
        legacy_group_id: row.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {
          migrationDate: new Date().toISOString(),
          sourceTable: 'auth_group',
          originalName: row.name
        }
      })
    }, results);

    // 3. ROLE PERMISSIONS MIGRATION
    await migrateTable(sourceClient, {
      name: 'role_permissions',
      sourceTable: 'auth_group_permissions',
      selectQuery: `
        SELECT
          agp.id,
          agp.group_id,
          agp.permission_id,
          ag.name as group_name,
          ap.name as permission_name,
          ap.codename
        FROM auth_group_permissions agp
        JOIN auth_group ag ON agp.group_id = ag.id
        JOIN auth_permission ap ON agp.permission_id = ap.id
        ORDER BY agp.id
      `,
      transformFn: (row: any) => ({
        role_name: row.group_name,
        permission_name: row.permission_name,
        permission_codename: row.codename,
        permission_level: 'standard',
        is_active: true,
        legacy_group_id: row.group_id,
        legacy_permission_id: row.permission_id,
        legacy_junction_id: row.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {
          migrationDate: new Date().toISOString(),
          sourceTable: 'auth_group_permissions'
        }
      })
    }, results);

    // 4. PAYMENTS MIGRATION
    await migrateTable(sourceClient, {
      name: 'payments',
      sourceTable: 'dispatch_payment',
      selectQuery: `
        SELECT
          id,
          patient_id,
          amount,
          payment_method,
          payment_status,
          transaction_id,
          created_at,
          updated_at,
          notes
        FROM dispatch_payment
        ORDER BY id
      `,
      transformFn: (row: any) => ({
        patient_id: row.patient_id,
        amount: parseFloat(row.amount) || 0,
        payment_method: row.payment_method || 'cash',
        payment_status: row.payment_status || 'pending',
        transaction_reference: row.transaction_id,
        payment_date: row.created_at,
        notes: row.notes,
        created_at: row.created_at,
        updated_at: row.updated_at,
        legacy_payment_id: row.id,
        metadata: {
          migrationDate: new Date().toISOString(),
          sourceTable: 'dispatch_payment'
        }
      })
    }, results);

    // 5. SHIPMENTS MIGRATION
    await migrateTable(sourceClient, {
      name: 'shipments',
      sourceTable: 'dispatch_shipment',
      selectQuery: `
        SELECT
          id,
          order_id,
          tracking_number,
          carrier,
          shipment_status,
          shipped_date,
          delivered_date,
          created_at,
          updated_at
        FROM dispatch_shipment
        ORDER BY id
      `,
      transformFn: (row: any) => ({
        order_id: row.order_id,
        tracking_number: row.tracking_number,
        carrier: row.carrier || 'unknown',
        shipment_status: row.shipment_status || 'pending',
        shipped_at: row.shipped_date,
        delivered_at: row.delivered_date,
        created_at: row.created_at,
        updated_at: row.updated_at,
        legacy_shipment_id: row.id,
        metadata: {
          migrationDate: new Date().toISOString(),
          sourceTable: 'dispatch_shipment'
        }
      })
    }, results);

    // 6. CUSTOMER FEEDBACK MIGRATION
    await migrateTable(sourceClient, {
      name: 'customer_feedback',
      sourceTable: 'dispatch_feedback',
      selectQuery: `
        SELECT
          id,
          patient_id,
          feedback_type,
          rating,
          feedback_text,
          created_at,
          updated_at
        FROM dispatch_feedback
        ORDER BY id
      `,
      transformFn: (row: any) => ({
        patient_id: row.patient_id,
        feedback_type: row.feedback_type || 'general',
        rating: parseInt(row.rating) || null,
        feedback_text: row.feedback_text,
        submission_date: row.created_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        legacy_feedback_id: row.id,
        metadata: {
          migrationDate: new Date().toISOString(),
          sourceTable: 'dispatch_feedback'
        }
      })
    }, results);

    // 7. SYSTEM MESSAGES MIGRATION
    await migrateTable(sourceClient, {
      name: 'system_messages',
      sourceTable: 'dispatch_system_message',
      selectQuery: `
        SELECT
          id,
          message_type,
          title,
          content,
          is_active,
          priority,
          created_at,
          updated_at,
          created_by
        FROM dispatch_system_message
        ORDER BY id
      `,
      transformFn: (row: any) => ({
        message_type: row.message_type || 'info',
        title: row.title,
        content: row.content,
        priority: row.priority || 'normal',
        is_active: row.is_active !== false,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        legacy_message_id: row.id,
        metadata: {
          migrationDate: new Date().toISOString(),
          sourceTable: 'dispatch_system_message'
        }
      })
    }, results);

    // 8. GLOBAL SETTINGS MIGRATION
    await migrateTable(sourceClient, {
      name: 'global_settings',
      sourceTable: 'dispatch_setting',
      selectQuery: `
        SELECT
          id,
          setting_key,
          setting_value,
          setting_type,
          description,
          is_active,
          created_at,
          updated_at
        FROM dispatch_setting
        ORDER BY id
      `,
      transformFn: (row: any) => ({
        setting_key: row.setting_key,
        setting_value: row.setting_value,
        setting_type: row.setting_type || 'string',
        description: row.description,
        is_active: row.is_active !== false,
        category: 'system',
        created_at: row.created_at,
        updated_at: row.updated_at,
        legacy_setting_id: row.id,
        metadata: {
          migrationDate: new Date().toISOString(),
          sourceTable: 'dispatch_setting'
        }
      })
    }, results);

    // 9. OPERATIONS MIGRATION
    await migrateTable(sourceClient, {
      name: 'operations',
      sourceTable: 'dispatch_operation',
      selectQuery: `
        SELECT
          id,
          operation_type,
          operation_data,
          status,
          started_at,
          completed_at,
          created_by,
          created_at,
          updated_at
        FROM dispatch_operation
        ORDER BY id
      `,
      transformFn: (row: any) => ({
        operation_type: row.operation_type,
        operation_data: row.operation_data || {},
        operation_status: row.status || 'pending',
        started_at: row.started_at,
        completed_at: row.completed_at,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        legacy_operation_id: row.id,
        metadata: {
          migrationDate: new Date().toISOString(),
          sourceTable: 'dispatch_operation'
        }
      })
    }, results);

    // 10. ORDER CASES MIGRATION (relationship table)
    await migrateTable(sourceClient, {
      name: 'order_cases',
      sourceTable: 'dispatch_order',
      selectQuery: `
        SELECT DISTINCT
          o.id as order_id,
          o.patient_id,
          c.id as case_id
        FROM dispatch_order o
        JOIN cases c ON o.patient_id = c.patient_id
        WHERE o.patient_id IS NOT NULL
        ORDER BY o.id
      `,
      transformFn: (row: any) => ({
        order_id: row.order_id,
        case_id: row.case_id,
        relationship_type: 'primary',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {
          migrationDate: new Date().toISOString(),
          sourceQuery: 'order-case relationship via patient_id'
        }
      })
    }, results);

    // Print summary
    console.log('\n=== MIGRATION SUMMARY ===');
    results.forEach(result => {
      const status = result.success ? '✅' : '❌';
      console.log(`${status} ${result.tableName}: ${result.migrated}/${result.sourceCount} migrated`);
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
    });

    const successCount = results.filter(r => r.success).length;
    const totalTables = results.length;
    console.log(`\n📊 Overall: ${successCount}/${totalTables} tables migrated successfully`);

    return results;

  } catch (error: any) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await sourceClient.end();
  }
}

async function migrateTable(
  sourceClient: Client,
  config: {
    name: string;
    sourceTable: string;
    selectQuery: string;
    transformFn: (row: any) => any;
  },
  results: MigrationResult[]
) {
  console.log(`📋 Migrating ${config.name}...`);

  try {
    // Check if source table exists
    const tableExistsResult = await sourceClient.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = '${config.sourceTable}'
      );
    `);

    if (!tableExistsResult.rows[0].exists) {
      console.log(`⚠️  Source table ${config.sourceTable} does not exist, skipping...`);
      results.push({
        tableName: config.name,
        sourceCount: 0,
        migrated: 0,
        success: true,
        error: 'Source table does not exist'
      });
      return;
    }

    // Get source data
    const sourceResult = await sourceClient.query(config.selectQuery);
    console.log(`Found ${sourceResult.rows.length} records in ${config.sourceTable}`);

    if (sourceResult.rows.length === 0) {
      results.push({
        tableName: config.name,
        sourceCount: 0,
        migrated: 0,
        success: true
      });
      return;
    }

    // Transform data
    const transformedData = sourceResult.rows.map(config.transformFn);

    // Insert in batches
    const batchSize = 100;
    let totalInserted = 0;

    for (let i = 0; i < transformedData.length; i += batchSize) {
      const batch = transformedData.slice(i, i + batchSize);

      try {
        const { error } = await supabase
          .from(config.name)
          .insert(batch);

        if (error) {
          console.error(`❌ Error inserting batch for ${config.name}:`, error.message);
          continue;
        }

        totalInserted += batch.length;
        console.log(`✅ Inserted ${batch.length} records for ${config.name} (total: ${totalInserted})`);

      } catch (batchError: any) {
        console.error(`❌ Batch error for ${config.name}:`, batchError.message);
      }
    }

    results.push({
      tableName: config.name,
      sourceCount: sourceResult.rows.length,
      migrated: totalInserted,
      success: totalInserted > 0
    });

    console.log(`✅ ${config.name} migration completed: ${totalInserted}/${sourceResult.rows.length} records\n`);

  } catch (error: any) {
    console.error(`❌ Error migrating ${config.name}:`, error.message);
    results.push({
      tableName: config.name,
      sourceCount: 0,
      migrated: 0,
      success: false,
      error: error.message
    });
  }
}

// Execute the migration
if (require.main === module) {
  migrateRemainingTablesComprehensive()
    .then(results => {
      console.log('\n✨ Migration completed!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n💥 Migration Error:', error.message);
      process.exit(1);
    });
}

export { migrateRemainingTablesComprehensive };