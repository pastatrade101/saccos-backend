create table if not exists public.credential_handoffs (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    user_id uuid not null references auth.users (id),
    member_id uuid references public.members (id),
    email text not null,
    password_ciphertext text not null,
    password_iv text not null,
    password_tag text not null,
    created_by uuid not null references auth.users (id),
    created_at timestamptz not null default now(),
    cleared_at timestamptz,
    cleared_by uuid references auth.users (id)
);

create index if not exists credential_handoffs_tenant_user_idx
    on public.credential_handoffs (tenant_id, user_id, created_at desc);

create index if not exists credential_handoffs_member_idx
    on public.credential_handoffs (member_id, created_at desc);

alter table public.credential_handoffs enable row level security;

drop policy if exists credential_handoffs_select_policy on public.credential_handoffs;
create policy credential_handoffs_select_policy
    on public.credential_handoffs
    for select
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_role(array['super_admin', 'branch_manager', 'auditor'])
            or user_id = auth.uid()
        )
    );

drop policy if exists credential_handoffs_insert_policy on public.credential_handoffs;
create policy credential_handoffs_insert_policy
    on public.credential_handoffs
    for insert
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin', 'branch_manager'])
    );

drop policy if exists credential_handoffs_update_policy on public.credential_handoffs;
create policy credential_handoffs_update_policy
    on public.credential_handoffs
    for update
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_role(array['super_admin', 'branch_manager'])
            or user_id = auth.uid()
        )
    )
    with check (
        tenant_id = public.current_tenant_id()
        and (
            public.has_role(array['super_admin', 'branch_manager'])
            or user_id = auth.uid()
        )
    );
