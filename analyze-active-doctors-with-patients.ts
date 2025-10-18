import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function analyzeActiveDoctorsWithPatients() {
  const sourcePool = new Pool({
    host: process.env.SOURCE_DB_HOST,
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME,
    user: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔍 Analyzing active doctors with active patients...\n');

    // Step 1: Check what patient-related tables exist
    console.log('📋 1. Finding patient-related tables:');
    const patientTablesResult = await sourcePool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name LIKE '%patient%'
      ORDER BY table_name
    `);
    console.log('   Found patient tables:');
    patientTablesResult.rows.forEach(row => console.log(`     - ${row.table_name}`));

    // Step 2: Analyze all potential doctors (1,181)
    console.log('\n👥 2. Analyzing all 1,181 potential doctors:');
    const allDoctorsQuery = `
      SELECT DISTINCT
        au.id as user_id,
        au.first_name,
        au.last_name,
        au.email,
        au.is_active,
        au.date_joined,
        au.last_login,
        CASE WHEN dod.user_id IS NOT NULL THEN true ELSE false END as has_office_assignment,
        CASE WHEN dus.user_id IS NOT NULL THEN true ELSE false END as has_settings
      FROM auth_user au
      LEFT JOIN dispatch_office_doctors dod ON au.id = dod.user_id
      LEFT JOIN dispatch_usersetting dus ON au.id = dus.user_id
      WHERE dus.user_id IS NOT NULL OR dod.user_id IS NOT NULL
      ORDER BY au.id
    `;

    const allDoctorsResult = await sourcePool.query(allDoctorsQuery);
    const totalDoctors = allDoctorsResult.rows.length;
    const activeDoctors = allDoctorsResult.rows.filter(d => d.is_active).length;
    
    console.log(`   Total potential doctors: ${totalDoctors}`);
    console.log(`   Active doctors (is_active=true): ${activeDoctors}`);
    console.log(`   Inactive doctors: ${totalDoctors - activeDoctors}`);

    // Step 3: Check if dispatch_patient exists and has doctor relationships
    try {
      const patientStructureResult = await sourcePool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'dispatch_patient' 
        ORDER BY ordinal_position
      `);
      
      if (patientStructureResult.rows.length > 0) {
        console.log('\n📊 3. dispatch_patient table structure:');
        patientStructureResult.rows.forEach(row => {
          console.log(`   - ${row.column_name}: ${row.data_type}`);
        });

        // Check for doctor-patient relationships
        const patientCountResult = await sourcePool.query('SELECT COUNT(*) as count FROM dispatch_patient');
        console.log(`\n   Total patients in dispatch_patient: ${patientCountResult.rows[0].count}`);

        // Find doctor-patient relationship field
        const doctorFields = patientStructureResult.rows.filter(row => 
          row.column_name.includes('doctor') || row.column_name.includes('user')
        );
        
        if (doctorFields.length > 0) {
          console.log('   Doctor-related fields:');
          doctorFields.forEach(field => console.log(`     - ${field.column_name}`));
          
          // Try to count patients per doctor
          const doctorField = doctorFields[0].column_name; // Use first doctor field found
          const doctorPatientCountQuery = `
            SELECT 
              ${doctorField} as doctor_id, 
              COUNT(*) as patient_count,
              COUNT(CASE WHEN archived = false OR archived IS NULL THEN 1 END) as active_patients
            FROM dispatch_patient 
            WHERE ${doctorField} IS NOT NULL
            GROUP BY ${doctorField}
            ORDER BY patient_count DESC
            LIMIT 10
          `;
          
          const doctorPatientResult = await sourcePool.query(doctorPatientCountQuery);
          console.log(`\n   Top 10 doctors by patient count (using ${doctorField}):`);
          doctorPatientResult.rows.forEach(row => {
            console.log(`     Doctor ${row.doctor_id}: ${row.patient_count} patients (${row.active_patients} active)`);
          });
        }
      }
    } catch (error) {
      console.log('\n⚠️  dispatch_patient table not found or accessible');
    }

    // Step 4: Check active doctors with recent activity
    console.log('\n⏰ 4. Analyzing doctor activity:');
    const recentActivityQuery = `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN au.last_login > NOW() - INTERVAL '30 days' THEN 1 END) as active_30days,
        COUNT(CASE WHEN au.last_login > NOW() - INTERVAL '90 days' THEN 1 END) as active_90days,
        COUNT(CASE WHEN au.last_login > NOW() - INTERVAL '1 year' THEN 1 END) as active_1year
      FROM auth_user au
      LEFT JOIN dispatch_office_doctors dod ON au.id = dod.user_id
      LEFT JOIN dispatch_usersetting dus ON au.id = dus.user_id
      WHERE (dus.user_id IS NOT NULL OR dod.user_id IS NOT NULL)
      AND au.is_active = true
    `;

    const activityResult = await sourcePool.query(recentActivityQuery);
    const activity = activityResult.rows[0];
    console.log(`   Active doctors with recent logins:`);
    console.log(`     Last 30 days: ${activity.active_30days}`);
    console.log(`     Last 90 days: ${activity.active_90days}`);
    console.log(`     Last 1 year: ${activity.active_1year}`);

    // Step 5: Recommend filtering criteria
    console.log('\n' + '='.repeat(60));
    console.log('📈 RECOMMENDATIONS FOR DOCTOR MIGRATION:');
    console.log('   Filter criteria to consider:');
    console.log(`   1. is_active = true (reduces from ${totalDoctors} to ${activeDoctors} doctors)`);
    console.log(`   2. Recent login activity (30-90 days)`);
    console.log('   3. Has active patients (if patient data available)');
    console.log('   4. Has office assignments (more likely to be practicing)');
    
    const officeAssignedActive = allDoctorsResult.rows.filter(d => d.is_active && d.has_office_assignment).length;
    console.log(`\n   🎯 SUGGESTED COUNT: ${officeAssignedActive} doctors`);
    console.log('      (Active doctors with office assignments)');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await sourcePool.end();
  }
}

analyzeActiveDoctorsWithPatients();
