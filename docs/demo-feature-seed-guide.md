# Demo Feature Seed Guide

Use this data pack to demo end-to-end SACCO workflows with enough breadth for first-client demos.

## 1) Member + Transactions (100 rows)

- File: `docs/member-import-100-members-one-year.csv`
- Covers:
  - onboarding profiles (name, phone, email, gender, DOB, address, TIN, NIN)
  - opening savings and shares
  - withdrawals
  - loan disbursement + repayment history

## 2) Dividend Cycles (multi-cycle, 3 component types)

- File: `docs/dividend-cycle-demo-pack.csv`
- Covers for FY2024/2025 and FY2025/2026:
  - `share_dividend`
  - `savings_interest_bonus`
  - `patronage_refund`

## 3) Demo Sequence

1. Import members CSV.
2. Verify overview, accounts, loans, transactions, and reports render populated data.
3. Use dividend cycle pack values to create/freeze/allocate/submit/approve/pay/close dividend cycles.
4. Run report exports (PDF + CSV) to show financial outputs.

## Notes

- `branch_code` intentionally removed from member CSV to avoid branch-code upload mismatch.
- If your tenant has multiple branches, set default branch during import.
