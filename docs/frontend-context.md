# Frontend Context

This document explains the current React frontend as it exists now, including routing, role separation, tenant workspace behavior, and the main UI decisions already encoded in the app.

## Stack

- React 18
- TypeScript
- Vite
- Material UI
- React Router
- Supabase Auth client
- Axios
- React Hook Form
- Zod
- Chart.js via `react-chartjs-2`

Frontend root:

- [frontend/src](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src)

## Runtime Entry Points

- [frontend/src/main.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/main.tsx)
  - mounts providers
  - applies MUI theme and UI state
- [frontend/src/App.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/App.tsx)
  - main route map
- [frontend/src/auth/AuthProvider.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/auth/AuthProvider.tsx)
  - session, profile, subscription, selected tenant/branch
- [frontend/src/components/Layout.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/components/Layout.tsx)
  - main admin shell

## Auth Model

Supabase handles browser authentication. The app then loads backend identity context.

Flow:

1. User signs in with Supabase email/password
2. `AuthProvider` stores the session
3. frontend calls `/users/me`
4. frontend optionally calls `/me/subscription`
5. app stores:
   - tenant profile
   - platform role
   - selected tenant
   - selected branch
   - branch assignments
   - subscription entitlements

Files:

- [frontend/src/lib/supabase.ts](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/lib/supabase.ts)
- [frontend/src/lib/api.ts](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/lib/api.ts)
- [frontend/src/auth/AuthProvider.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/auth/AuthProvider.tsx)

Important behavior:

- every backend request uses the Supabase access token in `Authorization: Bearer <token>`
- stale tenant and branch local storage is cleared on sign-in to avoid cross-user routing mistakes
- subscription errors raise a global inactive banner state

## Routing Model

Main file:

- [frontend/src/App.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/App.tsx)

High-level routes:

- `/signin`
- `/access-denied`
- `/setup/tenant`
- `/setup/super-admin`
- `/dashboard`
- `/auditor/exceptions`
- `/auditor/journals`
- `/auditor/journals/:id`
- `/auditor/audit-logs`
- `/auditor/reports`
- `/platform/tenants`
- `/platform/plans`
- `/staff-users`
- `/members`
- `/cash`
- `/contributions`
- `/dividends`
- `/loans`
- `/loans/:loanId`
- `/follow-ups`
- `/reports`
- `/portal`

### ProtectedRoute

File:

- [frontend/src/auth/ProtectedRoute.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/auth/ProtectedRoute.tsx)

Purpose:

- guards by authentication
- guards by role
- blocks internal ops from tenant-internal pages where required

## Layout and Navigation

Admin shell:

- [frontend/src/components/Layout.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/components/Layout.tsx)

Supporting UI state:

- [frontend/src/ui/UIProvider.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/ui/UIProvider.tsx)
- [frontend/src/ui/AppThemeProvider.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/ui/AppThemeProvider.tsx)

Current behavior:

- responsive sidebar
- top bar with avatar menu only on the right
- route search in top bar
- tenant workspace switcher for platform owner
- persistent theme mode
- role-aware nav visibility

### Nav Rules

Current intended visibility:

- `platform_admin`
  - Dashboard
  - Tenants
  - Plans
  - setup pages
- tenant `super_admin`
  - Dashboard
  - Team Access
  - Reports
- `branch_manager`
  - Dashboard
  - Team Access
  - Members
  - Contributions
  - Dividends
  - Reports
- `loan_officer`
  - Dashboard
  - Members
  - Loans
  - Reports
- `teller`
  - Dashboard
  - Members
  - Cash Desk
- `auditor`
  - Auditor Dashboard
  - Exceptions
  - Journals
  - Audit Logs
  - Reports
- `member`
  - `/portal` only

Note:

- the frontend hides menu items, but backend remains the real security boundary

## Page Map

### Sign-in and Setup

- [frontend/src/pages/SignIn.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/pages/SignIn.tsx)
- [frontend/src/pages/SetupTenant.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/pages/SetupTenant.tsx)
- [frontend/src/pages/SetupSuperAdmin.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/pages/SetupSuperAdmin.tsx)

Current setup flow:

1. SaaS owner signs in
2. creates tenant
3. creates real tenant super admin account
4. tenant super admin signs in separately

Important:

- there is still a [frontend/src/pages/SetupBranch.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/pages/SetupBranch.tsx) file in the tree, but the active product flow no longer uses a separate branch setup screen because tenant creation provisions the default branch automatically

### Platform Admin Pages

- [frontend/src/pages/PlatformTenants.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/pages/PlatformTenants.tsx)
- [frontend/src/pages/PlatformPlans.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/pages/PlatformPlans.tsx)

Purpose:

- SaaS owner tenant inventory
- plan editing
- tenant subscription assignment

### Dashboard

- [frontend/src/pages/Dashboard.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/pages/Dashboard.tsx)

This page is heavily role-conditional.

Current role variants:

- platform owner dashboard
- teller dashboard
- branch manager dashboard
- loan officer dashboard
- auditor dashboard

Reusable chart helpers:

- [frontend/src/components/ChartPanel.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/components/ChartPanel.tsx)
- [frontend/src/lib/charts.ts](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/lib/charts.ts)
- teller-specific cards in [frontend/src/components/teller](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/components/teller)

### Follow-ups

- [frontend/src/pages/FollowUps.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/pages/FollowUps.tsx)

Purpose:

- dedicated page for operational due-item review
- filters:
  - status
  - loan/member search
  - due-from
  - due-to

This page was added after the dashboard card grew too dense.

### Auditor Workspace

- [frontend/src/pages/AuditorDashboard.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/pages/AuditorDashboard.tsx)
- [frontend/src/pages/AuditorExceptions.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/pages/AuditorExceptions.tsx)
- [frontend/src/pages/AuditorJournals.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/pages/AuditorJournals.tsx)
- [frontend/src/pages/AuditorAuditLogs.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/pages/AuditorAuditLogs.tsx)
- [frontend/src/pages/AuditorReports.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/pages/AuditorReports.tsx)
- [frontend/src/pages/AccessDenied.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/pages/AccessDenied.tsx)

Purpose:

- keep auditor strictly read-only
- isolate auditor navigation from operational pages
- provide exception-first oversight instead of generic branch operations

Current auditor pages:

- dashboard summary KPIs
- exception feed
- journals list and journal detail
- audit log viewer
- CSV export page

### Team Access

- [frontend/src/pages/StaffUsers.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/pages/StaffUsers.tsx)

Current behavior:

- provisioning form is modal-based from a page-level action button
- workspace layout uses a left-side section instead of a raw directory dump
- role options are restricted by the current actor

### Members

- [frontend/src/pages/Members.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/pages/Members.tsx)

Current behavior:

- branch manager is the onboarding role
- onboarding form is modal-based
- teller/member snapshot rendering is different from branch-manager admin rendering
- member login can be provisioned later

### Cash

- [frontend/src/pages/Cash.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/pages/Cash.tsx)

Current behavior:

- teller-focused cash desk
- deposit, withdrawal, and share contribution start from dedicated buttons
- each action opens its own modal form
- all postings still use confirmation modal before submit

### Contributions and Dividends

- [frontend/src/pages/Contributions.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/pages/Contributions.tsx)
- [frontend/src/pages/Dividends.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/pages/Dividends.tsx)

Current behavior:

- contributions is read-oriented and branch-scoped
- dividends exposes cycle management and visibility for branch manager and auditor workflows

### Loans

- [frontend/src/pages/Loans.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/pages/Loans.tsx)
- [frontend/src/pages/LoanDetail.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/pages/LoanDetail.tsx)

Current behavior:

- disbursement and repayment forms are modal-driven from header buttons
- loan portfolio rows navigate to dedicated detail page, not modal
- loan detail page includes:
  - borrower details
  - status
  - metrics
  - transactions
  - amortization schedule

### Reports

- [frontend/src/pages/Reports.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/pages/Reports.tsx)

Current behavior:

- export-oriented page
- advanced report visibility depends on subscription entitlements

### Member Portal

- [frontend/src/pages/MemberPortal.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/pages/MemberPortal.tsx)

Current behavior:

- dedicated member-only workspace
- separate side nav styled similarly to admin shell
- toggleable sidebar
- flat top bar
- menu items render dedicated views inside the portal:
  - Overview
  - Accounts
  - Loans
  - Transactions
  - Contributions

Important:

- portal should not expose admin shell or dev tools
- member data is loaded in a fault-tolerant way so one failing dataset does not destroy the whole page

## API Integration Rules

Main files:

- [frontend/src/lib/api.ts](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/lib/api.ts)
- [frontend/src/lib/endpoints.ts](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/lib/endpoints.ts)
- [frontend/src/types/api.ts](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/types/api.ts)

Current rules:

- use backend endpoints rather than direct browser queries for scoped operational data
- attach cache-control headers to avoid stale `304` empty-body problems
- map all routes centrally in `endpoints.ts`

Important historical fix:

- several pages originally read Supabase tables directly in the browser
- those were migrated to backend endpoints because role and branch scoping became inconsistent
- if a future screen fails to read data that definitely exists, check whether it is trying to bypass the backend

## Shared Components

- [frontend/src/components/DataTable.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/components/DataTable.tsx)
- [frontend/src/components/ConfirmModal.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/components/ConfirmModal.tsx)
- [frontend/src/components/SearchableSelect.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/components/SearchableSelect.tsx)
- [frontend/src/components/Toast.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/components/Toast.tsx)

Supporting utilities:

- [frontend/src/utils/downloadFile.ts](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/utils/downloadFile.ts)
- [frontend/src/utils/format.ts](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/utils/format.ts)
- [frontend/src/utils/plans.ts](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/utils/plans.ts)

## UI Decisions Already Made

These are current product decisions, not accidents:

- Material UI is the main design system
- admin top bar uses avatar-only account menu on the right
- loan detail uses dedicated page, not modal
- dashboard follow-up has a dedicated `View all` page
- member portal uses its own left nav and top bar
- setup flow no longer relies on a separate branch setup screen
- tenant setup pulls real plan entitlements from backend instead of hardcoded benefit lists

## What To Read Before Changing Frontend Behavior

1. [frontend/src/App.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/App.tsx)
2. [frontend/src/auth/AuthProvider.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/auth/AuthProvider.tsx)
3. [frontend/src/components/Layout.tsx](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/components/Layout.tsx)
4. [frontend/src/lib/endpoints.ts](/Users/pastoryjoseph/Desktop/saccos-backend/frontend/src/lib/endpoints.ts)
5. [docs/backend-context.md](/Users/pastoryjoseph/Desktop/saccos-backend/docs/backend-context.md)
