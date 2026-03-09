# Phase 2 Progress: Query + Data Access Hardening

Date: 2026-03-09

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
