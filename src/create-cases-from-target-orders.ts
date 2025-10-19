import { Client as PgClient } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

const BATCH_SIZE = 1000;

async function createCases() {
  const targetClient = new PgClient({
    host: process.env.TARGET_DB_HOST,
    port: parseInt(process.env.TARGET_DB_PORT || "5432"),
    user: process.env.TARGET_DB_USER,
    password: process.env.TARGET_DB_PASSWORD,
    database: process.env.TARGET_DB_NAME,
  });

  try {
    await targetClient.connect();
    console.log("Creating cases from orders...");

    const result = await targetClient.query();

    console.log();
    const verify = await targetClient.query();
    console.log();

  } finally {
    await targetClient.end();
  }
}

createCases().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
