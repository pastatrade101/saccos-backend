# SACCOS Platform Monorepo

Production-oriented multi-tenant SACCOS platform with:

- Node.js + Express backend
- Supabase Postgres + Auth
- React 18 + TypeScript + Vite frontend
- Material UI dashboard and member portal

This README is the entry point. The detailed working context lives in:

- [docs/backend-context.md](/Users/pastoryjoseph/Desktop/saccos-backend/docs/backend-context.md)
- [docs/frontend-context.md](/Users/pastoryjoseph/Desktop/saccos-backend/docs/frontend-context.md)
- [docs/deployment.md](/Users/pastoryjoseph/Desktop/saccos-backend/docs/deployment.md)
- [docs/api-examples.md](/Users/pastoryjoseph/Desktop/saccos-backend/docs/api-examples.md)

## Repo Map

- [src](/Users/pastoryjoseph/Desktop/saccos-backend/src): backend runtime
- [supabase/sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql): schema, RLS, procedures, additive migrations
- [scripts](/Users/pastoryjoseph/Desktop/saccos-backend/scripts): bootstrap and demo seed
- [frontend](/Users/pastoryjoseph/Desktop/saccos-backend/frontend): React app
- [docs](/Users/pastoryjoseph/Desktop/saccos-backend/docs): project documentation

## Current Operating Model

- `platform_admin` / SaaS owner:
  - platform dashboard
  - tenant management
  - plan management
  - tenant creation
  - first tenant super admin creation
  - cannot operate inside tenant finance workflows
- tenant `super_admin`:
  - creates branch managers only
  - does not onboard members directly
  - does not handle cash or loans directly
- `branch_manager`:
  - creates `loan_officer`, `teller`, `auditor`
  - onboards members
  - views contributions and dividends
- `loan_officer`:
  - handles loans
- `teller`:
  - handles deposits, withdrawals, share contributions
- `auditor`:
  - read-only operational/reporting access
- `member`:
  - member self-service portal only

## Core Financial Model

- Tenant creation seeds default GL accounts via `seed_tenant_defaults`
- Member creation auto-creates:
  - savings account
  - share capital account
- Loan disbursement creates:
  - `loans` master record
  - `loan_schedules`
  - `loan_accounts`
  - `loan_account_transactions`
- Deposits and withdrawals post against:
  - tenant control GL accounts
  - member sub-ledger accounts
- Dividends use:
  - cycles
  - snapshots
  - allocations
  - approvals
  - payment posting

## SQL Apply Order

For a fresh environment, apply SQL in this order:

1. [001_schema.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/001_schema.sql)
2. [002_rls.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/002_rls.sql)
3. [003_procedures.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/003_procedures.sql)
4. [001_plans.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/001_plans.sql)
5. [002_rls_plans.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/002_rls_plans.sql)
6. [004_shares_and_dividends.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/004_shares_and_dividends.sql)
7. [005_dividend_module.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/005_dividend_module.sql)
8. [006_performance_indexes.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/006_performance_indexes.sql)
9. [007_loan_accounts.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/007_loan_accounts.sql)
10. [008_loan_repayment_tracking_fix.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/008_loan_repayment_tracking_fix.sql)
11. [009_auditor_upgrade.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/009_auditor_upgrade.sql)
12. [010_member_import.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/010_member_import.sql)
13. [011_import_storage_policies.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/011_import_storage_policies.sql)
14. [013_phase1_foundation.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/013_phase1_foundation.sql)
15. [014_phase1_rls.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/014_phase1_rls.sql)
16. [015_phase1_procedures.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/015_phase1_procedures.sql)
17. [016_phase2_cash_control.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/016_phase2_cash_control.sql)
18. [017_phase2_cash_control_rls.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/017_phase2_cash_control_rls.sql)
19. [018_phase2_receipts_storage.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/018_phase2_receipts_storage.sql)
20. [019_idempotency_keys.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/019_idempotency_keys.sql)

Important:

- `002_rls.sql` is not idempotent because PostgreSQL policies do not support `if not exists`
- do not rerun the entire file blindly on a live database that already has those policies
- additive migrations like `006`, `007`, and `008` are safe to run when needed

## Cash Control And Receipt Proof

Phase 2 now adds:

- teller sessions with open, close, and manager review
- receipt policy with tenant default and optional branch override
- signed receipt upload flow
- immutable receipt records linked to posted journals
- daily cash summary
- CSV exports for:
  - daily cashbook
  - teller balancing

New backend endpoints:

- `GET /api/cash-control/sessions`
- `GET /api/cash-control/sessions/current`
- `POST /api/cash-control/sessions/open`
- `POST /api/cash-control/sessions/:id/close`
- `POST /api/cash-control/sessions/:id/review`
- `GET /api/cash-control/receipt-policy`
- `PUT /api/cash-control/receipt-policy`
- `POST /api/cash-control/receipts/init`
- `POST /api/cash-control/receipts/:id/confirm`
- `GET /api/cash-control/journals/:journalId/receipts`
- `GET /api/cash-control/receipts/:id/download`
- `GET /api/cash-control/summary/daily`
- `GET /api/cash-control/reports/daily-cashbook.csv`
- `GET /api/cash-control/reports/teller-balancing.csv`

How to test:

1. Apply `016_phase2_cash_control.sql`
2. Apply `017_phase2_cash_control_rls.sql`
3. Apply `018_phase2_receipts_storage.sql`
4. Restart backend and frontend
5. Sign in as `teller`
6. Open `Cash Desk`
7. Open a teller session
8. Post a deposit or withdrawal with a receipt attached
9. Close the session with counted closing cash
10. Sign in as `branch_manager`
11. Open `Cash Control`
12. Review receipt policy, teller sessions, and export reports

## CSV Member Import + Secure First Login

The platform now supports branch-manager-led CSV member import with optional member portal provisioning.

Template:

- [docs/member-import-template.csv](/Users/pastoryjoseph/Desktop/saccos-backend/docs/member-import-template.csv)

New backend endpoints:

- `POST /api/imports/members`
- `GET /api/imports/members/:jobId`
- `GET /api/imports/members/:jobId/rows?status=failed&page&limit`
- `GET /api/imports/members/:jobId/failures.csv`
- `GET /api/imports/members/:jobId/credentials`
- `POST /api/users/me/password-changed`

Security model:

- temporary passwords are generated server-side only
- passwords are never stored in Postgres
- credentials are exposed only through a one-time signed CSV export
- imported member logins are forced to change password on first login
- import requests and auth-user creation are rate-limited
- the importer accepts standard onboarding columns plus optional migration columns:
  - `loan_id`
  - `loan_amount`
  - `interest_rate`
  - `term_months`
  - `loan_status`
  - `withdrawal_amount`
  - `repayment_amount`
  - `opening_savings_date`
  - `opening_shares_date`
  - `withdrawal_date`
  - `loan_disbursed_at`
  - `repayment_date`
- `member_id` from legacy files should be mapped into `member_no`
- `cumulative_savings` from legacy files should be mapped into `opening_savings`
- imported `loan_id` is treated as an external reference; the system still generates its own internal loan number
- dated activity fields let imported transactions and loans appear across a realistic historical timeline in dashboards
- for a single-branch tenant, leave `branch_code` blank and the importer will use the tenant's default branch automatically

How to test:

1. Apply `010_member_import.sql`
2. Apply `011_import_storage_policies.sql`
3. Restart backend and frontend
4. Sign in as a `branch_manager`
5. Open `Member Import`
6. Upload the template CSV
7. Enable `Create member portal accounts` if needed
8. Download the credentials CSV and distribute it securely
9. Sign in as an imported member
10. Confirm the app forces `/change-password`
11. Change password and verify the member is redirected into `/portal`

## Local Run

Backend:

```bash
npm install
cp .env.example .env
npm run dev
```

Backend with Docker Compose:

```bash
cp .env.example .env
docker compose build
docker compose up -d
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
