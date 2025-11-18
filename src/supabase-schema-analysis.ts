/**
 * Supabase Schema Analysis using direct database connection
 * Analyzes target database structure for migration planning
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

interface TableSchema {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

interface TableSummary {
  name: string;
  exists: boolean;
  recordCount: number;
  hasLegacyMapping: boolean;
  legacyMappingField?: string;
  columns: TableSchema[];
}

class SupabaseSchemaAnalysis {
  private targetPool: Pool;

  constructor() {
    this.targetPool = new Pool({
      host: process.env.TARGET_DB_HOST,
      port: parseInt(process.env.TARGET_DB_PORT || '5432'),
      database: process.env.TARGET_DB_NAME,
      user: process.env.TARGET_DB_USER,
      password: process.env.TARGET_DB_PASSWORD,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }

  /**
   * Check if table exists and get its structure
   */
  async analyzeTable(tableName: string): Promise<TableSummary> {
    const summary: TableSummary = {
      name: tableName,
      exists: false,
      recordCount: 0,
      hasLegacyMapping: false,
      columns: []
    };

    try {
      // Check if table exists
      const existsResult = await this.targetPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = $1
        )
      `, [tableName]);

      summary.exists = existsResult.rows[0].exists;

      if (!summary.exists) {
        return summary;
      }

      // Get table schema
      const schemaResult = await this.targetPool.query(`
        SELECT
          table_name,
          column_name,
          data_type,
          is_nullable,
          column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [tableName]);

      summary.columns = schemaResult.rows;

      // Check for legacy mapping fields
      const legacyColumn = summary.columns.find(col =>
        col.column_name.startsWith('legacy_') && col.column_name.endsWith('_id')
      );

      if (legacyColumn) {
        summary.hasLegacyMapping = true;
        summary.legacyMappingField = legacyColumn.column_name;
      }

      // Get record count
      const countResult = await this.targetPool.query(`SELECT COUNT(*) as count FROM ${tableName}`);
      summary.recordCount = parseInt(countResult.rows[0].count);

    } catch (error) {
      console.warn(`⚠️  Error analyzing table ${tableName}:`, error instanceof Error ? error.message : 'Unknown error');
    }

    return summary;
  }

  /**
   * Analyze all migration-target tables
   */
  async analyzeAllMigrationTables(): Promise<TableSummary[]> {
    console.log('🔍 Analyzing migration target tables...');

    const targetTables = [
      // Already migrated core tables
      'profiles', 'offices', 'doctors', 'patients', 'orders', 'messages', 'files',

      // New entities to migrate
      'technicians', 'templates', 'cases', 'case_files', 'case_states',
      'case_messages', 'order_cases', 'order_states', 'jaws', 'treatment_plans',
      'purchases', 'payments', 'shipments', 'patients_doctors_offices',

      // Additional entities mentioned
      'message_attachments', 'system_messages', 'operations', 'role_permissions'
    ];

    const summaries: TableSummary[] = [];

    for (const tableName of targetTables) {
      console.log(`🔧 Analyzing ${tableName}...`);
      const summary = await this.analyzeTable(tableName);
      summaries.push(summary);

      const status = summary.exists
        ? (summary.recordCount > 0 ? `${summary.recordCount.toLocaleString()} records` : 'empty')
        : 'missing';
      const legacyInfo = summary.hasLegacyMapping ? ` [${summary.legacyMappingField}]` : '';

      console.log(`   ${summary.exists ? '✅' : '❌'} ${tableName}: ${status}${legacyInfo}`);
    }

    return summaries;
  }

  /**
   * Generate migration priority recommendations
   */
  generateMigrationPlan(summaries: TableSummary[]): void {
    console.log('\n🎯 COMPREHENSIVE MIGRATION PLAN:');
    console.log('==================================');

    const existingTables = summaries.filter(s => s.exists);
    const missingTables = summaries.filter(s => !s.exists);
    const readyForMigration = existingTables.filter(s => s.hasLegacyMapping);
    const populatedTables = existingTables.filter(s => s.recordCount > 0);

    console.log(`📊 Table Status Summary:`);
    console.log(`   • Total analyzed: ${summaries.length}`);
    console.log(`   • Existing tables: ${existingTables.length}`);
    console.log(`   • Missing tables: ${missingTables.length}`);
    console.log(`   • Ready for differential migration: ${readyForMigration.length}`);
    console.log(`   • Already populated: ${populatedTables.length}`);

    // Core already migrated
    const coreTables = ['profiles', 'offices', 'doctors', 'patients', 'orders', 'messages', 'files'];
    const coreStatus = summaries.filter(s => coreTables.includes(s.name) && s.exists);

    console.log('\n✅ Phase 1 - Core Tables (COMPLETED):');
    coreStatus.forEach(table => {
      const migrated = table.hasLegacyMapping && table.recordCount > 0 ? 'MIGRATED' : 'NEEDS MIGRATION';
      console.log(`   ${table.name}: ${table.recordCount.toLocaleString()} records [${migrated}]`);
    });

    // Priority entities for Phase 2
    const phase2Tables = ['technicians', 'cases', 'treatment_plans', 'jaws'];
    const phase2Status = summaries.filter(s => phase2Tables.includes(s.name));

    console.log('\n🚀 Phase 2 - High Priority Entities:');
    phase2Status.forEach(table => {
      if (table.exists) {
        const status = table.recordCount > 0 ? 'HAS DATA' : 'READY';
        console.log(`   ✅ ${table.name}: ${status} (${table.recordCount} records)`);
      } else {
        console.log(`   ❌ ${table.name}: TABLE MISSING - needs creation`);
      }
    });

    // Relationship entities for Phase 3
    const phase3Tables = ['case_files', 'case_states', 'case_messages', 'order_cases', 'order_states'];
    const phase3Status = summaries.filter(s => phase3Tables.includes(s.name));

    console.log('\n🔗 Phase 3 - Relationship Tables:');
    phase3Status.forEach(table => {
      if (table.exists) {
        const status = table.recordCount > 0 ? 'HAS DATA' : 'READY';
        console.log(`   ✅ ${table.name}: ${status} (${table.recordCount} records)`);
      } else {
        console.log(`   ❌ ${table.name}: TABLE MISSING - needs creation`);
      }
    });

    // Advanced entities for Phase 4
    const phase4Tables = ['purchases', 'payments', 'shipments', 'patients_doctors_offices'];
    const phase4Status = summaries.filter(s => phase4Tables.includes(s.name));

    console.log('\n⚡ Phase 4 - Advanced/Specialized Tables:');
    phase4Status.forEach(table => {
      if (table.exists) {
        const status = table.recordCount > 0 ? 'HAS DATA' : 'READY';
        console.log(`   ✅ ${table.name}: ${status} (${table.recordCount} records)`);
      } else {
        console.log(`   ❌ ${table.name}: TABLE MISSING - needs creation`);
      }
    });

    // Missing tables that need creation
    if (missingTables.length > 0) {
      console.log('\n🔧 TABLES REQUIRING SCHEMA CREATION:');
      missingTables.forEach(table => {
        console.log(`   • ${table.name}`);
      });
    }

    console.log('\n📋 IMMEDIATE ACTION ITEMS:');
    console.log('1. Use existing migration scripts to create missing table schemas');
    console.log('2. Run differential migrations for tables that exist');
    console.log('3. Prioritize high-value entities: cases, treatment_plans, jaws');
    console.log('4. Handle relationship tables after core entities');
  }

  /**
   * Cleanup database connections
   */
  async cleanup(): Promise<void> {
    try {
      await this.targetPool.end();
    } catch (error) {
      console.error('❌ Error during cleanup:', error);
    }
  }
}

// Main execution
async function main() {
  const analyzer = new SupabaseSchemaAnalysis();

  try {
    const summaries = await analyzer.analyzeAllMigrationTables();
    analyzer.generateMigrationPlan(summaries);

  } catch (error) {
    console.error('❌ Analysis failed:', error);
    process.exit(1);
  } finally {
    await analyzer.cleanup();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Script execution failed:', error);
    process.exit(1);
  });
}

export { SupabaseSchemaAnalysis };