const BASE = process.env.BASE_URL || "http://localhost:8080";
const TARGET = Number(process.env.SEED_COUNT ?? 1_000_000);
const BATCH = Number(process.env.SEED_BATCH ?? 500);
const CONC = Number(process.env.SEED_CONCURRENCY ?? 8);
const DAYS_BACK = Number(process.env.SEED_DAYS_BACK ?? 29);

const SPREAD_MS = DAYS_BACK * 24 * 3600 * 1000;
const SERVICES = ["checkout", "auth", "payments", "inventory", "shipping", "notifications", "search", "recommendations"];
const LEVELS = ["debug", "info", "warn", "error"];
const REGIONS = ["eu-west", "us-east", "us-west", "ap-south", "me-central"];
const MESSAGES = ["payment declined", "user login ok", "cache miss", "request timeout", "order created", "job scheduled"];
const NOW = Date.now();

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function makeBatch(size) {
  const logs = new Array(size);
  for (let i = 0; i < size; i++) {
    logs[i] = {
      timestamp: new Date(NOW - Math.random() * SPREAD_MS).toISOString(),
      level: LEVELS[randInt(0, LEVELS.length - 1)],
      service: SERVICES[randInt(0, SERVICES.length - 1)],
      message: MESSAGES[randInt(0, MESSAGES.length - 1)] + " id=" + randInt(1, 999999),
      attributes: {
        user_id: String(randInt(1, 99999)),
        region: REGIONS[randInt(0, REGIONS.length - 1)],
        retries: randInt(0, 3),
      },
    };
  }
  return logs;
}

let accepted = 0;
let sheds = 0;
let failures = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function send(logs) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const res = await fetch(BASE + "/logs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ logs }),
      });

      if (res.status === 200) {
        const body = await res.json();
        accepted += body.accepted ?? 0;
        return;
      }

      await res.text().catch(() => {});

      if (res.status === 503) {
        sheds++;
        await sleep(50 + attempt * 25);
        continue;
      }

      failures++;
      return;
    } catch {
      await sleep(100);
    }
  }
  failures++;
}

async function worker() {
  while (accepted < TARGET) {
    await send(makeBatch(BATCH));
  }
}

async function waitForHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE + "/health");
      if (res.status === 200) return;
    } catch {}
    await sleep(1000);
  }
  throw new Error("service did not become healthy");
}

console.log(`Seeding ${TARGET.toLocaleString()} logs through POST /logs`);
console.log(`Spread over the last ${DAYS_BACK} days, batch size ${BATCH}, concurrency ${CONC}\n`);

await waitForHealth();

const started = Date.now();
const ticker = setInterval(() => {
  const elapsed = (Date.now() - started) / 1000;
  process.stdout.write(`\r  ${accepted.toLocaleString()} / ${TARGET.toLocaleString()}  (${Math.round(accepted / elapsed).toLocaleString()}/s)   `);
}, 2000);

await Promise.all(Array.from({ length: CONC }, worker));

clearInterval(ticker);
const elapsed = (Date.now() - started) / 1000;

console.log(`\n\n  accepted      : ${accepted.toLocaleString()}`);
console.log(`  rate          : ${Math.round(accepted / elapsed).toLocaleString()} logs/s`);
console.log(`  503 retries   : ${sheds}`);
console.log(`  failures      : ${failures}`);
