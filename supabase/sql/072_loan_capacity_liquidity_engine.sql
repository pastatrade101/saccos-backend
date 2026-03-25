create table if not exists public.loan_product_policies (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    loan_product_id uuid not null references public.loan_products(id) on delete cascade,
    contribution_multiplier numeric(9,4) not null default 3 check (contribution_multiplier >= 0),
    max_loan_amount numeric(18,2) not null default 0 check (max_loan_amount >= 0),
    min_loan_amount numeric(18,2) not null default 0 check (min_loan_amount >= 0 and min_loan_amount <= max_loan_amount),
    liquidity_buffer_percent numeric(9,4) not null default 0 check (liquidity_buffer_percent >= 0 and liquidity_buffer_percent <= 100),
    requires_guarantor boolean not null default false,
    requires_collateral boolean not null default false,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    unique (tenant_id, loan_product_id)
);

create table if not exists public.branch_liquidity_policy (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    branch_id uuid not null references public.branches(id) on delete cascade,
    max_lending_ratio numeric(9,4) not null default 70 check (max_lending_ratio >= 0 and max_lending_ratio <= 100),
    minimum_liquidity_reserve numeric(18,2) not null default 0 check (minimum_liquidity_reserve >= 0),
    auto_loan_freeze_threshold numeric(18,2) not null default 0 check (auto_loan_freeze_threshold >= 0),
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    unique (tenant_id, branch_id)
);

create table if not exists public.loan_fund_pool (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    branch_id uuid not null references public.branches(id) on delete cascade,
    total_deposits numeric(18,2) not null default 0 check (total_deposits >= 0),
    reserved_liquidity numeric(18,2) not null default 0 check (reserved_liquidity >= 0),
    active_loans_total numeric(18,2) not null default 0 check (active_loans_total >= 0),
    available_for_loans numeric(18,2) generated always as (
        greatest(total_deposits - reserved_liquidity - active_loans_total, 0)
    ) stored,
    last_updated timestamptz not null default timezone('utc', now()),
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    unique (tenant_id, branch_id)
);

create table if not exists public.member_financial_profile (
    member_id uuid not null references public.members(id) on delete cascade,
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    total_contributions numeric(18,2) not null default 0 check (total_contributions >= 0),
    locked_savings numeric(18,2) not null default 0 check (locked_savings >= 0),
    withdrawable_balance numeric(18,2) not null default 0 check (withdrawable_balance >= 0),
    current_loan_exposure numeric(18,2) not null default 0 check (current_loan_exposure >= 0),
    guarantor_exposure numeric(18,2) not null default 0 check (guarantor_exposure >= 0),
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    primary key (tenant_id, member_id)
);

create table if not exists public.loan_capacity_audit (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    branch_id uuid not null references public.branches(id) on delete cascade,
    member_id uuid not null references public.members(id) on delete cascade,
    loan_product_id uuid not null references public.loan_products(id) on delete cascade,
    requested_amount numeric(18,2),
    calculated_limit numeric(18,2) not null default 0 check (calculated_limit >= 0),
    contribution_limit numeric(18,2) not null default 0 check (contribution_limit >= 0),
    product_limit numeric(18,2) not null default 0 check (product_limit >= 0),
    liquidity_limit numeric(18,2) not null default 0 check (liquidity_limit >= 0),
    policy_snapshot jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists loan_product_policies_tenant_product_idx
    on public.loan_product_policies (tenant_id, loan_product_id);

create index if not exists branch_liquidity_policy_tenant_branch_idx
    on public.branch_liquidity_policy (tenant_id, branch_id);

create index if not exists loan_fund_pool_tenant_branch_idx
    on public.loan_fund_pool (tenant_id, branch_id, last_updated desc);

create index if not exists member_financial_profile_tenant_member_idx
    on public.member_financial_profile (tenant_id, member_id);

create index if not exists loan_capacity_audit_tenant_member_created_idx
    on public.loan_capacity_audit (tenant_id, member_id, created_at desc);

create index if not exists loan_capacity_audit_tenant_branch_created_idx
    on public.loan_capacity_audit (tenant_id, branch_id, created_at desc);

create index if not exists loan_capacity_audit_tenant_product_created_idx
    on public.loan_capacity_audit (tenant_id, loan_product_id, created_at desc);

create trigger set_loan_product_policies_updated_at before update on public.loan_product_policies
for each row execute function public.set_updated_at();

create trigger set_branch_liquidity_policy_updated_at before update on public.branch_liquidity_policy
for each row execute function public.set_updated_at();

create trigger set_loan_fund_pool_updated_at before update on public.loan_fund_pool
for each row execute function public.set_updated_at();

create trigger set_member_financial_profile_updated_at before update on public.member_financial_profile
for each row execute function public.set_updated_at();

insert into public.loan_product_policies (
    tenant_id,
    loan_product_id,
    contribution_multiplier,
    max_loan_amount,
    min_loan_amount,
    liquidity_buffer_percent,
    requires_guarantor,
    requires_collateral
)
select
    lp.tenant_id,
    lp.id,
    greatest(coalesce(lp.maximum_loan_multiple, 3), 0),
    coalesce(lp.max_amount, 9999999999999.99),
    greatest(coalesce(lp.min_amount, 0), 0),
    0,
    coalesce(lp.required_guarantors_count, 0) > 0,
    false
from public.loan_products lp
where lp.deleted_at is null
on conflict (tenant_id, loan_product_id) do nothing;

insert into public.branch_liquidity_policy (
    tenant_id,
    branch_id,
    max_lending_ratio,
    minimum_liquidity_reserve,
    auto_loan_freeze_threshold
)
select
    b.tenant_id,
    b.id,
    70,
    0,
    0
from public.branches b
where b.deleted_at is null
on conflict (tenant_id, branch_id) do nothing;

insert into public.loan_fund_pool (
    tenant_id,
    branch_id,
    total_deposits,
    reserved_liquidity,
    active_loans_total,
    last_updated
)
select
    b.tenant_id,
    b.id,
    0,
    0,
    0,
    timezone('utc', now())
from public.branches b
where b.deleted_at is null
on conflict (tenant_id, branch_id) do nothing;
