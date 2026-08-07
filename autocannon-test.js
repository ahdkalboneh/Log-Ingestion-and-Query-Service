// autocannon-test.js
import autocannon from "autocannon";

const BATCH_SIZE = Number(process.env.BATCH_SIZE || 20);
const DURATION = Number(process.env.DURATION || 30);
const CONNECTIONS = Number(process.env.CONNECTIONS || 50);
const URL = process.env.TARGET_URL || 'http://localhost:8080/logs';

function randomPoisonedBatch(size) {
    const poisonMessages = [
        () => `stack trace at C:\\Users\\svc\\app.js:${Math.floor(Math.random() * 500)}`,
        () => `path=/var/log/app\\error.log level="warn"`,
        () => `plain message ${Math.random().toString(36).slice(2)}`,
        () => `json inside: {"key":"val\\"ue"}`,
        () => `windows path C:\\Program Files\\App\\bin\\service.exe crashed`,
    ];

    const logs = Array.from({ length: size }, () => {
        const msgFn = poisonMessages[Math.floor(Math.random() * poisonMessages.length)];
        return {
            timestamp: new Date().toISOString(),
            level: ["info", "warn", "error"][Math.floor(Math.random() * 3)],
            service: "load-test-batch",
            message: msgFn(),
            attributes: { user_id: String(Math.floor(Math.random() * 1000)) },
        };
    });

    return JSON.stringify({ logs });
}

console.log(`Config: batchSize=${BATCH_SIZE}, connections=${CONNECTIONS}, duration=${DURATION}s, url=${URL}`);

autocannon(
    {
        url: URL,
        connections: CONNECTIONS,
        duration: DURATION,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        setupClient: (client) => {
            client.setBody(randomPoisonedBatch(BATCH_SIZE));
        },
    },
    (err, result) => {
        if (err) {
            console.error(err);
            process.exit(1);
        }
        console.log(autocannon.printResult(result));
        console.log('---');

        const successfulRequests = result[Object.keys(result).includes('2xx') ? '2xx' : 'requests'];
        const totalRequests = result.requests.total;
        const estimatedRowsSent = totalRequests * BATCH_SIZE;
        const estimatedRowsPerSec = estimatedRowsSent / result.duration;

        console.log(`p99 latency: ${result.latency.p99}ms`);
        console.log(`errors: ${result.errors}`);
        console.log(`non2xx: ${result.non2xx}`);
        console.log(`total requests: ${totalRequests}`);
        console.log(`batch size: ${BATCH_SIZE}`);
        console.log(`estimated rows sent: ${estimatedRowsSent}`);
        console.log(`estimated rows/sec (request-based): ${estimatedRowsPerSec.toFixed(0)}`);
        console.log('---');
        console.log('NOTE: this is rows *sent*, not rows *stored*.');
        console.log('Run this SQL right after the test to get the real number:');
        console.log(`  SELECT count(*) FROM logs WHERE service='load-test-batch';`);
        console.log('Then: real_rows_stored / test_duration_seconds = true rows/sec');
        console.log(`Exact requests: ${result.requests.total}`);
        console.log(`Expected logs: ${result.requests.total * BATCH_SIZE}`);
    }
);