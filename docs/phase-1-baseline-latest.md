# Phase 0 Load Test Baseline

- Started: 2026-03-09T10:49:36.496Z
- Finished: 2026-03-09T10:51:39.819Z
- Base URL: http://127.0.0.1:5000
- Duration: 120s
- Concurrency: 20

## Current Max Snapshot

- Requests: 815
- Approx throughput: 6.79 req/s
- Error rate: 0%
- Network failure rate: 0%
- p95 latency: 6028.423 ms

## Bottleneck Ranking (Highest p95 First)

| Endpoint | Requests | Error % | p95 (ms) | p99 (ms) | Status mix |
|---|---:|---:|---:|---:|---|
| GET /api/reports/trial-balance/export?tenant_id=2015bcb9-52a2-459e-82de-e9356214e155&format=pdf | 107 | 0% | 7292.73 | 8060.396 | 200:107 |
| GET /api/loan-applications?tenant_id=2015bcb9-52a2-459e-82de-e9356214e155&page=1&limit=20 | 311 | 0% | 3423.318 | 4227.854 | 200:311 |
| GET /api/members?tenant_id=2015bcb9-52a2-459e-82de-e9356214e155&page=1&limit=20 | 397 | 0% | 3261.805 | 3770.957 | 200:397 |

## Recommended Next Step

- Use `GET /api/observability/summary` and `GET /api/observability/tenants` to correlate endpoint bottlenecks with tenant load.
