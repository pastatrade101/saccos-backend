alter table public.user_profiles
    add column if not exists branch_id uuid references public.branches (id),
    add column if not exists must_change_password boolean not null default true,
    add column if not exists first_login_at timestamptz,
    add column if not exists member_id uuid references public.members (id);

update public.user_profiles
set must_change_password = false
where must_change_password = true
  and role <> 'member';

create index if not exists user_profiles_tenant_branch_idx
    on public.user_profiles (tenant_id, branch_id);

create unique index if not exists user_profiles_tenant_member_key
    on public.user_profiles (tenant_id, member_id)
    where member_id is not null and deleted_at is null;

alter table public.members
    add column if not exists member_no text,
    add column if not exists notes text;

alter table public.members
    alter column phone drop not null,
    alter column national_id drop not null;

create unique index if not exists members_tenant_member_no_key
    on public.members (tenant_id, member_no)
    where member_no is not null and deleted_at is null;

create unique index if not exists members_tenant_email_key
    on public.members (tenant_id, email)
    where email is not null and deleted_at is null;

create table if not exists public.import_jobs (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    branch_id uuid not null references public.branches (id),
    created_by uuid not null references auth.users (id),
    kind text not null default 'members_csv',
    status text not null default 'pending'
        check (status in ('pending', 'processing', 'completed', 'failed')),
    total_rows integer not null default 0,
    success_rows integer not null default 0,
    failed_rows integer not null default 0,
    credentials_path text,
    failures_path text,
    created_at timestamptz not null default now(),
    completed_at timestamptz
);

create table if not exists public.import_job_rows (
    id uuid primary key default gen_random_uuid(),
    job_id uuid not null references public.import_jobs (id) on delete cascade,
    row_number integer not null,
    raw jsonb not null,
    status text not null check (status in ('success', 'failed')),
    error text,
    member_id uuid references public.members (id),
    auth_user_id uuid references auth.users (id),
    created_at timestamptz not null default now()
);

create index if not exists import_jobs_tenant_created_idx
    on public.import_jobs (tenant_id, created_at desc);

create index if not exists import_jobs_branch_created_idx
    on public.import_jobs (branch_id, created_at desc);

create index if not exists import_job_rows_job_status_idx
    on public.import_job_rows (job_id, status, row_number);

alter table public.import_jobs enable row level security;
alter table public.import_job_rows enable row level security;

drop policy if exists import_jobs_select_policy on public.import_jobs;
create policy import_jobs_select_policy
    on public.import_jobs
    for select
    using (
        public.current_tenant_id() = tenant_id
        and (
            public.has_role(array['super_admin', 'branch_manager', 'auditor'])
            or public.is_internal_ops()
        )
    );

drop policy if exists import_jobs_insert_policy on public.import_jobs;
create policy import_jobs_insert_policy
    on public.import_jobs
    for insert
    with check (
        public.current_tenant_id() = tenant_id
        and public.has_role(array['super_admin', 'branch_manager'])
    );

drop policy if exists import_jobs_update_policy on public.import_jobs;
create policy import_jobs_update_policy
    on public.import_jobs
    for update
    using (
        public.current_tenant_id() = tenant_id
        and public.has_role(array['super_admin', 'branch_manager'])
    )
    with check (
        public.current_tenant_id() = tenant_id
        and public.has_role(array['super_admin', 'branch_manager'])
    );

drop policy if exists import_job_rows_select_policy on public.import_job_rows;
create policy import_job_rows_select_policy
    on public.import_job_rows
    for select
    using (
        exists (
            select 1
            from public.import_jobs jobs
            where jobs.id = import_job_rows.job_id
              and jobs.tenant_id = public.current_tenant_id()
              and (
                  public.has_role(array['super_admin', 'branch_manager', 'auditor'])
                  or public.is_internal_ops()
              )
        )
    );

drop policy if exists import_job_rows_insert_policy on public.import_job_rows;
create policy import_job_rows_insert_policy
    on public.import_job_rows
    for insert
    with check (
        exists (
            select 1
            from public.import_jobs jobs
            where jobs.id = import_job_rows.job_id
              and jobs.tenant_id = public.current_tenant_id()
              and public.has_role(array['super_admin', 'branch_manager'])
        )
    );

drop policy if exists import_job_rows_update_policy on public.import_job_rows;
create policy import_job_rows_update_policy
    on public.import_job_rows
    for update
    using (
        exists (
            select 1
            from public.import_jobs jobs
            where jobs.id = import_job_rows.job_id
              and jobs.tenant_id = public.current_tenant_id()
              and public.has_role(array['super_admin', 'branch_manager'])
        )
    )
    with check (
        exists (
            select 1
            from public.import_jobs jobs
            where jobs.id = import_job_rows.job_id
              and jobs.tenant_id = public.current_tenant_id()
              and public.has_role(array['super_admin', 'branch_manager'])
        )
    );
