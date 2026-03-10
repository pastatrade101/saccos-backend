create table if not exists public.approval_policies (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    operation_key text not null,
    enabled boolean not null default true,
    threshold_amount numeric(18, 2) not null default 0,
    required_checker_count integer not null default 1 check (required_checker_count >= 1 and required_checker_count <= 5),
    allowed_maker_roles text[] not null default array['teller', 'branch_manager', 'super_admin'],
    allowed_checker_roles text[] not null default array['branch_manager', 'super_admin'],
    sla_minutes integer not null default 120 check (sla_minutes >= 5 and sla_minutes <= 10080),
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    unique (tenant_id, operation_key)
);

create table if not exists public.approval_requests (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    branch_id uuid references public.branches(id) on delete set null,
    operation_key text not null,
    entity_type text,
    entity_id uuid,
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'executed', 'expired', 'cancelled')),
    maker_user_id uuid not null,
    payload_json jsonb not null default '{}'::jsonb,
    policy_snapshot jsonb not null default '{}'::jsonb,
    requested_amount numeric(18, 2),
    currency text not null default 'TZS',
    threshold_amount numeric(18, 2),
    required_checker_count integer not null default 1 check (required_checker_count >= 1 and required_checker_count <= 5),
    approved_count integer not null default 0 check (approved_count >= 0),
    rejection_reason text,
    requested_at timestamptz not null default timezone('utc', now()),
    expires_at timestamptz,
    last_decision_at timestamptz,
    executed_at timestamptz,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.approval_steps (
    id uuid primary key default gen_random_uuid(),
    approval_request_id uuid not null references public.approval_requests(id) on delete cascade,
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    step_order integer not null check (step_order >= 1),
    required_role text,
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'skipped')),
    decided_by uuid,
    decided_at timestamptz,
    notes text,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    unique (approval_request_id, step_order)
);

create table if not exists public.approval_decisions (
    id uuid primary key default gen_random_uuid(),
    approval_request_id uuid not null references public.approval_requests(id) on delete cascade,
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    decision text not null check (decision in ('approved', 'rejected')),
    decided_by uuid not null,
    notes text,
    created_at timestamptz not null default timezone('utc', now()),
    unique (approval_request_id, decided_by)
);

create index if not exists approval_policies_tenant_operation_idx
    on public.approval_policies (tenant_id, operation_key);

create index if not exists approval_requests_tenant_status_idx
    on public.approval_requests (tenant_id, status, requested_at desc);

create index if not exists approval_requests_tenant_branch_idx
    on public.approval_requests (tenant_id, branch_id, requested_at desc);

create index if not exists approval_requests_tenant_operation_idx
    on public.approval_requests (tenant_id, operation_key, requested_at desc);

create index if not exists approval_decisions_request_idx
    on public.approval_decisions (approval_request_id, created_at asc);

create index if not exists approval_steps_request_idx
    on public.approval_steps (approval_request_id, step_order asc);

create trigger set_approval_policies_updated_at before update on public.approval_policies
for each row execute function public.set_updated_at();

create trigger set_approval_requests_updated_at before update on public.approval_requests
for each row execute function public.set_updated_at();

create trigger set_approval_steps_updated_at before update on public.approval_steps
for each row execute function public.set_updated_at();

insert into public.approval_policies (
    tenant_id,
    operation_key,
    enabled,
    threshold_amount,
    required_checker_count,
    allowed_maker_roles,
    allowed_checker_roles,
    sla_minutes
)
select
    t.id,
    policy.operation_key,
    true,
    2000000,
    1,
    policy.allowed_maker_roles,
    policy.allowed_checker_roles,
    120
from public.tenants t
cross join (
    values
        (
            'finance.withdraw'::text,
            array['teller', 'branch_manager', 'super_admin']::text[],
            array['branch_manager', 'super_admin']::text[]
        ),
        (
            'finance.loan_disburse'::text,
            array['teller', 'loan_officer', 'branch_manager', 'super_admin']::text[],
            array['branch_manager', 'super_admin']::text[]
        )
) as policy(operation_key, allowed_maker_roles, allowed_checker_roles)
on conflict (tenant_id, operation_key) do nothing;
