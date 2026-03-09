# Phase 4 Progress: Horizontal Scale + Distributed Controls

Date: 2026-03-09

## Completed in this batch

### 1) Distributed rate limiting (instance-safe)

- Replaced in-memory `Map` rate-limit buckets with Postgres-backed atomic consumption via RPC.
- Added SQL migration:
  - `supabase/sql/031_phase4_distributed_rate_limits.sql`
- Updated all call sites to await distributed checks:
  - OTP send flows
  - Password setup link SMS flow
  - Import/auth user creation flow
  - Generic rate-limit middleware

### 2) Multi-instance readiness in compose

- Removed fixed backend `container_name` to avoid scaling conflicts in Docker Compose.
- Backend service can now be replicated in environments with a proper reverse proxy/load balancer strategy.

### 3) Env hardening for import/auth creation limits

- Added explicit env parsing/exports for:
  - `MEMBER_IMPORT_RATE_LIMIT_MAX`
  - `MEMBER_IMPORT_RATE_LIMIT_WINDOW_MS`
  - `AUTH_USER_CREATE_RATE_LIMIT_MAX`
  - `AUTH_USER_CREATE_RATE_LIMIT_WINDOW_MS`

## Migration required

Run this SQL file in Supabase SQL Editor:

- `supabase/sql/031_phase4_distributed_rate_limits.sql`

## Notes

- Idempotency was already DB-backed (`api_idempotency_requests`) and remains safe across replicas.
- OTP challenge state was already DB-backed (`auth_otp_challenges`) and remains safe across replicas.
- Observability in this app is per-instance memory; for real multi-instance SLO visibility, scrape each instance and aggregate in your metrics backend.
