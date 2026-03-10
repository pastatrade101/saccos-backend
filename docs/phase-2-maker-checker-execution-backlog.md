# Phase 2 Execution Backlog: Enterprise Maker-Checker Engine

Updated: March 10, 2026  
Scope: Phase 2 from [saccos-gap-remediation-phases.md](/Users/pastoryjoseph/Desktop/saccos-backend/docs/saccos-gap-remediation-phases.md)  
Priority: Critical

## 1. Delivery Objective

Expand maker-checker from isolated workflows to a reusable approval engine for high-risk operations.

## Current Progress

- `MC-001`: Done (schema and RLS migrations `039` / `040`)
- `MC-002`: Done (approval policy + request + decision APIs)
- `MC-003`: Done (high-value enforcement on `finance.withdraw`)
- `MC-004`: Done (high-value enforcement on `finance.loan_disburse`)
- `MC-005`: Pending (additional high-risk operations: teller cash close variance, reversals, writeoff approvals)
- `MC-006`: Pending (frontend approval queue + decision UI)
- `MC-007`: Pending (SLA escalation automation + reminder notifications)

## 2. Implemented in this kickoff

1. Generic approval engine tables:
   - `approval_policies`
   - `approval_requests`
   - `approval_steps`
   - `approval_decisions`
2. New backend module:
   - `GET /api/approvals/policies`
   - `PATCH /api/approvals/policies/:operationKey`
   - `GET /api/approvals/requests`
   - `GET /api/approvals/requests/:requestId`
   - `POST /api/approvals/requests/:requestId/approve`
   - `POST /api/approvals/requests/:requestId/reject`
3. Transaction enforcement:
   - High-value `withdraw` and `loan_disburse` now return `202` with `approval_required=true` and `approval_request_id` when checker approval is required.
   - Maker re-submits with `approval_request_id` after checker approval to execute posting.
   - Approval request is marked `executed` after successful posting.

## 3. API Execution Flow

### High-value withdrawal/disbursement

1. Maker submits transaction without `approval_request_id`.
2. API responds `202` with pending request metadata.
3. Checker approves request via approval endpoint.
4. Maker resubmits same transaction with `approval_request_id`.
5. API posts transaction and marks approval request `executed`.

### Rejection path

1. Checker rejects request.
2. Maker receives `APPROVAL_REQUEST_REJECTED` until a new request is created.

## 4. Acceptance Criteria (Phase 2 kickoff)

1. High-value withdrawals cannot post without checker decision.
2. High-value loan disbursements cannot post without checker decision.
3. Maker cannot self-approve (`MAKER_CHECKER_VIOLATION`).
4. Approval queue supports filtering by status/operation/branch.
5. All approval actions are audit logged.

## 5. Next Steps to complete Phase 2

1. Extend approval enforcement to:
   - teller close with significant cash variance
   - manual reversal operations
   - writeoff and restructure financial postings
2. Add auto-expiry scheduler for stale pending requests (`pending -> expired`).
3. Add approval queue/decision pages in frontend for branch manager/super admin.
4. Add integration tests:
   - pending -> approve -> execute
   - pending -> reject -> blocked execution
   - maker-checker violation cases

