update public.report_export_jobs
set retry_count = coalesce(retry_count, 0),
    max_retries = greatest(coalesce(max_retries, 3), 0),
    next_attempt_at = coalesce(next_attempt_at, now())
where retry_count is null
   or max_retries is null
   or next_attempt_at is null;

alter table public.report_export_jobs
    alter column retry_count set not null,
    alter column max_retries set not null,
    alter column next_attempt_at set not null;

create index if not exists report_export_jobs_cleanup_completed_idx
    on public.report_export_jobs (status, completed_at, created_at);

create index if not exists report_export_jobs_cleanup_dead_letter_idx
    on public.report_export_jobs (status, dead_lettered_at, created_at);
