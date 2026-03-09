# Phase 0 Load Test Baseline

- Started: 2026-03-09T09:45:27.704Z
- Finished: 2026-03-09T09:47:35.578Z
- Base URL: http://127.0.0.1:5000
- Duration: 120s
- Concurrency: 20

## Current Max Snapshot

- Requests: 712
- Approx throughput: 5.93 req/s
- Error rate: 0%
- Network failure rate: 0%
- p95 latency: 6603.145 ms

## Bottleneck Ranking (Highest p95 First)

| Endpoint | Requests | Error % | p95 (ms) | p99 (ms) | Status mix |
|---|---:|---:|---:|---:|---|
| GET /api/reports/trial-balance/export?tenant_id=2015bcb9-52a2-459e-82de-e9356214e155&format=pdf | 80 | 0% | 11229.337 | 13764.042 | 200:80 |
| GET /api/members?tenant_id=2015bcb9-52a2-459e-82de-e9356214e155&page=1&limit=20 | 358 | 0% | 5040.858 | 6219.49 | 200:358 |
| GET /api/loan-applications?tenant_id=2015bcb9-52a2-459e-82de-e9356214e155&page=1&limit=20 | 274 | 0% | 4915.159 | 6237.493 | 200:274 |

## Recommended Next Step

- Use `GET /api/observability/summary` and `GET /api/observability/tenants` to correlate endpoint bottlenecks with tenant load.
