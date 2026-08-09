// seed-db.ts
// Bulk-seeds the "logs" table with realistic, varied data for load testing.
// Connects directly to Postgres and streams rows in with COPY, so inserting
// 1,000,000+ rows takes seconds instead of minutes. This is standalone and
// does NOT import anything from your app, so it will work regardless of
// where you place this folder in your project.
//
// Usage:
//   DATABASE_URL="postgres://user:pass@localhost:5432/dbname" \
//   SEED_COUNT=1000000 \
//   npx tsx seed-db.ts
//
// Env vars:
//   DATABASE_URL    Postgres connection string (required)
//   SEED_COUNT      total rows to insert (default 1000000)
//   SEED_BATCH      rows per COPY batch (default 5000)
//   SEED_DAYS_BACK  spread of timestamps, in days into the past (default 30)
//   SEED_TABLE      table name (default "logs")

import postgres from "postgres";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { generateLog, randomPastTimestamp } from "./lib/log-generator.js";

const DATABASE_URL = process.env.DATABASE_URL;
const SEED_COUNT = Number(process.env.SEED_COUNT ?? 1_000_000);
const BATCH_SIZE = Number(process.env.SEED_BATCH ?? 5000);
const DAYS_BACK = Number(process.env.SEED_DAYS_BACK ?? 30);
const TABLE = process.env.SEED_TABLE ?? "logs";

if (!DATABASE_URL) {
  console.error("[seed] Missing DATABASE_URL env var. Example:");
  console.error('  DATABASE_URL="postgres://user:pass@localhost:5432/dbname" npx tsx seed-db.ts');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 5 });

function csvEscape(val: string): string {
  return `"${val.replace(/"/g, '""')}"`;
}

async function* toCSV(count: number) {
  for (let i = 0; i < count; i++) {
    const log = generateLog(randomPastTimestamp(DAYS_BACK));
    yield (
      [
        csvEscape(log.timestamp),
        csvEscape(log.level),
        csvEscape(log.service),
        csvEscape(log.message.replace(/[\r\n]/g, " ")),
        csvEscape(JSON.stringify(log.attributes)),
      ].join(",") + "\n"
    );
  }
}

async function insertBatch(size: number) {
  const query = sql`COPY ${sql(TABLE)} (timestamp, level, service, message, attributes)
                     FROM STDIN
                     WITH (FORMAT csv)`;
  const stream = await query.writable();
  await pipeline(Readable.from(toCSV(size)), stream);
  await query;
}

async function main() {
  console.log("=== Seeding logs table ===");
  console.log(`Table: ${TABLE}`);
  console.log(`Target rows: ${SEED_COUNT}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Timestamp spread: last ${DAYS_BACK} days (all in the past, safe for a large dataset)`);
  console.log("");

  const startedAt = Date.now();
  let inserted = 0;

  while (inserted < SEED_COUNT) {
    const size = Math.min(BATCH_SIZE, SEED_COUNT - inserted);
    await insertBatch(size);
    inserted += size;

    const elapsedSec = (Date.now() - startedAt) / 1000;
    const rate = Math.round(inserted / elapsedSec);
    process.stdout.write(
      `\r[seed] Inserted ${inserted}/${SEED_COUNT} rows (${rate} rows/sec, ${elapsedSec.toFixed(1)}s elapsed)`
    );
  }

  const totalSec = (Date.now() - startedAt) / 1000;
  console.log("");
  console.log("");
  console.log("=== Done ===");
  console.log(`Total rows inserted: ${inserted}`);
  console.log(`Total time: ${totalSec.toFixed(2)}s`);
  console.log(`Average insert rate: ${Math.round(inserted / totalSec)} rows/sec`);

  await sql.end({ timeout: 5 });
}

main().catch(async (err) => {
  console.error("");
  console.error("[seed] Fatal error:", err);
  await sql.end({ timeout: 5 });
  process.exit(1);
});
