/**
 * Supabase Target Database Analysis
 * Analyzes target database structure using Supabase client
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

interface TableInfo {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

interface TableSummary {
  name: string;
  columns: TableInfo[];
  recordCount: number;
  hasLegacyMapping: boolean;
  legacyMappingField?: string;
  migratableEntities?: number;
}

class SupabaseTargetAnalysis {
  private supabase: any;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE;

    if (!supabaseUrl || !supabaseServiceRole) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE environment variables');
    }

    this.supabase = createClient(supabaseUrl, supabaseServiceRole);
  }

  /**
   * Get all table names in the public schema
   */
  async getAllTables(): Promise<string[]> {
    console.log('🔍 Getting all tables in target database...');

    const { data, error } = await this.supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .order('table_name');

    if (error) {
      console.error('❌ Error getting tables:', error);
      return [];
    }

    const tableNames = data.map((row: any) => row.table_name);
    console.log(`✓ Found ${tableNames.length} tables in public schema`);

    return tableNames;
  }

  /**
   * Get table schema information
   */
  async getTableSchema(tableName: string): Promise<TableInfo[]> {
    const { data, error } = await this.supabase
      .from('information_schema.columns')
      .select('table_name, column_name, data_type, is_nullable, column_default')
      .eq('table_schema', 'public')
      .eq('table_name', tableName)
      .order('ordinal_position');

    if (error) {
      console.error(`❌ Error getting schema for ${tableName}:`, error);
      return [];
    }

    return data;
  }

  /**
   * Get record count for a table
   */
  async getRecordCount(tableName: string): Promise<number> {
    try {
      const { count, error } = await this.supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true });

      if (error) {
        console.warn(`⚠️  Could not get count for ${tableName}:`, error.message);
        return 0;
      }

      return count || 0;
    } catch (error) {
      console.warn(`⚠️  Error counting records in ${tableName}`);
      return 0;
    }
  }

  /**
   * Check if table has legacy mapping field
   */
  hasLegacyMapping(columns: TableInfo[]): { hasMapping: boolean; field?: string } {
    const legacyField = columns.find(col =>
      col.column_name.startsWith('legacy_') && col.column_name.includes('_id')
    );

    return {
      hasMapping: !!legacyField,
      field: legacyField?.column_name
    };
  }

  /**
   * Analyze migration-relevant tables
   */
  async analyzeMigrationTables(): Promise<TableSummary[]> {
    console.log('🔍 Analyzing migration-relevant tables...');

    const allTables = await this.getAllTables();

    // Filter for migration-relevant tables
    const relevantTables = allTables.filter(tableName => {
      return [
        'technicians', 'templates', 'cases', 'case_files', 'case_states',
        'case_messages', 'order_cases', 'order_states', 'jaws', 'treatment_plans',
        'purchases', 'payments', 'shipments', 'patients_doctors_offices',
        // Also check existing tables
        'messages', 'files', 'orders', 'offices', 'profiles', 'patients', 'doctors'
      ].includes(tableName);
    });

    console.log(`📋 Analyzing ${relevantTables.length} migration-relevant tables...`);

    const summaries: TableSummary[] = [];

    for (const tableName of relevantTables) {
      console.log(`🔧 Analyzing ${tableName}...`);

      const columns = await this.getTableSchema(tableName);
      const recordCount = await this.getRecordCount(tableName);
      const legacyMapping = this.hasLegacyMapping(columns);

      let migratableEntities = 0;
      if (legacyMapping.hasMapping && legacyMapping.field) {
        // Count records with legacy mappings
        try {
          const { count } = await this.supabase
            .from(tableName)
            .select('*', { count: 'exact', head: true })
            .not(legacyMapping.field, 'is', null);
          migratableEntities = count || 0;
        } catch (error) {
          console.warn(`⚠️  Could not count legacy mappings in ${tableName}`);
        }
      }

      summaries.push({
        name: tableName,
        columns,
        recordCount,
        hasLegacyMapping: legacyMapping.hasMapping,
        legacyMappingField: legacyMapping.field,
        migratableEntities
      });

      console.log(`   ✓ ${tableName}: ${recordCount} records, ${legacyMapping.hasMapping ? 'HAS' : 'NO'} legacy mapping`);
    }

    return summaries;
  }

  /**
   * Display comprehensive analysis report
   */
  displayAnalysisReport(summaries: TableSummary[]): void {
    console.log('\n🎉 SUPABASE TARGET DATABASE ANALYSIS REPORT');
    console.log('=============================================');
    console.log(`📅 Analysis Date: ${new Date().toISOString()}`);
    console.log(`🎯 Tables Analyzed: ${summaries.length}`);

    // Summary statistics
    const totalRecords = summaries.reduce((sum, s) => sum + s.recordCount, 0);
    const tablesWithLegacy = summaries.filter(s => s.hasLegacyMapping).length;
    const totalMigrated = summaries.reduce((sum, s) => sum + (s.migratableEntities || 0), 0);

    console.log(`📊 Total Records: ${totalRecords.toLocaleString()}`);
    console.log(`🔗 Tables with Legacy Mapping: ${tablesWithLegacy}/${summaries.length}`);
    console.log(`📁 Total Migrated Records: ${totalMigrated.toLocaleString()}`);

    console.log('\n📋 TABLE-BY-TABLE ANALYSIS:');
    console.log('=============================');

    // Group by migration status
    const existingTables = summaries.filter(s => s.recordCount > 0);
    const emptyTables = summaries.filter(s => s.recordCount === 0);
    const missingTables = summaries.filter(s => s.columns.length === 0);

    console.log('\n✅ EXISTING TABLES WITH DATA:');
    existingTables.forEach(table => {
      const migrationInfo = table.hasLegacyMapping
        ? `${table.migratableEntities} legacy records`
        : 'No legacy mapping';

      console.log(`   ${table.name}: ${table.recordCount.toLocaleString()} records (${migrationInfo})`);

      // Show key columns
      const keyColumns = table.columns.filter(col =>
        col.column_name.includes('id') || col.column_name.includes('legacy')
      );
      keyColumns.forEach(col => {
        console.log(`     • ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULLABLE'}`);
      });
    });

    if (emptyTables.length > 0) {
      console.log('\n⚠️ EMPTY TABLES (MIGRATION TARGETS):');
      emptyTables.forEach(table => {
        console.log(`   ${table.name}: Schema exists, 0 records`);
        if (table.hasLegacyMapping) {
          console.log(`     Legacy field: ${table.legacyMappingField}`);
        }
      });
    }

    if (missingTables.length > 0) {
      console.log('\n❌ MISSING TABLES (NEED CREATION):');
      missingTables.forEach(table => {
        console.log(`   ${table.name}: Table does not exist`);
      });
    }

    // Migration readiness assessment
    console.log('\n🎯 MIGRATION READINESS ASSESSMENT:');
    const readyTables = existingTables.filter(t => t.hasLegacyMapping);
    const needsSetup = emptyTables.concat(missingTables);

    console.log(`   ✅ Ready for differential migration: ${readyTables.length} tables`);
    console.log(`   ⚠️  Need setup/creation: ${needsSetup.length} tables`);

    console.log('\n🚀 RECOMMENDED MIGRATION ORDER:');

    // Core tables (already migrated)
    const coreTables = ['profiles', 'offices', 'doctors', 'patients', 'orders', 'messages', 'files'];
    const coreExisting = summaries.filter(s => coreTables.includes(s.name) && s.recordCount > 0);

    console.log('   Phase 1 - Core (Already Complete):');
    coreExisting.forEach(table => {
      console.log(`     ✅ ${table.name} (${table.recordCount.toLocaleString()} records)`);
    });

    // Secondary tables
    const secondaryTables = ['technicians', 'templates', 'cases'];
    const secondaryAnalysis = summaries.filter(s => secondaryTables.includes(s.name));

    console.log('   Phase 2 - Secondary Entities:');
    secondaryAnalysis.forEach(table => {
      const status = table.recordCount > 0 ? `${table.recordCount} records` : 'Ready for migration';
      console.log(`     ${table.recordCount > 0 ? '✅' : '🔧'} ${table.name} (${status})`);
    });

    // Relationship tables
    const relationshipTables = ['case_files', 'case_states', 'case_messages', 'order_cases', 'order_states'];
    const relationshipAnalysis = summaries.filter(s => relationshipTables.includes(s.name));

    console.log('   Phase 3 - Relationship Tables:');
    relationshipAnalysis.forEach(table => {
      const status = table.recordCount > 0 ? `${table.recordCount} records` : 'Ready for migration';
      console.log(`     ${table.recordCount > 0 ? '✅' : '🔧'} ${table.name} (${status})`);
    });

    // Advanced tables
    const advancedTables = ['jaws', 'treatment_plans', 'purchases', 'payments', 'shipments'];
    const advancedAnalysis = summaries.filter(s => advancedTables.includes(s.name));

    console.log('   Phase 4 - Advanced Entities:');
    advancedAnalysis.forEach(table => {
      const status = table.recordCount > 0 ? `${table.recordCount} records` : 'Ready for migration';
      console.log(`     ${table.recordCount > 0 ? '✅' : '🔧'} ${table.name} (${status})`);
    });
  }

  /**
   * Get specific table details for migration planning
   */
  async getTableMigrationDetails(tableName: string): Promise<void> {
    console.log(`\n🔍 Detailed analysis for ${tableName}:`);

    const columns = await this.getTableSchema(tableName);
    if (columns.length === 0) {
      console.log(`❌ Table ${tableName} does not exist`);
      return;
    }

    const recordCount = await this.getRecordCount(tableName);
    const legacyMapping = this.hasLegacyMapping(columns);

    console.log(`📊 Records: ${recordCount.toLocaleString()}`);
    console.log(`🔗 Legacy Mapping: ${legacyMapping.hasMapping ? legacyMapping.field : 'None'}`);

    console.log('📋 Schema:');
    columns.forEach(col => {
      const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
      const defaultVal = col.column_default ? ` DEFAULT ${col.column_default}` : '';
      console.log(`   ${col.column_name}: ${col.data_type} ${nullable}${defaultVal}`);
    });

    // If table has records and legacy mapping, show sample
    if (recordCount > 0 && legacyMapping.hasMapping) {
      console.log('\n📋 Sample records with legacy mapping:');
      try {
        const { data: sampleData, error } = await this.supabase
          .from(tableName)
          .select('*')
          .not(legacyMapping.field!, 'is', null)
          .limit(3);

        if (error) {
          console.warn(`⚠️  Could not get sample data: ${error.message}`);
        } else if (sampleData && sampleData.length > 0) {
          sampleData.forEach((record: any, i: number) => {
            console.log(`   Record ${i + 1}: Legacy ID = ${record[legacyMapping.field!]}, UUID = ${record.id}`);
          });
        }
      } catch (error) {
        console.warn(`⚠️  Error getting sample data for ${tableName}`);
      }
    }
  }
}

// Main execution
async function main() {
  console.log('🚀 Starting Supabase target database analysis...');

  const analyzer = new SupabaseTargetAnalysis();

  try {
    // Get comprehensive analysis
    const summaries = await analyzer.analyzeMigrationTables();
    analyzer.displayAnalysisReport(summaries);

    // Get detailed analysis for key tables
    console.log('\n🔍 DETAILED TABLE ANALYSIS:');
    console.log('============================');

    const keyTables = ['technicians', 'cases', 'case_files', 'jaws', 'treatment_plans', 'purchases'];
    for (const tableName of keyTables) {
      await analyzer.getTableMigrationDetails(tableName);
    }

    console.log('\n🎯 MIGRATION READINESS SUMMARY:');
    console.log('================================');

    const existingTables = summaries.filter(s => s.recordCount > 0 || s.columns.length > 0);
    const missingTables = summaries.filter(s => s.columns.length === 0);

    console.log(`✅ Tables ready for migration: ${existingTables.length}`);
    console.log(`❌ Tables needing creation: ${missingTables.length}`);

    if (missingTables.length > 0) {
      console.log('\n🔧 Tables requiring schema creation:');
      missingTables.forEach(table => {
        console.log(`   • ${table.name}`);
      });
    }

    console.log('\n📈 Next steps:');
    console.log('1. Create missing table schemas if needed');
    console.log('2. Run differential migrations for existing tables');
    console.log('3. Validate relationship integrity');
    console.log('4. Generate comprehensive migration report');

  } catch (error) {
    console.error('❌ Analysis failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Script execution failed:', error);
    process.exit(1);
  });
}

export { SupabaseTargetAnalysis };