alter type public.journal_source add value if not exists 'treasury_investment';
alter type public.journal_source add value if not exists 'treasury_income';

alter table public.tenant_settings
    add column if not exists default_treasury_investment_account_id uuid references public.chart_of_accounts (id),
    add column if not exists default_treasury_income_account_id uuid references public.chart_of_accounts (id);

create table if not exists public.treasury_policies (
    tenant_id uuid primary key references public.tenants (id) on delete cascade,
    liquidity_reserve_ratio numeric(5,2) not null default 30 check (liquidity_reserve_ratio >= 0 and liquidity_reserve_ratio <= 100),
    minimum_liquidity_reserve numeric(18,2) not null default 0 check (minimum_liquidity_reserve >= 0),
    max_single_order_amount numeric(18,2) check (max_single_order_amount is null or max_single_order_amount >= 0),
    settlement_account_id uuid not null references public.chart_of_accounts (id),
    investment_control_account_id uuid not null references public.chart_of_accounts (id),
    investment_income_account_id uuid not null references public.chart_of_accounts (id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.treasury_assets (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    asset_name text not null,
    asset_type text not null,
    symbol text,
    market text,
    currency text not null default 'TZS',
    status text not null default 'active' check (status in ('active', 'inactive')),
    asset_account_id uuid references public.chart_of_accounts (id),
    income_account_id uuid references public.chart_of_accounts (id),
    created_by uuid references auth.users (id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists treasury_assets_tenant_name_key
    on public.treasury_assets (tenant_id, asset_name);

create table if not exists public.treasury_orders (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    branch_id uuid references public.branches (id),
    asset_id uuid not null references public.treasury_assets (id) on delete restrict,
    order_type text not null check (order_type in ('buy', 'sell')),
    units numeric(18,6) not null check (units > 0),
    unit_price numeric(18,2) not null check (unit_price >= 0),
    total_amount numeric(18,2) not null check (total_amount >= 0),
    order_date date not null default current_date,
    reference text not null,
    status text not null default 'pending_review' check (status in ('draft', 'pending_review', 'pending_approval', 'approved', 'rejected', 'executed', 'cancelled')),
    approval_request_id uuid references public.approval_requests (id),
    liquidity_snapshot jsonb not null default '{}'::jsonb,
    created_by uuid not null references auth.users (id),
    reviewed_by uuid references auth.users (id),
    reviewed_at timestamptz,
    executed_by uuid references auth.users (id),
    executed_at timestamptz,
    rejected_by uuid references auth.users (id),
    rejected_at timestamptz,
    rejection_reason text,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists treasury_orders_tenant_status_created_idx
    on public.treasury_orders (tenant_id, status, created_at desc);

create table if not exists public.treasury_transactions (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    asset_id uuid not null references public.treasury_assets (id) on delete restrict,
    order_id uuid references public.treasury_orders (id) on delete set null,
    transaction_type text not null check (transaction_type in ('buy', 'sell', 'dividend', 'interest')),
    units numeric(18,6) not null default 0 check (units >= 0),
    price numeric(18,2) not null default 0 check (price >= 0),
    total_amount numeric(18,2) not null check (total_amount >= 0),
    transaction_date date not null default current_date,
    reference text not null,
    ledger_journal_id uuid references public.journal_entries (id),
    created_by uuid not null references auth.users (id),
    status text not null default 'posted' check (status in ('posted', 'cancelled')),
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists treasury_transactions_tenant_date_idx
    on public.treasury_transactions (tenant_id, transaction_date desc, created_at desc);

create table if not exists public.treasury_income (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    asset_id uuid not null references public.treasury_assets (id) on delete restrict,
    transaction_id uuid references public.treasury_transactions (id) on delete set null,
    income_type text not null check (income_type in ('dividend', 'interest', 'capital_gain')),
    amount numeric(18,2) not null check (amount >= 0),
    received_date date not null default current_date,
    description text,
    posted_to_ledger boolean not null default false,
    ledger_journal_id uuid references public.journal_entries (id),
    recorded_by uuid not null references auth.users (id),
    created_at timestamptz not null default now()
);

create index if not exists treasury_income_tenant_received_idx
    on public.treasury_income (tenant_id, received_date desc, created_at desc);

create table if not exists public.treasury_portfolio_positions (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    asset_id uuid not null references public.treasury_assets (id) on delete cascade,
    units_owned numeric(18,6) not null default 0,
    average_price numeric(18,2) not null default 0,
    total_cost numeric(18,2) not null default 0,
    current_price numeric(18,2) not null default 0,
    current_market_value numeric(18,2) not null default 0,
    unrealized_gain numeric(18,2) not null default 0,
    portfolio_return_percent numeric(9,4) not null default 0,
    last_valuation_at timestamptz,
    updated_at timestamptz not null default now()
);

create unique index if not exists treasury_portfolio_positions_tenant_asset_key
    on public.treasury_portfolio_positions (tenant_id, asset_id);

drop trigger if exists set_treasury_policies_updated_at on public.treasury_policies;
create trigger set_treasury_policies_updated_at
before update on public.treasury_policies
for each row execute function public.set_updated_at();

drop trigger if exists set_treasury_assets_updated_at on public.treasury_assets;
create trigger set_treasury_assets_updated_at
before update on public.treasury_assets
for each row execute function public.set_updated_at();

drop trigger if exists set_treasury_orders_updated_at on public.treasury_orders;
create trigger set_treasury_orders_updated_at
before update on public.treasury_orders
for each row execute function public.set_updated_at();

drop trigger if exists set_treasury_portfolio_positions_updated_at on public.treasury_portfolio_positions;
create trigger set_treasury_portfolio_positions_updated_at
before update on public.treasury_portfolio_positions
for each row execute function public.set_updated_at();

create or replace function public.seed_treasury_defaults(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cash_account_id uuid;
    v_investment_account_id uuid;
    v_income_account_id uuid;
begin
    if not exists (select 1 from public.tenants where id = p_tenant_id and deleted_at is null) then
        raise exception 'Tenant % does not exist', p_tenant_id;
    end if;

    insert into public.chart_of_accounts (
        tenant_id,
        account_code,
        account_name,
        account_type,
        system_tag,
        is_system_control
    )
    select
        p_tenant_id,
        'TRS-INV',
        'Treasury Investments',
        'asset',
        'treasury_investments_control',
        true
    where not exists (
        select 1
          from public.chart_of_accounts
         where tenant_id = p_tenant_id
           and system_tag = 'treasury_investments_control'
           and deleted_at is null
    );

    insert into public.chart_of_accounts (
        tenant_id,
        account_code,
        account_name,
        account_type,
        system_tag,
        is_system_control
    )
    select
        p_tenant_id,
        'TRS-INC',
        'Treasury Investment Income',
        'income',
        'treasury_investment_income',
        true
    where not exists (
        select 1
          from public.chart_of_accounts
         where tenant_id = p_tenant_id
           and system_tag = 'treasury_investment_income'
           and deleted_at is null
    );

    select default_cash_account_id
      into v_cash_account_id
      from public.tenant_settings
     where tenant_id = p_tenant_id;

    select id
      into v_investment_account_id
      from public.chart_of_accounts
     where tenant_id = p_tenant_id
       and system_tag = 'treasury_investments_control'
       and deleted_at is null
     limit 1;

    select id
      into v_income_account_id
      from public.chart_of_accounts
     where tenant_id = p_tenant_id
       and system_tag = 'treasury_investment_income'
       and deleted_at is null
     limit 1;

    update public.tenant_settings
       set default_treasury_investment_account_id = coalesce(default_treasury_investment_account_id, v_investment_account_id),
           default_treasury_income_account_id = coalesce(default_treasury_income_account_id, v_income_account_id),
           updated_at = now()
     where tenant_id = p_tenant_id;

    insert into public.treasury_policies (
        tenant_id,
        liquidity_reserve_ratio,
        minimum_liquidity_reserve,
        max_single_order_amount,
        settlement_account_id,
        investment_control_account_id,
        investment_income_account_id
    )
    values (
        p_tenant_id,
        30,
        0,
        null,
        v_cash_account_id,
        v_investment_account_id,
        v_income_account_id
    )
    on conflict (tenant_id) do update
        set settlement_account_id = coalesce(public.treasury_policies.settlement_account_id, excluded.settlement_account_id),
            investment_control_account_id = coalesce(public.treasury_policies.investment_control_account_id, excluded.investment_control_account_id),
            investment_income_account_id = coalesce(public.treasury_policies.investment_income_account_id, excluded.investment_income_account_id),
            updated_at = now();

    return jsonb_build_object(
        'settlement_account_id', v_cash_account_id,
        'investment_control_account_id', v_investment_account_id,
        'investment_income_account_id', v_income_account_id
    );
end;
$$;

select public.seed_treasury_defaults(id)
from public.tenants
where deleted_at is null;

grant execute on function public.seed_treasury_defaults(uuid) to service_role;

alter table public.treasury_policies enable row level security;
alter table public.treasury_assets enable row level security;
alter table public.treasury_orders enable row level security;
alter table public.treasury_transactions enable row level security;
alter table public.treasury_income enable row level security;
alter table public.treasury_portfolio_positions enable row level security;

revoke all on public.treasury_policies from anon, authenticated;
revoke all on public.treasury_assets from anon, authenticated;
revoke all on public.treasury_orders from anon, authenticated;
revoke all on public.treasury_transactions from anon, authenticated;
revoke all on public.treasury_income from anon, authenticated;
revoke all on public.treasury_portfolio_positions from anon, authenticated;
