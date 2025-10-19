import { Client as PgClient } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

const BATCH_SIZE = 1000;

async function migrateJaws() {
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

    const productResult = await targetClient.query(`SELECT id, legacy_course_id FROM public.products WHERE legacy_course_id IS NOT NULL`);
    const productMap = new Map(productResult.rows.map(r => [r.legacy_course_id, r.id]));
    console.log(`Loaded ${productMap.size} products`);

    const orderResult = await targetClient.query(`SELECT id, legacy_instruction_id FROM public.orders WHERE legacy_instruction_id IS NOT NULL`);
    const orderMap = new Map(orderResult.rows.map(r => [r.legacy_instruction_id, r.id]));
    console.log(`Loaded ${orderMap.size} orders`);

    const jawInstructionResult = await sourceClient.query(`SELECT CASE WHEN upper_jaw_id IS NOT NULL THEN upper_jaw_id ELSE lower_jaw_id END as jaw_id, id as instruction_id, CASE WHEN upper_jaw_id IS NOT NULL THEN 'upper' ELSE 'lower' END as jaw_type FROM dispatch_instruction WHERE upper_jaw_id IS NOT NULL OR lower_jaw_id IS NOT NULL`);
    
    const jawOrderMap = new Map();
    const jawTypeMap = new Map();
    jawInstructionResult.rows.forEach(row => {
      const orderId = orderMap.get(row.instruction_id);
      if (orderId) {
        jawOrderMap.set(row.jaw_id, orderId);
        jawTypeMap.set(row.jaw_id, row.jaw_type);
      }
    });
    console.log(`Mapped ${jawOrderMap.size} jaws to orders`);

    console.log("Fetching jaws...");
    const result = await sourceClient.query(`SELECT id, bond_teeth, extract_teeth, reason, product_id, labial FROM dispatch_jaw ORDER BY id`);
    console.log(`Found ${result.rows.length} jaws in source`);

    const existing = await targetClient.query(`SELECT legacy_jaw_id FROM public.jaws WHERE legacy_jaw_id IS NOT NULL`);
    const existingIds = new Set(existing.rows.map(r => r.legacy_jaw_id));
    console.log(`Found ${existingIds.size} existing jaws in target`);

    const reasonMap = { 1: "breakage", 2: "other", 3: "complete" };
    const jaws = result.rows.filter(j => !existingIds.has(j.id));
    console.log(`${jaws.length} new jaws to migrate`);
    
    let inserted = 0;
    let skipped = 0;
    for (let i = 0; i < jaws.length; i += BATCH_SIZE) {
      const batch = jaws.slice(i, i + BATCH_SIZE);
      const values = [];
      const placeholders = [];
      let idx = 1;

      for (const jaw of batch) {
        const orderId = jawOrderMap.get(jaw.id);
        const jawType = jawTypeMap.get(jaw.id);
        const productId = jaw.product_id ? productMap.get(jaw.product_id) : null;
        
        if (!orderId || !jawType) {
          skipped++;
          continue;
        }

        const reason = jaw.reason ? reasonMap[jaw.reason] : null;
        placeholders.push(`($${idx}, $${idx+1}, $${idx+2}, $${idx+3}, $${idx+4}, $${idx+5}, $${idx+6}, $${idx+7})`);
        values.push(jaw.id, orderId, productId, jawType, jaw.labial, jaw.bond_teeth, jaw.extract_teeth, reason);
        idx += 8;
      }

      if (placeholders.length > 0) {
        await targetClient.query(`INSERT INTO public.jaws (legacy_jaw_id, order_id, product_id, jaw_type, labial, bond_teeth, extract_teeth, replacement_reason) VALUES ${placeholders.join(", ")} ON CONFLICT (legacy_jaw_id) DO NOTHING`, values);
        inserted += placeholders.length;
        console.log(`Batch ${Math.floor(i/BATCH_SIZE)+1}: ${inserted} jaws`);
      }
    }

    console.log(`✓ Migrated ${inserted} jaws`);
    console.log(`⚠ Skipped ${skipped} jaws (no order mapping)`);
  } finally {
    await sourceClient.end();
    await targetClient.end();
  }
}

migrateJaws().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
