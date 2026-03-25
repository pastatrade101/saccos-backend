# Core SACCOS Delivery Matrix

Updated: March 4, 2026

Historical terminology note:

- This matrix was assembled while the codebase still exposed more SaaS-era language.
- In the current deployment, row 8 should be read as legacy compatibility capability rather than an active platform product surface.

Status key:

- `Done`: implemented and integrated in current backend + frontend
- `Partial`: implemented baseline exists, but enterprise-depth extensions still pending
- `Missing`: not implemented

| Phase | Area | Status | Current Notes |
| --- | --- | --- | --- |
| 0 | Baseline structure and context | Done | Modular route/service architecture is in place; docs updated to current route and role model |
| 1 | Core data model + products + posting rules | Done | Member lifecycle tables/procedures, product catalog, posting-rule checks, and seeded defaults are implemented |
| 2 | Teller sessions + receipt proof + cash summary | Done | Cash-control module, receipt policies, signed upload flow, and daily summary exports are live |
| 3 | Loan workflow + approvals + disbursement controls | Done | Application/appraisal/approval/disbursement lifecycle is live with maker-checker and disbursement gating |
| 4 | Contributions + member sub-ledgers | Partial | Savings/shares/loan member accounts and contribution flows exist; recurring contribution automation remains limited |
| 5 | Dividend lifecycle enterprise controls | Partial | Draft/freeze/allocate/submit/approve/pay/close exists; advanced simulation and policy modeling can be expanded |
| 6 | Governance, audit, security hardening | Partial | Auditor module, immutable logs, rate limits, idempotency, and password-change forcing exist; deeper hardening continues |
| 7 | Reporting + exports | Partial | Core CSV exports and auditor reports exist; broader regulatory and PDF packs remain incremental |
| 8 | Legacy workspace status / compatibility controls | Partial | Subscription and plan artifacts still exist in schema and code, but active platform tenant administration is not part of the mounted client runtime |
| 9 | CSV import + secure first login | Done | Import jobs, row-level failures, optional auth provisioning, temp credentials export, and forced password change are active |
| 10 | UI/UX role dashboards + design system | Partial | Role-aware dashboards and themed shell exist; ongoing polish continues by page/workflow |
| 11 | Tests + QA + readiness | Partial | Procedure tests, API tests, and smoke flow exist; broader coverage and CI maturity are ongoing |

## Completed Highlights Since Last Audit

- Loan workflow moved to strict approved-only disbursement path.
- Super admin removed from loan disbursement route authorization.
- Member application approval path stabilized (branch manager submit, super admin approve/reject).
- Member CSV import supports richer historical migration fields and credentials export.
- Frontend role gating aligned to latest route permissions.
- Legacy platform-management references remain in parts of the codebase and documentation history, but they are no longer the primary runtime model.

## Current Priority Gaps

1. Expand reporting breadth (balance sheet/income statement production-grade packs).
2. Increase automated test coverage for edge-case and failure-path financial scenarios.
3. Continue UX consistency pass across all operational pages.
4. Strengthen async/background handling for long-running import and batch tasks.
