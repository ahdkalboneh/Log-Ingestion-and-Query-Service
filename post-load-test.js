import autocannon from "autocannon";

const logs = Array.from({ length: 500 }, (_, i) => ({
  timestamp: new Date().toISOString(),
  level: "error",
  service: "checkout",
  message: `payment declined ${i}`,
  attributes: {
    user_id: `${i}`,
    region: "eu-west",
    retries: 3
  }
}));

const instance = autocannon(
  {
    url: "http://localhost:8080/logs",
    method: "POST",
    connections: 16,
    duration: 60,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      logs
    })
  },
  (err, result) => {
    if (err) {
      console.error(err);
      return;
    }

    console.log("\n========== RESULTS ==========");
    console.log("Requests/sec:", result.requests.average);
    console.log("Errors:", result.errors);
    console.log("Timeouts:", result.timeouts);

    const logsPerSecond = result.requests.average * 500;

    console.log("Logs/sec:", logsPerSecond);

    if (logsPerSecond >= 15000) {
      console.log("✅ PASS: Above 15k logs/sec requirement");
    } else {
      console.log("❌ FAIL: Below 15k logs/sec requirement");
    }
  }
);

autocannon.track(instance);
