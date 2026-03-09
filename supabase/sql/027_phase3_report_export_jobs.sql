create table if not exists public.report_export_jobs (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    created_by uuid not null references auth.users (id),
    report_key text not null,
    format text not null check (format in ('csv', 'pdf')),
    query jsonb not null default '{}'::jsonb,
    status text not null default 'pending'
        check (status in ('pending', 'processing', 'completed', 'failed')),
    filename text,
    title text,
    row_count integer not null default 0,
    result_path text,
    content_type text,
    error_code text,
    error_message text,
    started_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists report_export_jobs_tenant_created_idx
    on public.report_export_jobs (tenant_id, created_at desc);

create index if not exists report_export_jobs_tenant_status_created_idx
    on public.report_export_jobs (tenant_id, status, created_at desc);

create index if not exists report_export_jobs_creator_created_idx
    on public.report_export_jobs (created_by, created_at desc);

alter table public.report_export_jobs enable row level security;

drop policy if exists report_export_jobs_select_policy on public.report_export_jobs;
create policy report_export_jobs_select_policy
    on public.report_export_jobs
    for select
    using (
        public.current_tenant_id() = tenant_id
        and (
            public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
            or public.is_internal_ops()
        )
    );

drop policy if exists report_export_jobs_insert_policy on public.report_export_jobs;
create policy report_export_jobs_insert_policy
    on public.report_export_jobs
    for insert
    with check (
        public.current_tenant_id() = tenant_id
        and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
    );

drop policy if exists report_export_jobs_update_policy on public.report_export_jobs;
create policy report_export_jobs_update_policy
    on public.report_export_jobs
    for update
    using (
        public.current_tenant_id() = tenant_id
        and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
    )
    with check (
        public.current_tenant_id() = tenant_id
        and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
    );
