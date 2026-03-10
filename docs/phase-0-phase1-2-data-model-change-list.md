# Phase 0 Approved Data Model Change List (Phase 1 + 2)

Updated: March 10, 2026  
Status: Draft for approval  
Owner: Platform Owner + Engineering Lead

## 1. Purpose

Capture the approved schema backlog required to execute:

- Phase 1: Credit risk controls (default + guarantor enforcement)
- Phase 2: Enterprise maker-checker engine

This is the Phase 0 exit artifact for data model readiness.

## 2. Phase 1 Entities (Credit Risk Controls)

## `loan_default_cases`

Purpose: Track default lifecycle state and risk posture per loan.

Core fields:

- `id` (uuid, pk)
- `tenant_id`, `branch_id`
- `loan_id`
- `status` (`delinquent`, `in_recovery`, `claim_ready`, `restructured`, `written_off`, `recovered`)
- `dpd_days`
- `opened_at`, `closed_at`
- `opened_by`, `closed_by`
- `reason_code`, `notes`
- `created_at`, `updated_at`

Indexes:

- (`tenant_id`, `status`, `opened_at`)
- (`loan_id`)

## `collection_actions`

Purpose: SLA-managed collections actions against a default case.

Core fields:

- `id`, `tenant_id`, `branch_id`
- `default_case_id`
- `action_type` (`call`, `visit`, `notice`, `legal_warning`, `settlement_offer`)
- `owner_user_id`
- `due_at`, `completed_at`
- `outcome_code`
- `status` (`open`, `completed`, `overdue`, `cancelled`)
- `escalated_at`, `escalation_reason`
- `created_at`, `updated_at`

Indexes:

- (`tenant_id`, `status`, `due_at`)
- (`default_case_id`, `status`)

## `loan_restructures`

Purpose: Approved restructure decisions and terms.

Core fields:

- `id`, `tenant_id`, `loan_id`, `default_case_id`
- `request_status` (`draft`, `submitted`, `approved`, `rejected`)
- `old_terms_json`, `new_terms_json`
- `effective_date`
- `request_reason`
- `approved_by`, `approved_at`
- `created_by`, `created_at`, `updated_at`

## `loan_writeoffs`

Purpose: Controlled write-off events.

Core fields:

- `id`, `tenant_id`, `loan_id`, `default_case_id`
- `principal_amount`, `interest_amount`, `total_amount`
- `writeoff_reason_code`
- `approval_request_id`
- `posted_journal_id`
- `written_off_at`, `written_off_by`
- `created_at`

## `loan_recoveries`

Purpose: Post-writeoff recoveries and reconciliation.

Core fields:

- `id`, `tenant_id`, `loan_id`, `default_case_id`
- `amount`
- `recovery_type` (`cash`, `guarantor`, `legal_settlement`, `adjustment`)
- `reference`
- `posted_journal_id`
- `recovered_at`, `recovered_by`
- `created_at`

## `guarantor_exposures`

Purpose: Real-time liability capacity per guarantor/member.

Core fields:

- `id`, `tenant_id`
- `guarantor_member_id`
- `committed_amount`
- `invoked_amount`
- `available_amount`
- `last_recalculated_at`
- `created_at`, `updated_at`

Indexes:

- (`tenant_id`, `guarantor_member_id`) unique

## `guarantor_claims`

Purpose: Invocation and settlement lifecycle for guarantor liabilities.

Core fields:

- `id`, `tenant_id`, `loan_id`, `default_case_id`
- `guarantor_member_id`
- `claim_amount`, `settled_amount`
- `status` (`draft`, `submitted`, `approved`, `posted`, `partial_settled`, `settled`, `waived`)
- `approval_request_id`
- `posted_journal_id`
- `claimed_at`, `claimed_by`
- `created_at`, `updated_at`

## 3. Phase 2 Entities (Maker-Checker Engine)

## `approval_policies`

Purpose: Policy-driven approval requirements.

Core fields:

- `id`, `tenant_id`, `operation_code`
- `risk_tier`
- `threshold_min`, `threshold_max`, `currency`
- `required_approvals`
- `allowed_maker_roles`, `allowed_checker_roles` (jsonb arrays)
- `allow_self_approval` (default false)
- `reject_on_sla_breach` (default true)
- `auto_expire_minutes`
- `is_active`
- `version`
- `created_at`, `updated_at`

Indexes:

- (`tenant_id`, `operation_code`, `is_active`)
- (`tenant_id`, `operation_code`, `version`)

## `approval_requests`

Purpose: Runtime request envelope per controlled operation.

Core fields:

- `id`, `tenant_id`, `branch_id`
- `operation_code`
- `resource_type`, `resource_id`
- `amount`, `currency`
- `maker_user_id`
- `status` (`pending`, `approved`, `rejected`, `expired`, `cancelled`)
- `policy_snapshot_json`
- `submitted_at`, `expires_at`, `resolved_at`
- `reason_code`, `notes`
- `created_at`, `updated_at`

Indexes:

- (`tenant_id`, `status`, `created_at`)
- (`tenant_id`, `operation_code`, `status`)

## `approval_steps`

Purpose: Optional multi-step sequenced approval routes.

Core fields:

- `id`, `approval_request_id`
- `step_order`
- `required_approvals`
- `eligible_roles` (jsonb)
- `status` (`pending`, `approved`, `rejected`, `expired`)
- `opened_at`, `closed_at`

## `approval_decisions`

Purpose: Individual checker decisions.

Core fields:

- `id`, `approval_request_id`, `approval_step_id`
- `checker_user_id`
- `decision` (`approve`, `reject`, `escalate`)
- `reason_code`, `notes`
- `before_snapshot_json`, `after_snapshot_json`
- `decided_at`

Indexes:

- (`approval_request_id`, `checker_user_id`) unique
- (`approval_request_id`, `decided_at`)

## 4. Shared Audit and Integrity Requirements

All new entities must include:

- `tenant_id` (except strictly child rows inheriting through parent)
- immutable `created_at`
- actor references for critical actions (`*_by`)
- soft-delete strategy only where required by regulation/policy

Audit requirements:

- Link critical posted outcomes to `journal_id`.
- Preserve policy snapshot for approval determinism.
- Enforce SoD at DB + service layer (`maker_user_id != checker_user_id`).

## 5. Migration and Rollout Order

1. Create Phase 2 approval tables (`approval_*`) first.
2. Create Phase 1 control tables (`loan_default_cases`, `collection_actions`, `guarantor_*`, `loan_*`).
3. Backfill required references (`approval_request_id`) into Phase 1 workflows.
4. Add indexes and constraints.
5. Enable feature flags tenant-by-tenant.

## 6. Phase 0 Approval Check

This document is considered approved when Product, Risk, Finance, Compliance, and Engineering sign off that:

1. Entities cover all Phase 1 and 2 exit criteria.
2. Required constraints/indexes are sufficient for operational scale.
3. No critical process state lacks durable persistence.

