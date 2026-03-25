# Deployment Guide

Production deployment notes for the current single-client deployment of the backend and frontend.

Current deployment note:

- The runtime is one deployed workspace for one SACCOS client.
- The schema and migration chain still include legacy SaaS-era `tenant`, `plan`, and `subscription` artifacts that remain required for compatibility.
- There are no active platform provisioning routes in the mounted API, but compatibility data such as `/api/me/subscription` is still used by the frontend.

## Runtime Requirements

- Node.js 20+ (backend and local frontend builds)
- Docker + Docker Compose (recommended deployment path)
- Supabase project with:
  - Postgres
  - Auth
  - Storage bucket `imports` (private)
  - Storage bucket for receipts if configured

## Environment Variables

Backend `.env` (from `.env.example`):

- `PORT`
- `API_PREFIX`
- `NODE_ENV`
- `CORS_ORIGINS`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `HIGH_VALUE_THRESHOLD_TZS`
- import and receipt policy env keys (see `.env.example`)

Frontend `frontend/.env` (from `frontend/.env.example`):

- `VITE_API_BASE_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Never place service-role keys in frontend env.

## Database Migration Apply Order

Apply the files below in this exact order on a fresh environment:

- `supabase/sql/001_schema.sql`
- `supabase/sql/002_rls.sql`
- `supabase/sql/003_procedures.sql`
- `supabase/sql/001_plans.sql`
- `supabase/sql/002_rls_plans.sql`
- `supabase/sql/004_shares_and_dividends.sql`
- `supabase/sql/005_dividend_module.sql`
- `supabase/sql/006_performance_indexes.sql`
- `supabase/sql/007_loan_accounts.sql`
- `supabase/sql/008_loan_repayment_tracking_fix.sql`
- `supabase/sql/009_auditor_upgrade.sql`
- `supabase/sql/010_member_import.sql`
- `supabase/sql/011_import_storage_policies.sql`
- `supabase/sql/012_temp_credentials.sql`
- `supabase/sql/013_phase1_foundation.sql`
- `supabase/sql/014_phase1_rls.sql`
- `supabase/sql/015_phase1_procedures.sql`
- `supabase/sql/016_phase2_cash_control.sql`
- `supabase/sql/017_phase2_cash_control_rls.sql`
- `supabase/sql/018_phase2_receipts_storage.sql`
- `supabase/sql/019_idempotency_keys.sql`
- `supabase/sql/020_dividend_submission_handoff.sql`
- `supabase/sql/021_loan_workflow.sql`
- `supabase/sql/022_loan_workflow_rls.sql`
- `supabase/sql/023_performance_reliability.sql`
- `supabase/sql/024_member_accounts_schema_compat.sql`
- `supabase/sql/025_auth_otp_challenges.sql`
- `supabase/sql/026_phase2_seek_indexes.sql`
- `supabase/sql/027_phase3_report_export_jobs.sql`
- `supabase/sql/028_phase3_report_export_worker.sql`
- `supabase/sql/029_phase3_report_export_retries.sql`
- `supabase/sql/030_phase3_report_export_cleanup_indexes.sql`
- `supabase/sql/031_phase4_distributed_rate_limits.sql`
- `supabase/sql/032_phase4_otp_atomic_verify.sql`
- `supabase/sql/033_phase5_platform_tenant_indexes.sql`
- `supabase/sql/034_member_profile_identity_fields.sql`
- `supabase/sql/035_phase1_credit_risk_controls.sql`
- `supabase/sql/036_phase1_credit_risk_controls_rls.sql`
- `supabase/sql/037_phase1_default_detection_policy.sql`
- `supabase/sql/038_phase1_guarantor_exposure_policy.sql`
- `supabase/sql/039_phase2_maker_checker_engine.sql`
- `supabase/sql/040_phase2_maker_checker_engine_rls.sql`
- `supabase/sql/041_phase3_financial_statements.sql`
- `supabase/sql/042_phase3_financial_statements_rls.sql`
- `supabase/sql/043_platform_operations_metrics.sql`
- `supabase/sql/044_tenant_purge_guardrail.sql`
- `supabase/sql/045_branch_alert_notification_dispatches.sql`
- `supabase/sql/046_sms_trigger_settings.sql`
- `supabase/sql/047_subscription_latest_lookup.sql`
- `supabase/sql/048_platform_tenant_branch_counts.sql`
- `supabase/sql/049_platform_operations_overview_rpc.sql`
- `supabase/sql/050_security_invoker_views.sql`
- `supabase/sql/051_harden_function_search_path.sql`
- `supabase/sql/052_move_pg_trgm_to_extensions_schema.sql`
- `supabase/sql/053_phase4_loan_application_approval_rpc.sql`
- `supabase/sql/054_phase4_loan_application_rejection_rpc.sql`
- `supabase/sql/055_phase4_loan_application_submit_rpc.sql`
- `supabase/sql/056_phase4_loan_application_appraisal_rpc.sql`
- `supabase/sql/057_phase4_loan_approval_cycles.sql`
- `supabase/sql/058_phase4_loan_approval_cycle_conflict_fix.sql`
- `supabase/sql/059_phase4_loan_approval_enum_cast_fix.sql`
- `supabase/sql/060_phase5_member_payment_orders.sql`
- `supabase/sql/061_phase5_member_payment_orders_savings.sql`
- `supabase/sql/062_phase4_loan_application_submitted_rejection.sql`
- `supabase/sql/063_phase4_loan_application_reference_uniqueness.sql`
- `supabase/sql/064_penalty_rules_enhancements.sql`
- `supabase/sql/065_loan_products_enhancements.sql`
- `supabase/sql/066_savings_product_enhancements.sql`
- `supabase/sql/067_member_pending_activation_status.sql`
- `supabase/sql/068_member_payment_orders_membership_fee.sql`
- `supabase/sql/069_member_application_constraints.sql`
- `supabase/sql/070_member_payment_orders_loan_repayment.sql`
- `supabase/sql/071_fix_seeded_loan_income_mappings.sql`

For existing environments, run only new additive migrations and validate policy collisions before execution.

## Backend Deployment (Docker)

Files:

- `Dockerfile`
- `docker-compose.yml`

Commands:

```bash
cp .env.example .env
docker compose build
docker compose up -d
docker compose logs -f backend
```

Health checks:

```bash
curl http://127.0.0.1:5000/health
curl http://127.0.0.1:5000/api/health
```

## Frontend Deployment (Docker)

Files:

- `frontend/Dockerfile`
- `frontend/docker-compose.yml`
- `frontend/nginx.conf`

Commands:

```bash
cd frontend
cp .env.example .env
docker compose build
docker compose up -d
docker compose logs -f frontend
```

Default frontend URL:

- `http://localhost:8080`

## Post-Deploy Validation Checklist

1. Login works for:
   - super admin
   - branch manager
   - loan officer
   - teller
   - auditor
   - member
2. Initial super admin bootstrap works.
3. Member application approval path works.
4. Loan workflow path works:
   - submit -> appraise -> approve -> disburse
5. Deposit/withdraw works with idempotency.
6. Cash control session and receipt flow works.
7. Auditor routes are read-only and accessible only by auditor.
8. CSV import path and credentials download works.
9. `/me/subscription` returns current workspace status/capabilities if that compatibility endpoint is enabled in the deployment.
10. Exports download correctly.

## Security and Operations

- Run API behind TLS terminator (Nginx/Caddy/ALB).
- Restrict Supabase dashboard access and require MFA.
- Rotate service-role key on schedule.
- Enable Supabase backup/PITR and retention policy.
- Forward app logs and audit exceptions to central monitoring.
- Use at least two backend instances for HA.
- Run backup and restore drills monthly:
  - see [backup-restore-drill-checklist.md](/Users/pastoryjoseph/Desktop/saccos-backend/docs/backup-restore-drill-checklist.md)
