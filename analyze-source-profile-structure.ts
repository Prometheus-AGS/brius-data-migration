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

interface SourceTableStructure {
  tableName: string;
  columns: Array<{
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }>;
  sampleRecords: any[];
  recordCount: number;
}

async function analyzeSourceTable(tableName: string, limit = 5): Promise<SourceTableStructure> {
  const client = await sourcePool.connect();

  try {
    // Get table structure
    const structureQuery = `
      SELECT
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position;
    `;

    const structureResult = await client.query(structureQuery, [tableName]);

    // Get record count
    const countResult = await client.query(`SELECT COUNT(*) as count FROM ${tableName}`);
    const recordCount = parseInt(countResult.rows[0].count);

    // Get sample records
    const sampleResult = await client.query(`SELECT * FROM ${tableName} ORDER BY id LIMIT $1`, [limit]);

    return {
      tableName,
      columns: structureResult.rows,
      sampleRecords: sampleResult.rows,
      recordCount
    };

  } finally {
    client.release();
  }
}

async function findDoctorTechnicianTables() {
  const client = await sourcePool.connect();

  try {
    console.log('\n🔍 SEARCHING FOR DOCTOR/TECHNICIAN RELATED TABLES\n');

    // Find all tables that might contain doctor or technician data
    const tableSearchQuery = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND (table_name LIKE '%doctor%' OR table_name LIKE '%tech%' OR table_name LIKE '%staff%' OR table_name LIKE '%office%')
      ORDER BY table_name;
    `;

    const tablesResult = await client.query(tableSearchQuery);
    console.log('📋 Tables that might contain doctor/technician data:');
    tablesResult.rows.forEach(row => {
      console.log(`   ${row.table_name}`);
    });

    // Check if there are any users who are NOT patients (potential doctors/technicians)
    const nonPatientUsersQuery = `
      SELECT
        au.id,
        au.username,
        au.email,
        au.first_name,
        au.last_name,
        au.is_staff,
        au.is_superuser
      FROM auth_user au
      LEFT JOIN dispatch_patient dp ON au.id = dp.user_id
      WHERE dp.user_id IS NULL
        AND au.is_active = true
      ORDER BY au.id
      LIMIT 20;
    `;

    const nonPatientUsersResult = await client.query(nonPatientUsersQuery);
    console.log('\n👥 auth_user records that are NOT patients (potential doctors/technicians):');
    console.log(`   Total non-patient users: ${nonPatientUsersResult.rows.length}`);
    nonPatientUsersResult.rows.forEach(row => {
      console.log(`   [${row.id}] ${row.first_name} ${row.last_name} (${row.username || row.email}) - Staff: ${row.is_staff}, Super: ${row.is_superuser}`);
    });

  } finally {
    client.release();
  }
}

async function analyzeRelationshipKeys() {
  const client = await sourcePool.connect();

  try {
    console.log('\n🔗 ANALYZING RELATIONSHIP KEYS BETWEEN TABLES\n');

    // Check auth_user to dispatch_patient relationship
    const authUserPatientQuery = `
      SELECT
        au.id as auth_user_id,
        au.username,
        au.email,
        au.first_name,
        au.last_name,
        dp.id as dispatch_patient_id,
        dp.doctor_id,
        dp.suffix as patient_code
      FROM auth_user au
      INNER JOIN dispatch_patient dp ON au.id = dp.user_id
      LIMIT 10;
    `;

    const authUserPatientResult = await client.query(authUserPatientQuery);
    console.log('👤➡️🤒 auth_user -> dispatch_patient relationships (first 10):');
    authUserPatientResult.rows.forEach(row => {
      console.log(`   User ${row.auth_user_id} (${row.first_name} ${row.last_name}, ${row.username || row.email}) -> Patient ${row.dispatch_patient_id} (${row.patient_code})`);
    });

    // Note: dispatch_doctor table does not exist, dispatch_agent is for system agents not user technicians

    // Count relationships
    const relationshipCounts = await Promise.all([
      client.query('SELECT COUNT(*) as count FROM auth_user'),
      client.query('SELECT COUNT(*) as count FROM dispatch_patient'),
      client.query('SELECT COUNT(*) as count FROM dispatch_agent'),
      client.query(`
        SELECT COUNT(*) as count
        FROM auth_user au
        INNER JOIN dispatch_patient dp ON au.id = dp.user_id
      `),
      client.query(`
        SELECT COUNT(*) as count
        FROM auth_user au
        LEFT JOIN dispatch_patient dp ON au.id = dp.user_id
        WHERE dp.user_id IS NULL AND au.is_active = true
      `),
    ]);

    console.log('\n📊 SOURCE DATABASE RELATIONSHIP COUNTS:');
    console.log(`   auth_user: ${relationshipCounts[0].rows[0].count}`);
    console.log(`   dispatch_patient: ${relationshipCounts[1].rows[0].count}`);
    console.log(`   dispatch_agent (system agents): ${relationshipCounts[2].rows[0].count}`);
    console.log(`   auth_user->dispatch_patient links: ${relationshipCounts[3].rows[0].count}`);
    console.log(`   auth_user NOT linked to patients: ${relationshipCounts[4].rows[0].count}`);

  } finally {
    client.release();
  }
}

async function main() {
  try {
    console.log('🔍 ANALYZING SOURCE DATABASE PROFILE STRUCTURE');
    console.log('=' .repeat(60));

    const tablesToAnalyze = ['auth_user', 'dispatch_patient', 'dispatch_doctor', 'dispatch_agent'];

    for (const tableName of tablesToAnalyze) {
      try {
        console.log(`\n📋 TABLE: ${tableName.toUpperCase()}`);
        console.log('-' .repeat(40));

        const analysis = await analyzeSourceTable(tableName);

        console.log(`Record Count: ${analysis.recordCount.toLocaleString()}`);
        console.log('\nColumns:');
        analysis.columns.forEach(col => {
          console.log(`   ${col.column_name}: ${col.data_type}${col.is_nullable === 'NO' ? ' NOT NULL' : ''}`);
        });

        if (analysis.sampleRecords.length > 0) {
          console.log('\nSample Records:');
          analysis.sampleRecords.forEach((record, index) => {
            console.log(`   [${index + 1}] ID: ${record.id} | Key fields: ${JSON.stringify({
              ...(record.username && { username: record.username }),
              ...(record.email && { email: record.email }),
              ...(record.name && { name: record.name }),
              ...(record.patient_id && { patient_id: record.patient_id }),
              ...(record.doctor_id && { doctor_id: record.doctor_id }),
              ...(record.user_id && { user_id: record.user_id }),
              ...(record.prefix && { prefix: record.prefix }),
              ...(record.suffix && { suffix: record.suffix })
            })}`);
          });
        }

      } catch (error: any) {
        console.log(`❌ Error analyzing ${tableName}: ${error.message}`);
      }
    }

    await findDoctorTechnicianTables();
    await analyzeRelationshipKeys();

  } catch (error) {
    console.error('❌ Analysis failed:', error);
  } finally {
    await sourcePool.end();
  }
}

if (require.main === module) {
  main();
}