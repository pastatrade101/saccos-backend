# Frontend Context

This document reflects the current React frontend implementation under `frontend/src`.

## Stack

- React 18 + TypeScript + Vite
- Material UI (M3-inspired shell)
- React Router
- Axios API client
- Supabase browser auth client
- React Hook Form + Zod
- Chart.js (`react-chartjs-2`)

## App Entry and Providers

- `frontend/src/main.tsx`
- `frontend/src/App.tsx`
- `frontend/src/auth/AuthProvider.tsx`
- `frontend/src/ui/AppThemeProvider.tsx`
- `frontend/src/ui/UIProvider.tsx`

Key behavior:

- Supabase session persists in browser
- Access token attached to all API requests
- `/users/me` and `/me/subscription` hydrate role, tenant context, and entitlements
- if backend is unavailable, app routes to `/service-unavailable`
- if `must_change_password=true`, app forces `/change-password` before workspace access

## Layout and Navigation

Primary shell:

- `frontend/src/components/Layout.tsx`

Current layout behavior:

- white side navigation (sharp edges)
- top bar in brand primary color (`#0A0573`)
- left-side nav toggle
- right-side avatar menu with logout
- global route search in top bar
- responsive drawer behavior for mobile/desktop

Role-aware menu visibility is driven by:

- signed-in role
- internal ops/platform mode
- plan entitlements from `/me/subscription`

## Route Map (Current)

Public:

- `/`
- `/signin`
- `/access-denied`
- `/service-unavailable`

Password policy:

- `/change-password`

Member portal:

- `/portal`

Setup:

- `/setup/tenant`
- `/setup/super-admin`

Workspace:

- `/dashboard`
- `/platform/tenants`
- `/platform/plans`
- `/staff-users`
- `/products`
- `/member-applications`
- `/members`
- `/members/import`
- `/cash`
- `/cash-control`
- `/contributions`
- `/dividends`
- `/loans`
- `/loans/:loanId`
- `/follow-ups`
- `/reports`

Auditor:

- `/auditor/exceptions`
- `/auditor/journals`
- `/auditor/journals/:id`
- `/auditor/audit-logs`
- `/auditor/reports`

## Role Access (UI Layer)

- `platform_admin`: platform tenants/plans + setup, no tenant internal finance operations
- `super_admin`: governance-level tenant screens, user control, approvals
- `branch_manager`: member onboarding, applications, team operations, contributions, dividends
- `loan_officer`: loan workflow appraisal/disbursement/monitoring
- `teller`: cash desk and approved-loan disbursement + repayments
- `auditor`: read-only auditor routes
- `member`: portal only

Note: backend RBAC remains the source of truth.

## Loan Workflow UI

Main page: `frontend/src/pages/Loans.tsx`

Current behavior:

- workflow card for loan application lifecycle
- separate actions for:
  - new application
  - appraisal
  - approval/rejection
  - disbursement from approved applications
  - loan repayment
- disbursement action removed for super admin
- details-first review flow:
  - officer can open application details before appraisal
  - portfolio rows link to dedicated loan details page (`/loans/:loanId`)

## Member UI

Pages:

- `frontend/src/pages/Members.tsx`
- `frontend/src/pages/MemberImport.tsx`
- `frontend/src/pages/MemberPortal.tsx`

Highlights:

- member onboarding via modal patterns
- CSV import with robust error handling
- optional portal account generation
- import summary, failed rows pagination, credentials download flow

## Theming

Brand tokens:

- primary dark: `#0A0573`
- primary light/accent: `#1FA8E6`

Theme files:

- `frontend/src/theme/colors.ts`
- `frontend/tailwind.config.js` (utility alignment where used)

Chart color standards are aligned with financial semantics:

- deposits green
- withdrawals red
- loans cyan
- savings navy
- dividends amber

## Frontend Integration Contracts

Core API files:

- `frontend/src/lib/api.ts`
- `frontend/src/lib/endpoints.ts`
- `frontend/src/types/api.ts`

These are the single source for endpoint paths and typed contracts used by pages.

## Design and UX Notes

- member sidebar now supports dedicated pages + toggle behavior
- top-level form actions are modal-driven for money-sensitive operations
- blocked states are explicit for inactive subscriptions
- loading, empty, and error states are implemented across role pages
