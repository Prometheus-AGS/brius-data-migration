import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const sourcePool = new Pool({
  host: process.env.SOURCE_DB_HOST,
  port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
  database: process.env.SOURCE_DB_NAME,
  user: process.env.SOURCE_DB_USER,
  password: process.env.SOURCE_DB_PASSWORD,
  ssl: false,
});

interface TableColumn {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  character_maximum_length: number | null;
}

interface TableSchema {
  tableName: string;
  columns: TableColumn[];
  recordCount: number;
  sampleRecords: any[];
  primaryKeys: string[];
  foreignKeys: Array<{
    column_name: string;
    foreign_table_name: string;
    foreign_column_name: string;
  }>;
}

class SourceSchemaInvestigator {
  private client: any;

  async initialize() {
    this.client = await sourcePool.connect();
    console.log('✅ Connected to source database');
  }

  async cleanup() {
    if (this.client) {
      this.client.release();
    }
    await sourcePool.end();
  }

  async getTableSchema(tableName: string): Promise<TableSchema> {
    console.log(`\n📋 ANALYZING TABLE: ${tableName.toUpperCase()}`);
    console.log('-'.repeat(50));

    try {
      // Get column information
      const columnQuery = `
        SELECT
          column_name,
          data_type,
          is_nullable,
          column_default,
          character_maximum_length
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
        ORDER BY ordinal_position;
      `;

      const columnResult = await this.client.query(columnQuery, [tableName]);

      // Get record count
      const countResult = await this.client.query(`SELECT COUNT(*) as count FROM ${tableName}`);
      const recordCount = parseInt(countResult.rows[0].count);

      // Get sample records (limit 5)
      const sampleResult = await this.client.query(`SELECT * FROM ${tableName} ORDER BY id LIMIT 5`);

      // Get primary keys
      const pkQuery = `
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_schema = 'public'
          AND tc.table_name = $1
          AND tc.constraint_type = 'PRIMARY KEY'
      `;

      const pkResult = await this.client.query(pkQuery, [tableName]);
      const primaryKeys = pkResult.rows.map((row: any) => row.column_name);

      // Get foreign keys
      const fkQuery = `
        SELECT
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
          AND tc.table_name = $1;
      `;

      const fkResult = await this.client.query(fkQuery, [tableName]);

      // Display information
      console.log(`Record Count: ${recordCount.toLocaleString()}`);
      console.log(`Primary Keys: ${primaryKeys.join(', ') || 'None'}`);

      if (fkResult.rows.length > 0) {
        console.log('Foreign Keys:');
        fkResult.rows.forEach((fk: any) => {
          console.log(`   ${fk.column_name} -> ${fk.foreign_table_name}.${fk.foreign_column_name}`);
        });
      }

      console.log('\nColumns:');
      columnResult.rows.forEach((col: any) => {
        const nullable = col.is_nullable === 'YES' ? '' : ' NOT NULL';
        const length = col.character_maximum_length ? `(${col.character_maximum_length})` : '';
        const defaultVal = col.column_default ? ` DEFAULT ${col.column_default}` : '';
        console.log(`   ${col.column_name}: ${col.data_type}${length}${nullable}${defaultVal}`);
      });

      if (sampleResult.rows.length > 0) {
        console.log('\nSample Records:');
        sampleResult.rows.forEach((record: any, index: number) => {
          console.log(`   [${index + 1}] ${JSON.stringify(record)}`);
        });
      }

      return {
        tableName,
        columns: columnResult.rows,
        recordCount,
        sampleRecords: sampleResult.rows,
        primaryKeys,
        foreignKeys: fkResult.rows
      };

    } catch (error: any) {
      console.error(`❌ Error analyzing ${tableName}: ${error.message}`);
      throw error;
    }
  }

  async analyzeUserRelationships() {
    console.log('\n🔗 ANALYZING USER RELATIONSHIP PATTERNS');
    console.log('='.repeat(60));

    try {
      // 1. Get all tables that reference auth_user
      const userReferencingTablesQuery = `
        SELECT DISTINCT
          tc.table_name,
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
          AND ccu.table_name = 'auth_user'
        ORDER BY tc.table_name;
      `;

      const userReferencingResult = await this.client.query(userReferencingTablesQuery);

      console.log('\n📊 Tables that reference auth_user:');
      userReferencingResult.rows.forEach((row: any) => {
        console.log(`   ${row.table_name}.${row.column_name} -> auth_user.${row.foreign_column_name}`);
      });

      // 2. Analyze auth_user groups to understand user types
      const userGroupsQuery = `
        SELECT
          g.id as group_id,
          g.name as group_name,
          COUNT(aug.user_id) as user_count
        FROM auth_group g
        LEFT JOIN auth_user_groups aug ON g.id = aug.group_id
        GROUP BY g.id, g.name
        ORDER BY user_count DESC;
      `;

      try {
        const userGroupsResult = await this.client.query(userGroupsQuery);

        console.log('\n👥 User groups and counts:');
        userGroupsResult.rows.forEach((row: any) => {
          console.log(`   Group ${row.group_id} (${row.group_name}): ${row.user_count} users`);
        });
      } catch (error: any) {
        console.log('\n👥 User groups table not found or error:', error.message);
      }

      // 3. Analyze dispatch_patient relationships
      const patientRelationshipQuery = `
        SELECT
          COUNT(*) as total_patients,
          COUNT(DISTINCT user_id) as unique_users,
          COUNT(DISTINCT doctor_id) as unique_doctors,
          COUNT(DISTINCT office_id) as unique_offices,
          COUNT(CASE WHEN archived = true THEN 1 END) as archived_count,
          COUNT(CASE WHEN suspended = true THEN 1 END) as suspended_count
        FROM dispatch_patient;
      `;

      const patientRelationshipResult = await this.client.query(patientRelationshipQuery);

      console.log('\n🤒 dispatch_patient analysis:');
      const stats = patientRelationshipResult.rows[0];
      Object.entries(stats).forEach(([key, value]) => {
        console.log(`   ${key}: ${value}`);
      });

      // 4. Check for doctor-related tables and relationships
      const doctorTablesQuery = `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
          AND (table_name LIKE '%doctor%' OR table_name LIKE '%office%' OR table_name LIKE '%practice%')
        ORDER BY table_name;
      `;

      const doctorTablesResult = await this.client.query(doctorTablesQuery);

      console.log('\n👨‍⚕️ Doctor-related tables:');
      doctorTablesResult.rows.forEach((row: any) => {
        console.log(`   ${row.table_name}`);
      });

      // 5. Check for technician-related patterns
      const technicianPatternsQuery = `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
          AND (table_name LIKE '%tech%' OR table_name LIKE '%agent%' OR table_name LIKE '%role%')
        ORDER BY table_name;
      `;

      const technicianPatternsResult = await this.client.query(technicianPatternsQuery);

      console.log('\n🔧 Technician-related tables:');
      technicianPatternsResult.rows.forEach((row: any) => {
        console.log(`   ${row.table_name}`);
      });

    } catch (error: any) {
      console.error('❌ Error analyzing user relationships:', error.message);
      throw error;
    }
  }

  async findAllDispatchTables(): Promise<string[]> {
    console.log('\n🔍 FINDING ALL DISPATCH TABLES');
    console.log('='.repeat(40));

    try {
      const dispatchTablesQuery = `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
          AND table_name LIKE 'dispatch_%'
        ORDER BY table_name;
      `;

      const result = await this.client.query(dispatchTablesQuery);
      const tableNames = result.rows.map((row: any) => row.table_name);

      console.log(`Found ${tableNames.length} dispatch tables:`);
      tableNames.forEach((tableName: string) => {
        console.log(`   ${tableName}`);
      });

      return tableNames;

    } catch (error: any) {
      console.error('❌ Error finding dispatch tables:', error.message);
      throw error;
    }
  }
}

async function main() {
  const investigator = new SourceSchemaInvestigator();

  try {
    console.log('🔍 COMPREHENSIVE SOURCE DATABASE SCHEMA INVESTIGATION');
    console.log('='.repeat(70));

    await investigator.initialize();

    // 1. Core user-related tables first
    const coreUserTables = ['auth_user', 'auth_group', 'auth_user_groups'];

    console.log('\n📋 ANALYZING CORE USER TABLES');
    console.log('='.repeat(50));

    for (const tableName of coreUserTables) {
      try {
        await investigator.getTableSchema(tableName);
      } catch (error: any) {
        console.log(`   Table ${tableName} not found or error: ${error.message}`);
      }
    }

    // 2. Key dispatch tables
    const keyDispatchTables = [
      'dispatch_patient',
      'dispatch_doctor',
      'dispatch_agent',
      'dispatch_office',
      'dispatch_usersetting',
      'dispatch_office_doctors',
      'dispatch_role'
    ];

    console.log('\n📋 ANALYZING KEY DISPATCH TABLES');
    console.log('='.repeat(50));

    for (const tableName of keyDispatchTables) {
      try {
        await investigator.getTableSchema(tableName);
      } catch (error: any) {
        console.log(`   Table ${tableName} not found or error: ${error.message}`);
      }
    }

    // 3. Find and analyze all dispatch tables
    console.log('\n📋 ANALYZING ALL DISPATCH TABLES');
    console.log('='.repeat(50));

    const allDispatchTables = await investigator.findAllDispatchTables();
    const remainingTables = allDispatchTables.filter(table =>
      !keyDispatchTables.includes(table)
    );

    for (const tableName of remainingTables) {
      try {
        await investigator.getTableSchema(tableName);
      } catch (error: any) {
        console.log(`   Error analyzing ${tableName}: ${error.message}`);
      }
    }

    // 4. Analyze user relationships
    await investigator.analyzeUserRelationships();

    console.log('\n🎉 Source database schema investigation completed!');

  } catch (error: any) {
    console.error('💥 Investigation failed:', error.message);
    process.exit(1);
  } finally {
    await investigator.cleanup();
  }
}

if (require.main === module) {
  main();
}