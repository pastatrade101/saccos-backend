# Phase 5 Progress: Legacy Platform-Scale Optimization Work

Date: 2026-03-09

Historical note:

- This document records optimization work from the earlier SaaS/platform phase of the codebase.
- The current deployment is single-client and does not expose `/api/platform/tenants` as part of the mounted runtime.
- The migration and service changes documented here still exist in source history, but this document should not be read as the current client-facing architecture.

## Completed in this batch

### 1) Removed N+1 subscription lookups from platform tenant listing

- Updated `GET /api/platform/tenants` enrichment flow to fetch subscription status in batch.
- Previous behavior called `getSubscriptionStatus(tenantId)` per tenant row.
- New behavior calls one batched resolver for the page tenant IDs.
- Added query-time platform filters in tenant list schema/service:
  - `search` (tenant name/registration number)
  - `status` (tenant status)

Files:

- `src/modules/platform/platform.service.js`
- `src/services/subscription.service.js`

### 2) Added batched subscription status resolver

- Added `getSubscriptionStatusesForTenants(tenantIds, options)`.
- Added batched DB loaders:
  - latest `tenant_subscriptions` for many tenant IDs in one query
  - `plan_features` for all involved plan IDs in one query
  - legacy `subscriptions` fallback for tenants without current plan rows
- Response is assembled per tenant with the same entitlement/limits logic used by single-tenant lookup.
- Cache is populated per tenant after batch load.

### 3) Added platform tenant scale indexes (migration)

- Added SQL migration:
  - `supabase/sql/033_phase5_platform_tenant_indexes.sql`
- Includes:
  - active-tenant ordering index for default list (`created_at desc`)
  - active-tenant `status + created_at` index for status-filtered lists
  - trigram GIN indexes for `search` on `name` and `registration_number`

## Validation run

- `node --check src/services/subscription.service.js`
- `node --check src/modules/platform/platform.service.js`
- `npm run check`

All passed.

## Migration required

Run this SQL file in Supabase SQL Editor:

- `supabase/sql/033_phase5_platform_tenant_indexes.sql`

## Why this matters for Phase 5

This removes a hot N+1 path in a platform-level endpoint and significantly reduces DB round-trips as tenant count grows.

## Recommended next tasks in Phase 5

1. Capture `EXPLAIN ANALYZE` before/after for `/api/platform/tenants` (`search`, `status`, default list) and store in docs.
2. Add short-TTL cache + invalidation for platform tenant subscription summaries.
3. Add platform tenant list load profile (realistic data volume) and capture p95/p99 before/after.
4. Add materialized/aggregate views for platform dashboard summary cards.
