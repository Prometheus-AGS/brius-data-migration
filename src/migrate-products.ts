import { Client as PgClient } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

async function migrateProducts() {
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

    const courseResult = await targetClient.query(`SELECT id, legacy_id FROM public.courses WHERE legacy_id IS NOT NULL`);
    const courseMap = new Map(courseResult.rows.map(r => [r.legacy_id, r.id]));

    console.log("Fetching products...");
    const result = await sourceClient.query(`SELECT id, name, description, free, customization, type, course_id FROM dispatch_product WHERE deleted = false ORDER BY id`);

    const existing = await targetClient.query(`SELECT legacy_course_id FROM public.products WHERE legacy_course_id IS NOT NULL`);
    const existingIds = new Set(existing.rows.map(r => r.legacy_course_id));

    const typeMap = { 1: "main", 2: "refinement", 3: "any", 4: "replacement", 5: "invoice", 6: "merchandise" };
    let inserted = 0;

    for (const product of result.rows) {
      if (existingIds.has(product.id)) continue;
      if (!courseMap.has(product.course_id)) continue;

      const courseType = typeMap[product.type] || "main";
      const metadata = { description: product.description, free: product.free };

      await targetClient.query(`INSERT INTO public.products (legacy_course_id, name, course_type, base_price, customization, metadata) VALUES ($1, $2, $3::course_type, $4, $5::jsonb, $6::jsonb) ON CONFLICT (legacy_course_id) DO NOTHING`, [product.id, product.name, courseType, product.free ? 0 : null, product.customization, JSON.stringify(metadata)]);
      inserted++;
    }

    console.log(`✓ Migrated ${inserted} products`);
  } finally {
    await sourceClient.end();
    await targetClient.end();
  }
}

migrateProducts().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
