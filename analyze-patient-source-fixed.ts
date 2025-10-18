import { Pool } from 'pg';
import { config } from 'dotenv';

config();

const printf = (format: string, ...args: any[]): void => {
  console.log(format, ...args);
};

const sourcePool = new Pool({
  host: process.env.SOURCE_DB_HOST,
  port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
  database: process.env.SOURCE_DB_NAME,
  user: process.env.SOURCE_DB_USER,
  password: process.env.SOURCE_DB_PASSWORD,
  ssl: false
});

async function analyzePatientSource(): Promise<void> {
  const client = await sourcePool.connect();
  
  try {
    printf('🔍 ANALYZING SOURCE PATIENT DATA');
    printf('==================================================\n');

    // Examine table structure
    printf('📋 dispatch_patient table structure:');
    const schemaQuery = `
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'dispatch_patient'
      ORDER BY ordinal_position;
    `;
    const schemaResult = await client.query(schemaQuery);
    schemaResult.rows.forEach(row => {
      printf(`   ${row.column_name}: ${row.data_type} ${row.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}${row.column_default ? ` DEFAULT ${row.column_default}` : ''}`);
    });

    // Count totals
    printf('\n📊 Patient counts:');
    const totalResult = await client.query('SELECT COUNT(*) as count FROM public.dispatch_patient');
    printf(`   Total patients: ${totalResult.rows[0].count}`);
    
    const activeResult = await client.query('SELECT COUNT(*) as count FROM public.dispatch_patient WHERE archived = false');
    printf(`   Active patients: ${activeResult.rows[0].count}`);

    const suspendedResult = await client.query('SELECT COUNT(*) as count FROM public.dispatch_patient WHERE suspended = true');
    printf(`   Suspended patients: ${suspendedResult.rows[0].count}`);

    // Doctor relationships
    printf('\n🏥 Doctor relationships:');
    const withDoctorResult = await client.query('SELECT COUNT(*) as count FROM public.dispatch_patient WHERE doctor_id IS NOT NULL');
    printf(`   Patients with doctor: ${withDoctorResult.rows[0].count}/${totalResult.rows[0].count}`);
    
    const uniqueDoctorsResult = await client.query('SELECT COUNT(DISTINCT doctor_id) as count FROM public.dispatch_patient WHERE doctor_id IS NOT NULL');
    printf(`   Unique doctors with patients: ${uniqueDoctorsResult.rows[0].count}`);

    // Office relationships
    printf('\n🏢 Office relationships:');
    const withOfficeResult = await client.query('SELECT COUNT(*) as count FROM public.dispatch_patient WHERE office_id IS NOT NULL');
    printf(`   Patients with office: ${withOfficeResult.rows[0].count}/${totalResult.rows[0].count}`);
    
    const uniqueOfficesResult = await client.query('SELECT COUNT(DISTINCT office_id) as count FROM public.dispatch_patient WHERE office_id IS NOT NULL');
    printf(`   Unique offices with patients: ${uniqueOfficesResult.rows[0].count}`);

    // Check for user_id relationships (profiles)
    printf('\n👤 User/Profile relationships:');
    const withUserResult = await client.query('SELECT COUNT(*) as count FROM public.dispatch_patient WHERE user_id IS NOT NULL');
    printf(`   Patients with user_id: ${withUserResult.rows[0].count}/${totalResult.rows[0].count}`);
    
    const uniqueUsersResult = await client.query('SELECT COUNT(DISTINCT user_id) as count FROM public.dispatch_patient WHERE user_id IS NOT NULL');
    printf(`   Unique users with patients: ${uniqueUsersResult.rows[0].count}`);

    // Status analysis
    printf('\n📈 Status distribution:');
    const statusResult = await client.query(`
      SELECT 
        CASE 
          WHEN status IS NULL THEN 'NULL'
          ELSE status::text
        END as status_value,
        COUNT(*) as count
      FROM public.dispatch_patient 
      GROUP BY status 
      ORDER BY count DESC
    `);
    statusResult.rows.forEach(row => {
      printf(`   Status ${row.status_value}: ${row.count} patients`);
    });

    // Sample records for inspection
    printf('\n📋 Sample patient records:');
    const sampleResult = await client.query(`
      SELECT id, doctor_id, user_id, office_id, archived, suspended, status, birthdate, sex, suffix, schemes
      FROM public.dispatch_patient 
      ORDER BY id 
      LIMIT 5
    `);
    sampleResult.rows.forEach((row, idx) => {
      printf(`   ${idx + 1}. ID: ${row.id}, Doctor: ${row.doctor_id}, User: ${row.user_id}, Office: ${row.office_id}, Active: ${!row.archived}, Status: ${row.status}, Sex: ${row.sex}, Birthdate: ${row.birthdate}, Suffix: '${row.suffix}', Schemes: '${row.schemes?.substring(0, 50)}${row.schemes?.length > 50 ? '...' : ''}'`);
    });

    // Check for potential migration issues
    printf('\n⚠️  Potential migration issues:');
    const noDocResult = await client.query('SELECT COUNT(*) as count FROM public.dispatch_patient WHERE doctor_id IS NULL');
    printf(`   Patients without doctors: ${noDocResult.rows[0].count}`);
    
    const noUserResult = await client.query('SELECT COUNT(*) as count FROM public.dispatch_patient WHERE user_id IS NULL');
    printf(`   Patients without user_id: ${noUserResult.rows[0].count}`);
    
    const noOfficeResult = await client.query('SELECT COUNT(*) as count FROM public.dispatch_patient WHERE office_id IS NULL');
    printf(`   Patients without office: ${noOfficeResult.rows[0].count}`);

    // Sex field analysis
    printf('\n⚧️  Sex field analysis:');
    const sexResult = await client.query(`
      SELECT 
        CASE 
          WHEN sex IS NULL THEN 'NULL'
          WHEN sex = 0 THEN 'UNKNOWN (0)'
          WHEN sex = 1 THEN 'MALE (1)'
          WHEN sex = 2 THEN 'FEMALE (2)'
          ELSE 'OTHER (' || sex::text || ')'
        END as sex_label,
        COUNT(*) as count
      FROM public.dispatch_patient 
      GROUP BY sex 
      ORDER BY count DESC
    `);
    sexResult.rows.forEach(row => {
      printf(`   ${row.sex_label}: ${row.count} patients`);
    });

    printf('\n✅ Source analysis complete!');

  } catch (error) {
    printf('❌ Source analysis error: %s', error instanceof Error ? error.message : String(error));
  } finally {
    client.release();
    await sourcePool.end();
  }
}

if (require.main === module) {
  analyzePatientSource().catch(console.error);
}

export { analyzePatientSource };
