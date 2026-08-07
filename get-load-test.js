import autocannon from "autocannon";

const instance = autocannon(
  {
    url: "http://localhost:8080",
    connections: 16,
    duration: 60,

    requests: [
      {
        method: "GET",
        path: "/logs?limit=100",
      },
      {
        method: "GET",
        path: "/logs?level=error&limit=100",
      },
      {
        method: "GET",
        path: "/logs?service=checkout&limit=100",
      },
      {
        method: "GET",
        path: "/logs?since=2026-08-07T00:00:00Z&limit=100",
      }
    ]
  },
  (err, result) => {
    if (err) {
      console.error(err);
      return;
    }

    console.log("\n========== GET RESULTS ==========");
    console.log("Requests/sec:", result.requests.average);
    console.log("Errors:", result.errors);
    console.log("Timeouts:", result.timeouts);

    console.log("\nLatency:");
    console.log("p50:", result.latency.p50, "ms");
    console.log("p95:", result.latency.p95, "ms");
    console.log("p97.5:", result.latency.p97_5, "ms");
    console.log("p99:", result.latency.p99, "ms");
    console.log("max:", result.latency.max, "ms");
  }
);

autocannon.track(instance);
