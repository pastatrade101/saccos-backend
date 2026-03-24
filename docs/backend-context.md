# Backend Context

Last updated: March 11, 2026

This document is a full backend context snapshot for `saccos-backend` as currently implemented.

## 1) Purpose and scope

`saccos-backend` is a single-tenant SACCOS API and worker system for:

- tenant lifecycle and subscription governance
- member onboarding and portal access
- savings, shares, loans, and teller operations
- maker-checker controls for high-risk operations
- credit-risk controls (default detection, collections, guarantor exposure/claims)
- dividend cycles
- report exports (sync and async worker)
- platform observability and operations telemetry
- branch/staff SMS operational alerts with tenant-level trigger controls

Core stack:

- Node.js + Express
- Supabase Postgres + Auth + Storage
- Zod request validation
- JWT auth + RBAC + RLS-aware data access patterns

## 2) Runtime architecture

### Entry points

- `src/server.js`
  - starts HTTP server
  - starts default-detection scheduler
  - starts API metrics collector flusher
- `src/app.js`
  - middleware chain, health endpoints, `/metrics`, API router
- `src/worker.js`
  - report export background loop (`report-export-worker`)

### Request pipeline

1. `request-context` adds request metadata/request id
2. observability middleware starts timers
3. security middleware: `helmet`, `cors`, body parsing
4. route-level middleware: auth, RBAC, validation, rate limits, idempotency
5. controller -> service -> Supabase (table/RPC/storage/auth admin)
6. centralized not-found + error-handler response normalization

## 3) Source layout

- `src/config`
  - `env.js` typed env parsing (zod)
  - `supabase.js` retriable + instrumented Supabase clients (`adminSupabase`, `publicSupabase`)
- `src/constants`
  - roles
- `src/middleware`
  - auth, authorize, idempotency, rate-limit, observability, validation
- `src/modules`
  - domain modules (controllers/routes/schemas/services by bounded context)
- `src/services`
  - cross-domain services (audit, subscription, sms, alerts, otp, observability, metrics collector, etc.)
- `src/routes/index.js`
  - all API route mounting under `/api`
- `supabase/sql`
  - schema and additive migrations
- `scripts`
  - bootstrap, seed, reset, load test tools
- `test`
  - API, procedures, smoke, and helpers

## 4) Access control and safety model

### Roles

Defined in `src/constants/roles.js`, the system now relies on tenant-level roles only (`super_admin`, `branch_manager`, `loan_officer`, `teller`, `auditor`, `member`). Platform owner roles remain in the constants for future extensions but are not wired to any active endpoints in this single-tenant deployment.

### Subscription and feature gates

- Subscription, plan, and feature gating logic has been removed. The backend assumes the single tenant is always active and exposes the entire feature set without plan enforcement.

### Critical safety controls

- idempotency middleware on mutation-heavy flows
- maker-checker guardrails in loan approval and approval engine
- role/tenant scoped queries and strict validation
- audit logs for sensitive operations
- closed-period mutation guardrail for journal entries (Phase 3)

## 5) API module map

All routes are mounted in `src/routes/index.js`.

### Auth and identity

- `/api/auth`
  - signin, OTP send/verify, password setup link send, invite/signup
- `/api/users`
  - me/profile, password-changed marker, staff CRUD, temp credential retrieval
- `/api/me/subscription`
  - current tenant subscription + feature entitlements

### Platform owner operations

- Platform-level endpoints have been removed. All operational work is scoped to the single tenant workspace rather than a multi-tenant platform.

### Tenant administration

- `/api/tenants` is no longer exposed; tenant life cycle is assumed static and managed outside this service.
- `/api/branches`
  - branch list/create with plan-limit enforcement
- `/api/products`
  - bootstrap + product/rule catalogs (savings, loans, shares, fees, penalties, posting rules)

### Members and onboarding

- `/api/member-applications`
  - lifecycle: create/update/submit/review/approve/reject
- `/api/members`
  - member CRUD, account list, member login create/reset, temp credential fetch, bulk delete

### Loans and finance

- `/api/loan-applications`
  - lifecycle: list/detail/create/update/submit/appraise/approve/reject/disburse
  - guarantor request list (`member` role) and guarantor consent endpoint
  - supports multiple guarantors per application
- finance endpoints are mounted at API root:
  - `/api/deposit`
  - `/api/withdraw`
  - `/api/transfer`
  - `/api/share-contribution`
  - `/api/dividend-allocation`
  - `/api/loan/disburse`
  - `/api/loan/repay`
  - `/api/loan/portfolio`
  - `/api/loan/schedules`
  - `/api/loan/transactions`
  - `/api/statements`
  - `/api/ledger`
  - `/api/interest-accrual`
  - `/api/close-period`

### Cash control

- `/api/cash-control`
  - teller sessions: open/close/review/current/list
  - receipt policy
  - receipt upload init/confirm/download and journal receipt list
  - daily summary and CSV exports

### Dividends

- `/api/dividends`
  - cycle setup/update/freeze/allocate/submit
  - approve/reject/pay/close

### Credit risk (Phase 1)

- `/api/credit-risk`
  - default cases: list/detail/create/transition
  - collection actions: list/create/update/complete/escalate
  - default detection: manual run
  - guarantor exposures: list/recompute
  - guarantor claims: list/detail/create/submit/approve/reject/post/settle/waive

### Approvals (Phase 2)

- `/api/approvals`
  - approval policies list/update
  - approval requests queue/detail
  - approve/reject actions
- Gate: `maker_checker_enabled`

### Notification settings (SMS trigger controls)

- `/api/notification-settings/sms-triggers`
  - tenant super admin reads/updates per-event SMS trigger toggles
- Gates:
  - active subscription
  - `sms_trigger_controls_enabled` (Growth/Enterprise)

### Reports and exports

- `/api/reports`
  - export jobs detail/download
  - report exports: member statements, trial balance, balance sheet, income statement, cash position, PAR, loan aging, portfolio summary, member balances summary, audit exceptions
  - supports sync and async (`async=true`) flows

### Imports

- `/api/imports/members`
  - preview/import jobs and row-level failure inspection
  - failure CSV and generated credential download URL

### Auditor and observability

- `/api/auditor`
  - read-only audit summaries, exceptions, journals, audit logs, CSV packs
- `/api/observability`
  - in-process app observability summary, tenant dashboards, SLO view, reset

## 6) Key workflows and state models

### Member application lifecycle

- `draft -> submitted -> approved/rejected`
- approval creates/links member and member accounts

### Loan application lifecycle

- `draft -> submitted -> appraised -> approved/rejected -> disbursed`
- maker-checker enforced on approval path
- disbursement can yield approval request if high-value policy triggers
- guarantor consent flow:
  - guarantors can accept/decline via member endpoint
  - unresolved guarantor consent blocks progression checks where required

### Credit-risk lifecycle (default and claim)

- default case statuses include operational progression such as:
  - `delinquent -> in_recovery -> claim_ready -> (restructured/writeoff/recovered path)`
- collection actions are independently tracked and auditable
- guarantor claim workflow:
  - `draft -> submitted -> approved/rejected -> posted -> settled/waived`

### Maker-checker lifecycle

- operations (currently high-value `finance.withdraw` and `finance.loan_disburse`) can create approval requests
- states include pending/approved/rejected/expired
- maker cannot self-check
- policy-driven threshold and required checker count

## 7) Notifications and SMS architecture

### Dispatch

- `src/services/branch-alerts.service.js`
  - sends transactional SMS to branch managers, loan officers, tellers, or direct user ids
  - writes delivery audit rows to `notification_dispatches`

### Trigger controls

- catalog in `src/modules/notification-settings/notification-settings.constants.js`
- per-tenant settings in `sms_trigger_settings`
- controls are managed by tenant `super_admin`
- feature availability is plan-gated to Growth/Enterprise
- runtime sends are also plan-checked to prevent starter-plan SMS dispatch

### SMS-worthy event families implemented

- loan officer events (submission/rejection/ready-for-disbursement/guarantor-decline/default flag)
- teller events (approval-required, approval outcomes, cash mismatch, posting failure, policy block)
- branch manager events (approval pending, default opened, claim-ready, guarantor claim submitted)

## 8) Platform telemetry and incident monitoring

### Instrumentation tables

- `api_metrics`
  - endpoint, latency, status, bytes, tenant/user dimensions
- `api_errors`
  - API errors for incident feed
- `notification_dispatches`
  - SMS dispatch status data

### Platform metrics endpoints

- Platform-level metrics endpoints have been removed. Telemetry still captures system-level metrics for the single tenant via the existing `/metrics` and observability racks.

### Exclusions

API metrics collector intentionally ignores:

- `/health`
- `/api/health`
- `/metrics`

## 9) Database and migration context

Primary migration directory: `supabase/sql/`.

### Foundational sequence

- `001_*` through `034_*` establish schema, RLS, procedures, products, imports, OTP, reporting worker, and distributed rate limits.

### Phase-focused migrations

- Phase 1 credit risk:
  - `035_phase1_credit_risk_controls.sql`
  - `036_phase1_credit_risk_controls_rls.sql`
  - `037_phase1_default_detection_policy.sql`
  - `038_phase1_guarantor_exposure_policy.sql`
- Phase 2 maker-checker:
  - `039_phase2_maker_checker_engine.sql`
  - `040_phase2_maker_checker_engine_rls.sql`
- Phase 3 financial statements:
  - `041_phase3_financial_statements.sql`
  - `042_phase3_financial_statements_rls.sql`
- Platform operations telemetry:
  - `043_platform_operations_metrics.sql`
- Tenant deletion guardrail:
  - `044_tenant_purge_guardrail.sql`
- Branch alert dispatch audit:
  - `045_branch_alert_notification_dispatches.sql`
- SMS trigger settings:
  - `046_sms_trigger_settings.sql`

### Tenant hard-delete behavior

`platform.service.deleteTenant` performs:

1. confirmation + scope discovery
2. storage cleanup (`receipts`, `imports`)
3. explicit delete ordering across tenant tables (including loans, credit-risk, approvals, dispatches, metrics)
4. dynamic fallback RPC `purge_tenant_scoped_rows`
5. Supabase auth user cleanup (excluding internal ops platform users)
6. final tenant row delete

## 10) Environment and config context

`src/config/env.js` validates and exposes:

- server/network: `PORT`, `HOST`, `API_PREFIX`, `CORS_ORIGINS`, `SSL_ENABLED`
- Supabase: URL, anon/service keys, retry tuning
- auth/otp/sms: OTP TTL/attempts/rates/provider credentials, OTP enforcement switch
- subscriptions and policy thresholds: grace days, high-value amount, out-of-hours window
- imports/auth rate limits
- reporting branding
- observability and SLO thresholds
- credit risk scheduler + policy parameters
- branch alert SMS global switch

## 11) Operational scripts

From `package.json` / `scripts/`:

- `npm run dev`
- `npm start`
- `npm run start:worker`
- `npm run bootstrap:internal-ops`
- `npm run seed:demo`
- `npm run reset:tenants`
- `npm run reset:members`
- `npm run cleanup:report-exports`
- `npm run load:baseline`
- `npm run load:scale`

## 12) Test coverage map

`test/` includes:

- API:
  - RBAC/security
  - tenant isolation
  - receipts and reports
- procedures:
  - financial postings
  - dividends
  - seed/products
- smoke:
  - end-to-end platform + tenant critical flow

Commands:

- `npm test`
- `npm run test:watch`
- `npm run test:smoke`

## 13) Current phase status reference

Authoritative remediation plan and status are tracked in:

- `docs/saccos-gap-remediation-phases.md`

Current state summary:

- Phase 0: artifacts complete
- Phase 1: backend critical credit-risk scope implemented
- Phase 2: backend engine implemented and actively used by disbursement/withdraw flows
- Phase 3: balance sheet/income statement + period guardrails implemented
- Phase 4+: ongoing hardening/notification/regulatory/DR/readiness work

## 14) Notes for contributors

- Treat migrations as additive in non-empty environments.
- Preserve tenant isolation assumptions in every new query path.
- New high-risk mutations should use:
  - idempotency where applicable
  - approval engine checks where applicable
  - audit logging and before/after payloads
- Any tenant-scoped new table should be included in explicit tenant delete ordering, even with the dynamic purge guardrail present.
