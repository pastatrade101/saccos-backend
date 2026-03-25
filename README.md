# SACCOS Monorepo

Client-specific SACCOS deployment for one production workspace.

This codebase started as a SaaS/multi-tenant platform. The active runtime is now a single deployed SACCOS for one client, but some schema, migration, and service names still use `tenant`, `platform`, `plan`, or `subscription` terminology for compatibility with older data and code paths.

## Stack

- Backend: Node.js + Express
- Database/Auth: Supabase Postgres + Supabase Auth + Supabase Storage
- Frontend: React 18 + TypeScript + Vite + Material UI
- Security: RLS, JWT validation, RBAC, idempotency, maker-checker, audit logs

## Documentation Index

- [Backend context](docs/backend-context.md)
- [Frontend context](docs/frontend-context.md)
- [Deployment guide](docs/deployment.md)
- [API request examples](docs/api-examples.md)
- [Delivery/status matrix](docs/phase-audit-matrix.md)
- [Client delivery guide](docs/product-sales-guide.md)
- [Phase 3 async workloads progress](docs/phase-3-async-workloads-progress.md)
- [Phase 4 scale progress](docs/phase-4-scale-progress.md)

## Repository Map

- `src/`: backend runtime code
- `supabase/sql/`: schema, RLS, procedures, and additive migrations
- `scripts/`: bootstrap, seed, reset, and load-test utilities
- `frontend/`: React application
- `docs/`: product, engineering, and operations documentation
- `test/`: Jest + Supertest + procedure smoke tests

## Runtime Model

- The mounted backend API is single-workspace focused.
- There are no active `/api/platform/*` or `/api/tenants` routes in `src/routes/index.js`.
- `/api/me/subscription` is still available and is used as a compatibility status/capabilities endpoint for the deployed workspace.
- Legacy platform and multi-tenant modules still exist in parts of the codebase and migration chain, but they are not the primary runtime surface for this client deployment.

## Current Role Model

- `super_admin`
  - governs the deployed workspace
  - manages branch managers and governance actions
- `branch_manager`
  - manages staff assignments and member operations
  - approves/rejects loan applications
  - oversees contributions, dividends, and cash-control policy
- `loan_officer`
  - appraises loan applications
  - can disburse approved loans
- `teller`
  - handles cash desk operations
  - can disburse approved loans
  - posts repayments
- `auditor`
  - read-only audit workspace
- `member`
  - self-service portal only

Legacy internal roles such as `platform_admin` and `platform_owner` may still appear in compatibility code, types, or test helpers. They are not part of the normal client-facing workflow.

## Core Workflows

### Initial workspace setup

1. Deploy the workspace and apply the database migrations.
2. Create the first `super_admin` via the setup flow or bootstrap tooling.
3. Seed products, posting rules, and default branch data as needed.

### Member onboarding

1. `branch_manager` creates a member application (`draft`)
2. `branch_manager` submits for approval
3. `super_admin` approves or rejects
4. On approval:
   - the member record is created or linked
   - member accounts are ensured
   - optional membership fee posting can run

### Loan workflow

1. Application created by member or staff (`draft`)
2. Submitted (`submitted`)
3. Loan officer appraisal (`appraised`)
4. Branch manager approval (`approved`, with maker-checker where configured)
5. Disbursement by `loan_officer` or `teller` only (`disbursed`)
6. Disbursement posts the accounting entry through finance logic

## Migrations

The full current migration order is maintained in [docs/deployment.md](docs/deployment.md) and runs through `071_fix_seeded_loan_income_mappings.sql`.

Important:

- The legacy compatibility migrations `001_plans.sql` and `002_rls_plans.sql` are still required because the current codebase still reads plan/subscription tables for workspace capability checks.
- Prefer additive migrations in non-empty environments.
- Do not rerun base schema files blindly against live data.
- Run monthly recovery exercises using [backup-restore-drill-checklist.md](docs/backup-restore-drill-checklist.md).

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
docker compose logs -f backend
```

Scaled backend:

```bash
docker compose -f docker-compose.scale.yml up -d --build --scale backend=2 backend api-lb report-worker
```

Frontend:

```bash
cd frontend
docker compose build
docker compose up -d
docker compose logs -f frontend
```

Health checks:

```bash
curl http://127.0.0.1:5000/health
curl http://127.0.0.1:5000/api/health
```

## Automated Tests

The backend includes Jest + Supertest + `pg` coverage for:

- direct financial procedure tests
- API RBAC and workspace-scope access tests
- receipt policy and report export tests
- smoke flows covering bootstrap, staffing, member onboarding, cash operations, lending, dividends, and exports

Useful commands:

```bash
cp .env.test.example .env.test
npm install
npm test
npm run test:watch
npm run test:smoke
```

Safety guard:

- destructive cleanup only runs when `NODE_ENV=test`
- the test suite only deletes data it created during the run

## Bootstrap and Demo Data

Bootstrap the initial admin/setup context:

```bash
npm run bootstrap:internal-ops
```

Seed demo data:

```bash
npm run seed:demo
```

The demo seed creates a realistic client workspace with branches, staff, members, savings activity, shares, loans, repayments, and dividends.

## Recommended Reading Order

1. [docs/backend-context.md](docs/backend-context.md)
2. [docs/frontend-context.md](docs/frontend-context.md)
3. [docs/deployment.md](docs/deployment.md)
4. [docs/api-examples.md](docs/api-examples.md)
