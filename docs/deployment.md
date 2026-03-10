# Deployment Guide

Production deployment notes for backend and frontend.

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

Apply in this exact sequence on a fresh environment:

1. `supabase/sql/001_schema.sql`
2. `supabase/sql/002_rls.sql`
3. `supabase/sql/003_procedures.sql`
4. `supabase/sql/001_plans.sql`
5. `supabase/sql/002_rls_plans.sql`
6. `supabase/sql/004_shares_and_dividends.sql`
7. `supabase/sql/005_dividend_module.sql`
8. `supabase/sql/006_performance_indexes.sql`
9. `supabase/sql/007_loan_accounts.sql`
10. `supabase/sql/008_loan_repayment_tracking_fix.sql`
11. `supabase/sql/009_auditor_upgrade.sql`
12. `supabase/sql/010_member_import.sql`
13. `supabase/sql/011_import_storage_policies.sql`
14. `supabase/sql/012_temp_credentials.sql`
15. `supabase/sql/013_phase1_foundation.sql`
16. `supabase/sql/014_phase1_rls.sql`
17. `supabase/sql/015_phase1_procedures.sql`
18. `supabase/sql/016_phase2_cash_control.sql`
19. `supabase/sql/017_phase2_cash_control_rls.sql`
20. `supabase/sql/018_phase2_receipts_storage.sql`
21. `supabase/sql/019_idempotency_keys.sql`
22. `supabase/sql/020_dividend_submission_handoff.sql`
23. `supabase/sql/021_loan_workflow.sql`
24. `supabase/sql/022_loan_workflow_rls.sql`
25. `supabase/sql/023_performance_reliability.sql`
26. `supabase/sql/025_auth_otp_challenges.sql`
27. `supabase/sql/026_phase2_seek_indexes.sql`
28. `supabase/sql/027_phase3_report_export_jobs.sql`
29. `supabase/sql/028_phase3_report_export_worker.sql`
30. `supabase/sql/029_phase3_report_export_retries.sql`
31. `supabase/sql/030_phase3_report_export_cleanup_indexes.sql`
32. `supabase/sql/031_phase4_distributed_rate_limits.sql`
33. `supabase/sql/032_phase4_otp_atomic_verify.sql`
34. `supabase/sql/033_phase5_platform_tenant_indexes.sql`
35. `supabase/sql/034_member_profile_identity_fields.sql`
36. `supabase/sql/035_phase1_credit_risk_controls.sql`
37. `supabase/sql/036_phase1_credit_risk_controls_rls.sql`
38. `supabase/sql/037_phase1_default_detection_policy.sql`
39. `supabase/sql/038_phase1_guarantor_exposure_policy.sql`
40. `supabase/sql/039_phase2_maker_checker_engine.sql`
41. `supabase/sql/040_phase2_maker_checker_engine_rls.sql`
42. `supabase/sql/041_phase3_financial_statements.sql`
43. `supabase/sql/042_phase3_financial_statements_rls.sql`

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
   - platform owner
   - tenant super admin
   - branch manager
   - loan officer
   - teller
   - auditor
   - member
2. Tenant setup + super admin bootstrap works.
3. Member application approval path works.
4. Loan workflow path works:
   - submit -> appraise -> approve -> disburse
5. Deposit/withdraw works with idempotency.
6. Cash control session and receipt flow works.
7. Auditor routes are read-only and accessible only by auditor.
8. CSV import path and credentials download works.
9. `/me/subscription` returns active entitlements.
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
