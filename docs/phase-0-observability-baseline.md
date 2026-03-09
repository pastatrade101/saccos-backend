# Phase 0 Execution Guide: SLO + Observability + Baseline

This guide implements Phase 0 for capacity planning and captures the required exit artifact:

- SLOs defined
- observability enabled
- first load baseline executed
- current max + bottleneck ranking documented

## 1. SLO Targets

Configured through environment variables:

- `SLO_LIST_ENDPOINT_P95_MS=400`
- `SLO_HEAVY_REPORT_P95_MS=2000`
- `SLO_ERROR_RATE_PCT=1`

These are evaluated by the backend at runtime and exposed via `GET /api/observability/slos`.

## 2. Observability Endpoints

### Platform/API observability (requires platform admin/super admin token)

- `GET /api/observability/summary`
- `GET /api/observability/tenants`
- `GET /api/observability/slos`
- `POST /api/observability/reset`

### Prometheus-style metrics endpoint

- `GET /metrics`
- Optional protection with `METRICS_BEARER_TOKEN`

If `METRICS_BEARER_TOKEN` is set, call with:

```bash
curl -H "Authorization: Bearer <token>" http://localhost:5000/metrics
```

## 3. What Is Measured

- Request timing: all HTTP requests, with p50/p95/p99 and per-endpoint stats.
- DB query timing: all Supabase REST/RPC calls (latency + failure rate).
- Job timing: import jobs, report export jobs, OTP SMS send jobs.
- Tenant-level dashboards: request/db/job metrics aggregated per tenant.

## 4. Run the First Baseline Load Test

### Example setup

```bash
export LOAD_TEST_BASE_URL=http://127.0.0.1:5000
export LOAD_TEST_AUTH_TOKEN=<JWT_WITH_ACCESS>
export LOAD_TEST_DURATION_SECONDS=120
export LOAD_TEST_CONCURRENCY=25
export LOAD_TEST_TARGETS="GET /api/members?tenant_id=<tenant-id>&page=1&limit=20|4,GET /api/loan-applications?tenant_id=<tenant-id>&page=1&limit=20|3,GET /api/reports/trial-balance/export?tenant_id=<tenant-id>&format=pdf|1"
export LOAD_TEST_OUTPUT_FILE=docs/phase-0-baseline-latest.md
```

### Execute

```bash
npm run load:baseline
```

The command prints JSON summary and writes a markdown report if `LOAD_TEST_OUTPUT_FILE` is set.

## 5. Exit Criteria Checklist (Phase 0)

- [ ] SLO thresholds configured in `.env`
- [ ] Observability endpoints returning live data
- [ ] Baseline load test run and report generated
- [ ] `docs/phase-0-baseline-latest.md` contains:
  - current max throughput snapshot
  - p95 latency snapshot
  - bottleneck-ranked endpoints

## 6. Suggested Phase 0 Evidence Bundle

- `docs/phase-0-baseline-latest.md`
- output of `GET /api/observability/summary`
- output of `GET /api/observability/tenants`
- output of `GET /api/observability/slos`
