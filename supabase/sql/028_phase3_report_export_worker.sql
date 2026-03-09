create or replace function public.claim_report_export_job()
returns public.report_export_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
    claimed_job public.report_export_jobs;
begin
    with next_job as (
        select id
        from public.report_export_jobs
        where status = 'pending'
        order by created_at asc
        for update skip locked
        limit 1
    )
    update public.report_export_jobs as jobs
    set
        status = 'processing',
        started_at = coalesce(jobs.started_at, now()),
        error_code = null,
        error_message = null
    from next_job
    where jobs.id = next_job.id
    returning jobs.* into claimed_job;

    if claimed_job.id is null then
        return null;
    end if;

    return claimed_job;
end;
$$;

revoke all on function public.claim_report_export_job() from public;
revoke all on function public.claim_report_export_job() from anon;
revoke all on function public.claim_report_export_job() from authenticated;
grant execute on function public.claim_report_export_job() to service_role;
