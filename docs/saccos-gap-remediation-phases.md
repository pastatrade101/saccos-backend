# SACCOS Gap Remediation Phases

Updated: March 10, 2026

## Objective
Close the remaining capability gaps for production-grade SACCOS operations, prioritized by operational risk.

Priority labels used:

- `Critical`: system safety/control risk
- `Important`: compliance/scale readiness
- `Nice to have`: UX/automation enhancement

## Phase 0: Scope Lock and Control Blueprint (1 week)
Priority: `Critical`

Focus:

- Lock policy and process definitions for default handling, guarantor liability, and maker-checker thresholds.
- Freeze reporting requirements for regulator and board packs.
- Define RPO/RTO and DR evidence requirements.

Deliverables:

- Approved process maps for loan default, collections, guarantor claim, and override flows.
- Approval policy matrix by transaction type and amount.
- Regulatory report specification catalog.

Exit criteria:

- Signed-off control matrix and target-state workflow diagrams.
- Data model change list approved for Phase 1 and 2.

Phase 0 kickoff artifacts in `docs/`:

- [phase-0-control-blueprint.md](/Users/pastoryjoseph/Desktop/saccos-backend/docs/phase-0-control-blueprint.md)
- [phase-0-process-maps.md](/Users/pastoryjoseph/Desktop/saccos-backend/docs/phase-0-process-maps.md)
- [phase-0-approval-policy-matrix.csv](/Users/pastoryjoseph/Desktop/saccos-backend/docs/phase-0-approval-policy-matrix.csv)
- [phase-0-regulatory-report-catalog.csv](/Users/pastoryjoseph/Desktop/saccos-backend/docs/phase-0-regulatory-report-catalog.csv)
- [phase-0-raci-matrix.csv](/Users/pastoryjoseph/Desktop/saccos-backend/docs/phase-0-raci-matrix.csv)
- [phase-0-phase1-2-data-model-change-list.md](/Users/pastoryjoseph/Desktop/saccos-backend/docs/phase-0-phase1-2-data-model-change-list.md)
- [phase-0-signoff-checklist.md](/Users/pastoryjoseph/Desktop/saccos-backend/docs/phase-0-signoff-checklist.md)

## Phase 1: Credit Risk Controls (Default + Guarantor Enforcement) (2-3 weeks)
Priority: `Critical`

Status (March 10, 2026): Backend critical scope implemented (`CR-001` to `CR-006`) with migrations `035`-`038`, APIs, audit trails, default detection scheduler support, guarantor exposure enforcement, and guarantor claims workflow.

Focus:

- Implement full default lifecycle and collections workflow.
- Implement guarantor exposure monitoring and liability enforcement.

Deliverables:

- Default case management (`delinquent -> in_recovery -> restructured/writeoff/recovered`).
- Collections action tracking with owner, due date, outcome.
- Guarantor utilization and exposure limits (real-time checks during loan approval).
- Guarantor claim posting and settlement workflow.

Suggested entities:

- `loan_default_cases`
- `collection_actions`
- `loan_restructures`
- `loan_writeoffs`
- `loan_recoveries`
- `guarantor_exposures`
- `guarantor_claims`

Exit criteria:

- Loan defaults are managed through auditable workflow states.
- Guarantor liabilities can be invoked and posted end-to-end.

Phase 1 execution artifacts in `docs/` and `supabase/sql/`:

- [phase-1-credit-risk-controls-execution-backlog.md](/Users/pastoryjoseph/Desktop/saccos-backend/docs/phase-1-credit-risk-controls-execution-backlog.md)
- [035_phase1_credit_risk_controls.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/035_phase1_credit_risk_controls.sql)
- [036_phase1_credit_risk_controls_rls.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/036_phase1_credit_risk_controls_rls.sql)

## Phase 2: Enterprise Maker-Checker Engine (2 weeks)
Priority: `Critical`

Status (March 10, 2026): Kickoff implemented with approval engine schema/API and high-value enforcement for `withdraw` and `loan_disburse`; remaining scope is UI, scheduler automation, and expanded operation coverage.

Focus:

- Expand dual control from selected areas to all high-risk operations.

Deliverables:

- Generic approval engine for high-risk operations.
- Dual approval enforcement for withdrawals and large teller transactions.
- Approval queue for checker roles with SLA timestamps.
- Rejection and escalation paths with reason codes.

Suggested entities:

- `approval_requests`
- `approval_steps`
- `approval_decisions`
- `approval_policies`

Exit criteria:

- Configured critical transactions cannot post without required approvals.
- Maker-checker violations are blocked and logged.

Phase 2 execution artifacts in `docs/` and `supabase/sql/`:

- [phase-2-maker-checker-execution-backlog.md](/Users/pastoryjoseph/Desktop/saccos-backend/docs/phase-2-maker-checker-execution-backlog.md)
- [039_phase2_maker_checker_engine.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/039_phase2_maker_checker_engine.sql)
- [040_phase2_maker_checker_engine_rls.sql](/Users/pastoryjoseph/Desktop/saccos-backend/supabase/sql/040_phase2_maker_checker_engine_rls.sql)

## Phase 3: Financial Statements and Period Governance (2 weeks)
Priority: `Important`

Focus:

- Add statutory financial statements from GL with period-safe reporting.

Deliverables:

- Balance Sheet report endpoint + export.
- Income Statement report endpoint + export.
- Periodized snapshots and comparative reporting support.
- Close-period guardrails to prevent out-of-period mutation without controlled reversal.

Suggested entities:

- `financial_statement_runs`
- `financial_snapshot_periods`

Exit criteria:

- Monthly/quarterly financial statements generated directly from posted journals.

## Phase 4: Notification Orchestration (1-2 weeks)
Priority: `Important`

Focus:

- Build event-driven notifications beyond OTP.

Deliverables:

- Loan approval/rejection alerts.
- Repayment due and overdue reminders.
- Transaction confirmation notifications.
- User channel preference controls.

Suggested entities:

- `notification_events`
- `notification_templates`
- `notification_dispatches`
- `notification_preferences`

Exit criteria:

- Core member/staff operational events generate reliable notifications with delivery status.

## Phase 5: Regulatory and Audit Hardening (2 weeks)
Priority: `Important`

Focus:

- Strengthen compliance reporting and audit evidence quality.

Deliverables:

- Regulatory report pack templates and run history.
- Enhanced audit evidence for approvals, reversals, overrides.
- Before/after value validation for critical writes including procedure-driven updates.

Suggested entities:

- `regulatory_report_runs`
- `regulatory_report_items`
- `regulatory_submissions`

Exit criteria:

- Compliance exports are reproducible with run metadata and traceable source references.

## Phase 6: Disaster Recovery Automation and Validation (1-2 weeks)
Priority: `Important`

Focus:

- Move DR from checklist-only to repeatable tested controls.

Deliverables:

- Automated backup verification jobs.
- Scheduled restore drills in isolated environment.
- DR dashboard with RPO/RTO actuals.

Suggested entities:

- `dr_drill_runs`
- `backup_verification_runs`

Exit criteria:

- Documented and evidenced successful restore drill meeting defined RPO/RTO.

## Phase 7: 100-Tenant Readiness Gate (1 week)
Priority: `Important`

Focus:

- Validate operational readiness at your current business target.

Deliverables:

- Mixed-workload load tests (members, loans, reports, platform).
- Soak test and incident runbook checks.
- Final go-live risk register with mitigations.

Exit criteria:

- Error rate, latency, and operational controls meet internal SLOs for 100-tenant target.

## Recommended Execution Order

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4
6. Phase 5
7. Phase 6
8. Phase 7

## Go/No-Go Rules

- Do not scale to wider production until Phase 1 and 2 are complete.
- Do not claim compliance-grade readiness until Phase 3 and 5 are complete.
- Do not claim resilience readiness until Phase 6 evidence is complete.
