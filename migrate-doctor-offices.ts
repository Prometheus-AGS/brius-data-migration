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

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '100');
const TEST_MODE = process.env.TEST_MODE === 'true';

interface SourceDoctorOffice {
  id: number;
  office_id: number;
  user_id: number; // doctor's user_id
}

async function buildLookupMappings() {
  console.log('Building lookup mappings...');
  
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

  // Build doctor/profile mapping (legacy user_id -> target profile UUID)
  const doctorResult = await targetClient.query(`
    SELECT id, legacy_user_id 
    FROM profiles 
    WHERE legacy_user_id IS NOT NULL AND profile_type = 'doctor'
  `);
  const doctorMapping = new Map<number, string>();
  for (const row of doctorResult.rows) {
    doctorMapping.set(row.legacy_user_id, row.id);
  }
  console.log(`  Built ${doctorMapping.size} doctor mappings`);

  return { officeMapping, doctorMapping };
}

async function migrateDoctorOfficesBatch(
  doctorOffices: SourceDoctorOffice[],
  officeMapping: Map<number, string>,
  doctorMapping: Map<number, string>
): Promise<{ success: number; skipped: number; errors: number }> {
  
  const insertData: any[] = [];
  let skipped = 0;

  for (const doctorOffice of doctorOffices) {
    const officeId = officeMapping.get(doctorOffice.office_id);
    const doctorId = doctorMapping.get(doctorOffice.user_id);

    if (!officeId) {
      console.log(`    Skipping doctor-office ${doctorOffice.id}: No mapping for office ${doctorOffice.office_id}`);
      skipped++;
      continue;
    }

    if (!doctorId) {
      console.log(`    Skipping doctor-office ${doctorOffice.id}: No mapping for doctor ${doctorOffice.user_id}`);
      skipped++;
      continue;
    }

    insertData.push({
      doctor_id: doctorId,
      office_id: officeId,
      is_primary: false, // We'll set one as primary later if needed
      is_active: true
    });
  }

  if (insertData.length === 0) {
    return { success: 0, skipped, errors: 0 };
  }

  try {
    // Build the insert query
    const values = insertData.map((_, index) => {
      const base = index * 4;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
    }).join(', ');

    const query = `
      INSERT INTO doctor_offices (doctor_id, office_id, is_primary, is_active)
      VALUES ${values}
      ON CONFLICT (doctor_id, office_id) DO NOTHING
    `;

    const queryParams: any[] = [];
    for (const data of insertData) {
      queryParams.push(
        data.doctor_id,
        data.office_id,
        data.is_primary,
        data.is_active
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

async function migrateDoctorOffices() {
  try {
    await sourceClient.connect();
    await targetClient.connect();
    console.log('Connected to both databases');

    const { officeMapping, doctorMapping } = await buildLookupMappings();

    // Get total count
    const countResult = await sourceClient.query(`
      SELECT COUNT(*) as total FROM dispatch_office_doctors
    `);
    const totalRecords = parseInt(countResult.rows[0].total);
    console.log(`Total doctor-office associations to migrate: ${totalRecords}\n`);

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
        SELECT id, office_id, user_id
        FROM dispatch_office_doctors
        ORDER BY id
        LIMIT $1 OFFSET $2
      `, [currentBatchSize, offset]);

      const doctorOffices: SourceDoctorOffice[] = batchResult.rows;

      if (doctorOffices.length === 0) {
        break;
      }

      // Migrate batch
      const result = await migrateDoctorOfficesBatch(
        doctorOffices, 
        officeMapping, 
        doctorMapping
      );

      totalSuccess += result.success;
      totalSkipped += result.skipped;
      totalErrors += result.errors;

      if (result.errors === 0) {
        console.log(`    Successfully inserted ${result.success} doctor-office associations`);
      }

      processed += doctorOffices.length;
      
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
migrateDoctorOffices();
