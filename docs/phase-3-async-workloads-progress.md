# Phase 3 Progress: Async Workload Architecture

Date: 2026-03-09

## Completed in this batch

### 1) Async report export jobs (v1)

- Added background job flow for report exports using `report_export_jobs`.
- Existing export endpoints now support `?async=true` and return `202` with `job_id`.
- Processing updates job status:
  - `pending` -> `processing` -> `completed` / `failed`

### 2) Job lifecycle endpoints

- Added endpoints:
  - `GET /api/reports/export-jobs/:jobId`
  - `GET /api/reports/export-jobs/:jobId/download`
- Download endpoint returns a signed URL after job completion.

### 3) Shared export artifact builder

- Refactored export generation so both sync and async flows use one builder:
  - PDF generation
  - CSV generation

### 4) Storage-backed artifacts

- Async report files are uploaded to `IMPORTS_BUCKET` and downloaded via signed URL.

### 5) Anti-stall safeguards

- Added job-level timeout and upload timeout protections.
- Async failures now log explicit error context to backend logs.
- Jobs that hit timeout/failure are marked `failed` with `error_code` and `error_message`.

### 6) Dedicated report worker (v2)

- Removed in-request `setImmediate` execution from API path.
- Added DB-backed claim function using `FOR UPDATE SKIP LOCKED` so workers can safely claim one pending job at a time.
- Added worker runtime entrypoint:
  - `node src/worker.js`
- Added Docker service:
  - `report-worker` in `docker-compose.yml`
- Added npm script:
  - `npm run start:worker`

### 7) Retry + dead-letter handling (v3)

- Added retry metadata on export jobs:
  - `retry_count`
  - `max_retries`
  - `next_attempt_at`
  - `dead_lettered_at`
- Worker now uses exponential backoff retries for transient failures.
- When retries are exhausted, job is moved to dead-letter state as:
  - `status = failed`
  - `dead_lettered_at` set
- Claim function now only picks jobs that are due:
  - `status = pending`
  - `next_attempt_at <= now()`

### 8) Retention + cleanup policy (v4)

- Added worker-side periodic cleanup for old export jobs and stored artifacts.
- Cleanup targets:
  - old `completed` jobs
  - old dead-lettered `failed` jobs
- Added manual cleanup command:
  - `npm run cleanup:report-exports`
- Added retention env controls:
  - `REPORT_EXPORT_CLEANUP_ENABLED`
  - `REPORT_EXPORT_CLEANUP_INTERVAL_MS`
  - `REPORT_EXPORT_CLEANUP_BATCH_SIZE`
  - `REPORT_EXPORT_RETENTION_COMPLETED_DAYS`
  - `REPORT_EXPORT_RETENTION_FAILED_DAYS`

## Migration required

Run these SQL files in Supabase SQL Editor:

- `supabase/sql/027_phase3_report_export_jobs.sql`
- `supabase/sql/028_phase3_report_export_worker.sql`
- `supabase/sql/029_phase3_report_export_retries.sql`
- `supabase/sql/030_phase3_report_export_cleanup_indexes.sql`

## Notes

- Async exports are now queue-based with separate worker execution.
- Cleanup is safe to run repeatedly and can be triggered manually or by worker interval.
