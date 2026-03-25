# Backend vs UI Wiring Gap

Updated: March 10, 2026

Historical note:

- This comparison was captured while some SaaS-era setup and platform references were still present in the frontend.
- The active client-facing route map is single-workspace; treat any `/platform/*` or `/tenants/*` references here as legacy compatibility or archived scope unless they are confirmed in the current mounted route tree.

## Scope
Comparison of implemented backend modules/routes in `saccos-backend` against currently wired frontend screens/actions.

## Already Wired in UI
- Auth sign-in + OTP flow
- Initial super-admin setup and workspace entry
- Staff users and member management (including imports)
- Loan application lifecycle (create, submit, appraise, approve/reject, disburse, repay)
- Cash/teller operations and cash control basics
- Dividends cycle workflow
- Reports (trial balance, member statements, PAR, loan aging, balance sheet, income statement)
- Approvals queue and request decisions
- Approval policy editing (branch manager/super admin) on Approvals page

## Backend Functionality Not Yet Wired (or only partially wired)

### 1) Credit Risk module (`/api/credit-risk`) - **Partial UI coverage**
Current UI wiring (Loans > Collections tab):
- `GET /default-cases`
- `GET /collection-actions`
- `POST /default-detection/run`

Not yet wired:
- `GET /default-cases/:id`
- `POST /default-cases`
- `POST /default-cases/:id/transition`
- `POST /collection-actions`
- `PATCH /collection-actions/:actionId`
- `POST /collection-actions/:actionId/complete`
- `POST /collection-actions/:actionId/escalate`
- `GET /guarantor-exposures`
- `POST /guarantor-exposures/recompute`
- `GET /guarantor-claims`
- `GET /guarantor-claims/:claimId`
- `POST /guarantor-claims`
- `POST /guarantor-claims/:claimId/submit`
- `POST /guarantor-claims/:claimId/approve`
- `POST /guarantor-claims/:claimId/reject`
- `POST /guarantor-claims/:claimId/post`
- `POST /guarantor-claims/:claimId/settle`
- `POST /guarantor-claims/:claimId/waive`

### 2) Observability module (`/api/observability`) - **No UI coverage**
Not wired:
- `GET /summary`
- `GET /tenants`
- `GET /slos`
- `POST /reset`

### 3) Reports module (`/api/reports`) - **Partial UI coverage**
Not wired:
- `GET /cash-position/export`
- `GET /loan-portfolio-summary/export`
- `GET /member-balances-summary/export`
- `GET /audit-exceptions/export`

### 4) Finance module (`/api`) - **Partial UI coverage**
Not wired:
- `POST /transfer`
- `POST /interest-accrual`
- `POST /close-period`
- `GET /ledger`
- `POST /dividend-allocation` (legacy/API path; UI currently uses dividend-cycle APIs)

### 5) Cash Control module (`/api/cash-control`) - **Partial UI coverage**
Not wired:
- `POST /sessions/:id/review`
- `GET /journals/:journalId/receipts`
- `GET /receipts/:id/download`

### 6) Imports module (`/api/imports`) - **Partial UI coverage**
Not wired:
- `POST /members/preview`

### 7) Additional API endpoints currently API-only
- `POST /auth/signup`
- legacy tenant-management endpoints from the earlier SaaS phase are not part of the mounted client runtime
- `GET /members/:id`
- `PATCH /loan-applications/:id`

## Recommended UI Wiring Order
1. Credit-risk actions and guarantor claims workflow UI (critical for Phase 1 operational completeness).
2. Observability dashboard for SLOs and workspace health (critical for scale operations).
3. Close period + ledger query + interest accrual operations (Phase 3 governance and auditability).
4. Remaining advanced report exports and cash-control review/receipt evidence screens.
