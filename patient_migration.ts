import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const sourceClient = new Client({
  connectionString: process.env.SOURCE_DATABASE_URL,
});

const targetClient = new Client({
  connectionString: process.env.SUPABASE_DATABASE_URL,
});

interface SourcePatient {
  id: number;
  user_id: number;
  doctor_id: number;
  office_id: number;
  archived: boolean;
  suspended: boolean;
  status: string;
  birthdate: string;
  sex: string;
  schemes: string;
}

interface TargetPatient {
  legacy_patient_id: number;
  legacy_user_id: number;
  profile_id: string;
  doctor_id: number;
  office_id: number;
  status: string;
  metadata: any;
}

async function migratePatients() {
  try {
    await sourceClient.connect();
    await targetClient.connect();

    console.log('Starting patient migration...');

    // Get source patients with profile mapping
    const sourceQuery = `
      SELECT DISTINCT
        p.id as patient_id,
        p.user_id,
        p.doctor_id,
        p.office_id,
        p.archived,
        p.suspended,
        p.status,
        p.birthdate,
        p.sex,
        p.schemes,
        au.first_name,
        au.last_name,
        au.email
      FROM dispatch_patient p
      JOIN auth_user au ON p.user_id = au.id
      ORDER BY p.id;
    `;

    const sourceResult = await sourceClient.query(sourceQuery);
    const sourcePatients = sourceResult.rows;

    console.log(`Found ${sourcePatients.length} patients to migrate`);

    // Clear existing target data
    console.log('Clearing existing patient data...');
    await targetClient.query('DELETE FROM public.patients;');

    // Get profile mappings from target
    console.log('Loading profile mappings...');
    const profileMappingsResult = await targetClient.query(`
      SELECT legacy_user_id, id as profile_id 
      FROM public.profiles 
      WHERE legacy_user_id IS NOT NULL;
    `);

    const profileMappings = new Map();
    profileMappingsResult.rows.forEach(row => {
      profileMappings.set(row.legacy_user_id, row.profile_id);
    });

    console.log(`Loaded ${profileMappings.size} profile mappings`);

    // Process in batches
    const batchSize = 100;
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < sourcePatients.length; i += batchSize) {
      const batch = sourcePatients.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(sourcePatients.length / batchSize)} (${batch.length} patients)`);

      for (const patient of batch) {
        try {
          const profileId = profileMappings.get(patient.user_id);
          
          if (!profileId) {
            console.warn(`No profile found for user_id ${patient.user_id}, patient ${patient.patient_id}`);
            errorCount++;
            continue;
          }

          // Build metadata object
          const metadata = {
            archived: patient.archived,
            suspended: patient.suspended,
            birthdate: patient.birthdate,
            sex: patient.sex,
            schemes: patient.schemes,
            legacy_data: {
              original_patient_id: patient.patient_id,
              original_user_id: patient.user_id
            }
          };

          const targetPatient: TargetPatient = {
            legacy_patient_id: patient.patient_id,
            legacy_user_id: patient.user_id,
            profile_id: profileId,
            doctor_id: patient.doctor_id,
            office_id: patient.office_id,
            status: patient.status || 'active',
            metadata: metadata
          };

          // Insert patient
          const insertQuery = `
            INSERT INTO public.patients (
              legacy_patient_id,
              legacy_user_id,
              profile_id,
              doctor_id,
              office_id,
              status,
              metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          `;

          await targetClient.query(insertQuery, [
            targetPatient.legacy_patient_id,
            targetPatient.legacy_user_id,
            targetPatient.profile_id,
            targetPatient.doctor_id,
            targetPatient.office_id,
            targetPatient.status,
            JSON.stringify(targetPatient.metadata)
          ]);

          successCount++;

        } catch (error) {
          console.error(`Error migrating patient ${patient.patient_id}:`, error);
          errorCount++;
        }
      }
    }

    console.log('Patient migration completed!');
    console.log(`Successfully migrated: ${successCount} patients`);
    console.log(`Errors: ${errorCount} patients`);

    // Validation
    console.log('\nRunning validation...');
    
    const targetCountResult = await targetClient.query('SELECT COUNT(*) as count FROM public.patients;');
    const targetCount = parseInt(targetCountResult.rows[0].count);
    
    console.log(`Target patients count: ${targetCount}`);
    
    // Check foreign key integrity
    const orphanedPatientsResult = await targetClient.query(`
      SELECT COUNT(*) as count 
      FROM public.patients p 
      LEFT JOIN public.profiles pr ON p.profile_id = pr.id 
      WHERE pr.id IS NULL;
    `);
    const orphanedPatients = parseInt(orphanedPatientsResult.rows[0].count);
    
    const orphanedDoctorLinksResult = await targetClient.query(`
      SELECT COUNT(*) as count 
      FROM public.patients p 
      LEFT JOIN public.doctors d ON p.doctor_id = d.id 
      WHERE d.id IS NULL;
    `);
    const orphanedDoctorLinks = parseInt(orphanedDoctorLinksResult.rows[0].count);

    console.log(`Orphaned patients (no profile): ${orphanedPatients}`);
    console.log(`Orphaned doctor links: ${orphanedDoctorLinks}`);

    if (orphanedPatients === 0 && orphanedDoctorLinks === 0) {
      console.log('✅ All foreign key relationships are valid!');
    } else {
      console.log('⚠️ Foreign key integrity issues detected');
    }

  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await sourceClient.end();
    await targetClient.end();
  }
}

migratePatients();
