import { db } from "../db/index.js";
import { sql } from "drizzle-orm";

const RETENTION_DAYS = Number(
  process.env.RETENTION_DAYS ?? 30,
);

const CHECK_INTERVAL_MS = Number(
  process.env.RETENTION_CHECK_INTERVAL_MS ?? 3600000,
);

export async function managePartitions(): Promise<void> {
  if (
    !Number.isInteger(RETENTION_DAYS) ||
    RETENTION_DAYS < 1
  ) {
    throw new Error(
      "RETENTION_DAYS must be a positive integer",
    );
  }

  // Start of today in UTC
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Create today partition + next 2 days
  for (let i = -RETENTION_DAYS; i <= 2; i++) {
    const targetDate = new Date(today);

    targetDate.setUTCDate(
      today.getUTCDate() + i,
    );

    const year = targetDate.getUTCFullYear();

    const month = String(
      targetDate.getUTCMonth() + 1,
    ).padStart(2, "0");

    const day = String(
      targetDate.getUTCDate(),
    ).padStart(2, "0");

    const partitionName =
      `logs_p${year}_${month}_${day}`;

    const startDate =
      `${year}-${month}-${day} 00:00:00+00`;

    const nextDate = new Date(targetDate);

    nextDate.setUTCDate(
      targetDate.getUTCDate() + 1,
    );

    const nextYear =
      nextDate.getUTCFullYear();

    const nextMonth = String(
      nextDate.getUTCMonth() + 1,
    ).padStart(2, "0");

    const nextDay = String(
      nextDate.getUTCDate(),
    ).padStart(2, "0");

    const endDate =
      `${nextYear}-${nextMonth}-${nextDay} 00:00:00+00`;

    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS "${partitionName}"
      PARTITION OF "logs"
      FOR VALUES FROM ('${startDate}')
                   TO ('${endDate}');
    `));
  }

  // Retention cutoff
  const cutoffDate = new Date(today);

  cutoffDate.setUTCDate(
    cutoffDate.getUTCDate() - RETENTION_DAYS,
  );

  // Get actual partitions belonging to logs
  const partitionsResult = await db.execute<{
    partition_name: string;
  }>(sql`
    SELECT c.relname AS partition_name
    FROM pg_inherits i
    JOIN pg_class c
      ON c.oid = i.inhrelid
    WHERE i.inhparent = 'logs'::regclass
      AND c.relname LIKE 'logs_p%'
  `);

  for (const row of partitionsResult) {
    const match = row.partition_name.match(
      /^logs_p(\d{4})_(\d{2})_(\d{2})$/,
    );

    if (!match) {
      continue;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    const partitionDate = new Date(
      Date.UTC(year, month - 1, day),
    );

    if (partitionDate < cutoffDate) {
      await db.execute(
        sql.raw(
          `DROP TABLE IF EXISTS "${row.partition_name}"`,
        ),
      );

      console.log(
        `[Retention] Dropped expired partition: ${row.partition_name}`,
      );
    }
  }
}

export function startRetentionScheduler() {
  const run = async () => {
    try {
      await managePartitions();
    } catch (error) {
      console.error(
        "[Retention] Partition management failed:",
        error,
      );
    } finally {
      setTimeout(run, CHECK_INTERVAL_MS);
    }
  };

  setTimeout(run, 2000);
}