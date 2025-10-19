import { Client as PgClient } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

const BATCH_SIZE = 1000;

async function migrateTreatmentPlans() {
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
