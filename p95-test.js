import http from "node:http";
import { URL } from "node:url";

const BASE_URL = process.env.TARGET_URL || 'http://localhost:8080';
const CONNECTIONS = Number(process.env.CONNECTIONS || 20);
const DURATION_SEC = Number(process.env.DURATION || 30);
const LIMIT = Number(process.env.LIMIT || 50);

const services = ['load-test-batch', 'load-test', 'api', 'debug-test'];
const levels = ['info', 'warn', 'error'];

function randomPath() {
    const service = services[Math.floor(Math.random() * services.length)];
    const level = levels[Math.floor(Math.random() * levels.length)];
    const useFilter = Math.random() > 0.5;
    if (useFilter) {
        return `/logs?service=${encodeURIComponent(service)}&level=${encodeURIComponent(level)}&limit=${LIMIT}`;
    }
    return `/logs?limit=${LIMIT}`;
}

const latencies = [];
let success = 0;
let failed = 0;
let running = true;

function doRequest() {
    return new Promise((resolve) => {
        const path = randomPath();
        const url = new URL(BASE_URL + path);
        const start = process.hrtime.bigint();

        const req = http.get(
            {
                hostname: url.hostname,
                port: url.port,
                path: url.pathname + url.search,
                timeout: 10000,
            },
            (res) => {
                res.on('data', () => {}); // drain
                res.on('end', () => {
                    const end = process.hrtime.bigint();
                    const ms = Number(end - start) / 1e6;
                    latencies.push(ms);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        success++;
                    } else {
                        failed++;
                    }
                    resolve();
                });
            }
        );

        req.on('error', () => {
            failed++;
            resolve();
        });
        req.on('timeout', () => {
            req.destroy();
            failed++;
            resolve();
        });
    });
}

async function worker() {
    while (running) {
        await doRequest();
    }
}

function percentile(sortedArr, p) {
    if (sortedArr.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sortedArr.length) - 1;
    return sortedArr[Math.max(0, Math.min(idx, sortedArr.length - 1))];
}

async function main() {
    console.log(`Config: connections=${CONNECTIONS}, duration=${DURATION_SEC}s, url=${BASE_URL}/logs, limit=${LIMIT}`);
    console.log('Mixing filtered (service+level) and unfiltered queries.\n');
    console.log('Running...');

    const workers = Array.from({ length: CONNECTIONS }, () => worker());

    setTimeout(() => {
        running = false;
    }, DURATION_SEC * 1000);

    await Promise.race([
        Promise.all(workers),
        new Promise((resolve) => setTimeout(resolve, DURATION_SEC * 1000 + 15000)),
    ]);

    running = false;

    const sorted = [...latencies].sort((a, b) => a - b);
    const total = success + failed;

    console.log('\n=== RESULTS ===');
    console.log(`Total requests: ${total}`);
    console.log(`Successful (2xx): ${success}`);
    console.log(`Failed/non-2xx: ${failed}`);
    console.log(`Requests/sec (avg): ${(total / DURATION_SEC).toFixed(1)}`);
    console.log('');
    console.log(`p50 latency: ${percentile(sorted, 50).toFixed(1)}ms`);
    console.log(`p90 latency: ${percentile(sorted, 90).toFixed(1)}ms`);
    console.log(`p95 latency: ${percentile(sorted, 95).toFixed(1)}ms  <-- TARGET METRIC`);
    console.log(`p99 latency: ${percentile(sorted, 99).toFixed(1)}ms`);
    console.log(`max latency: ${sorted.length ? sorted[sorted.length - 1].toFixed(1) : 0}ms`);
    console.log('');
    const p95 = percentile(sorted, 95);
    console.log(`TARGET: p95 < 1000ms  =>  ${p95 < 1000 ? 'PASS ✅' : 'FAIL ❌'} (${p95.toFixed(1)}ms)`);

    process.exit(failed > total * 0.5 ? 1 : 0);
}

main();