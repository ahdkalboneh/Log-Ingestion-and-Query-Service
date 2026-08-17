/**
 * k6 load test for the Log Ingestion service.
 * Matches the platform benchmark scenarios exactly (Load / Stress / Spike /
 * Breakpoint), sends batches of varying size (1 log up to MAX_BATCH), and
 * varies level/service/message content to simulate realistic traffic.
 *
 * Usage:
 *   k6 run --env BASE_URL=http://localhost:8080 --env SCENARIO=load k6-load-test.js
 *   k6 run --env BASE_URL=http://localhost:8080 --env SCENARIO=stress k6-load-test.js
 *   k6 run --env BASE_URL=http://localhost:8080 --env SCENARIO=spike k6-load-test.js
 *   k6 run --env BASE_URL=http://localhost:8080 --env SCENARIO=breakpoint k6-load-test.js
 *
 * Notes:
 *   - k6's arrival-rate executors are calibrated in *iterations/sec*, but the
 *     targets in the doc are *logs/sec*. This script converts using
 *     AVG_BATCH_SIZE (default 100) -> rate = targetLogsPerSec / AVG_BATCH_SIZE.
 *     Each iteration then picks a random batch size (1..MAX_BATCH), so actual
 *     achieved logs/sec will fluctuate around the target -- check the
 *     `accepted_logs` counter / test duration in the summary for the real
 *     achieved rate, not just the configured arrival rate.
 *   - Raise preAllocatedVUs/maxVUs if k6 logs "insufficient VUs" warnings;
 *     that means the target rate needs more concurrent workers than allotted.
 *   - Correctness checks and eventual-consistency polling are intentionally
 *     NOT part of this script (k6 arrival-rate VUs are not a good fit for
 *     stateful polling loops). Use bench.js for those.
 */

import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const SCENARIO = __ENV.SCENARIO || 'load';
const AVG_BATCH_SIZE = parseInt(__ENV.AVG_BATCH_SIZE || '100', 10);
const MIN_BATCH = parseInt(__ENV.MIN_BATCH || '1', 10);
const MAX_BATCH = parseInt(__ENV.MAX_BATCH || '400', 10);
const PRE_ALLOC_VUS = parseInt(__ENV.PRE_ALLOC_VUS || '100', 10);
const MAX_VUS = parseInt(__ENV.MAX_VUS || '800', 10);

// ---------------------------------------------------------------------------
// Custom metrics (mirrors the platform's result panel naming where possible)
// ---------------------------------------------------------------------------

const acceptedLogs = new Counter('accepted_logs');
const rejectedLogs = new Counter('rejected_logs');
const shedRequests = new Counter('shed_requests'); // 429/503
const httpRequestsCounter = new Counter('http_requests_total');
const batchLatency = new Trend('batch_latency_ms', true);
const httpErrorRate = new Rate('http_error_rate');
const postSuccessRate = new Rate('post_status_success_rate');

// ---------------------------------------------------------------------------
// Log data generation
// ---------------------------------------------------------------------------

const SERVICES = ['checkout', 'auth', 'payments', 'inventory', 'shipping', 'notifications', 'search', 'recommendations'];
const REGIONS = ['eu-west', 'us-east', 'us-west', 'ap-south', 'me-central'];
const MESSAGES = {
  error: ['payment declined', 'connection timeout', 'unhandled exception', 'database write failed', 'upstream 502', 'token expired'],
  warn: ['retrying request', 'slow query detected', 'cache miss rate high', 'deprecated field used', 'rate limit approaching'],
  info: ['request completed', 'user logged in', 'order created', 'cache warmed', 'job scheduled', 'health check ok'],
  debug: ['entering handler', 'query built', 'cache lookup', 'validating payload'],
};

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickLevel() {
  // weighted: debug 10%, info 55%, warn 20%, error 15%
  const r = Math.random();
  if (r < 0.10) return 'debug';
  if (r < 0.65) return 'info';
  if (r < 0.85) return 'warn';
  return 'error';
}

function genLog() {
  const level = pickLevel();
  const service = SERVICES[randInt(0, SERVICES.length - 1)];
  const msgs = MESSAGES[level];
  const message = msgs[randInt(0, msgs.length - 1)];
  return {
    timestamp: new Date(Date.now() - randInt(0, 1500)).toISOString(),
    level,
    service,
    message,
    attributes: {
      user_id: String(randInt(1, 99999)),
      region: REGIONS[randInt(0, REGIONS.length - 1)],
      retries: randInt(0, 3),
      bench_id: `k6-${__VU}-${__ITER}-${Date.now()}`,
    },
  };
}

// Mirrors the "small batches, large batches, even single log" mix
function randomBatchSize() {
  const r = Math.random();
  if (r < 0.10) return 1;
  if (r < 0.60) return randInt(2, Math.min(50, MAX_BATCH));
  if (r < 0.90) return randInt(50, Math.min(200, MAX_BATCH));
  return randInt(Math.min(200, MAX_BATCH), MAX_BATCH);
}

function makeBatch(size) {
  const logs = [];
  for (let i = 0; i < size; i++) logs.push(genLog());
  return logs;
}

// ---------------------------------------------------------------------------
// Scenario -> k6 executor config
// Rates are converted from target logs/sec to target iterations/sec using
// AVG_BATCH_SIZE, since each iteration sends one batch of variable size.
// ---------------------------------------------------------------------------

function toIterRate(logsPerSec) {
  return Math.max(1, Math.round(logsPerSec / AVG_BATCH_SIZE));
}

const SCENARIOS = {
  load: {
    ingest: {
      executor: 'constant-arrival-rate',
      rate: toIterRate(15000),
      timeUnit: '1s',
      duration: '120s',
      preAllocatedVUs: PRE_ALLOC_VUS,
      maxVUs: MAX_VUS,
      exec: 'ingest',
    },
  },
  stress: {
    ingest: {
      executor: 'ramping-arrival-rate',
      startRate: toIterRate(15000),
      timeUnit: '1s',
      preAllocatedVUs: PRE_ALLOC_VUS,
      maxVUs: MAX_VUS,
      stages: [
        { target: toIterRate(15000), duration: '30s' },
        { target: toIterRate(22500), duration: '60s' },
        { target: toIterRate(30000), duration: '60s' },
      ],
      exec: 'ingest',
    },
  },
  spike: {
    ingest: {
      executor: 'ramping-arrival-rate',
      startRate: toIterRate(7500),
      timeUnit: '1s',
      preAllocatedVUs: PRE_ALLOC_VUS,
      maxVUs: MAX_VUS,
      stages: [
        { target: toIterRate(7500), duration: '30s' },
        { target: toIterRate(30000), duration: '10s' },
        { target: toIterRate(7500), duration: '60s' },
      ],
      exec: 'ingest',
    },
  },
  breakpoint: {
    ingest: {
      executor: 'ramping-arrival-rate',
      startRate: toIterRate(15000),
      timeUnit: '1s',
      preAllocatedVUs: PRE_ALLOC_VUS,
      maxVUs: MAX_VUS,
      stages: [
        { target: toIterRate(15000), duration: '30s' },
        { target: toIterRate(22500), duration: '30s' },
        { target: toIterRate(30000), duration: '30s' },
        { target: toIterRate(45000), duration: '30s' },
      ],
      exec: 'ingest',
    },
  },
};

// A low-rate scenario that keeps hitting the aggregate endpoint once/sec
// throughout the ingest scenario, to check query performance stays <1s p95
// while ingestion is active (matches the "1 aggregation request per second"
// requirement).
const aggregateProbeDurationSec = { load: 120, stress: 150, spike: 100, breakpoint: 120 }[SCENARIO] || 120;

SCENARIOS[SCENARIO].aggregate_probe = {
  executor: 'constant-arrival-rate',
  rate: 1,
  timeUnit: '1s',
  duration: `${aggregateProbeDurationSec}s`,
  preAllocatedVUs: 5,
  maxVUs: 20,
  exec: 'aggregateProbe',
};

export const options = {
  scenarios: SCENARIOS[SCENARIO],
  thresholds: {
    http_error_rate: ['rate<0.01'],
    'batch_latency_ms{scenario:ingest}': ['p(95)<2000'],
    // Primary aggregation query target: p95 under 1s
    'aggregate_latency_ms': ['p(95)<1000'],
  },
};

// ---------------------------------------------------------------------------
// VU functions
// ---------------------------------------------------------------------------

export function ingest() {
  const size = randomBatchSize();
  const batch = makeBatch(size);

  const res = http.post(`${BASE_URL}/logs`, JSON.stringify({ logs: batch }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { scenario: 'ingest' },
  });

  httpRequestsCounter.add(1);
  batchLatency.add(res.timings.duration, { scenario: 'ingest' });

  if (res.status === 429 || res.status === 503) {
    shedRequests.add(1);
    postSuccessRate.add(false);
    return;
  }

  const ok = check(res, { 'status is 2xx': (r) => r.status >= 200 && r.status < 300 });
  httpErrorRate.add(!ok);
  postSuccessRate.add(ok);

  if (ok) {
    let rejected = 0;
    try {
      const body = JSON.parse(res.body);
      rejected = Array.isArray(body.rejected) ? body.rejected.length : (body.rejected_count || 0);
    } catch (e) {
      // non-JSON body on success is itself worth flagging
    }
    rejectedLogs.add(rejected);
    acceptedLogs.add(Math.max(0, size - rejected));
  }
}

const aggregateLatency = new Trend('aggregate_latency_ms', true);

export function aggregateProbe() {
  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const until = new Date().toISOString();
  const res = http.get(`${BASE_URL}/logs/aggregate?since=${since}&until=${until}&bucket=1m`, {
    tags: { scenario: 'aggregate_probe' },
  });
  aggregateLatency.add(res.timings.duration);
  check(res, {
    'aggregate status 200': (r) => r.status === 200,
    'aggregate has buckets array': (r) => {
      try {
        return Array.isArray(JSON.parse(r.body).buckets);
      } catch (e) {
        return false;
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export function handleSummary(data) {
  const m = data.metrics;
  const durationSec = data.state.testRunDurationMs / 1000;
  const accepted = m.accepted_logs ? m.accepted_logs.values.count : 0;
  const achievedLogsPerSec = (accepted / durationSec).toFixed(2);

  const summaryText = `
================ RESULTS: ${SCENARIO} ================
Duration:                ${durationSec.toFixed(1)}s
HTTP requests:            ${m.http_requests_total ? m.http_requests_total.values.count : 0}
Accepted logs:             ${accepted}
Rejected logs:              ${m.rejected_logs ? m.rejected_logs.values.count : 0}
Shed (429/503):              ${m.shed_requests ? m.shed_requests.values.count : 0}
Achieved logs/sec:        ${achievedLogsPerSec}  (target varies by stage, see scenario config)
Batch latency p95 (ms):   ${m.batch_latency_ms ? m.batch_latency_ms.values['p(95)'].toFixed(2) : 'n/a'}
Aggregate latency p95 ms: ${m.aggregate_latency_ms ? m.aggregate_latency_ms.values['p(95)'].toFixed(2) : 'n/a'}
HTTP error rate:          ${m.http_error_rate ? (m.http_error_rate.values.rate * 100).toFixed(2) : '0.00'}%
=========================================================
`;

  return {
    stdout: summaryText,
    [`k6-summary-${SCENARIO}.json`]: JSON.stringify(data, null, 2),
  };
}