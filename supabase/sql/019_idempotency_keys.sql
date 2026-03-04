create table if not exists public.api_idempotency_requests (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid references public.tenants (id),
    scope_key text not null,
    user_id uuid not null references auth.users (id),
    method text not null,
    route_path text not null,
    idempotency_key text not null,
    request_hash text not null,
    response_status integer,
    response_body jsonb,
    created_at timestamptz not null default now(),
    completed_at timestamptz
);

create unique index if not exists api_idempotency_requests_scope_key_idx
    on public.api_idempotency_requests (scope_key, user_id, method, route_path, idempotency_key);

create index if not exists api_idempotency_requests_tenant_created_idx
    on public.api_idempotency_requests (tenant_id, created_at desc);

alter table public.api_idempotency_requests enable row level security;

drop policy if exists api_idempotency_requests_select_policy on public.api_idempotency_requests;
create policy api_idempotency_requests_select_policy
    on public.api_idempotency_requests
    for select
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_role(array['super_admin', 'branch_manager', 'auditor'])
            or user_id = auth.uid()
        )
    );

drop policy if exists api_idempotency_requests_insert_policy on public.api_idempotency_requests;
create policy api_idempotency_requests_insert_policy
    on public.api_idempotency_requests
    for insert
    with check (
        tenant_id = public.current_tenant_id()
        and user_id = auth.uid()
    );

drop policy if exists api_idempotency_requests_update_policy on public.api_idempotency_requests;
create policy api_idempotency_requests_update_policy
    on public.api_idempotency_requests
    for update
    using (
        tenant_id = public.current_tenant_id()
        and user_id = auth.uid()
    )
    with check (
        tenant_id = public.current_tenant_id()
        and user_id = auth.uid()
    );
