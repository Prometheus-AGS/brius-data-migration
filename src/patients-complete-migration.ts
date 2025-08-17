// ---------------------------------------------------------------
// migrate-patients.ts
// ---------------------------------------------------------------
// This script copies legacy patient data from the FDW tables into the
// "patients" table.  It can be run repeatedly – rows that already have
// a non‑null legacy_patient_id are ignored.
// ---------------------------------------------------------------

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

type Gender = 'male' | 'female' | 'unknown';
type PatientStatus = 'active' | 'inactive';

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
  id: number;               // legacy_patient_id
  user_id: number;          // foreign key to auth_user
  birthdate: string | null;
  sex: number | null;       // 1 = male, 2 = female, other = unknown
  suffix: string | null;
  archived: boolean;
  suspended: boolean;
  status: number;           // 1‑active, 2‑inactive, 3‑inactive, 4‑active (based on your data)
  schemes: string | null;
  submitted_at: string | null;
  updated_at: string | null;
}

interface AuthUser {
  id: number;
  // we only need the id for this migration, but you could grab name/email etc.
}

/**
 * Initialise Supabase client – we use the service‑role key because we need
 * write permission on the "patients" table.
 */
function getSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE must be set');
  }
  return createClient(url, serviceKey);
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
  // Your legacy data shows 1 & 4 = active, 2 & 3 = inactive.
  if (legacyStatus === 1 || legacyStatus === 4) return 'active';
  return 'inactive';
}

/**
 * Pull a batch of patients that still need migration.
 */
async function fetchPatientsBatch(
  supabase: SupabaseClient,
  batchSize: number,
  offset: number
): Promise<PatientRow[]> {
  const { data, error } = await supabase
    .from('patients')
    .select(
      `id,patient_number,legacy_patient_id,legacy_user_id,
       date_of_birth,sex,suffix,archived,suspended,
       status,schemes,enrolled_at,updated_at`
    )
    .is('legacy_patient_id', null) // only rows not yet migrated
    .range(offset, offset + batchSize - 1);

  if (error) throw error;
  return (data as PatientRow[]) ?? [];
}

/**
 * Pull the FDW rows that correspond to a given set of legacy_patient_ids.
 * We query the foreign tables directly (they appear as normal tables under the
 * schema you gave them – e.g. `legacy_fdw.dispatch_patient`).
 */
async function fetchLegacyPatients(
  supabase: SupabaseClient,
  legacyIds: number[]
): Promise<DispatchPatient[]> {
  const { data, error } = await supabase
    .from('legacy_fdw.dispatch_patient')
    .select(
      `id,user_id,birthdate,sex,suffix,archived,
       suspended,status,schemes,submitted_at,updated_at`
    )
    .in('id', legacyIds);

  if (error) throw error;
  return (data as DispatchPatient[]) ?? [];
}

/**
 * Pull the auth_user rows that correspond to a set of user IDs.
 */
async function fetchAuthUsers(
  supabase: SupabaseClient,
  userIds: number[]
): Promise<AuthUser[]> {
  const { data, error } = await supabase
    .from('legacy_fdw.auth_user')
    .select('id')
    .in('id', userIds);

  if (error) throw error;
  return (data as AuthUser[]) ?? [];
}

/**
 * Main migration loop.
 */
async function main() {
  const supabase = getSupabase();
  const BATCH_SIZE = Number(process.env.BATCH_SIZE) || 500;
  let offset = 0;
  let totalMigrated = 0;

  console.log('🚀 Starting patient‑data migration');

  while (true) {
    // 1️⃣ Grab a page of patients that still need legacy data
    const patients = await fetchPatientsBatch(supabase, BATCH_SIZE, offset);
    if (patients.length === 0) break; // nothing left → finished

    console.log(`📄 Processing batch starting at offset ${offset} (${patients.length} patients)`);

    // Extract the legacy IDs we'll need to look up.
    // The legacy patient ID lives in the FDW table, but the `patient_number`
    // column is formatted like "PT000123".  Strip the prefix and cast to int.
    const legacyIds = patients.map(p => {
      const match = p.patient_number.match(/^PT(\d+)$/);
      return match ? Number(match[1]) : null;
    }).filter((id): id is number => id !== null);

    if (legacyIds.length === 0) {
      console.log('⚠️  No valid legacy IDs found in this batch, skipping...');
      offset += BATCH_SIZE;
      continue;
    }

    // 2️⃣ Pull the legacy rows in one go
    const legacyPatients = await fetchLegacyPatients(supabase, legacyIds);
    const legacyById = new Map<number, DispatchPatient>();
    legacyPatients.forEach(lp => legacyById.set(lp.id, lp));

    console.log(`🔍 Found ${legacyPatients.length} legacy patient records`);

    // 3️⃣ Collect all auth_user IDs we'll need (one‑to‑many isn't expected)
    const userIds = legacyPatients.map(lp => lp.user_id).filter((id): id is number => id !== undefined);
    const authUsers = await fetchAuthUsers(supabase, userIds);
    const authUserExists = new Set<number>(authUsers.map(u => u.id));

    console.log(`👥 Found ${authUsers.length} auth users`);

    // 4️⃣ Build the update payloads
    const updates: PatientRow[] = [];

    for (const patient of patients) {
      const match = patient.patient_number.match(/^PT(\d+)$/);
      if (!match) continue; // should never happen

      const legacyId = Number(match[1]);
      const legacy = legacyById.get(legacyId);
      if (!legacy) continue; // no legacy row – skip for now

      const updatedPatient: PatientRow = {
        ...patient,
        legacy_patient_id: legacy.id,
        legacy_user_id: authUserExists.has(legacy.user_id) ? legacy.user_id : null,
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

    // 5️⃣ Apply the updates in a single upsert call per batch.
    if (updates.length > 0) {
      const { error: upsertError } = await supabase
        .from('patients')
        .upsert(updates, { onConflict: 'id' });

      if (upsertError) {
        console.error('❗ Upsert error on batch starting at offset', offset, upsertError);
        // Decide if you want to abort or continue – here we abort.
        process.exit(1);
      }

      totalMigrated += updates.length;
      console.log(`✅ Processed batch ${Math.floor(offset / BATCH_SIZE) + 1}: migrated ${updates.length} rows`);
    }
    
    offset += BATCH_SIZE;
  }

  console.log(`🎉 Migration complete – total rows updated: ${totalMigrated}`);
  process.exit(0);
}

// Run the script
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
