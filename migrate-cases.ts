import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

// Source database connection
const sourceClient = new Client({
  host: process.env.SOURCE_DB_HOST,
  port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
  database: process.env.SOURCE_DB_NAME,
  user: process.env.SOURCE_DB_USER,
  password: process.env.SOURCE_DB_PASSWORD,
});

// Target database connection
const targetClient = new Client({
  host: process.env.TARGET_DB_HOST,
  port: parseInt(process.env.TARGET_DB_PORT || '5432'),
  database: process.env.TARGET_DB_NAME,
  user: process.env.TARGET_DB_USER,
  password: process.env.TARGET_DB_PASSWORD,
});

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '500');
const TEST_MODE = process.env.TEST_MODE === 'true';

interface SourcePatient {
  id: number;
  doctor_id: number | null;
  user_id: number;
  office_id: number | null;
  archived: boolean;
  status: number | null;
  submitted_at: Date | null;
  suffix: string;
  updated_at: Date | null;
  sex: number | null;
  suspended: boolean;
}

async function buildLookupMappings() {
  console.log('Building lookup mappings...');
  
  // Build patient mapping (legacy_patient_id -> target patient UUID)
  const patientResult = await targetClient.query(`
    SELECT id, legacy_patient_id 
    FROM patients 
    WHERE legacy_patient_id IS NOT NULL
  `);
  const patientMapping = new Map<number, string>();
  for (const row of patientResult.rows) {
    patientMapping.set(row.legacy_patient_id, row.id);
  }
  console.log(`  Built ${patientMapping.size} patient mappings`);

  // Build doctor mapping (legacy_user_id -> target doctor UUID)  
  const doctorResult = await targetClient.query(`
    SELECT id, legacy_user_id 
    FROM doctors 
    WHERE legacy_user_id IS NOT NULL
  `);
  const doctorMapping = new Map<number, string>();
  for (const row of doctorResult.rows) {
    doctorMapping.set(row.legacy_user_id, row.id);
  }
  console.log(`  Built ${doctorMapping.size} doctor mappings`);

  // Build office mapping (legacy_office_id -> target office UUID)
  const officeResult = await targetClient.query(`
    SELECT id, legacy_office_id 
    FROM offices 
    WHERE legacy_office_id IS NOT NULL
  `);
  const officeMapping = new Map<number, string>();
  for (const row of officeResult.rows) {
    officeMapping.set(row.legacy_office_id, row.id);
  }
  console.log(`  Built ${officeMapping.size} office mappings`);

  // Get a default doctor for cases without primary doctor
  const defaultDoctorResult = await targetClient.query(`
    SELECT id FROM doctors 
    ORDER BY id 
    LIMIT 1
  `);
  const defaultDoctorId = defaultDoctorResult.rows[0]?.id;
  console.log(`  Default doctor ID: ${defaultDoctorId}`);

  return { patientMapping, doctorMapping, officeMapping, defaultDoctorId };
}

function mapStatus(legacyStatus: number | null): string {
  // Map legacy status to valid enum values
  switch (legacyStatus) {
    case 1: return 'consultation';
    case 2: return 'diagnosis'; 
    case 3: return 'treatment_plan';
    case 4: return 'active';
    case 5: return 'refinement';
    case 6: return 'retention';
    case 7: return 'completed';
    case 8: return 'cancelled';
    case 9: return 'on_hold';
    case 10: return 'transferred';
    case 11: return 'revision';
    default: return 'consultation'; // Default for null/unknown status
  }
}

async function migrateCasesBatch(
  patients: SourcePatient[],
  patientMapping: Map<number, string>,
  doctorMapping: Map<number, string>,
  officeMapping: Map<number, string>,
  defaultDoctorId: string
): Promise<{ success: number; skipped: number; errors: number }> {
  
  const insertData: any[] = [];
  let skipped = 0;

  for (const patient of patients) {
    const patientId = patientMapping.get(patient.id);
    let doctorId = patient.doctor_id ? doctorMapping.get(patient.doctor_id) : null;
    const officeId = patient.office_id ? officeMapping.get(patient.office_id) : null;

    if (!patientId) {
      console.log(`    Skipping patient ${patient.id}: No mapping for patient`);
      skipped++;
      continue;
    }

    // Use default doctor if no primary doctor assigned
    if (!doctorId) {
      doctorId = defaultDoctorId;
    }

    // Generate case number using legacy pattern
    const caseNumber = `CASE-${patient.suffix}-${patient.id}`;
    
    insertData.push({
      patient_id: patientId,
      primary_doctor_id: doctorId,
      office_id: officeId,
      case_number: caseNumber,
      status: mapStatus(patient.status),
      deleted: patient.archived || patient.suspended,
      created_at: patient.submitted_at || new Date(),
      updated_at: patient.updated_at || new Date(),
      legacy_patient_id: patient.id,
      metadata: JSON.stringify({
        legacy_status: patient.status,
        legacy_sex: patient.sex,
        legacy_archived: patient.archived,
        legacy_suspended: patient.suspended,
        original_suffix: patient.suffix,
        legacy_doctor_id: patient.doctor_id,
        legacy_user_id: patient.user_id
      })
    });
  }

  if (insertData.length === 0) {
    return { success: 0, skipped, errors: 0 };
  }

  try {
    // Build the insert query
    const fields = [
      'patient_id', 'primary_doctor_id', 'office_id', 'case_number', 
      'status', 'deleted', 'created_at', 'updated_at', 
      'legacy_patient_id', 'metadata'
    ];
    
    const values = insertData.map((_, index) => {
      const base = index * fields.length;
      return `(${fields.map((_, i) => `$${base + i + 1}`).join(', ')})`;
    }).join(', ');

    const query = `
      INSERT INTO cases (${fields.join(', ')})
      VALUES ${values}
      ON CONFLICT (case_number) DO NOTHING
    `;

    const queryParams: any[] = [];
    for (const data of insertData) {
      queryParams.push(
        data.patient_id,
        data.primary_doctor_id,
        data.office_id,
        data.case_number,
        data.status,
        data.deleted,
        data.created_at,
        data.updated_at,
        data.legacy_patient_id,
        data.metadata
      );
    }

    const result = await targetClient.query(query, queryParams);
    
    return { 
      success: result.rowCount || 0, 
      skipped, 
      errors: 0 
    };

  } catch (error) {
    console.error('    Batch insert error:', error);
    return { 
      success: 0, 
      skipped, 
      errors: insertData.length 
    };
  }
}

async function migrateCases() {
  try {
    await sourceClient.connect();
    await targetClient.connect();
    console.log('Connected to both databases');

    const { patientMapping, doctorMapping, officeMapping, defaultDoctorId } = await buildLookupMappings();

    if (!defaultDoctorId) {
      throw new Error('No default doctor found in target database');
    }

    // Get total count
    const countResult = await sourceClient.query(`
      SELECT COUNT(*) as total FROM dispatch_patient
    `);
    const totalRecords = parseInt(countResult.rows[0].total);
    console.log(`Total patients/cases to migrate: ${totalRecords}\n`);

    if (TEST_MODE) {
      console.log('🧪 Running in TEST MODE - processing only first 10 records\n');
    }

    // Process in batches
    let processed = 0;
    let totalSuccess = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    const limit = TEST_MODE ? Math.min(10, BATCH_SIZE) : BATCH_SIZE;
    const maxRecords = TEST_MODE ? 10 : totalRecords;

    while (processed < maxRecords) {
      const offset = processed;
      const currentBatchSize = Math.min(limit, maxRecords - processed);
      
      console.log(`Processing batch: ${offset + 1} to ${offset + currentBatchSize}`);

      // Fetch batch
      const batchResult = await sourceClient.query(`
        SELECT id, doctor_id, user_id, office_id, archived, status, 
               submitted_at, suffix, updated_at, sex, suspended
        FROM dispatch_patient
        ORDER BY id
        LIMIT $1 OFFSET $2
      `, [currentBatchSize, offset]);

      const patients: SourcePatient[] = batchResult.rows;

      if (patients.length === 0) {
        break;
      }

      // Migrate batch
      const result = await migrateCasesBatch(
        patients, 
        patientMapping, 
        doctorMapping, 
        officeMapping,
        defaultDoctorId
      );

      totalSuccess += result.success;
      totalSkipped += result.skipped;
      totalErrors += result.errors;

      if (result.errors === 0) {
        console.log(`    Successfully inserted ${result.success} cases`);
      }

      processed += patients.length;
      
      const progressPercent = ((processed / totalRecords) * 100).toFixed(1);
      console.log(`Progress: ${progressPercent}% (${processed}/${totalRecords}) - Success: ${totalSuccess}, Skipped: ${totalSkipped}, Errors: ${totalErrors}\n`);
    }

    console.log('=== Migration Complete ===');
    console.log(`Total processed: ${processed}`);
    console.log(`Successfully migrated: ${totalSuccess}`);
    console.log(`Skipped: ${totalSkipped}`);
    console.log(`Errors: ${totalErrors}`);

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await sourceClient.end();
    await targetClient.end();
  }
}

// Run migration
migrateCases();
