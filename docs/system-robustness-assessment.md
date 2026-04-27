# System Robustness Assessment (Rules + Ledger)

Updated: April 25, 2026

Scope:

- Backend: `saccos-backend` (Node/Express + Supabase Postgres)
- Frontend: `saccos-frontend` (React/Vite)
- Focus: financial rules, ledger correctness, and control enforcement.

Path note:

- Backend references are relative to the `saccos-backend/` project root.
- Frontend references are relative to the `SACCOS-SYSTEM/` root (the frontend lives in `saccos-frontend/`).

## Summary

The system has strong “ledger primitives” (double-entry journals, balance enforcement, period closures, and RLS) and a real controls baseline (2FA gating, maker-checker for key operations, audit logging, idempotency). However, it is not yet production-robust as the core ledger for a SACCO because a few gaps can still create financial integrity or governance failures under real-world conditions.

## What Is Strong Today

### Ledger and period governance (DB-level)

- Double-entry journals are enforced in Postgres using `journal_entries` + `journal_lines`, plus a deferrable trigger that rejects unbalanced journals.
- Ledger reporting is driven from posted journals (`ledger_entries_view`, `trial_balance_view`) and summarized balances (`account_balances`).
- Period governance exists via `period_closures` + `closing_procedure`, and a closed-period guard trigger blocks non-reversal postings into closed periods.
- Row-level security (RLS) is enabled and ledger tables are not broadly readable by authenticated users. Journal visibility is scoped to `super_admin` and `auditor` (plus internal ops).

Key references:

- `supabase/sql/001_schema.sql`
- `supabase/sql/002_rls.sql`
- `supabase/sql/003_procedures.sql`
- `supabase/sql/041_phase3_financial_statements.sql`

### Control framework and enforcement (API-level)

- Maker-checker approval engine exists (`approval_policies`, `approval_requests`, `approval_decisions`, `approval_steps`) with:
  - explicit self-approval prevention
  - SLA expiry handling for approved-but-stale requests
  - audit logging and notifications
- High-value enforcement is integrated for:
  - `finance.withdraw`
  - `finance.loan_disburse`
  - treasury execution governance (`treasury.order_execute`)
- Idempotency support is present for high-mutation routes via `Idempotency-Key` reservations and response replay.
- Staff roles are gated behind authenticator-based 2FA at the backend middleware layer (not just UI).

Key references:

- `supabase/sql/039_phase2_maker_checker_engine.sql`
- `src/modules/approvals/approvals.service.js`
- `src/modules/finance/finance.service.js`
- `src/modules/treasury/treasury.service.js`
- `src/middleware/auth.js`
- `src/middleware/idempotency.js`
- `supabase/sql/019_idempotency_keys.sql`

### Frontend route gating (UI-level)

The frontend has role-based route guards and “2FA required” routing. This is helpful for UX and reduces accidental access, but backend authorization and DB controls remain the source of truth.

Key references (frontend project, relative to `SACCOS-SYSTEM` root):

- `saccos-frontend/src/App.tsx`
- `saccos-frontend/src/auth/ProtectedRoute.tsx`
- `saccos-frontend/src/auth/AuthProvider.tsx`

### Evidence via tests

- There are procedure-level tests asserting that the core posting procedures produce balanced journals for deposits/withdrawals/loan disbursement/loan repayment.

Key references:

- `test/procedures/financial-postings.test.ts`

## Critical Gaps (Must-Fix Before “Core SACCO Ledger” Production Use)

### 1) Balance integrity under concurrency (race conditions)

`withdraw` and `transfer` are vulnerable to classic “check then update” races. With concurrent requests, two withdrawals (or two transfers) can both pass the pre-check and then overdraw the same savings account.

Where this happens:

- `public.withdraw(...)` in `supabase/sql/003_procedures.sql`
- `public.transfer(...)` in `supabase/sql/003_procedures.sql`

Why it matters:

- This is a direct financial correctness risk. It can create negative balances and ledger/member transaction trails that look legitimate but represent an impossible real-world state.

### 2) Controlled reversal workflow is not implemented

The schema supports reversal metadata (`is_reversal`, `reversed_journal_id`), and the closed-period guard hints at a “controlled reversal workflow”, but there is no clear RPC/service flow that:

- creates a reversal journal with an explicit link to the original journal
- enforces approval/SoD rules for reversals
- records sufficient evidence/metadata for audit/regulator review

Where to look:

- `supabase/sql/001_schema.sql` (`is_reversal`, `reversed_journal_id`)
- `supabase/sql/041_phase3_financial_statements.sql` (closed-period guard hint)
- `supabase/sql/003_procedures.sql` (`post_journal_entry` always inserts `is_reversal=false`)

### 3) “Rules” are not fully deterministic against ledger postings

Fee and penalty rule entities exist (`fee_rules`, `penalty_rules`, `loan_products.processing_fee_rule_id`, `loan_products.penalty_rule_id`, `posting_rules`), but core loan ledger posting procedures do not consistently apply fees and penalties as journal lines during disbursement/repayment.

Where to look:

- Rule models: `supabase/sql/013_phase1_foundation.sql` and `supabase/sql/021_loan_workflow.sql`
- Core postings: `supabase/sql/003_procedures.sql` (`loan_disburse`, `loan_repayment`)

Impact:

- Product policy can drift from financial truth (a loan product configured with fees/penalties can still produce journals that ignore those rules).

### 4) “Out-of-hours” policy is audit-only (not enforced)

Out-of-hours posting is flagged as an audit exception, but there is no backend guard that blocks or approval-gates out-of-hours postings.

Where to look:

- Audit flagging: `src/modules/auditor/auditor.service.js` and `v_audit_exception_feed` (in `supabase/sql/003_procedures.sql`)
- The finance service defines out-of-hours blocking codes but does not emit them: `src/modules/finance/finance.service.js`

### 5) Maker-checker coverage is partial

Maker-checker enforcement is present for high-value withdrawals and loan disbursements (and treasury), but other high-risk operations called out in the Phase 2 backlog are not yet approval-gated (e.g., reversals, write-off postings, teller close variance governance).

Where to look:

- Phase 2 backlog: `docs/phase-2-maker-checker-execution-backlog.md`
- Cash control session review exists, but without approval policy integration: `src/modules/cash-control/cash-control.service.js`

## Recommended Next Steps (Priority Order)

1. Fix concurrency at the database boundary for `withdraw` and `transfer` (and any other “check then update” balance mutations): use row locks (`... for update`), conditional updates, and/or transaction-safe patterns so two concurrent mutations cannot overdraw.
2. Implement a controlled reversal workflow:
   - DB function to create reversal journals with linkage
   - maker-checker enforcement for reversal operations
   - audit evidence capture and metadata requirements
3. Make rules deterministic with postings:
   - wire loan product fee/penalty rules into disbursement/repayment posting logic
   - reduce drift between `posting_rules`, `tenant_settings`, and actual journal line generation
4. Enforce out-of-hours posting policy (block by default, allow only via explicit approval override where appropriate).
5. Expand maker-checker enforcement to additional high-risk operations listed in Phase 2 backlog (cash variance governance, reversals, write-offs, restructure postings).

