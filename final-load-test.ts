import autocannon from "autocannon";

const BASE_URL = process.env.BASE_URL || "http://localhost:8080";

const INGEST_CONNECTIONS = Number(process.env.INGEST_CONNECTIONS || 16);
const INGEST_DURATION = Number(process.env.INGEST_DURATION || 60);
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 500);

const QUERY_CONNECTIONS = Number(process.env.QUERY_CONNECTIONS || 20);
const QUERY_DURATION = Number(process.env.QUERY_DURATION || 60);

const AGG_CONNECTIONS = Number(process.env.AGG_CONNECTIONS || 1);
const AGG_DURATION = Number(process.env.AGG_DURATION || 60);

const TARGET_LOGS_PER_SEC = 15000;
const TARGET_P95_MS = 1000;

type TestResult = {
  name: string;
  pass: boolean;
  details: string;
};

const results: TestResult[] = [];

function addResult(
  name: string,
  pass: boolean,
  details: string
) {
  results.push({ name, pass, details });

  console.log(
    `${pass ? "✅ PASS" : "❌ FAIL"} ${name}`
  );

  console.log(`   ${details}\n`);
}

function getP95(latency: any): number {
  // autocannon exposes an HDR histogram.
  // percentile(95) gives us the actual p95.
  if (typeof latency.percentile === "function") {
    return latency.percentile(95);
  }

  // Fallback only if percentile() is unavailable.
  // This is an interpolation between p90 and p97.5.
  const p90 = latency.p90;
  const p975 = latency.p97_5;

  if (
    typeof p90 === "number" &&
    typeof p975 === "number"
  ) {
    return p90 + (p975 - p90) * ((95 - 90) / (97.5 - 90));
  }

  return NaN;
}

function runAutocannon(
  options: autocannon.Options
): Promise<any> {
  return new Promise((resolve, reject) => {
    const instance = autocannon(options, (err, result) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(result);
    });

    autocannon.track(instance, {
      renderProgressBar: true,
      renderResultsTable: true,
    });
  });
}

async function checkHealth() {
  console.log("\n========================================");
  console.log("0. HEALTH CHECK");
  console.log("========================================\n");

  const start = Date.now();

  try {
    const response = await fetch(`${BASE_URL}/health`);
    const elapsed = Date.now() - start;

    addResult(
      "Application health",
      response.ok,
      `HTTP ${response.status}, ${elapsed}ms`
    );

    return response.ok;
  } catch (error) {
    addResult(
      "Application health",
      false,
      `Cannot connect to ${BASE_URL}`
    );

    return false;
  }
}

async function checkStoredRecords() {
  console.log("\n========================================");
  console.log("1. STORED RECORDS");
  console.log("========================================\n");

  console.log(
    "This test expects the database to already contain approximately 1,000,000 rows."
  );

  console.log(
    "Check PostgreSQL manually with:"
  );

  console.log(`
SELECT COUNT(*) FROM logs;
`);

  console.log(
    "After running the query, compare the count with ~1,000,000."
  );
}

async function testIngestion() {
  console.log("\n========================================");
  console.log("2. POST /logs THROUGHPUT");
  console.log("========================================\n");

  console.log(`URL: ${BASE_URL}/logs`);
  console.log(`Connections: ${INGEST_CONNECTIONS}`);
  console.log(`Duration: ${INGEST_DURATION}s`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Target: >= ${TARGET_LOGS_PER_SEC} logs/sec\n`);

  const timestamp = new Date().toISOString();

  const logs = Array.from(
    { length: BATCH_SIZE },
    (_, i) => ({
      timestamp,
      level: "info",
      service: "load-test-service",
      message: `load-test-${Date.now()}-${i}`,
      attributes: {
        test: true,
        testId: "final-load-test",
      },
    })
  );

  const body = JSON.stringify({ logs });

  const result = await runAutocannon({
    url: `${BASE_URL}/logs`,
    method: "POST",
    connections: INGEST_CONNECTIONS,
    duration: INGEST_DURATION,

    headers: {
      "content-type": "application/json",
    },

    body,
  });

  const requestsPerSec = result.requests.average;

  const logsPerSec = requestsPerSec * BATCH_SIZE;

  const errors = result.errors;
  const timeouts = result.timeouts;
  const non2xx = result.non2xx;

  const p95 = getP95(result.latency);

  console.log("\nPOST RESULTS");
  console.log("----------------------------------------");
  console.log(`Requests/sec: ${requestsPerSec.toFixed(2)}`);
  console.log(`Logs/sec:     ${logsPerSec.toFixed(2)}`);
  console.log(`p50:          ${result.latency.p50} ms`);
  console.log(`p95:          ${p95.toFixed(2)} ms`);
  console.log(`p99:          ${result.latency.p99} ms`);
  console.log(`Max:          ${result.latency.max} ms`);
  console.log(`Errors:       ${errors}`);
  console.log(`Timeouts:     ${timeouts}`);
  console.log(`Non-2xx:      ${non2xx}`);

  addResult(
    "Sustained ingestion >= 15,000 logs/sec",
    logsPerSec >= TARGET_LOGS_PER_SEC,
    `${logsPerSec.toFixed(2)} logs/sec`
  );

  addResult(
    "No dropped/error requests during ingestion",
    errors === 0 &&
      timeouts === 0 &&
      non2xx === 0,
    `errors=${errors}, timeouts=${timeouts}, non2xx=${non2xx}`
  );

  return result;
}

async function testGetLogs() {
  console.log("\n========================================");
  console.log("3. GET /logs");
  console.log("========================================\n");

  const url =
    `${BASE_URL}/logs?service=load-test-service&limit=50`;

  console.log(`URL: ${url}`);
  console.log(`Connections: ${QUERY_CONNECTIONS}`);
  console.log(`Duration: ${QUERY_DURATION}s`);
  console.log(`Target p95: < ${TARGET_P95_MS}ms\n`);

  const result = await runAutocannon({
    url,
    method: "GET",
    connections: QUERY_CONNECTIONS,
    duration: QUERY_DURATION,
  });

  const p95 = getP95(result.latency);

  console.log("\nGET RESULTS");
  console.log("----------------------------------------");
  console.log(`Requests/sec: ${result.requests.average.toFixed(2)}`);
  console.log(`p50:          ${result.latency.p50} ms`);
  console.log(`p95:          ${p95.toFixed(2)} ms`);
  console.log(`p99:          ${result.latency.p99} ms`);
  console.log(`Max:          ${result.latency.max} ms`);
  console.log(`Errors:       ${result.errors}`);
  console.log(`Timeouts:     ${result.timeouts}`);
  console.log(`Non-2xx:      ${result.non2xx}`);

  addResult(
    "GET /logs p95 < 1 second",
    p95 < TARGET_P95_MS &&
      result.errors === 0 &&
      result.timeouts === 0 &&
      result.non2xx === 0,
    `p95=${p95.toFixed(2)}ms`
  );

  return result;
}

async function testAggregation() {
  console.log("\n========================================");
  console.log("4. GET /logs/aggregate");
  console.log("========================================\n");

  const since = "2026-08-07T21:00:00Z";
  const until = "2026-08-07T21:05:00Z";

  const url =
    `${BASE_URL}/logs/aggregate` +
    `?since=${since}` +
    `&until=${until}` +
    `&bucket=1m` +
    `&group_by=service`;

  console.log(`URL: ${url}`);
  console.log(`Connections: ${AGG_CONNECTIONS}`);
  console.log(`Duration: ${AGG_DURATION}s`);
  console.log(`Target p95: < ${TARGET_P95_MS}ms\n`);

  const result = await runAutocannon({
    url,
    method: "GET",
    connections: AGG_CONNECTIONS,
    duration: AGG_DURATION,
  });

  const p95 = getP95(result.latency);

  console.log("\nAGGREGATION RESULTS");
  console.log("----------------------------------------");
  console.log(`Requests/sec: ${result.requests.average.toFixed(2)}`);
  console.log(`p50:          ${result.latency.p50} ms`);
  console.log(`p95:          ${p95.toFixed(2)} ms`);
  console.log(`p99:          ${result.latency.p99} ms`);
  console.log(`Max:          ${result.latency.max} ms`);
  console.log(`Errors:       ${result.errors}`);
  console.log(`Timeouts:     ${result.timeouts}`);
  console.log(`Non-2xx:      ${result.non2xx}`);

  addResult(
    "Aggregation p95 < 1 second",
    p95 < TARGET_P95_MS &&
      result.errors === 0 &&
      result.timeouts === 0 &&
      result.non2xx === 0,
    `p95=${p95.toFixed(2)}ms`
  );

  return result;
}

async function testVisibility() {
  console.log("\n========================================");
  console.log("5. NEW DATA VISIBILITY");
  console.log("========================================\n");

  const testId = `visibility-${Date.now()}`;

  const log = {
    timestamp: new Date().toISOString(),
    level: "info",
    service: "visibility-test",
    message: "NEW_LOG_VISIBILITY_TEST",
    attributes: {
      testId,
    },
  };

  const start = Date.now();

  const postResponse = await fetch(
    `${BASE_URL}/logs`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(log),
    }
  );

  if (!postResponse.ok) {
    addResult(
      "New data queryable within 20 seconds",
      false,
      `POST failed with HTTP ${postResponse.status}`
    );

    return;
  }

  let found = false;
  let elapsed = 0;

  while (elapsed < 20_000) {
    const response = await fetch(
      `${BASE_URL}/logs?service=visibility-test&limit=50`
    );

    if (response.ok) {
      const data = await response.json();

      const logs = data.logs || [];

      found = logs.some(
        (item: any) =>
          item.attributes?.testId === testId
      );

      if (found) {
        elapsed = Date.now() - start;
        break;
      }
    }

    await new Promise((resolve) =>
      setTimeout(resolve, 250)
    );

    elapsed = Date.now() - start;
  }

  addResult(
    "New data queryable within 20 seconds",
    found && elapsed <= 20_000,
    found
      ? `${elapsed}ms`
      : "Not visible within 20 seconds"
  );
}

async function testAggregationAvailabilityDuringIngestion() {
  console.log("\n========================================");
  console.log("6. AGGREGATION DURING INGESTION");
  console.log("========================================\n");

  console.log(
    "This test runs POST ingestion and aggregation concurrently."
  );

  console.log(
    "Requirement: aggregation must remain available during ingestion."
  );

  const timestamp = new Date().toISOString();

  const logs = Array.from(
    { length: BATCH_SIZE },
    (_, i) => ({
      timestamp,
      level: "info",
      service: "concurrent-ingestion",
      message: `concurrent-${Date.now()}-${i}`,
      attributes: {
        test: true,
      },
    })
  );

  const body = JSON.stringify({ logs });

  const ingestPromise = runAutocannon({
    url: `${BASE_URL}/logs`,
    method: "POST",
    connections: INGEST_CONNECTIONS,
    duration: INGEST_DURATION,
    headers: {
      "content-type": "application/json",
    },
    body,
  });

  // One aggregation request at a time.
  // This matches the requirement:
  // "Support one aggregation request per second during ingestion."
  const aggregationLatencies: number[] = [];
  let aggregationErrors = 0;

  const endAt =
    Date.now() + INGEST_DURATION * 1000;

  while (Date.now() < endAt) {
    const start = performance.now();

    try {
      const response = await fetch(
        `${BASE_URL}/logs/aggregate` +
        `?since=2026-08-07T21:00:00Z` +
        `&until=2026-08-07T21:05:00Z` +
        `&bucket=1m` +
        `&group_by=service`
      );

      const elapsed =
        performance.now() - start;

      aggregationLatencies.push(elapsed);

      if (!response.ok) {
        aggregationErrors++;
      }
    } catch {
      aggregationErrors++;
    }

    // approximately one aggregation request / second
    await new Promise((resolve) =>
      setTimeout(resolve, 1000)
    );
  }

  const ingestResult = await ingestPromise;

  aggregationLatencies.sort(
    (a, b) => a - b
  );

  const p95Index =
    Math.ceil(aggregationLatencies.length * 0.95) - 1;

  const aggregationP95 =
    aggregationLatencies[
      Math.max(0, p95Index)
    ] ?? Infinity;

  const ingestionLogsPerSec =
    ingestResult.requests.average * BATCH_SIZE;

  console.log("\nCONCURRENT TEST RESULTS");
  console.log("----------------------------------------");

  console.log(
    `Ingestion: ${ingestionLogsPerSec.toFixed(2)} logs/sec`
  );

  console.log(
    `Aggregation requests: ${aggregationLatencies.length}`
  );

  console.log(
    `Aggregation p95: ${aggregationP95.toFixed(2)} ms`
  );

  console.log(
    `Aggregation errors: ${aggregationErrors}`
  );

  console.log(
    `Ingestion errors: ${ingestResult.errors}`
  );

  console.log(
    `Ingestion timeouts: ${ingestResult.timeouts}`
  );

  addResult(
    "15k logs/sec maintained while aggregation runs",
    ingestionLogsPerSec >= TARGET_LOGS_PER_SEC,
    `${ingestionLogsPerSec.toFixed(2)} logs/sec`
  );

  addResult(
    "Aggregation available during ingestion",
    aggregationErrors === 0 &&
      aggregationP95 < TARGET_P95_MS,
    `aggregation p95=${aggregationP95.toFixed(2)}ms, errors=${aggregationErrors}`
  );

  addResult(
    "No ingestion errors during concurrent test",
    ingestResult.errors === 0 &&
      ingestResult.timeouts === 0 &&
      ingestResult.non2xx === 0,
    `errors=${ingestResult.errors}, timeouts=${ingestResult.timeouts}, non2xx=${ingestResult.non2xx}`
  );
}

async function main() {
  console.log("\n");
  console.log("################################################");
  console.log("# LOG INGESTION SERVICE - FINAL LOAD TEST");
  console.log("################################################");
  console.log(`BASE_URL: ${BASE_URL}`);
  console.log("\n");

  const healthy = await checkHealth();

  if (!healthy) {
    console.log(
      "\n❌ Application is not reachable. Aborting."
    );

    process.exit(1);
  }

  await checkStoredRecords();

  /*
   * IMPORTANT:
   *
   * The database should already contain approximately
   * 1,000,000 records from your seed generator.
   */

  await testIngestion();

  await testGetLogs();

  await testAggregation();

  await testVisibility();

  await testAggregationAvailabilityDuringIngestion();

  console.log("\n");
  console.log("################################################");
  console.log("# FINAL REPORT");
  console.log("################################################");
  console.log("\n");

  for (const result of results) {
    console.log(
      `${result.pass ? "✅ PASS" : "❌ FAIL"} ${result.name}`
    );

    console.log(
      `   ${result.details}`
    );
  }

  const passed =
    results.filter((r) => r.pass).length;

  const failed =
    results.filter((r) => !r.pass).length;

  console.log("\n----------------------------------------");

  console.log(
    `Passed: ${passed}`
  );

  console.log(
    `Failed: ${failed}`
  );

  console.log("----------------------------------------");

  if (failed === 0) {
    console.log(
      "\n🎉 FINAL RESULT: PASS"
    );
  } else {
    console.log(
      "\n❌ FINAL RESULT: FAIL"
    );

    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    "\n❌ LOAD TEST CRASHED:"
  );

  console.error(error);

  process.exit(1);
});
