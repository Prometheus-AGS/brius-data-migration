import { Pool } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Configuration
interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

type Gender = 'male' | 'female' | 'unknown';
type PatientStatus = 'active' | 'consultation' | 'treatment_plan' | 'in_treatment' | 'retention' | 'completed' | 'on_hold' | 'cancelled' | 'transferred' | 'archived' | 'prospect';

interface PatientRow {
  id: string;                     // UUID primary key
  patient_number: string;         // e.g. "PT000123"
  legacy_patient_id: number | null;
  legacy_user_id: number | null;
  date_of_birth: string | null;   // ISO date
  sex: Gender | null;
  suffix: string | null;
  archived: boolean | null;
  suspended: boolean | null;
  status: PatientStatus | null;
  schemes: string | null;
  enrolled_at: string | null;     // timestamp with tz
  updated_at: string | null;
}

interface DispatchPatient {
  id: number;               // legacy_patient_id (to be stored)
  user_id: number;          // foreign key to auth_user (for lookup)
  birthdate: string | null;
  sex: number | null;       // 1 = male, 2 = female, other = unknown
  suffix: string | null;
  archived: boolean;
  suspended: boolean;
  status: number;           // 1‑active, 2‑inactive, 3‑inactive, 4‑active
  schemes: string | null;
  submitted_at: string | null;
  updated_at: string | null;
}

interface AuthUser {
  id: number;
}

/**
 * Get database configuration from environment variables
 */
function getSourceConfig(): DatabaseConfig {
  return {
    host: process.env.SOURCE_DB_HOST!,
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME!,
    username: process.env.SOURCE_DB_USER!,
    password: process.env.SOURCE_DB_PASSWORD!,
  };
}

function getTargetConfig(): DatabaseConfig {
  return {
    host: process.env.TARGET_DB_HOST!,
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    database: process.env.TARGET_DB_NAME!,
    username: process.env.TARGET_DB_USER!,
    password: process.env.TARGET_DB_PASSWORD!,
  };
}

/**
 * Create database connection pools
 */
function createSourcePool(): Pool {
  const config = getSourceConfig();
  return new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
}

function createTargetPool(): Pool {
  const config = getTargetConfig();
  return new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
}

/**
 * Helper – map the legacy integer gender → enum used in the "patients" table.
 */
function mapGender(legacySex: number | null): Gender {
  if (legacySex === 1) return 'male';
  if (legacySex === 2) return 'female';
  return 'unknown';
}

/**
 * Helper – map the legacy integer status → enum used in the "patients" table.
 */
function mapStatus(legacyStatus: number | null): PatientStatus {
  // Based on legacy data: 1 & 4 = active, 2 & 10 = others
  // Map to valid patient_status_type enum values
  if (legacyStatus === 1 || legacyStatus === 4) return 'active';
  if (legacyStatus === 2) return 'on_hold';
  if (legacyStatus === 10) return 'archived';
  return 'active';  // default to active for unknown status
}

/**
 * Pull a batch of patients that have legacy_user_id but no legacy_patient_id.
 */
async function fetchPatientsBatch(
  targetPool: Pool,
  batchSize: number,
  offset: number
): Promise<PatientRow[]> {
  const query = `
    SELECT id, patient_number, legacy_patient_id, legacy_user_id,
           date_of_birth, sex, suffix, archived, suspended,
           status, schemes, enrolled_at, updated_at
    FROM patients 
    WHERE legacy_patient_id IS NULL AND legacy_user_id IS NOT NULL
    ORDER BY id
    LIMIT $1 OFFSET $2
  `;
  
  const result = await targetPool.query(query, [batchSize, offset]);
  return result.rows as PatientRow[];
}

/**
 * Pull the legacy dispatch_patient rows from source database by user_id.
 */
async function fetchLegacyPatients(
  sourcePool: Pool,
  userIds: number[]
): Promise<DispatchPatient[]> {
  if (userIds.length === 0) return [];
  
  const query = `
    SELECT id, user_id, birthdate, sex, suffix, archived,
           suspended, status, schemes, submitted_at, updated_at
    FROM dispatch_patient 
    WHERE user_id = ANY($1)
  `;
  
  const result = await sourcePool.query(query, [userIds]);
  return result.rows as DispatchPatient[];
}

/**
 * Pull the auth_user rows from source database.
 */
async function fetchAuthUsers(
  sourcePool: Pool,
  userIds: number[]
): Promise<AuthUser[]> {
  if (userIds.length === 0) return [];
  
  const query = `
    SELECT id
    FROM auth_user 
    WHERE id = ANY($1)
  `;
  
  const result = await sourcePool.query(query, [userIds]);
  return result.rows as AuthUser[];
}

/**
 * Update patients in target database with legacy data.
 */
async function updatePatients(
  targetPool: Pool,
  updates: PatientRow[]
): Promise<number> {
  if (updates.length === 0) return 0;
  
  const client = await targetPool.connect();
  try {
    await client.query('BEGIN');
    
    let updatedCount = 0;
    for (const patient of updates) {
      const query = `
        UPDATE patients 
        SET legacy_patient_id = $1,
            date_of_birth = $2,
            sex = $3,
            suffix = $4,
            archived = $5,
            suspended = $6,
            status = $7,
            schemes = $8,
            enrolled_at = $9,
            updated_at = $10
        WHERE id = $11
      `;
      
      const values = [
        patient.legacy_patient_id,
        patient.date_of_birth,
        patient.sex,
        patient.suffix,
        patient.archived,
        patient.suspended,
        patient.status,
        patient.schemes,
        patient.enrolled_at,
        patient.updated_at,
        patient.id
      ];
      
      const result = await client.query(query, values);
      updatedCount += result.rowCount || 0;
    }
    
    await client.query('COMMIT');
    return updatedCount;
    
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Main migration function
 */
async function main() {
  const sourcePool = createSourcePool();
  const targetPool = createTargetPool();
  
  const BATCH_SIZE = Number(process.env.BATCH_SIZE) || 500;
  let offset = 0;
  let totalMigrated = 0;
  
  console.log('🚀 Starting patient‑data migration (by legacy_user_id)');
  
  try {
    while (true) {
      // 1️⃣ Grab a page of patients that have legacy_user_id but need legacy_patient_id
      const patients = await fetchPatientsBatch(targetPool, BATCH_SIZE, offset);
      if (patients.length === 0) break; // nothing left → finished
      
      console.log(`📄 Processing batch starting at offset ${offset} (${patients.length} patients)`);
      
      // Extract the legacy_user_ids we'll need to look up
      const userIds = patients.map(p => p.legacy_user_id).filter((id): id is number => id !== null);
      
      if (userIds.length === 0) {
        console.log('⚠️  No valid legacy user IDs found in this batch, skipping...');
        offset += BATCH_SIZE;
        continue;
      }
      
      // 2️⃣ Pull the legacy rows from source database by user_id
      const legacyPatients = await fetchLegacyPatients(sourcePool, userIds);
      const legacyByUserId = new Map<number, DispatchPatient>();
      legacyPatients.forEach(lp => legacyByUserId.set(lp.user_id, lp));
      
      console.log(`🔍 Found ${legacyPatients.length} legacy patient records`);
      
      // 3️⃣ Verify auth_user IDs exist (optional check)
      const authUsers = await fetchAuthUsers(sourcePool, userIds);
      const authUserExists = new Set<number>(authUsers.map(u => u.id));
      
      console.log(`👥 Found ${authUsers.length} auth users`);
      
      // 4️⃣ Build the update payloads
      const updates: PatientRow[] = [];
      
      for (const patient of patients) {
        if (!patient.legacy_user_id) continue;
        
        const legacy = legacyByUserId.get(patient.legacy_user_id);
        if (!legacy) {
          console.log(`⚠️  No legacy patient found for user_id ${patient.legacy_user_id}`);
          continue;
        }
        
        const updatedPatient: PatientRow = {
          ...patient,
          legacy_patient_id: legacy.id,  // This is the dispatch_patient.id
          date_of_birth: legacy.birthdate,
          sex: mapGender(legacy.sex),
          suffix: legacy.suffix,
          archived: legacy.archived,
          suspended: legacy.suspended,
          status: mapStatus(legacy.status),
          schemes: legacy.schemes,
          // Keep the original enrolled_at if it already has a value; otherwise use the legacy submitted_at.
          enrolled_at: patient.enrolled_at ?? legacy.submitted_at,
          updated_at: new Date().toISOString()
        };
        
        updates.push(updatedPatient);
      }
      
      console.log(`📝 Prepared ${updates.length} updates`);
      
      // 5️⃣ Apply the updates
      if (updates.length > 0) {
        const updatedCount = await updatePatients(targetPool, updates);
        totalMigrated += updatedCount;
        console.log(`✅ Processed batch ${Math.floor(offset / BATCH_SIZE) + 1}: migrated ${updatedCount} rows`);
      }
      
      offset += BATCH_SIZE;
    }
    
    console.log(`🎉 Migration complete – total rows updated: ${totalMigrated}`);
    
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

// Handle different command line arguments
const command = process.argv[2];

if (command === 'validate') {
  console.log('Validation not implemented for this version');
  process.exit(0);
} else if (command === 'rollback') {
  console.log('Rollback not implemented for this version');
  process.exit(0);
} else {
  // Run the migration
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
