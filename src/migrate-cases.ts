import { Client as PgClient } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

const BATCH_SIZE = 1000;

async function migrateCases() {
  const sourceClient = new PgClient({
    host: process.env.SOURCE_DB_HOST,
    port: parseInt(process.env.SOURCE_DB_PORT || "5432"),
    user: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASSWORD,
    database: process.env.SOURCE_DB_NAME,
  });

  const targetClient = new PgClient({
    host: process.env.TARGET_DB_HOST,
    port: parseInt(process.env.TARGET_DB_PORT || "5432"),
    user: process.env.TARGET_DB_USER,
    password: process.env.TARGET_DB_PASSWORD,
    database: process.env.TARGET_DB_NAME,
  });

  try {
    await sourceClient.connect();
    await targetClient.connect();

    console.log("Building lookup maps...");
    const profileResult = await targetClient.query(`SELECT id, legacy_patient_id FROM public.profiles WHERE legacy_patient_id IS NOT NULL`);
    const patientMap = new Map(profileResult.rows.map(r => [r.legacy_patient_id, r.id]));
    console.log(`Loaded ${patientMap.size} profile mappings`);

    console.log("Fetching cases from source...");
    const result = await sourceClient.query(`
      SELECT di.id, di.patient_id, di.notes, di.complaint, di.conditions, di.objective, di.status, di.comprehensive, di.accept_extraction, di.submitted_at, dp.office_id
      FROM dispatch_instruction di LEFT JOIN dispatch_patient dp ON di.patient_id = dp.id
      ORDER BY id
    `);
    console.log(`Found ${result.rows.length} cases in source`);

    const existing = await targetClient.query(`SELECT legacy_instruction_id FROM public.cases WHERE legacy_instruction_id IS NOT NULL`);
    const existingIds = new Set(existing.rows.map(r => r.legacy_instruction_id));
    console.log(`Found ${existingIds.size} existing cases in target`);

    const typeMap = {
      0: 'stl_upper',
      1: 'stl_lower',
      2: 'clinical_photo',
      3: 'treatment_plan',
      4: 'xray',
      5: 'cbct_scan',
      10: 'simulation',
      11: 'aligner_design'
    };

    const statusMap = {
      0: 'draft',
      1: 'in_progress',
      2: 'completed',
      3: 'archived'
    };

    const cases = result.rows.filter(p => !existingIds.has(p.id));
    console.log(`${cases.length} new cases to migrate`);

    let inserted = 0;
    let skipped = 0;

    for (let i = 0; i < cases.length; i += BATCH_SIZE) {
      const batch = cases.slice(i, i + BATCH_SIZE);
      const values = [];
      const placeholders = [];
      let idx = 1;

      for (const caseData of batch) {
        const patientId = caseData.patient_id ? patientMap.get(caseData.creator_id) : null;
        
        if (!creatorId) {
          skipped++;
          continue;
        }

        const caseDataType = typeMap[caseData.type] || 'other';
        const caseDataStatus = statusMap[caseData.status] || 'draft';

        placeholders.push(`($${idx}, $${idx+1}, $${idx+2}, $${idx+3}, $${idx+4}, $${idx+5}, $${idx+6}, $${idx+7}, $${idx+8})`);
        values.push(
          creatorId,
          caseData.name,
          caseDataType,
          caseDataStatus,
          caseData.uid,
          caseData.size,
          caseData.public,
          caseData.created_at,
          caseData.id
        );
        idx += 9;
      }

      if (placeholders.length > 0) {
        await targetClient.query(`
          INSERT INTO public.cases (creator_id, name, caseData_type, status, file_uid, file_size_bytes, is_public, created_at, legacy_instruction_id)
          VALUES ${placeholders.join(", ")}
          ON CONFLICT (legacy_instruction_id) DO NOTHING
        `, values);
        inserted += placeholders.length;
        console.log(`Batch ${Math.floor(i/BATCH_SIZE)+1}: ${inserted} cases`);
      }
    }

    console.log(`✓ Migrated ${inserted} cases`);
    console.log(`⚠ Skipped ${skipped} cases (no creator mapping)`);

    const verifyResult = await targetClient.query(`SELECT COUNT(*) as count FROM public.cases WHERE legacy_instruction_id IS NOT NULL`);
    console.log(`Total cases in target: ${verifyResult.rows[0].count}`);

  } finally {
    await sourceClient.end();
    await targetClient.end();
  }
}

migrateCases().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
