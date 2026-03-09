# Tenant Scale Upgrade Plan (Up to 500 Tenants)

## 1. Phase 0: Baseline + Capacity Targets (1 week)

- Define SLOs: `p95 < 400ms` for list endpoints, `p95 < 2s` for heavy reports, error rate `< 1%`.
- Add full observability: request timing, DB query timing, queue/job timing, tenant-level dashboards.
- Run first load test baseline.
- Exit: clear “current max” documented and bottleneck-ranked.

## 2. Phase 1: Fast Safety Fixes (1-2 weeks)

- Enforce default pagination everywhere (`page/limit` required or safe defaults).
- Add hard max limits per endpoint (e.g., 100-200 rows, not full-table).
- Add frontend server-side pagination for members/loans/statements/dashboard feeds.
- Stop loading full datasets in dashboard and detail pages.
- Exit: no unbounded list endpoints in production.

## 3. Phase 2: Query + Data Access Hardening (2 weeks)

- Optimize high-traffic queries and remove N+1 patterns (platform tenant/subscription views).
- Add missing composite indexes from real query plans.
- Add projection discipline (select needed columns, avoid `*` on hot paths).
- Add cursor/keyset pagination for largest tables.
- Exit: top 20 queries stable under load with predictable latency.

## 4. Phase 3: Async Workload Architecture (2-3 weeks)

- Move imports/exports/SMS-heavy flows to worker queue (not in web process).
- Stream CSV/PDF generation where possible, avoid big in-memory buffers.
- Add retry, dead-letter, and job status APIs.
- Exit: web nodes remain responsive while heavy jobs run.

## 5. Phase 4: Horizontal Scale + Distributed Controls (2 weeks)

- Deploy multiple backend instances behind load balancer.
- Replace in-memory rate limits with shared store (Redis/Postgres-backed).
- Ensure idempotency and OTP/rate-limit logic are instance-safe.
- Exit: scale-out works linearly under concurrent traffic.

## 6. Phase 5: Tenant-Scale Platform Optimizations (2 weeks)

- Cache subscription/feature checks with short TTL + invalidation.
- Add aggregate/materialized views for dashboard/report summaries.
- Optimize platform admin endpoints for 500+ tenant listing/filtering.
- Exit: platform-level pages stay fast as tenant count grows.

## 7. Phase 6: Production Readiness for 500 Tenants (2 weeks)

- Run staged load tests: 100 -> 250 -> 500 tenants with realistic activity mix.
- Run soak test (24-72h), failover test, and backup/restore drill.
- Set autoscaling thresholds and runbook/on-call alerts.
- Exit: meets SLOs at 500-tenant target load with controlled costs.

## Recommended Rollout Gates

1. Gate A: Phase 1+2 complete, pass 100-tenant test.
2. Gate B: Phase 3+4 complete, pass 250-tenant test.
3. Gate C: Phase 5+6 complete, pass 500-tenant full-capacity test.

---

If needed, this can be expanded into a concrete 8-10 week execution roadmap with owner roles and weekly deliverables.
