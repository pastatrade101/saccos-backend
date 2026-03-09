# Phase 0 Load Test Baseline

- Started: 2026-03-09T12:01:24.643Z
- Finished: 2026-03-09T12:03:25.931Z
- Base URL: http://127.0.0.1:5000
- Duration: 120s
- Concurrency: 20

## Current Max Snapshot

- Requests: 4825
- Approx throughput: 40.21 req/s
- Error rate: 0%
- Network failure rate: 0%
- p95 latency: 1419.61 ms

## Bottleneck Ranking (Highest p95 First)

| Endpoint | Requests | Error % | p95 (ms) | p99 (ms) | Status mix |
|---|---:|---:|---:|---:|---|
| GET /api/reports/trial-balance/export?tenant_id=2015bcb9-52a2-459e-82de-e9356214e155&format=pdf | 603 | 0% | 1598.743 | 1928.461 | 200:603 |
| GET /api/members?tenant_id=2015bcb9-52a2-459e-82de-e9356214e155&page=1&limit=20 | 2438 | 0% | 573.373 | 975.886 | 200:2438 |
| GET /api/loan-applications?tenant_id=2015bcb9-52a2-459e-82de-e9356214e155&page=1&limit=20 | 1784 | 0% | 555.272 | 1041.621 | 200:1784 |

## Recommended Next Step

- Use `GET /api/observability/summary` and `GET /api/observability/tenants` to correlate endpoint bottlenecks with tenant load.
