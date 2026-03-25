create table if not exists public.loan_fund_pool_snapshots (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    branch_id uuid not null references public.branches(id) on delete cascade,
    snapshot_date date not null,
    total_deposits numeric(18,2) not null default 0 check (total_deposits >= 0),
    reserved_liquidity numeric(18,2) not null default 0 check (reserved_liquidity >= 0),
    active_loans_total numeric(18,2) not null default 0 check (active_loans_total >= 0),
    available_for_loans numeric(18,2) generated always as (
        greatest(total_deposits - reserved_liquidity - active_loans_total, 0)
    ) stored,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    unique (tenant_id, branch_id, snapshot_date)
);

create index if not exists loan_fund_pool_snapshots_tenant_branch_date_idx
    on public.loan_fund_pool_snapshots (tenant_id, branch_id, snapshot_date desc);

create trigger set_loan_fund_pool_snapshots_updated_at before update on public.loan_fund_pool_snapshots
for each row execute function public.set_updated_at();

insert into public.loan_fund_pool_snapshots (
    tenant_id,
    branch_id,
    snapshot_date,
    total_deposits,
    reserved_liquidity,
    active_loans_total
)
select
    tenant_id,
    branch_id,
    coalesce((last_updated at time zone 'utc')::date, timezone('utc', now())::date),
    total_deposits,
    reserved_liquidity,
    active_loans_total
from public.loan_fund_pool
on conflict (tenant_id, branch_id, snapshot_date) do update
set
    total_deposits = excluded.total_deposits,
    reserved_liquidity = excluded.reserved_liquidity,
    active_loans_total = excluded.active_loans_total,
    updated_at = timezone('utc', now());

alter table public.loan_fund_pool_snapshots enable row level security;

drop policy if exists loan_fund_pool_snapshots_select_policy on public.loan_fund_pool_snapshots;
create policy loan_fund_pool_snapshots_select_policy
on public.loan_fund_pool_snapshots
for select
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
);

drop policy if exists loan_fund_pool_snapshots_manage_policy on public.loan_fund_pool_snapshots;
create policy loan_fund_pool_snapshots_manage_policy
on public.loan_fund_pool_snapshots
for all
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager'])
)
with check (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager'])
);
