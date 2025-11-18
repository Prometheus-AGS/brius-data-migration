/**
 * Check Supabase Target Database Schema
 * Uses Supabase client to verify table structure
 */

import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function checkSupabaseSchema() {
  console.log('🔍 Checking Supabase target database schema...');

  // Initialize Supabase client
  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE!;

  const supabase = createClient(supabaseUrl, supabaseServiceRole, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  // Also try direct PostgreSQL connection
  const targetPool = new Pool({
    host: process.env.TARGET_DB_HOST,
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    database: process.env.TARGET_DB_NAME,
    user: process.env.TARGET_DB_USER,
    password: process.env.TARGET_DB_PASSWORD,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  try {
    console.log('\n📊 Testing Supabase client connection...');

    // Test basic Supabase connection by checking a simple table
    const { data: testData, error: testError } = await supabase
      .from('profiles')
      .select('count', { count: 'exact', head: true });

    if (testError) {
      console.error('❌ Supabase client error:', testError);
    } else {
      console.log('✅ Supabase client connected successfully');
      console.log(`   Profiles count: ${testData?.length || 'N/A'}`);
    }

    console.log('\n📊 Testing direct PostgreSQL connection...');

    // Test direct PostgreSQL connection
    const profileCountResult = await targetPool.query('SELECT COUNT(*) as count FROM profiles');
    console.log('✅ Direct PostgreSQL connected successfully');
    console.log(`   Profiles count: ${profileCountResult.rows[0].count}`);

    console.log('\n📋 Checking files table...');

    try {
      // Check if files table exists via Supabase
      const { data: filesData, error: filesError } = await supabase
        .from('files')
        .select('count', { count: 'exact', head: true });

      if (filesError) {
        console.error('❌ Files table error via Supabase:', filesError);

        // Try direct SQL to check table existence
        try {
          const tableCheckResult = await targetPool.query(`
            SELECT EXISTS (
              SELECT FROM information_schema.tables
              WHERE table_schema = 'public'
              AND table_name = 'files'
            );
          `);

          const tableExists = tableCheckResult.rows[0].exists;
          console.log(`   Files table exists (direct SQL): ${tableExists}`);

          if (tableExists) {
            // Get table schema
            const schemaResult = await targetPool.query(`
              SELECT column_name, data_type, is_nullable, column_default
              FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'files'
              ORDER BY ordinal_position;
            `);

            console.log('\n📋 Files table schema:');
            schemaResult.rows.forEach(row => {
              console.log(`   ${row.column_name}: ${row.data_type} ${row.is_nullable === 'NO' ? 'NOT NULL' : 'NULLABLE'}`);
            });
          }
        } catch (sqlError) {
          console.error('❌ Direct SQL error:', sqlError);
        }
      } else {
        console.log('✅ Files table accessible via Supabase');
        console.log(`   Files count: ${filesData?.length || 'N/A'}`);

        // Get current files count
        const { count } = await supabase
          .from('files')
          .select('*', { count: 'exact', head: true });

        console.log(`   Total files in target: ${count}`);
      }
    } catch (error) {
      console.error('❌ Error checking files table:', error);
    }

    console.log('\n📋 Checking source database tables...');

    // Connect to source database to verify dispatch_file
    const sourcePool = new Pool({
      host: process.env.SOURCE_DB_HOST,
      port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
      database: process.env.SOURCE_DB_NAME,
      user: process.env.SOURCE_DB_USER,
      password: process.env.SOURCE_DB_PASSWORD,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    try {
      const sourceCountResult = await sourcePool.query('SELECT COUNT(*) as count FROM dispatch_file');
      console.log(`✅ Source dispatch_file count: ${sourceCountResult.rows[0].count}`);

      // Check for files not yet migrated
      const unmigrated = await sourcePool.query(`
        SELECT COUNT(*) as count
        FROM dispatch_file df
        WHERE df.id NOT IN (
          SELECT COALESCE(CAST(metadata->>'legacy_file_id' AS INTEGER), 0)
          FROM files
          WHERE metadata->>'legacy_file_id' IS NOT NULL
        )
      `);

      console.log(`📊 Unmigrated files in source: ${unmigrated.rows[0].count}`);

    } catch (sourceError) {
      console.error('❌ Source database error:', sourceError);
    } finally {
      await sourcePool.end();
    }

  } catch (error) {
    console.error('❌ Main error:', error);
  } finally {
    await targetPool.end();
  }
}

if (require.main === module) {
  checkSupabaseSchema().catch(error => {
    console.error('❌ Script execution failed:', error);
    process.exit(1);
  });
}

export { checkSupabaseSchema };