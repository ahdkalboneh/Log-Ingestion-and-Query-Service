import { randomUUID } from "node:crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type GeneratedLog = {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  attributes: Record<string, string | number | boolean>;
};

const SERVICES = [
  "auth-service",
  "payments-service",
  "orders-service",
  "inventory-service",
  "notifications-service",
  "search-service",
  "recommendation-service",
  "user-profile-service",
  "cart-service",
  "shipping-service",
  "billing-service",
  "analytics-service",
  "gateway-service",
  "media-service",
  "reporting-service",
];

const REGIONS = ["us-east-1", "us-west-2", "eu-west-1", "eu-central-1", "ap-southeast-1"];
const ENVIRONMENTS = ["production", "staging", "canary"];
const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];
const ENDPOINTS = [
  "/api/v1/orders",
  "/api/v1/users",
  "/api/v1/payments",
  "/api/v1/cart",
  "/api/v1/search",
  "/api/v1/inventory",
];
const STATUS_CODES = [200, 201, 204, 400, 401, 403, 404, 409, 429, 500, 502, 503];

const LEVEL_WEIGHTS: Array<{ level: LogLevel; weight: number }> = [
  { level: "debug", weight: 30 },
  { level: "info", weight: 50 },
  { level: "warn", weight: 15 },
  { level: "error", weight: 5 },
];

const MESSAGE_TEMPLATES: Record<LogLevel, string[]> = {
  debug: [
    "Cache lookup for key {key} took {ms}ms",
    "Entering function processRequest with requestId {requestId}",
    "Connection pool size is currently {n}",
    "Serialized payload size: {n} bytes",
  ],
  info: [
    "Request {method} {endpoint} completed in {ms}ms with status {status}",
    "User {userId} logged in successfully",
    "Order {orderId} was created successfully",
    "Scheduled job {job} finished successfully",
    "Health check passed for {service}",
  ],
  warn: [
    "Request {method} {endpoint} took longer than expected: {ms}ms",
    "Retrying operation for order {orderId}, attempt {n}",
    "Rate limit approaching for user {userId}",
    "Deprecated endpoint {endpoint} was called",
  ],
  error: [
    "Request {method} {endpoint} failed with status {status}",
    "Failed to process payment for order {orderId}: timeout",
    "Unhandled exception while processing user {userId}",
    "Database query failed after {n} retries",
  ],
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function weightedLevel(): LogLevel {
  const total = LEVEL_WEIGHTS.reduce((sum, w) => sum + w.weight, 0);
  let roll = Math.random() * total;
  for (const w of LEVEL_WEIGHTS) {
    if (roll < w.weight) return w.level;
    roll -= w.weight;
  }
  return "info";
}

function buildMessage(level: LogLevel): string {
  const template = pick(MESSAGE_TEMPLATES[level]);
  return template
    .replace("{key}", `k_${randInt(1, 99999)}`)
    .replace("{ms}", String(randInt(1, 4000)))
    .replace("{n}", String(randInt(1, 50)))
    .replace("{requestId}", randomUUID())
    .replace("{method}", pick(HTTP_METHODS))
    .replace("{endpoint}", pick(ENDPOINTS))
    .replace("{status}", String(pick(STATUS_CODES)))
    .replace("{userId}", String(randInt(1000, 99999)))
    .replace("{orderId}", String(randInt(100000, 999999)))
    .replace("{job}", pick(["cleanup-job", "billing-sync", "report-export", "cache-warmup"]))
    .replace("{service}", pick(SERVICES));
}

function buildAttributes(): Record<string, string | number | boolean> {
  const pool: Array<[string, () => string | number | boolean]> = [
    ["requestId", () => randomUUID()],
    ["userId", () => randInt(1000, 99999)],
    ["statusCode", () => pick(STATUS_CODES)],
    ["durationMs", () => randInt(1, 4000)],
    ["region", () => pick(REGIONS)],
    ["env", () => pick(ENVIRONMENTS)],
    ["method", () => pick(HTTP_METHODS)],
    ["endpoint", () => pick(ENDPOINTS)],
    ["retries", () => randInt(0, 5)],
    ["cacheHit", () => Math.random() > 0.5],
  ];

  const count = randInt(3, 6);
  const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, count);
  const attrs: Record<string, string | number | boolean> = {};
  for (const [key, gen] of shuffled) {
    attrs[key] = gen();
  }
  return attrs;
}

/**
 * Random timestamp anywhere in the past `daysBack` days, up to "now".
 * Safe for direct DB seeding (bypasses the ingest API's future-timestamp rule).
 */
export function randomPastTimestamp(daysBack: number): string {
  const now = Date.now();
  const past = now - randInt(0, daysBack * 24 * 60 * 60 * 1000);
  return new Date(past).toISOString();
}

/**
 * Random timestamp guaranteed to pass the ingest API's validation rule:
 * "timestamp cannot be more than 5 minutes in the future".
 * Used by the POST /logs load test so requests are never rejected because
 * of an invalid timestamp.
 */
export function recentValidTimestamp(): string {
  const now = Date.now();
  const FOUR_MIN_MS = 4 * 60 * 1000; // stay safely under the 5-minute ceiling
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const offset = randInt(-ONE_HOUR_MS, FOUR_MIN_MS); // up to 1h in the past, up to 4m in the future
  return new Date(now + offset).toISOString();
}

export function generateLog(timestamp: string): GeneratedLog {
  const level = weightedLevel();
  return {
    timestamp,
    level,
    service: pick(SERVICES),
    message: buildMessage(level),
    attributes: buildAttributes(),
  };
}

export function generateLogBatch(count: number, timestampFn: () => string): GeneratedLog[] {
  const batch: GeneratedLog[] = [];
  for (let i = 0; i < count; i++) {
    batch.push(generateLog(timestampFn()));
  }
  return batch;
}

export const SERVICE_NAMES = SERVICES;
export const LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];
