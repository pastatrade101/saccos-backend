# Backend Context

This document describes how the backend currently works. It is intended to keep future maintenance grounded in the actual codebase rather than assumptions.

## Runtime Entry Points

- [src/server.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/server.js): starts the HTTP server
- [src/app.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/app.js): Express app configuration
- [src/routes/index.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/routes/index.js): mounts module routers

Request flow:

1. Express app sets security middleware, CORS, parsing, logging
2. API routes mount under `/api`
3. Protected routes use auth middleware
4. Handlers call module services
5. Services use Supabase admin client or PostgreSQL-backed RPCs
6. Errors are normalized by the global error handler

## Key Middleware

- [src/middleware/auth.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/middleware/auth.js)
  - validates Supabase JWT with `adminSupabase.auth.getUser(token)`
  - loads `user_profiles`
  - loads assigned branches
  - sets `req.auth`
  - treats `internal_ops` and `platform_admin` as platform-level actors
- [src/middleware/require-subscription-active.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/middleware/require-subscription-active.js)
  - blocks inactive or expired subscriptions
- [src/middleware/require-feature.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/middleware/require-feature.js)
  - blocks plan-disabled features
- [src/middleware/enforce-limit.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/middleware/enforce-limit.js)
  - blocks tenant operations that exceed plan limits
- [src/middleware/error-handler.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/middleware/error-handler.js)
  - standardizes API errors
- [src/middleware/request-context.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/middleware/request-context.js)
  - attaches request metadata for logging and tracing

## Module Map

### Auth

- [src/modules/auth/auth.routes.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/modules/auth/auth.routes.js)
- [src/modules/auth/auth.service.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/modules/auth/auth.service.js)

Purpose:

- backend sign-in wrapper
- login-related validation and token-aware server response handling

### Me

- [src/modules/me/me.routes.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/modules/me/me.routes.js)
- [src/modules/me/me.controller.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/modules/me/me.controller.js)

Purpose:

- current tenant subscription lookup via `/me/subscription`

### Platform

- [src/modules/platform/platform.routes.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/modules/platform/platform.routes.js)
- [src/modules/platform/platform.service.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/modules/platform/platform.service.js)

Purpose:

- platform plan management
- tenant subscription assignment
- SaaS owner tenant inventory

Role:

- `platform_admin` only

### Tenants

- [src/modules/tenants/tenants.routes.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/modules/tenants/tenants.routes.js)
- [src/modules/tenants/tenants.service.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/modules/tenants/tenants.service.js)

Purpose:

- tenant creation
- default subscription creation
- default branch creation
- GL seeding trigger

Important behavior:

- creating a tenant automatically provisions a default head-office branch
- tenant creation calls `seed_tenant_defaults`

### Branches

- [src/modules/branches/branches.routes.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/modules/branches/branches.routes.js)
- [src/modules/branches/branches.service.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/modules/branches/branches.service.js)

Purpose:

- branch reads and creation
- plan limit enforcement for `max_branches`

### Users

- [src/modules/users/users.routes.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/modules/users/users.routes.js)
- [src/modules/users/users.service.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/modules/users/users.service.js)

Purpose:

- `/users/me`
- staff provisioning
- first tenant super admin creation
- staff updates

Critical operating rules currently enforced:

- SaaS owner uses `Setup Super Admin` to create a real tenant admin account
- tenant `super_admin` can create `branch_manager` only
- `branch_manager` can create `loan_officer`, `teller`, and `auditor`

### Members

- [src/modules/members/members.routes.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/modules/members/members.routes.js)
- [src/modules/members/members.service.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/modules/members/members.service.js)

Purpose:

- member CRUD
- member login provisioning
- accessible member account listing for frontend pages

Important behavior:

- branch manager is the member onboarding role
- member creation auto-creates:
  - savings account
  - share capital account

### Finance

- [src/modules/finance/finance.routes.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/modules/finance/finance.routes.js)
- [src/modules/finance/finance.service.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/modules/finance/finance.service.js)

Purpose:

- deposit
- withdraw
- share contribution
- dividend allocation posting
- loan disbursement
- loan repayment
- statements
- loan portfolio reads
- loan schedule reads
- loan transaction reads

Important behavior:

- frontend reads should go through backend endpoints, not direct Supabase client table queries
- this was done deliberately to keep branch and role scoping consistent

### Dividends

- [src/modules/dividends/dividends.routes.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/modules/dividends/dividends.routes.js)
- [src/modules/dividends/dividends.service.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/modules/dividends/dividends.service.js)

Purpose:

- dividend cycle lifecycle
- freeze
- allocate
- approve
- reject
- pay
- close

Current approval rule:

- branch manager, not SaaS owner, approves branch dividend planning and runs within branch scope

### Reports

- [src/modules/reports/reports.routes.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/modules/reports/reports.routes.js)
- [src/modules/reports/reports.service.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/modules/reports/reports.service.js)

Purpose:

- CSV/PDF exports
- trial balance
- member statements
- PAR
- loan aging

### Auditor

- [src/modules/auditor/auditor.routes.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/modules/auditor/auditor.routes.js)
- [src/modules/auditor/auditor.service.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/modules/auditor/auditor.service.js)

Purpose:

- auditor summary KPIs
- exception feed
- read-only journals
- read-only audit logs
- auditor CSV exports

## Database Layout

Primary SQL files:

- [001_schema.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/001_schema.sql)
- [002_rls.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/002_rls.sql)
- [003_procedures.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/003_procedures.sql)

Additive SQL:

- [001_plans.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/001_plans.sql)
- [002_rls_plans.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/002_rls_plans.sql)
- [004_shares_and_dividends.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/004_shares_and_dividends.sql)
- [005_dividend_module.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/005_dividend_module.sql)
- [006_performance_indexes.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/006_performance_indexes.sql)
- [007_loan_accounts.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/007_loan_accounts.sql)
- [008_loan_repayment_tracking_fix.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/008_loan_repayment_tracking_fix.sql)
- [009_auditor_upgrade.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/009_auditor_upgrade.sql)

### Accounting Structure

GL setup:

- `chart_of_accounts` exists
- tenant defaults are seeded by `seed_tenant_defaults(p_tenant_id uuid)` in [003_procedures.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/003_procedures.sql)
- seeded controls include:
  - cash
  - member savings control
  - member share capital control
  - loan portfolio
  - interest receivable
  - loan interest income
  - retained earnings
  - dividends payable
  - dividend reserve

Member sub-ledger:

- `member_accounts` stores savings and share accounts
- member creation inserts both account types automatically

Loan sub-ledger:

- `loan_accounts` and `loan_account_transactions` were added later via [007_loan_accounts.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/007_loan_accounts.sql)
- `loan_disburse`, `loan_repayment`, and `interest_accrual` now update that loan sub-ledger

### Important Stored Procedures

All are in [003_procedures.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/003_procedures.sql).

Critical procedures:

- `seed_tenant_defaults`
- `post_journal_entry`
- `deposit`
- `withdraw`
- `transfer`
- `loan_disburse`
- `loan_repayment`
- `interest_accrual`
- `closing_procedure`

Dividend procedures and helpers are split between:

- [003_procedures.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/003_procedures.sql)
- [005_dividend_module.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/005_dividend_module.sql)

## Plans and Entitlements

Source of truth:

- [src/services/subscription.service.js](/Users/pastoryjoseph/Desktop/saccos-backend/src/services/subscription.service.js)

Behavior:

- plan features are merged into a single entitlement map
- subscription can be usable when:
  - `active` and not expired
  - `past_due` but still within grace period
- plan limits currently gate:
  - branches
  - staff users
  - members

Feature flags in active use:

- `loans_enabled`
- `dividends_enabled`
- `contributions_enabled`
- `advanced_reports`
- `maker_checker_enabled`
- `multi_approval_enabled`

## Current Security and Workflow Decisions

These are intentional and should not be casually undone:

- SaaS owner cannot operate tenant-internal finance workflows
- tenant `super_admin` is not teller or loan officer
- branch manager is the operational onboarding role
- frontend must prefer backend reads for scoped resources
- `/users/me`, `/members`, `/statements`, and similar critical reads have cache-control fixes to avoid `304`/empty-body issues in the client

## Provisioning Flows

### First SaaS user

- `npm run bootstrap:internal-ops`
- uses [scripts/bootstrap-internal-ops.js](/Users/pastoryjoseph/Desktop/saccos-backend/scripts/bootstrap-internal-ops.js)

### New tenant

1. SaaS owner creates tenant
2. backend creates default subscription and default branch
3. backend seeds default GL
4. SaaS owner creates a real tenant `super_admin` account
5. tenant `super_admin` creates first `branch_manager`
6. `branch_manager` creates operating staff and members

### Demo seed

- [scripts/seed-demo-data.js](/Users/pastoryjoseph/Desktop/saccos-backend/scripts/seed-demo-data.js)

Current seed intent:

- realistic Tanzania data
- staff users with real branch scopes
- members with savings, share, loan, and dividend activity

## Common Maintenance Notes

- if a page can write data but cannot read it back, check whether the frontend is still using direct Supabase table access instead of a backend endpoint
- if rerunning RLS files, prefer targeted policy updates because `create policy` is not idempotent
- if a live database is missing later features, prefer additive migrations (`004` onward) rather than resetting schema
- after index changes, let autovacuum/analyze refresh stats or run `analyze` in a maintenance window

## Useful Companion Docs

- [docs/frontend-context.md](/Users/pastoryjoseph/Desktop/saccos-backend/docs/frontend-context.md)
- [docs/deployment.md](/Users/pastoryjoseph/Desktop/saccos-backend/docs/deployment.md)
- [docs/api-examples.md](/Users/pastoryjoseph/Desktop/saccos-backend/docs/api-examples.md)
