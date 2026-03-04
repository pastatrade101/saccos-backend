# Core SACCOS Delivery Matrix

Status key:
- `Done`: already implemented in the current codebase
- `Partial`: baseline exists but the phase is incomplete for enterprise-grade scope
- `Missing`: not yet implemented

## Phase Audit

| Phase | Area | Status | Notes |
| --- | --- | --- | --- |
| 0 | Baseline audit and project structure | Partial | Modular backend/frontend exist; additive `src/db` and `frontend/src/features` anchors added, but broader refactor is still pending |
| 1 | Core data model, member lifecycle, products, posting rules | Done | Implemented in migrations `013-015`, backend modules `products` and `member-applications`, live flow patches, and frontend pages |
| 2 | Teller sessions, receipt proof policy, daily cash summary | Done | Implemented in migrations `016-018`, backend `cash-control` module, finance posting hooks, teller cash desk session flow, and manager cash-control page |
| 3 | Loan products, applications, approvals, guarantors, collateral, PAR | Partial | Loans, schedules, repayment, PAR, and loan detail views exist; loan products/guarantors/collateral/multi-step approvals remain incomplete |
| 4 | Contributions and member sub-ledgers | Partial | Member savings/shares/loan accounts exist with contributions view; recurring compulsory contribution policy and richer statements still need expansion |
| 5 | Enterprise dividends | Partial | Dividend cycles, allocations, approvals, and payments exist; treasury-grade approvals and full simulation UX still need more depth |
| 6 | Governance, audit, and security hardening | Partial | Auditor module, audit logs, temp credentials, and password-change gating exist; stronger role-change controls and full security hardening checklist remain |
| 7 | Management and regulatory reporting | Partial | Trial balance, statements, PAR, aging, auditor exports exist; full income statement, balance sheet, PDF registers, and operational packs remain |
| 8 | SaaS owner, plans, limits, billing prep | Partial | Plans, entitlements, platform admin console, tenant gating exist; billing engine and read-only suspension polish remain |
| 9 | CSV import and opening balances | Partial | Secure member import, credentials export, opening balances, dated activity imports exist; opening loans and async background jobs remain |
| 10 | UI/UX finish and role dashboards | Partial | Design system, dashboards, role navigation, public landing page, and member portal exist; more consistency passes remain |
| 11 | QA, tests, integrity protections, go-live readiness | Missing | Automated tests, idempotency keys, migration runner discipline, and full go-live checklist are still pending |

## Phase 1 Deliverables Added

### Database
- `013_phase1_foundation.sql`
- `014_phase1_rls.sql`
- `015_phase1_procedures.sql`

### Backend
- `src/modules/products/*`
- `src/modules/member-applications/*`
- Posting-rule enforcement in `finance.service.js`
- Product seeding in `tenants.service.js`
- `last_login_at` stamping in `auth.service.js`
- CBS-grade member fields and status-history writes in `members.service.js`

### Frontend
- `frontend/src/pages/ProductCatalog.tsx`
- `frontend/src/pages/MemberApplications.tsx`
- Navigation and route wiring in `App.tsx` and `Layout.tsx`
- New endpoint/type contracts in `frontend/src/lib/endpoints.ts` and `frontend/src/types/api.ts`

## Phase 2 Deliverables Added

### Database
- `016_phase2_cash_control.sql`
- `017_phase2_cash_control_rls.sql`
- `018_phase2_receipts_storage.sql`

### Backend
- `src/modules/cash-control/*`
- Teller-session enforcement hooks in `finance.service.js`
- Receipt finalization hooks in `finance.service.js`
- Phase 2 default seeding in `tenants.service.js`

### Frontend
- `frontend/src/pages/CashControl.tsx`
- Teller session and receipt upload flow in `frontend/src/pages/Cash.tsx`
- New cash-control routes and nav entries in `frontend/src/App.tsx` and `frontend/src/components/Layout.tsx`
