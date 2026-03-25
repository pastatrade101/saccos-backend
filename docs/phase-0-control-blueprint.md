# Phase 0 Control Blueprint (Enterprise)

Updated: March 10, 2026
Version: 1.0
Document owner: System Owner
Confidentiality: Internal - Controlled

## 1. Document Control

| Field | Value |
| --- | --- |
| Phase | Phase 0 (Scope Lock + Control Blueprint) |
| Effective date | March 10, 2026 |
| Review cadence | Quarterly or after major regulatory/process change |
| Approval required from | Product, Finance, Credit Risk, Compliance, Operations, Security |
| Change control | Any control change must include risk assessment + approval trail |

## 2. Objective

Establish an auditable, regulator-ready control baseline before implementing Phase 1 and Phase 2 modules.

## 3. Scope

In scope:

- Credit risk controls for defaults, guarantor liability, and recoveries.
- Enterprise maker-checker policy for critical operations.
- Regulatory reporting control catalog and ownership.
- DR control targets and evidence requirements.

Out of scope:

- Full implementation of default/collections modules (Phase 1).
- Full implementation of generalized approval engine (Phase 2).

## 4. Enterprise Control Principles

1. **Fail-closed control behavior**: critical transactions must block if control checks fail.
2. **Segregation of duties (SoD)**: maker cannot be checker for same request.
3. **Least privilege**: approvals constrained by role and branch/tenant scope.
4. **Immutable auditability**: all approvals/rejections/overrides stored with before/after state.
5. **Deterministic financial traceability**: all approved transactions map to journal references.
6. **Policy versioning**: control decisions must be versioned and reviewable.

## 5. Control Objectives and Baseline Decisions

| Control ID | Objective | Baseline Policy | Owner | Reviewer | Evidence | Review Frequency |
| --- | --- | --- | --- | --- | --- | --- |
| CTRL-CR-001 | Early default detection | Open default case at >= 30 DPD and classify stage | Credit Manager | Compliance Lead | Case history + transition logs | Monthly |
| CTRL-CR-002 | Enforce guarantor claim process | Guarantor claim only after approved case stage `claim_ready` | Credit Manager | Finance Controller | Approved claim record + journals | Monthly |
| CTRL-MC-001 | Prevent single-user critical posting | Maker-checker mandatory by policy matrix for critical ops | Operations Manager | Internal Auditor | Approval request trail | Monthly |
| CTRL-MC-002 | High-value withdrawal safety | TZS threshold based 2-step approval, reason code mandatory | Finance Manager | Compliance Lead | Request + reason + approver IDs | Weekly |
| CTRL-GL-001 | Out-of-period posting control | Block by default; controlled reversal exception only | Finance Controller | Auditor | Reversal approvals + journal links | Monthly |
| CTRL-RPT-001 | Regulatory reporting governance | Owner/reviewer/approver must be assigned per report | Compliance Lead | System Owner | Report run metadata | Monthly |
| CTRL-DR-001 | Business continuity readiness | RPO <= 15m, RTO <= 4h with evidenced drills | System Owner | Security Lead | Drill reports + timestamps | Quarterly |

## 6. Workflow Requirements

### 6.1 Loan Default and Collections

Required stages:

1. `monitoring`
2. `delinquent`
3. `in_recovery`
4. `claim_ready` or `restructure_candidate`
5. `recovered` or `written_off`

Mandatory controls:

- Stage transitions require actor, timestamp, reason, and optional attachment evidence.
- Write-off and guarantor claim transitions require maker-checker approval.
- Collections actions must be SLA-tracked and escalated on breach.

### 6.2 Guarantor Liability Enforcement

Required controls:

- Validate guarantor eligibility and exposure before claim creation.
- Enforce approved claim workflow before posting liability actions.
- Track claim balance, settlement status, and residual exposure.

### 6.3 General Maker-Checker Framework

Required controls:

- Policy-driven approvals by operation + threshold + scope.
- Configurable minimum checker count.
- SLA expiration behavior must default to reject/expire, not auto-approve.
- Enforce no self-approval and no role-conflicted approvals.

## 7. Data Governance and Audit Requirements

Mandatory metadata for new control entities:

- `tenant_id`, `branch_id` (when applicable)
- `created_by`, `updated_by`, `approved_by` (when applicable)
- `created_at`, `updated_at`, `approved_at`
- `status`, `reason_code`, `notes`
- `source_reference` (journal/request/case ID linkage)

Retention baseline:

- Control decisions and approvals: minimum 7 years.
- Regulatory report run metadata: minimum 7 years.
- DR drill evidence: minimum 3 years.

## 8. Phase 0 Artifacts (Authoritative)

- Approval policy matrix: [phase-0-approval-policy-matrix.csv](/Users/pastoryjoseph/Desktop/saccos-backend/docs/phase-0-approval-policy-matrix.csv)
- Regulatory report catalog: [phase-0-regulatory-report-catalog.csv](/Users/pastoryjoseph/Desktop/saccos-backend/docs/phase-0-regulatory-report-catalog.csv)
- RACI matrix: [phase-0-raci-matrix.csv](/Users/pastoryjoseph/Desktop/saccos-backend/docs/phase-0-raci-matrix.csv)
- Sign-off checklist: [phase-0-signoff-checklist.md](/Users/pastoryjoseph/Desktop/saccos-backend/docs/phase-0-signoff-checklist.md)
- Target-state process maps: [phase-0-process-maps.md](/Users/pastoryjoseph/Desktop/saccos-backend/docs/phase-0-process-maps.md)
- Phase 1 and 2 data model change list: [phase-0-phase1-2-data-model-change-list.md](/Users/pastoryjoseph/Desktop/saccos-backend/docs/phase-0-phase1-2-data-model-change-list.md)

## 9. One-Week Execution Plan (Phase 0)

| Day | Focus | Primary Output | Owner |
| --- | --- | --- | --- |
| Day 1 | Kickoff + scope lock | Confirmed decision log and owner assignments | System Owner |
| Day 2 | Credit + guarantor process design | Draft process maps + transition controls | Credit Manager |
| Day 3 | Maker-checker threshold policy | Draft approval matrix with thresholds | Operations + Finance |
| Day 4 | Regulatory + DR requirements freeze | Report catalog + RPO/RTO evidence requirements | Compliance + Security |
| Day 5 | Cross-functional review | Signed checklist and approved Phase 1/2 data model list | Product Owner |

## 10. Exit Criteria (Phase 0 Complete)

Phase 0 is complete only when all are true:

1. Control objectives approved by all required owners.
2. Approval policy matrix validated and signed.
3. Regulatory catalog ownership and deadlines confirmed.
4. RACI assigned with accountable owners.
5. Sign-off checklist completed with evidence links.
6. Process maps approved for default, collections, guarantor claim, and override flows.
7. Phase 1 and 2 data model change list approved.
