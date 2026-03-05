# Backup + Restore Drill Checklist

This checklist is for production reliability validation of the SACCOS platform.

## 1) Backup Baseline

- Confirm PITR is enabled in Supabase project settings.
- Confirm retention period meets policy (recommended: 14-35 days).
- Confirm logical backups/snapshots are generated daily.
- Confirm backup metadata includes timestamp, project, region, and retention expiry.

## 2) Define Recovery Targets

- Set RPO target (recommended: <= 15 minutes with PITR).
- Set RTO target (recommended: <= 2 hours for service restoration).
- Record targets in your operations runbook.

## 3) Drill Preparation

- Select a drill window and notify stakeholders.
- Freeze schema changes during drill.
- Capture baseline metrics:
  - transaction count
  - latest journal entry id
  - latest audit log id
  - tenant/member counts

## 4) Restore Exercise

- Create isolated restore environment (never restore over production first).
- Restore database to selected timestamp.
- Run migration checksum verification:
  - ensure all SQL files up to current version are applied
  - ensure RLS policies are enabled
- Run application smoke checks:
  - auth login
  - tenant scoped reads
  - deposit/withdraw post
  - loan disbursement/repayment
  - reports export

## 5) Data Integrity Verification

- Validate financial integrity after restore:
  - journal entries are balanced (`sum(debit)=sum(credit)` per journal)
  - account balances reconcile to ledger totals
  - idempotency table contains expected completed records
- Validate auditability:
  - audit logs exist for sensitive actions
  - no cross-tenant leakage in sample queries

## 6) Cutover Readiness (if real incident)

- Confirm restored env API health checks pass.
- Confirm frontend and backend are pointed to restored DB safely.
- Confirm secrets/keys are valid for restored environment.
- Confirm monitoring/alerts are active before traffic cutover.

## 7) Post-Drill Review

- Record actual RPO and RTO achieved.
- Record failures and remediation owners.
- Update runbooks and automate missing steps.
- Schedule next monthly drill with previous gaps as test focus.

## 8) Minimum Evidence to Keep

- Drill date/time and participants.
- Recovery target timestamp.
- Evidence of restored environment health checks.
- Evidence of accounting integrity checks.
- Action items with deadlines and owners.
