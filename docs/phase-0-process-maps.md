# Phase 0 Process Maps (Target State)

Updated: March 10, 2026  
Status: Draft for sign-off  
Owner: Credit + Operations + Compliance

## 1. Purpose

Define the authoritative target-state process maps required by Phase 0 deliverables:

- Loan default lifecycle
- Collections workflow
- Guarantor claim flow
- Override / exception flow

All maps are designed for fail-closed behavior and enterprise maker-checker controls.

## 2. Loan Default Lifecycle Map

### 2.1 State Flow

`active` -> `delinquent` -> `in_recovery` -> (`restructured` | `claim_ready` | `written_off` | `recovered`)

Detailed transition intent:

1. `active` -> `delinquent`  
   Trigger: DPD threshold breached (policy default: 30+ days).
2. `delinquent` -> `in_recovery`  
   Trigger: first formal collections action logged and assigned.
3. `in_recovery` -> `restructured`  
   Trigger: approved restructure decision.
4. `in_recovery` -> `claim_ready`  
   Trigger: guarantor invocation eligibility met.
5. `in_recovery` -> `written_off`  
   Trigger: approved write-off decision after recovery controls.
6. `in_recovery` -> `recovered`  
   Trigger: outstanding balance fully settled.

### 2.2 Mandatory Controls Per Transition

- Actor, timestamp, reason code, notes required.
- Before/after values persisted in audit logs.
- Critical transitions (`claim_ready`, `written_off`, `restructured`) require maker-checker approval.
- Any missing control evidence blocks transition.

## 3. Collections Workflow Map

### 3.1 Operational Flow

1. Case opened (`delinquent`)
2. Collections action created (`call`, `visit`, `notice`, `legal_warning`, `settlement_offer`)
3. Action owner assigned + due date + SLA
4. Action outcome logged (`promised_to_pay`, `partial_paid`, `no_contact`, `refused`, `escalate`)
5. Next action scheduled or case escalated
6. Case closed by resolution (`recovered`, `restructured`, `written_off`)

### 3.2 Escalation Rules

- SLA breach auto-flags case as escalated.
- Escalated actions require manager acknowledgement.
- Repeated no-contact outcomes trigger legal-prep queue.

## 4. Guarantor Claim Workflow Map

### 4.1 Claim Flow

1. Validate loan case in `claim_ready` state
2. Compute guarantor exposure and available liability
3. Create draft guarantor claim
4. Maker-checker approval on claim request
5. Post claim accounting entries
6. Track settlement (`open`, `partial`, `settled`, `waived`)

### 4.2 Hard Controls

- Claim creation blocked if exposure exceeds approved limits.
- Claim posting blocked until approval is completed.
- Claim settlement requires traceable payment references.

## 5. Override / Exception Flow Map

### 5.1 Scope

Applies to high-risk overrides:

- withdrawal override
- out-of-period journal
- manual balance adjustment
- exceptional write-off

### 5.2 Flow

1. Maker submits override request
2. Mandatory reason code + evidence attachment
3. Approval route resolved by policy (risk tier + amount + role)
4. Checker decision (`approve` | `reject` | `escalate`)
5. On approval, transaction is released for posting
6. Full audit trail persisted (request + decision + before/after)

### 5.3 Guardrails

- No self-approval.
- Expired requests auto-reject.
- Missing reason/evidence blocks submission.

## 6. Control Points Matrix

| Process | Control Point | Blocking Condition | Evidence Required |
| --- | --- | --- | --- |
| Default lifecycle | Transition to `claim_ready` | No approved recovery history | Case actions + approvals |
| Default lifecycle | Transition to `written_off` | Missing dual approval | Approval decision chain |
| Collections | Action closure | Missing outcome/status | Outcome code + notes |
| Guarantor claim | Claim posting | No approved claim | Claim approval + journal ref |
| Override | Execute override | SoD violation or SLA breach | Request + checker decision |

## 7. Sign-Off Gate

This artifact is considered approved when:

1. Credit Manager confirms lifecycle transitions.
2. Operations Manager confirms action taxonomy/SLA.
3. Compliance confirms control evidence sufficiency.
4. Internal Auditor confirms auditability and SoD enforceability.

