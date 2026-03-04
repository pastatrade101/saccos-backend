# SACCOS Frontend

React 18 + TypeScript + Vite dashboard and member portal for the SACCOS backend in the repository root.

The detailed working context is documented here:

- [frontend context](/Users/pastoryjoseph/Desktop/saccos-backend/docs/frontend-context.md)
- [backend context](/Users/pastoryjoseph/Desktop/saccos-backend/docs/backend-context.md)

## Frontend Scope

This app includes:

- platform owner workspace
- tenant setup flow
- tenant super admin bootstrap
- staff onboarding workspace
- member onboarding and member service pages
- teller cash desk
- loan officer loan workspace
- branch manager contributions and dividends visibility
- reporting exports
- member self-service portal

## Environment

Create `frontend/.env` from `frontend/.env.example`:

```bash
cp frontend/.env.example frontend/.env
```

Required values:

```env
VITE_API_BASE_URL=http://localhost:5000/api
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Never place backend secrets or service-role keys in the frontend env file.

## Local Run

Backend:

```bash
npm install
npm run dev
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Build

```bash
cd frontend
npm run build
npm run preview
```

## Current Important Flows

### SaaS owner

1. Sign in
2. Create tenant in `Tenant Setup`
3. Create real tenant super admin in `Setup Super Admin`
4. Assign plan and subscription from platform pages if needed

### Tenant super admin

1. Sign in with separate credentials
2. Go to `Team Access`
3. Create the first branch manager

### Branch manager

1. Create operational staff:
   - teller
   - loan officer
   - auditor
2. Onboard members
3. Use `Member Import` for bulk CSV onboarding when needed
4. Review contributions and dividends

### Teller

1. Use `Members` as service lookup
2. Use `Cash Desk` for:
   - deposit
   - withdrawal
   - share contribution

### Loan officer

1. Use `Loans`
2. Disburse and repay
3. Open dedicated loan detail pages from the portfolio list

### Member

1. Sign in
2. If provisioned with a temporary password, the app forces `/change-password`
3. After password reset, land in `/portal`
4. Navigate portal sections from the member sidebar

## Route Summary

- `/signin`
- `/change-password`
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
- `/members/import`
- `/cash`
- `/contributions`
- `/dividends`
- `/loans`
- `/loans/:loanId`
- `/follow-ups`
- `/reports`
- `/portal`

## CSV Member Import

1. Open `/members/import`
2. Download the template from `/member-import-template.csv`
3. Upload the CSV
4. Optionally enable `Create member portal accounts`
5. Review:
   - import summary
   - failed rows
   - failures CSV
   - one-time credentials CSV
6. The template also supports optional migrated-portfolio columns:
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
7. For legacy files, map:
   - `member_id` -> `member_no`
   - `cumulative_savings` -> `opening_savings`
8. For a single-branch tenant, leave `branch_code` blank and the importer will attach rows to the default tenant branch automatically.

Credentials handling:

- temporary passwords are generated server-side
- the credentials CSV uses a signed URL with a short lifetime
- distribute it securely and delete local copies after use

## Auditor Test Plan

1. Provision a tenant user with role `auditor`.
2. Sign in as the auditor.
3. Confirm only auditor pages are visible in navigation:
   - Auditor Dashboard
   - Exceptions
   - Journals
   - Audit Logs
   - Reports
4. Post transactions using operational roles.
5. Refresh auditor pages and confirm:
   - exceptions load
   - journals load
   - audit logs load
   - auditor CSV exports download
6. Try opening blocked operational routes directly and confirm the app shows `Access Denied`.
7. Confirm there are no create, update, or delete controls anywhere in the auditor UI.

## Notes For Future Changes

- prefer backend API reads over direct Supabase browser queries for operational data
- keep role gating aligned with backend authorization
- check [docs/frontend-context.md](/Users/pastoryjoseph/Desktop/saccos-backend/docs/frontend-context.md) before changing routing or workspace rules
- check [docs/backend-context.md](/Users/pastoryjoseph/Desktop/saccos-backend/docs/backend-context.md) before changing finance or provisioning flows
