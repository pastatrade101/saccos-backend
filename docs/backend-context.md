# Backend Context

This document describes the backend as it is currently implemented in `src/`.

## Runtime Entry Points

- `src/server.js`: boots HTTP server
- `src/app.js`: Express app, security middleware, health endpoints
- `src/routes/index.js`: API route mounting under `/api`

Request flow:

1. `request-context` attaches request metadata
2. security middleware (`helmet`, `cors`, parsing) runs
3. route-level auth and RBAC middleware executes
4. controller calls service layer
5. service layer uses Supabase admin client + RPC procedures
6. errors are normalized by global error handler

## Security and Access Model

Core middleware:

- `src/middleware/auth.js`: validates Supabase JWT, loads profile + branch assignments
- `src/middleware/authorize.js`: enforces RBAC
- `src/middleware/require-subscription.js` and `require-subscription-active.js`: blocks inactive tenants
- `src/middleware/require-feature.js`: plan feature gating
- `src/middleware/enforce-limit.js`: plan limits (`max_users`, `max_members`, `max_branches`)
- `src/middleware/idempotency.js`: duplicate financial-post prevention using `Idempotency-Key`
- `src/middleware/rate-limit.js`: endpoint-specific throttling (imports/auth-sensitive paths)

## Domain Modules

### Auth

- `src/modules/auth/*`
- Endpoints:
  - `POST /api/auth/signin`
  - `POST /api/auth/signup`

### Me

- `src/modules/me/*`
- Endpoints:
  - `GET /api/me/subscription`

### Platform (SaaS owner)

- `src/modules/platform/*`
- Endpoints:
  - `GET /api/platform/plans`
  - `PATCH /api/platform/plans/:planId/features`
  - `GET /api/platform/tenants`
  - `POST /api/platform/tenants/:tenantId/subscription`
  - `DELETE /api/platform/tenants/:tenantId`
- Role: `platform_admin` only

### Tenants and Branches

- `src/modules/tenants/*`
- `src/modules/branches/*`
- Tenant creation seeds defaults (COA, products, posting rules, subscription, default branch)

### Users and Team Access

- `src/modules/users/*`
- Key enforcement:
  - `super_admin` can provision `branch_manager` only
  - `branch_manager` can provision `loan_officer`, `teller`, `auditor`
  - member credentials and temp credential visibility are scoped by role

### Members and Member Applications

- `src/modules/members/*`
- `src/modules/member-applications/*`
- Current lifecycle:
  - Branch manager creates and submits application
  - Super admin approves/rejects
  - Approval creates/links member and ensures sub-accounts

### Loan Workflow

- `src/modules/loan-applications/*`
- Workflow states: `draft -> submitted -> appraised -> approved/rejected -> disbursed`
- Rules:
  - appraisal by `loan_officer`
  - approval/rejection by `branch_manager`
  - maker-checker: request maker cannot approve/reject
  - disbursement only by `loan_officer` or `teller`
  - disbursement cannot execute twice (`loan_id` guard + finance idempotency key support)

### Finance and Accounting

- `src/modules/finance/*`
- High-value endpoints:
  - `POST /api/deposit`
  - `POST /api/withdraw`
  - `POST /api/transfer`
  - `POST /api/share-contribution`
  - `POST /api/loan/disburse`
  - `POST /api/loan/repay`
  - `GET /api/loan/portfolio`
  - `GET /api/loan/schedules`
  - `GET /api/loan/transactions`
  - `GET /api/statements`
  - `GET /api/ledger`

### Cash Control and Receipts

- `src/modules/cash-control/*`
- Includes:
  - teller session open/close/review
  - receipt policy (tenant and optional branch override)
  - signed upload/confirm receipt flow
  - daily cash summary and CSV exports

### Dividends

- `src/modules/dividends/*`
- Branch manager prepares/submits cycle
- Super admin approves/rejects/pays/closes cycle

### Auditor

- `src/modules/auditor/*`
- Strict GET-only route surface
- Read-only exception-first reporting and CSV exports

### Reports

- `src/modules/reports/*`
- Management and accounting exports:
  - trial balance
  - cash position
  - member statements
  - loan portfolio summary
  - member balances summary
  - PAR
  - loan aging
  - audit exceptions report
- list endpoints across members/finance/loan-applications support optional `page` + `limit` query params

### Imports

- `src/modules/imports/*`
- CSV member import with:
  - row-level validation and error capture
  - optional portal provisioning
  - generated temporary passwords
  - signed credentials export URL
  - opening balances and optional historical loan/repayment migration

## Loan Workflow API (Current)

- `GET /api/loan-applications`
- `POST /api/loan-applications`
- `PATCH /api/loan-applications/:id`
- `POST /api/loan-applications/:id/submit`
- `POST /api/loan-applications/:id/appraise`
- `POST /api/loan-applications/:id/approve`
- `POST /api/loan-applications/:id/reject`
- `POST /api/loan-applications/:id/disburse`

## Database and Migrations

Primary migration location: `supabase/sql/`.

Latest major additive migrations:

- `019_idempotency_keys.sql`
- `020_dividend_submission_handoff.sql`
- `021_loan_workflow.sql`
- `022_loan_workflow_rls.sql`
- `023_performance_reliability.sql`

## Operational Scripts

- `npm run bootstrap:internal-ops`: create/ensure platform owner bootstrap user
- `npm run seed:demo`: populate realistic demo tenant data
- `npm run reset:tenants`: delete tenant data safely (tenant-scoped)
- `npm run reset:members`: clear member-domain data safely

## Testing

- `npm run test`
- `npm run test:watch`
- `npm run test:smoke`

Test helpers and smoke flow live in `test/`.
