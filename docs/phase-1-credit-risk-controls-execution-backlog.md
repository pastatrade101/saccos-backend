# Phase 1 Execution Backlog: Credit Risk Controls

Updated: March 10, 2026  
Scope: Phase 1 from [saccos-gap-remediation-phases.md](/Users/pastoryjoseph/Desktop/saccos-backend/docs/saccos-gap-remediation-phases.md)  
Priority: Critical

## 1. Delivery Objective

Implement auditable default and guarantor enforcement workflows end-to-end:

- default lifecycle state management
- collections actions with SLA and ownership
- guarantor exposure checks during lending decisions
- guarantor claim posting and settlement tracking

## Current Progress

- `CR-001`: Done (schema + RLS migrations 035/036)
- `CR-002`: Done (default case service + APIs)
- `CR-003`: Done (collection actions service + APIs)
- `CR-004`: Done (auto-detection service + manual trigger + optional scheduler; migration 037)
- `CR-005`: Done (guarantor exposure recompute APIs + approval-time enforcement; migration 038)
- `CR-006`: Done (guarantor claim create/submit/approve/reject/post/settle/waive APIs + audit + exposure recompute)

## 2. Sprint Sequence (2-3 weeks)

1. Sprint A (Schema + APIs foundation)
2. Sprint B (Business workflows + accounting hooks)
3. Sprint C (Controls, reporting, and go-live hardening)

## 3. Executable Tickets

## CR-001: Create Credit Risk Schema Baseline

- Type: Backend + DB
- Estimate: 2 days
- Dependencies: Phase 0 sign-off
- Deliverables:
  - apply migration skeletons:
    - `supabase/sql/035_phase1_credit_risk_controls.sql`
    - `supabase/sql/036_phase1_credit_risk_controls_rls.sql`
- Acceptance criteria:
  - tables, indexes, constraints, and enums created successfully
  - RLS enabled and policy smoke tests pass for branch manager/loan officer/auditor

## CR-002: Default Case Repository and Service Layer

- Type: Backend
- Estimate: 2 days
- Dependencies: CR-001
- Deliverables:
  - service methods for create/update/transition/list default cases
  - reason-code validation and fail-closed transition checks
- Acceptance criteria:
  - unauthorized transitions are blocked
  - transition history is auditable (actor + timestamp + reason)

## CR-003: Collections Action Workflow

- Type: Backend
- Estimate: 2 days
- Dependencies: CR-001, CR-002
- Deliverables:
  - create/update/complete/escalate collection actions
  - SLA fields (`due_at`, overdue status, escalation markers)
- Acceptance criteria:
  - overdue actions are detectable via API query
  - action outcomes are mandatory before completion

## CR-004: Loan Default Detection Trigger/Job

- Type: Backend Job
- Estimate: 1.5 days
- Dependencies: CR-002
- Deliverables:
  - scheduled default detection using DPD thresholds
  - open default case when threshold is breached
- Acceptance criteria:
  - idempotent behavior (no duplicate open cases)
  - configurable threshold by tenant policy

## CR-005: Guarantor Exposure Calculation and Checks

- Type: Backend + Policy
- Estimate: 2 days
- Dependencies: CR-001
- Deliverables:
  - exposure compute logic and update workflow
  - validation hook in loan approval/disbursement path
- Acceptance criteria:
  - approval blocked when exposure limit exceeded
  - exposure values are queryable and up to date

## CR-006: Guarantor Claim Workflow

- Type: Backend + Accounting
- Estimate: 2 days
- Dependencies: CR-002, CR-005
- Deliverables:
  - claim create/submit/approve/post/settle states
  - journal linkage (`posted_journal_id`)
- Acceptance criteria:
  - claim cannot post before approval
  - claim settlement updates claim and exposure consistently

## CR-007: Restructure, Writeoff, and Recovery Workflows

- Type: Backend + Accounting
- Estimate: 2.5 days
- Dependencies: CR-002
- Deliverables:
  - restructure record lifecycle
  - writeoff record with approval requirement
  - recovery posting linked to journals
- Acceptance criteria:
  - writeoff and recovery actions are traceable to journal entries
  - invalid state transitions are blocked

## CR-008: API Endpoints and Validation Schemas

- Type: Backend API
- Estimate: 2 days
- Dependencies: CR-002, CR-003, CR-006, CR-007
- Deliverables:
  - module routes/controllers/schemas for defaults and guarantor claims
  - paginated listing endpoints (`page`, `limit<=100`)
- Acceptance criteria:
  - endpoint auth and tenant scoping enforced
  - no unbounded list endpoints introduced

## CR-009: Audit and Evidence Hardening

- Type: Backend + Audit
- Estimate: 1.5 days
- Dependencies: CR-006, CR-007
- Deliverables:
  - audit events for all critical transitions and postings
  - before/after snapshots for critical decision points
- Acceptance criteria:
  - required audit fields present in every critical path
  - missing evidence blocks critical actions

## CR-010: Branch Manager and Loan Officer UI

- Type: Frontend
- Estimate: 2.5 days
- Dependencies: CR-008
- Deliverables:
  - collections queue
  - default case detail with transition controls
  - guarantor exposure and claim panel
- Acceptance criteria:
  - role-aware controls (no unauthorized actions visible)
  - server-side pagination for heavy lists

## CR-011: Test Pack and Regression Coverage

- Type: QA + Backend + Frontend
- Estimate: 2 days
- Dependencies: CR-008, CR-010
- Deliverables:
  - integration tests for transitions and enforcement paths
  - regression tests on loan approval/disbursement and reporting paths
- Acceptance criteria:
  - happy path + failure path coverage for all new workflows
  - no critical regressions in existing lending flows

## CR-012: Go-Live Readiness and Runbook

- Type: Ops + Product + Engineering
- Estimate: 1 day
- Dependencies: CR-001 through CR-011
- Deliverables:
  - rollout runbook and feature-flag strategy
  - rollback plan and data-fix SOP
- Acceptance criteria:
  - staged enablement plan approved
  - support/on-call team has operational playbook

## 4. Definition of Done (Phase 1)

Phase 1 is complete when:

1. Default cases are lifecycle-managed in system (not offline/manual only).
2. Collections actions are owned, SLA-tracked, and auditable.
3. Guarantor exposure limits are enforced at decision points.
4. Guarantor claims can be invoked and posted with traceable approvals.
5. Critical transitions and postings have full audit evidence.
