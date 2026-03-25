# Frontend Context

This document reflects the current React frontend implementation under `frontend/src`.

Current deployment note:

- The app serves one client workspace.
- Some frontend contracts still use older `tenant` and `subscription` terms because the codebase evolved from a SaaS version.
- The active route map is the one defined in `frontend/src/App.tsx`, not the older platform-management helpers still present in some shared files.

## Stack

- React 18 + TypeScript + Vite
- Material UI
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

- Supabase session persists in the browser
- access token is attached to API requests
- `/users/me` hydrates role, branch, and workspace context
- `/me/subscription` is still consumed as a compatibility status/capabilities endpoint for the deployed workspace
- if backend is unavailable, the app routes to `/service-unavailable`
- if `must_change_password=true`, the app forces `/change-password` before workspace access

## Layout and Navigation

Primary shell:

- `frontend/src/components/Layout.tsx`

Current layout behavior:

- white side navigation
- top bar in brand primary color (`#0A0573`)
- responsive drawer behavior for mobile and desktop
- avatar menu with logout and workspace status chips

Menu visibility is primarily driven by:

- signed-in role
- backend authorization
- compatibility capability/status data from `/me/subscription`

## Route Map

Public:

- `/`
- `/signin`
- `/signup`
- `/reset-password`
- `/privacy-policy`
- `/terms-and-agreement`
- `/access-denied`
- `/service-unavailable`

Password policy:

- `/change-password`

Member portal:

- `/portal`

Setup:

- `/setup/super-admin`

Workspace:

- `/dashboard`
- `/staff-users`
- `/products`
- `/member-applications`
- `/members`
- `/members/import`
- `/contributions`
- `/savings`
- `/payments`
- `/cash`
- `/cash-control`
- `/dividends`
- `/follow-ups`
- `/approvals`
- `/loans`
- `/loans/:loanId`
- `/reports`

Auditor:

- `/auditor/exceptions`
- `/auditor/journals`
- `/auditor/journals/:id`
- `/auditor/audit-logs`
- `/auditor/reports`

There are no active `/platform/tenants`, `/platform/plans`, or `/setup/tenant` routes in the current `App.tsx` route tree.

## Role Access

- `super_admin`: governance, approvals, and high-level workspace control
- `branch_manager`: staff, member operations, products, contributions, dividends, and operational oversight
- `loan_officer`: appraisal, lending workflow, and portfolio review
- `teller`: cash desk, loan disbursement execution, and repayments
- `auditor`: read-only auditor routes
- `member`: portal only

Note: backend RBAC remains the source of truth.

Legacy internal roles such as `platform_admin` and `platform_owner` still appear in some shared types and auth helpers, but they are not part of the normal client-facing route surface.

## Loan Workflow UI

Main page: `frontend/src/pages/Loans.tsx`

Current behavior:

- create and submit applications
- appraise applications
- approve or reject applications
- disburse approved applications
- repay and review portfolio/details
- open dedicated loan detail page at `/loans/:loanId`
- show credit-risk collection views and approval-related blocked states

## Member and Portal UI

Pages:

- `frontend/src/pages/Members.tsx`
- `frontend/src/pages/MemberImport.tsx`
- `frontend/src/pages/MemberPortal.tsx`

Highlights:

- modal-driven member onboarding
- CSV import with preview/error handling
- optional portal account generation
- import summary, failed rows pagination, and credentials download flow

## Theming

Brand tokens:

- primary dark: `#0A0573`
- primary light/accent: `#1FA8E6`

Theme files:

- `frontend/src/theme/colors.ts`
- `frontend/tailwind.config.js`

Chart color standards:

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

These remain the source of truth for typed contracts, even where some older endpoint names still reflect the previous SaaS design.

## Design and UX Notes

- money-sensitive actions are modal-driven
- loading, empty, and error states are implemented across role pages
- blocked states are still surfaced using "subscription" copy in some places because the compatibility API and UI copy have not been fully renamed yet
