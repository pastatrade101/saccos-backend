# Phase 1 Baseline Comparison (vs Phase 0)

Date: 2026-03-09

## Test Setup (Both Runs)

- Base URL: `http://127.0.0.1:5000`
- Duration: `120s`
- Concurrency: `20`
- Weighted targets:
  - `GET /api/members?...` weight 4
  - `GET /api/loan-applications?...` weight 3
  - `GET /api/reports/trial-balance/export?...` weight 1

## Summary Comparison

| Metric | Phase 0 | Phase 1 | Delta |
|---|---:|---:|---:|
| Requests | 712 | 815 | +103 (+14.5%) |
| Throughput (req/s) | 5.93 | 6.79 | +0.86 (+14.5%) |
| Error rate | 0% | 0% | no change |
| Network failure rate | 0% | 0% | no change |
| p50 latency (ms) | 2832.206 | 2521.580 | -310.626 (-11.0%) |
| p95 latency (ms) | 6603.145 | 6028.423 | -574.722 (-8.7%) |
| p99 latency (ms) | 9203.467 | 6913.779 | -2289.688 (-24.9%) |

## Endpoint p95 Comparison

| Endpoint | Phase 0 p95 (ms) | Phase 1 p95 (ms) | Delta |
|---|---:|---:|---:|
| `GET /api/members?...` | 5040.858 | 3261.805 | -1779.053 (-35.3%) |
| `GET /api/loan-applications?...` | 4915.159 | 3423.318 | -1491.841 (-30.4%) |
| `GET /api/reports/trial-balance/export?...` | 11229.337 | 7292.730 | -3936.607 (-35.1%) |

## Interpretation

- Phase 1 improved throughput and reduced latency across all measured endpoints.
- API safety controls (pagination + hard limits) are effective.
- SLO targets are still not met:
  - list endpoints target `< 400ms` p95
  - heavy reports target `< 2000ms` p95

## Next Focus (Phase 2)

1. Reduce per-request auth/subscription lookup overhead.
2. Remove tenant-level overfetch in high-traffic list services.
3. Optimize report generation path (PDF export) and add query/index tuning from live plans.
