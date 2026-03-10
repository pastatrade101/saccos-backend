# Phase 3 Execution Backlog: Financial Statements and Period Governance

Updated: March 10, 2026  
Scope: Phase 3 from [saccos-gap-remediation-phases.md](/Users/pastoryjoseph/Desktop/saccos-backend/docs/saccos-gap-remediation-phases.md)  
Priority: Important

## 1. Delivery Objective

Provide statutory-grade statement generation (Balance Sheet and Income Statement) from posted journals with period governance controls and evidence trails.

## Current Progress

- `FS-001`: Done (schema + RLS migrations `041` / `042`)
- `FS-002`: Done (Balance Sheet export endpoint + async worker support)
- `FS-003`: Done (Income Statement export endpoint + async worker support)
- `FS-004`: Done (financial statement run and snapshot persistence)
- `FS-005`: Done (closed-period posting guardrail trigger)
- `FS-006`: Pending (period comparison widgets in frontend dashboards)
- `FS-007`: Pending (close-period controlled reversal UI/workflow guidance)

## 2. Implemented in this kickoff

1. Data model additions:
   - `financial_statement_runs`
   - `financial_snapshot_periods`
2. Financial statement compute function:
   - `public.financial_statement_account_balances(p_tenant_id, p_from_date, p_to_date, p_branch_ids)`
3. Report endpoints:
   - `GET /api/reports/balance-sheet/export`
   - `GET /api/reports/income-statement/export`
4. Async export support:
   - `report_key=balance_sheet`
   - `report_key=income_statement`
5. Period governance control:
   - Trigger `guard_closed_period_journal_entries` blocks non-reversal postings into closed periods.

## 3. API behavior summary

### Balance Sheet

- Uses posted journals up to `as_of_date` (`today` default).
- Optional comparative column via `compare_as_of_date`.
- Optional `branch_id` scope with role-based branch enforcement.
- Emits totals for assets, liabilities, equity, and balance check.

### Income Statement

- Uses posted journals in `from_date..to_date` window.
- Defaults to year-to-date if `from_date` is omitted.
- Optional comparative window via `compare_from_date` + `compare_to_date`.
- Emits totals for income, expenses, and net surplus/deficit.

## 4. Acceptance Criteria (Phase 3 kickoff)

1. Balance Sheet export works in CSV and PDF, including async export jobs.
2. Income Statement export works in CSV and PDF, including async export jobs.
3. Every statement run writes traceable metadata to `financial_statement_runs`.
4. Snapshot rows are persisted/upserted in `financial_snapshot_periods` for the report period.
5. Non-reversal journal postings in closed periods are blocked at DB trigger level.

## 5. Test Checklist

1. Run migrations `041` then `042`.
2. Hit sync exports:
   - `/api/reports/balance-sheet/export?...`
   - `/api/reports/income-statement/export?...`
3. Hit async exports (`&async=true`) and verify `/api/reports/export-jobs/:jobId` reaches `completed`.
4. Verify run/snapshot rows inserted for each report execution.
5. Attempt journal post with `entry_date <= latest closed period` and confirm rejection unless reversal workflow is used.

## 6. Next Steps to complete Phase 3

1. Add frontend financial statement screens with comparative controls and snapshot browsing.
2. Add explicit controlled-reversal API/UI path tied to closed-period override evidence.
3. Add integration tests for comparative windows and closed-period guardrails.
4. Add statement run replay endpoint for audit/regulator reproducibility.
