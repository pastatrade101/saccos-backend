-- Platform operations metrics + incident logging for SaaS owner monitoring.

-- Allow explicit platform_owner role while preserving existing platform_admin behavior.
do $$
begin
    if exists (
        select 1
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        where t.typname = 'user_role'
          and n.nspname = 'public'
    ) then
        begin
            alter type public.user_role add value 'platform_owner';
        exception
            when duplicate_object then null;
        end;
    end if;
end
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
as $$
    select
        coalesce((auth.jwt() -> 'app_metadata' ->> 'platform_role') in ('internal_ops', 'platform_admin', 'platform_owner'), false)
        or exists (
            select 1
            from public.user_profiles up
            where up.user_id = auth.uid()
              and up.deleted_at is null
              and up.role::text in ('platform_admin', 'platform_owner')
              and up.is_active = true
        );
$$;

create table if not exists public.api_metrics (
    id bigserial primary key,
    tenant_id uuid references public.tenants(id) on delete set null,
    user_id uuid references auth.users(id) on delete set null,
    endpoint text not null,
    latency_ms numeric(12,3) not null check (latency_ms >= 0),
    status_code integer not null,
    request_bytes bigint not null default 0 check (request_bytes >= 0),
    response_bytes bigint not null default 0 check (response_bytes >= 0),
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists api_metrics_created_at_idx
    on public.api_metrics (created_at desc);
create index if not exists api_metrics_tenant_created_at_idx
    on public.api_metrics (tenant_id, created_at desc);
create index if not exists api_metrics_endpoint_created_at_idx
    on public.api_metrics (endpoint, created_at desc);
create index if not exists api_metrics_status_created_at_idx
    on public.api_metrics (status_code, created_at desc);
create index if not exists api_metrics_user_created_at_idx
    on public.api_metrics (user_id, created_at desc);

create table if not exists public.api_errors (
    id bigserial primary key,
    tenant_id uuid references public.tenants(id) on delete set null,
    endpoint text not null,
    status_code integer not null,
    message text not null,
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists api_errors_created_at_idx
    on public.api_errors (created_at desc);
create index if not exists api_errors_tenant_created_at_idx
    on public.api_errors (tenant_id, created_at desc);
create index if not exists api_errors_status_created_at_idx
    on public.api_errors (status_code, created_at desc);

alter table public.api_metrics enable row level security;
alter table public.api_errors enable row level security;

drop policy if exists api_metrics_platform_read_policy on public.api_metrics;
create policy api_metrics_platform_read_policy
on public.api_metrics
for select
to authenticated
using (public.is_platform_admin());

drop policy if exists api_metrics_platform_insert_policy on public.api_metrics;
create policy api_metrics_platform_insert_policy
on public.api_metrics
for insert
to authenticated
with check (public.is_platform_admin());

drop policy if exists api_errors_platform_read_policy on public.api_errors;
create policy api_errors_platform_read_policy
on public.api_errors
for select
to authenticated
using (public.is_platform_admin());

drop policy if exists api_errors_platform_insert_policy on public.api_errors;
create policy api_errors_platform_insert_policy
on public.api_errors
for insert
to authenticated
with check (public.is_platform_admin());
