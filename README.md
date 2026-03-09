# SACCOS Platform Monorepo

Enterprise multi-tenant SACCOS system for real-money operations.

## Stack

- Backend: Node.js + Express
- Database/Auth: Supabase Postgres + Supabase Auth + Supabase Storage
- Frontend: React 18 + TypeScript + Vite + Material UI
- Security: RLS, JWT validation, RBAC, feature gating, idempotency, audit logs

## Documentation Index

- [Backend context](docs/backend-context.md)
- [Frontend context](docs/frontend-context.md)
- [Deployment guide](docs/deployment.md)
- [API request examples](docs/api-examples.md)
- [Delivery/status matrix](docs/phase-audit-matrix.md)
- [Sales and marketing guide](docs/product-sales-guide.md)
- [Phase 3 async workloads progress](docs/phase-3-async-workloads-progress.md)
- [Phase 4 scale progress](docs/phase-4-scale-progress.md)

## Repository Map

- `src/`: backend runtime code
- `supabase/sql/`: schema, RLS, procedures, and additive migrations
- `scripts/`: bootstrap, seed, and reset utilities
- `frontend/`: React application
- `docs/`: product, engineering, and operations documentation
- `test/`: Jest + Supertest + procedure smoke tests

## Current Role Model

- `platform_admin` (SaaS owner)
  - manages tenants, plans, subscriptions
  - can create tenant super admins
  - does not perform tenant internal cash/loan/dividend operations
- tenant `super_admin`
  - governs tenant workspace
  - provisions `branch_manager` users
  - approves/rejects member applications
- `branch_manager`
  - provisions `loan_officer`, `teller`, `auditor`
  - creates and submits member applications
  - handles contributions/dividends/cash-control oversight
  - approves/rejects loan applications
- `loan_officer`
  - appraises loan applications
  - can disburse approved loans
- `teller`
  - deposit/withdraw/cash desk
  - can disburse approved loans
  - posts repayments
- `auditor`
  - strict read-only audit workspace
- `member`
  - self-service portal only

## Core Workflows

### Tenant bootstrap

1. `platform_admin` creates tenant
2. System seeds defaults:
   - chart of accounts
   - posting rules
   - baseline products
   - subscription entry
   - default branch
3. `platform_admin` creates first tenant `super_admin`

### Member onboarding

1. `branch_manager` creates member application (`draft`)
2. `branch_manager` submits for approval
3. `super_admin` approves or rejects
4. On approval:
   - member is created/linked
   - member accounts are ensured (savings/shares)
   - optional membership fee posting is executed

### Loan workflow (gated disbursement)

1. Application created by member or staff (`draft`)
2. Submitted (`submitted`)
3. Loan officer appraisal (`appraised`)
4. Branch manager approval (`approved`, maker-checker enforced)
5. Disbursement by `loan_officer` or `teller` only (`disbursed`)
6. Disbursement posts the final accounting entry through existing finance posting logic

## Migration Order (Fresh Environment)

Run in this sequence:

1. `001_schema.sql`
2. `002_rls.sql`
3. `003_procedures.sql`
4. `001_plans.sql`
5. `002_rls_plans.sql`
6. `004_shares_and_dividends.sql`
7. `005_dividend_module.sql`
8. `006_performance_indexes.sql`
9. `007_loan_accounts.sql`
10. `008_loan_repayment_tracking_fix.sql`
11. `009_auditor_upgrade.sql`
12. `010_member_import.sql`
13. `011_import_storage_policies.sql`
14. `012_temp_credentials.sql`
15. `013_phase1_foundation.sql`
16. `014_phase1_rls.sql`
17. `015_phase1_procedures.sql`
18. `016_phase2_cash_control.sql`
19. `017_phase2_cash_control_rls.sql`
20. `018_phase2_receipts_storage.sql`
21. `019_idempotency_keys.sql`
22. `020_dividend_submission_handoff.sql`
23. `021_loan_workflow.sql`
24. `022_loan_workflow_rls.sql`
25. `023_performance_reliability.sql`
26. `025_auth_otp_challenges.sql`
27. `026_phase2_seek_indexes.sql`
28. `027_phase3_report_export_jobs.sql`
29. `028_phase3_report_export_worker.sql`
30. `029_phase3_report_export_retries.sql`
31. `030_phase3_report_export_cleanup_indexes.sql`
32. `031_phase4_distributed_rate_limits.sql`

Important:

- Policy files (`002_rls.sql`, `002_rls_plans.sql`, `014_phase1_rls.sql`, `017_phase2_cash_control_rls.sql`, `022_loan_workflow_rls.sql`) should be applied carefully on environments with existing policies.
- Prefer additive migrations in production; do not rerun base schema files blindly.
- Run monthly recovery exercises using [backup-restore-drill-checklist.md](/Users/pastoryjoseph/Desktop/saccos-backend/docs/backup-restore-drill-checklist.md).

## Local Run

Backend:

```bash
npm install
cp .env.example .env
npm run dev
```

Frontend:

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

## Docker Run

Backend:

```bash
docker compose build
docker compose up -d
```

Frontend:

```bash
cd frontend
docker compose build
docker compose up -d
```

## High-Value References

- Member import template: `docs/member-import-template.csv`
- Demo seed script: `scripts/seed-demo-data.js`
- Tenant reset script: `scripts/reset-tenants.js`
- Member reset script: `scripts/reset-members.js`
docker compose logs -f backend
```

Health check:

```bash
curl http://localhost:5000/health
```

Frontend:

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

## Automated Tests

The backend now includes Jest + Supertest + `pg` coverage for:

- direct financial procedure tests
- API RBAC and tenant isolation tests
- receipt policy and report export tests
- smoke flow covering:
  - tenant creation
  - branch creation
  - tenant super admin bootstrap
  - staff provisioning
  - member onboarding
  - deposit and withdrawal
 - loan disbursement and repayment
 - dividend lifecycle
 - CSV export endpoint

## Docker Deployment

This repo now includes backend-only container artifacts:

- [Dockerfile](/Users/pastoryjoseph/Desktop/saccos-backend/Dockerfile)
- [docker-compose.yml](/Users/pastoryjoseph/Desktop/saccos-backend/docker-compose.yml)
- [.dockerignore](/Users/pastoryjoseph/Desktop/saccos-backend/.dockerignore)

Production notes:

- keep `.env` server-side only
- terminate TLS at Nginx, Caddy, Traefik, or your cloud load balancer
- expose only the API port you actually need
- do not put `SUPABASE_SERVICE_ROLE_KEY` in the frontend or client bundle
- use `docker compose pull && docker compose build --no-cache && docker compose up -d` for controlled server deploys

Setup:

```bash
cp .env.test.example .env.test
```

Required `.env.test` values:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL`

Before running tests, apply:

1. [013_phase1_foundation.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/013_phase1_foundation.sql)
2. [014_phase1_rls.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/014_phase1_rls.sql)
3. [015_phase1_procedures.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/015_phase1_procedures.sql)
4. [016_phase2_cash_control.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/016_phase2_cash_control.sql)
5. [017_phase2_cash_control_rls.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/017_phase2_cash_control_rls.sql)
6. [018_phase2_receipts_storage.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/018_phase2_receipts_storage.sql)
7. [019_idempotency_keys.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/019_idempotency_keys.sql)

Install dependencies:

```bash
npm install
```

Run all tests:

```bash
npm test
```

Watch mode:

```bash
npm run test:watch
```

Run only the smoke flow:

```bash
npm run test:smoke
```

Safety guard:

- destructive cleanup only runs when `NODE_ENV=test`
- the suite only deletes tenants and auth users it created during the run

## Bootstrap and Demo Data

Create the first SaaS owner/internal ops user:

```bash
npm run bootstrap:internal-ops
```

Seed realistic Tanzania demo data:

```bash
npm run seed:demo
```

The demo seed creates:

- a Tanzania tenant
- realistic branches
- staff users by role
- member users
- savings activity
- share contributions
- loans
- repayments
- dividends

## Auditor Test Plan

1. Create a user with role `auditor` in a tenant.
2. Sign in as that auditor.
3. Verify the visible navigation is limited to:
   - Auditor Dashboard
   - Exceptions
   - Journals
   - Audit Logs
   - Reports
4. Sign in as teller or loan officer and create transactions:
   - deposit
   - withdrawal
   - share contribution
   - loan disbursement
   - loan repayment
5. Sign back in as auditor and verify:
   - journal entries are visible
   - audit logs are visible
   - exceptions show high value, backdated, manual, or out-of-hours items when applicable
6. Attempt blocked auditor operations and confirm they fail:
   - POST/PATCH/DELETE in UI should not exist
   - direct backend mutation calls should return `403`
7. Confirm tenant isolation:
   - auditor cannot view another tenant’s data

## Recommended Reading Order For Future Work

1. [docs/backend-context.md](/Users/pastoryjoseph/Desktop/saccos-backend/docs/backend-context.md)
2. [docs/frontend-context.md](/Users/pastoryjoseph/Desktop/saccos-backend/docs/frontend-context.md)
3. [docs/deployment.md](/Users/pastoryjoseph/Desktop/saccos-backend/docs/deployment.md)
4. [docs/api-examples.md](/Users/pastoryjoseph/Desktop/saccos-backend/docs/api-examples.md)
