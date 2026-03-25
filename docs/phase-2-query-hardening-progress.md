# Phase 2 Progress: Query + Data Access Hardening

Date: 2026-03-09

Historical note:

- This document captures a real optimization batch, but some of the terminology reflects the earlier SaaS/multi-tenant phase.
- References to subscription caches and tenant status lookups should be read as compatibility-layer work retained in the current single-client codebase.

## Completed in this batch

### 1) Subscription status cache (hot path)

- Added short TTL in-memory cache for tenant subscription status lookups.
- Reduces repeated `tenant_subscriptions` + `plan_features` reads across request bursts.
- Cache invalidates on subscription assignment changes.

File:
- `src/services/subscription.service.js`

### 2) User context cache (hot path)

- Added short TTL in-memory cache for:
  - `user_profiles` by user_id
  - `branch_staff_assignments` by user_id
- Added explicit invalidation helper for user context cache.

File:
- `src/services/user-context.service.js`

### 3) Auth middleware latency reduction

- Changed auth context loading to run profile + branch assignment lookups in parallel.
- Keeps behavior intact while reducing auth pipeline wall-time.

File:
- `src/middleware/auth.js`

### 4) Cache invalidation on user writes

- Invalidates user context cache when user profile/assignments are updated or invited.

Files:
- `src/modules/users/users.service.js`
- `src/modules/auth/auth.service.js`

### 5) Loan applications list query pushdown

- Moved member/staff branch visibility filtering into SQL query instead of in-memory post-filter.
- Reduces overfetch and improves p95 for loan application listing.

File:
- `src/modules/loan-applications/loan-applications.service.js`

### 6) Single-flight cache protection (stampede control)

- Added in-flight request deduplication so concurrent cache misses for the same key execute one DB read only.
- Applied to:
  - subscription status cache
  - user profile cache
  - branch assignments cache
- Prevents periodic TTL expiry from causing burst query spikes under concurrency.

Files:
- `src/services/subscription.service.js`
- `src/services/user-context.service.js`

### 7) Cheaper pagination counts on hot list endpoints

- Switched paginated list counts from `exact` to `planned` for:
  - members listing
  - loan applications listing
- Keeps pagination totals while reducing expensive full-count planning/execution overhead on large tables.

Files:
- `src/modules/members/members.service.js`
- `src/modules/loan-applications/loan-applications.service.js`

### 8) Loan list payload slimming

- Removed heavy child collections from loan application list responses:
  - `loan_approvals`
  - `loan_guarantors`
  - `collateral_items`
- These remain available on detail responses used after create/update/workflow actions.
- Reduces join amplification and payload size on the highest-volume loan list endpoint.

File:
- `src/modules/loan-applications/loan-applications.service.js`

### 9) Cursor pagination + cheap total counts on hot lists

- Added optional `cursor` query support (seek by `created_at`) for:
  - members list
  - loan applications list
- Kept existing `page/limit` compatibility for current frontend clients.
- Added short-TTL cached totals with single-flight for paginated list responses.
  - avoids recalculating `count` on every repeated request burst.

Files:
- `src/modules/members/members.schemas.js`
- `src/modules/members/members.service.js`
- `src/modules/loan-applications/loan-applications.schemas.js`
- `src/modules/loan-applications/loan-applications.service.js`

### 10) Seek-support indexes

- Added new database indexes to support stable seek ordering and filtered list paths.

File:
- `supabase/sql/026_phase2_seek_indexes.sql`

## Validation

- Syntax checks passed for edited modules.
- `npm run check` passed.

## Suggested verification run

1. Re-run baseline load test (same Phase 1 target mix).
2. Compare p95 for:
   - `/api/members`
   - `/api/loan-applications`
   - `/api/reports/trial-balance/export`
3. Check observability DB operation counts for:
   - `tenant_subscriptions`
   - `plan_features`
   - `user_profiles`
   - `branch_staff_assignments`
