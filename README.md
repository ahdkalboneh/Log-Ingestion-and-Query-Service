# Logs Service

A lightweight, high-throughput log ingestion and query service built with **Express**, **TypeScript**, **PostgreSQL**, and **Drizzle ORM**.

The service is designed to handle large volumes of structured logs efficiently using:

* In-memory buffering and batched `COPY` writes
* PostgreSQL daily range partitioning
* Cursor-based/keyset pagination
* Time-bucketed log aggregation
* JSONB attributes for structured metadata
* Automatic partition management
* Configurable log retention with partition dropping
* Health monitoring and database connectivity checks

---

## Tech Stack

* **Node.js**
* **TypeScript**
* **Express**
* **PostgreSQL 16**
* **Drizzle ORM**
* **Docker & Docker Compose**

---

## Features

### High-Throughput Ingestion

Logs are first queued in an in-memory buffer and flushed in batches using PostgreSQL `COPY ... FROM STDIN`.

This significantly reduces the overhead of individual `INSERT` statements and allows the service to handle high ingestion rates.

### Flexible Querying

The `/logs` endpoint supports filtering by:

* Service
* Log level
* Time range
* Message content
* JSONB attributes

Pagination uses stable cursor-based pagination instead of `OFFSET`, allowing consistent performance even when navigating through deep pages.

### PostgreSQL Partitioning

The `logs` table is partitioned by day using PostgreSQL `RANGE` partitioning on the log timestamp.

Daily partitions allow PostgreSQL to prune irrelevant partitions for time-bounded queries.

A `logs_default` partition is also used as a fallback for timestamps that do not currently match an existing partition.

### Automatic Retention

A background retention worker:

1. Creates the current and upcoming daily partitions.
2. Detects partitions older than the configured retention period.
3. Drops expired partitions using `DROP TABLE`.

Dropping entire partitions is considerably more efficient than deleting millions of rows individually.

### Time-Bucketed Aggregation

The service optionally provides aggregation queries using PostgreSQL `date_bin`.

Supported bucket sizes:

* `1m`
* `5m`
* `1h`
* `1d`

Aggregation can optionally be grouped by:

* `service`
* `level`

---

# Setup

## Prerequisites

### Recommended

* Docker
* Docker Compose

---

## Running with Docker Compose

Start the application and PostgreSQL:

```bash
docker compose up --build
```

The services will be available at:

```text
API Server: http://localhost:8080
PostgreSQL: localhost:5433
```

The PostgreSQL container is configured for write-heavy workloads with settings such as:

* `synchronous_commit=off`
* Expanded WAL configuration
* Tuned memory/write settings

### Apply the Initial Migration

After the containers are running:

```bash
npx drizzle-kit migrate
```

---

# Environment Variables

| Variable                      |   Default | Description                    |
| ----------------------------- | --------: | ------------------------------ |
| `DATABASE_URL`                |         — | PostgreSQL connection string   |
| `PORT`                        |    `8080` | API server port                |
| `RETENTION_DAYS`              |      `30` | Number of days to retain logs  |
| `RETENTION_CHECK_INTERVAL_MS` | `3600000` | Retention maintenance interval |

Example:

```bash
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/logs_db
export PORT=8080
export RETENTION_DAYS=30
export RETENTION_CHECK_INTERVAL_MS=3600000
```

---

# API Documentation
# `GET /health`

Health check endpoint.

The endpoint verifies that the application is running and that the database connection is available.

### Healthy Response

```http
200 OK
```

```json
{
  "status": "ok"
}
```

### Unhealthy Response

```http
503 Service Unavailable
```

```json
{
  "status": "unhealthy"
}
```
---

## `POST /logs`

Bulk-ingest log records.

Incoming records are validated and queued in memory for batch processing.

### Request

```json
{
  "logs": [
    {
      "timestamp": "2026-08-13T10:00:00Z",
      "level": "info",
      "service": "auth-service",
      "message": "User logged in",
      "attributes": {
        "userId": "123",
        "success": true
      }
    }
  ]
}
```

### Validation Rules

#### `level`

Must be one of:

```text
debug
info
warn
error
```

#### `timestamp`

* Must be a valid ISO 8601 timestamp.
* Cannot be more than 5 minutes in the future.

#### `service`

* Required
* Must be a non-empty string
* Maximum length: 64 characters

#### `message`

* Required
* Must be a non-empty string

#### `attributes`

Optional flat JSON object containing only:

* Strings
* Numbers
* Booleans

Nested objects and arrays are not supported.

### Response

```json
{
  "accepted": 1,
  "rejected": [
    {
      "index": 3,
      "reason": "Invalid Level, Must be debug, info, warn, or error."
    }
  ]
}
```

---

# `GET /logs`

Query stored logs using filters and cursor-based pagination.

## Query Parameters

| Parameter    | Type       | Description                                    |
| ------------ | ---------- | ---------------------------------------------- |
| `service`    | String     | Filter by exact service name                   |
| `level`      | String     | Filter by `debug`, `info`, `warn`, or `error`  |
| `since`      | ISO String | Lower time bound                               |
| `until`      | ISO String | Upper time bound                               |
| `q`          | String     | Case-insensitive substring search in `message` |
| `attr.<key>` | Primitive  | Filter a JSONB attribute                       |
| `limit`      | Integer    | Number of logs to return, from 1–1000          |
| `cursor`     | String     | Opaque cursor returned by the previous request |

`limit` defaults to `100`.

### Example

```http
GET /logs?service=auth-service&level=error&limit=100
```

Attribute filtering:

```http
GET /logs?service=auth-service&attr.userId=123
```

Message search:

```http
GET /logs?q=connection%20failed
```

Time range:

```http
GET /logs?since=2026-08-13T00:00:00Z&until=2026-08-14T00:00:00Z
```

### Response

```json
{
  "logs": [
    {
      "id": 123,
      "timestamp": "2026-08-13T10:00:00Z",
      "level": "info",
      "service": "auth-service",
      "message": "User logged in",
      "attributes": {
        "userId": "123",
        "success": true
      }
    }
  ],
  "next_cursor": "eyJpZCI6MTIzLCJ0aW1lc3RhbXAiOiIuLi4ifQ=="
}
```

If there are no additional results, `next_cursor` is omitted or `null`.

---

# Aggregation API

The service also supports time-bucketed aggregation of log frequency.

Supported bucket sizes:

```text
1m
5m
1h
1d
```

Aggregation can optionally be grouped by:

```text
service
level
```

The aggregation functionality is enabled by default through the routing layer.

The implementation uses PostgreSQL `date_bin` for time bucketing.

To disable aggregation, remove or comment out the aggregation route definition in:

```text
logs_routes.ts
```

---

# Database Design

## Logs Table

```sql
CREATE TABLE "logs" (
    "id"          bigint GENERATED ALWAYS AS IDENTITY,
    "timestamp"   timestamptz NOT NULL,
    "level"       text NOT NULL,
    "service"     text NOT NULL,
    "message"     text NOT NULL,
    "attributes"  jsonb DEFAULT '{}'::jsonb,
    "created_at"  timestamptz DEFAULT now(),
    PRIMARY KEY ("timestamp", "id")
) PARTITION BY RANGE ("timestamp");
```

The table is partitioned by:

```text
timestamp
```

using PostgreSQL `RANGE` partitioning.

---

# Partitioning Strategy

Logs are stored in daily partitions following the naming convention:

```text
logs_pYYYY_MM_DD
```

For example:

```text
logs_p2026_08_13
logs_p2026_08_14
logs_p2026_08_15
```

A `logs_default` partition is maintained as a fallback for timestamps that do not match an existing partition.

The retention worker continuously ensures that the current and upcoming partitions exist.

---

# Indexing Strategy

A composite index is created across the partitions:

```sql
CREATE INDEX idx_logs_composite
ON logs (service, level, timestamp DESC, id DESC);
```

This index is designed to efficiently support queries combining:

* Exact `service` filtering
* Exact `level` filtering
* Timestamp range filtering
* Deterministic ordering
* Cursor-based pagination

The `(timestamp, id)` ordering also provides a stable ordering when multiple logs share the same timestamp.

---

# Cursor-Based Pagination

The API uses keyset pagination rather than `OFFSET`.

Instead of asking PostgreSQL to skip a growing number of rows, the next query starts from the last `(timestamp, id)` pair returned by the previous page.

Conceptually:

```text
(timestamp, id) < last_cursor
```

This avoids increasingly expensive `OFFSET` scans and keeps pagination performance stable as the dataset grows.

The cursor is returned to the client as an opaque Base64-encoded value.

---

# JSONB Attributes

Dynamic metadata is stored in a single PostgreSQL `JSONB` column:

```json
{
  "userId": "123",
  "success": true,
  "region": "eu-west"
}
```

Attribute queries use PostgreSQL JSONB operators.

For example:

```text
attr.userId=123
```

is translated into an operation equivalent to:

```sql
attributes ->> 'userId' = '123'
```

The ingestion layer strictly validates attributes as flat primitive key-value pairs.

This keeps the structure predictable and limits the memory and query overhead associated with arbitrary nested JSON.

---

# Retention Strategy

Log retention is handled automatically by a background worker.

The retention process performs two main tasks:

### 1. Partition Pre-Creation

The worker maintains partitions for:

* The current day
* Upcoming days

### 2. Expired Partition Removal

Partitions older than `RETENTION_DAYS` are removed using:

```sql
DROP TABLE
```

This is preferred over:

```sql
DELETE FROM logs
WHERE timestamp < ...
```

because deleting large amounts of data can generate significant I/O, WAL traffic, and table/index bloat.

Dropping an entire partition removes the data much more efficiently.

---

# Performance

The service is optimized around high-throughput ingestion and scalable querying.

### Ingestion

Instead of executing an SQL insert for every individual log, incoming logs are:

```text
HTTP requests
      ↓
Validation
      ↓
In-memory buffer
      ↓
Batch flush
      ↓
PostgreSQL COPY
```

This reduces database round trips and SQL statement overhead.

### Query Performance

Keyset pagination avoids the performance degradation associated with deep `OFFSET` pagination.

### Partition Pruning

Time-bounded queries allow PostgreSQL to prune irrelevant daily partitions, reducing the amount of data that needs to be scanned.

### Measured Performance

The implementation achieves high-throughput ingestion through buffered batch writes and PostgreSQL `COPY`.

Performance can vary depending on:

* CPU and memory limits
* PostgreSQL configuration
* Batch size
* Concurrent clients
* Dataset size
* Query complexity
* Docker/container resource limits

---
# Benchmark Results

The service was evaluated using the official benchmark with Docker Compose and the required resource limits.

| Metric | Result |
|---|---:|
| **Overall Score** | **97.35 / 100** |
| **Correctness** | **15 / 15 (100%)** |
| **Performance** | **47.50 / 50 (95.0%)** |
| **Queries** | **14.86 / 15 (99.04%)** |
| **Reliability** | **20 / 20 (100%)** |
| **Peak Throughput** | **20,472 logs/sec** |
| **Load Throughput** | **14,999 logs/sec** |
| **Load Error Rate** | **0%** |
| **Load p95 Latency** | **3.77 ms** |
| **Load Aggregation p95** | **8 ms** |
| **Eventual Consistency** | **4 / 4 scenarios passed** |

### Scenario Results

| Scenario | Throughput | Error Rate | p95 Latency | Aggregation p95 | Result |
|---|---:|---:|---:|---:|---|
| **Load** | 14,999 logs/s | 0% | 3.77 ms | 8 ms | Passed |
| **Stress** | 20,468 logs/s | 0% | 239.73 ms | 9.46 s | Passed |
| **Spike** | 15,260 logs/s | 0% | 194.35 ms | 5.19 s | Passed |
| **Breakpoint** | 20,472 logs/s | 0% | 290.56 ms | 15.59 s | Passed |

### Benchmark Notes

- All **15/15 correctness checks** passed.
- All **4/4 reliability scenarios** passed with **0% error rate**.
- The normal **load scenario** sustained approximately **15,000 logs/sec** with a **3.77 ms p95 ingestion latency**.
- The benchmark was executed with the required resource limits: **0.5 CPU / 256 MB** for the application and **1 CPU / 1 GB** for PostgreSQL.
- Some stress, spike, and breakpoint scenarios were **generator-limited rather than service-limited**, meaning the benchmark generator could not start all scheduled iterations. These results should therefore be interpreted as directional for those scenarios.
- Aggregation latency increases under heavy stress because aggregation queries compete with high ingestion workloads.
---
# Known Limitations

### Flat JSONB Attributes

`attributes` only supports flat primitive values.

Nested objects and arrays are rejected or normalized according to the ingestion validation rules.

### In-Memory Buffer

Logs that have been accepted into the in-memory buffer but have not yet been flushed to PostgreSQL can be lost if the process is terminated forcefully, for example by `SIGKILL`.

### Partition Boundary Handling

Logs with timestamps significantly outside the currently managed partition range may temporarily be routed to `logs_default` until the corresponding partition is created.

---

# Quick Start

```bash
# Clone the repository
git clone <repository-url>

# Enter the project
cd logs-service

# Start the services
docker compose up --build

# Apply the database migration
docker exec -i logs-postgres \
  psql -U postgres -d logs_db < 0000_harsh_sumo.sql
```

The API is then available at:

```text
http://localhost:8080
```

Check the service:

```bash
curl http://localhost:8080/health
```

Expected response:

```json
{
  "status": "ok"
}
```

---

# License

This project is intended as a backend engineering project demonstrating high-throughput log ingestion, PostgreSQL partitioning, efficient querying, and automated data retention.
