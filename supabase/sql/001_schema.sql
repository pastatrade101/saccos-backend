create extension if not exists pgcrypto;

create type public.user_role as enum (
    'super_admin',
    'branch_manager',
    'loan_officer',
    'teller',
    'auditor',
    'member'
);

create type public.subscription_plan as enum ('starter', 'growth', 'enterprise');
create type public.subscription_status as enum ('active', 'past_due', 'cancelled');
create type public.member_status as enum ('active', 'suspended', 'exited');
create type public.account_type as enum ('asset', 'liability', 'equity', 'income', 'expense');
create type public.member_account_type as enum ('savings', 'shares', 'fixed_deposit');
create type public.member_account_status as enum ('active', 'dormant', 'closed');
create type public.loan_status as enum ('draft', 'active', 'closed', 'in_arrears', 'written_off');
create type public.repayment_frequency as enum ('daily', 'weekly', 'monthly');
create type public.schedule_status as enum ('pending', 'partial', 'paid', 'overdue');
create type public.journal_source as enum (
    'deposit',
    'withdrawal',
    'transfer',
    'share_contribution',
    'dividend_allocation',
    'loan_disbursement',
    'loan_repayment',
    'interest_accrual',
    'closing',
    'adjustment'
);
create type public.dividend_cycle_status as enum ('draft', 'frozen', 'allocated', 'approved', 'paid', 'closed');
create type public.dividend_component_type as enum ('share_dividend', 'savings_interest_bonus', 'patronage_refund');
create type public.dividend_basis_method as enum (
    'end_balance',
    'average_daily_balance',
    'average_monthly_balance',
    'minimum_balance',
    'total_interest_paid',
    'total_fees_paid',
    'transaction_volume'
);
create type public.dividend_distribution_mode as enum ('rate', 'fixed_pool');
create type public.dividend_allocation_status as enum ('pending', 'paid', 'void');
create type public.dividend_payment_method as enum ('cash', 'bank', 'mobile_money', 'reinvest_to_shares');
create type public.dividend_residual_handling as enum ('carry_to_retained_earnings', 'allocate_pro_rata', 'allocate_to_reserve');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create table if not exists public.tenants (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    registration_number text not null,
    status text not null default 'active',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    deleted_by uuid references auth.users (id)
);

create unique index if not exists tenants_registration_number_key
    on public.tenants (registration_number)
    where deleted_at is null;

create table if not exists public.subscriptions (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    plan public.subscription_plan not null,
    status public.subscription_status not null,
    start_at timestamptz not null,
    expires_at timestamptz not null,
    grace_period_until timestamptz,
    limits_override jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists subscriptions_tenant_id_idx on public.subscriptions (tenant_id, start_at desc);

create table if not exists public.user_profiles (
    user_id uuid primary key references auth.users (id),
    tenant_id uuid not null references public.tenants (id),
    full_name text not null,
    phone text,
    role public.user_role not null,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    deleted_by uuid references auth.users (id)
);

create index if not exists user_profiles_tenant_role_idx on public.user_profiles (tenant_id, role);

create table if not exists public.chart_of_accounts (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    account_code text not null,
    account_name text not null,
    account_type public.account_type not null,
    parent_id uuid references public.chart_of_accounts (id),
    system_tag text,
    is_system_control boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    deleted_by uuid references auth.users (id)
);

create unique index if not exists chart_of_accounts_tenant_code_key
    on public.chart_of_accounts (tenant_id, account_code)
    where deleted_at is null;

create table if not exists public.tenant_settings (
    tenant_id uuid primary key references public.tenants (id),
    default_cash_account_id uuid references public.chart_of_accounts (id),
    default_member_savings_control_account_id uuid references public.chart_of_accounts (id),
    default_loan_portfolio_account_id uuid references public.chart_of_accounts (id),
    default_interest_receivable_account_id uuid references public.chart_of_accounts (id),
    default_interest_income_account_id uuid references public.chart_of_accounts (id),
    default_retained_earnings_account_id uuid references public.chart_of_accounts (id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.branches (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    name text not null,
    code text not null,
    address_line1 text not null,
    address_line2 text,
    city text not null,
    state text not null,
    country text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    deleted_by uuid references auth.users (id)
);

create unique index if not exists branches_tenant_code_key
    on public.branches (tenant_id, code)
    where deleted_at is null;

create table if not exists public.branch_staff_assignments (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    branch_id uuid not null references public.branches (id),
    user_id uuid not null references auth.users (id),
    created_at timestamptz not null default now(),
    deleted_at timestamptz
);

create unique index if not exists branch_staff_assignments_unique_key
    on public.branch_staff_assignments (tenant_id, branch_id, user_id)
    where deleted_at is null;

create table if not exists public.members (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    branch_id uuid not null references public.branches (id),
    user_id uuid unique references auth.users (id),
    full_name text not null,
    phone text not null,
    email text,
    national_id text not null,
    status public.member_status not null default 'active',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    deleted_by uuid references auth.users (id)
);

create unique index if not exists members_tenant_national_id_key
    on public.members (tenant_id, national_id)
    where deleted_at is null;

create table if not exists public.member_accounts (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    member_id uuid not null references public.members (id),
    branch_id uuid not null references public.branches (id),
    account_number text not null,
    account_name text not null,
    product_type public.member_account_type not null,
    status public.member_account_status not null default 'active',
    gl_account_id uuid not null references public.chart_of_accounts (id),
    available_balance numeric(18,2) not null default 0,
    locked_balance numeric(18,2) not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    deleted_by uuid references auth.users (id)
);

create unique index if not exists member_accounts_tenant_account_number_key
    on public.member_accounts (tenant_id, account_number)
    where deleted_at is null;

create table if not exists public.loans (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    member_id uuid not null references public.members (id),
    branch_id uuid not null references public.branches (id),
    loan_number text not null,
    principal_amount numeric(18,2) not null check (principal_amount > 0),
    annual_interest_rate numeric(9,4) not null check (annual_interest_rate >= 0),
    term_count integer not null check (term_count > 0),
    repayment_frequency public.repayment_frequency not null default 'monthly',
    status public.loan_status not null default 'draft',
    outstanding_principal numeric(18,2) not null default 0,
    accrued_interest numeric(18,2) not null default 0,
    last_interest_accrual_at date,
    disbursed_at timestamptz,
    created_by uuid references auth.users (id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists loans_tenant_loan_number_key on public.loans (tenant_id, loan_number);
create index if not exists loans_tenant_status_idx on public.loans (tenant_id, status);

create table if not exists public.loan_accounts (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    loan_id uuid not null unique references public.loans (id) on delete cascade,
    member_id uuid not null references public.members (id),
    branch_id uuid not null references public.branches (id),
    account_number text not null,
    account_name text not null,
    gl_account_id uuid not null references public.chart_of_accounts (id),
    status public.loan_status not null default 'active',
    principal_balance numeric(18,2) not null default 0,
    accrued_interest_balance numeric(18,2) not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    deleted_by uuid references auth.users (id)
);

create unique index if not exists loan_accounts_tenant_account_number_key
    on public.loan_accounts (tenant_id, account_number)
    where deleted_at is null;

create unique index if not exists loan_accounts_tenant_loan_key
    on public.loan_accounts (tenant_id, loan_id)
    where deleted_at is null;

create table if not exists public.loan_schedules (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    loan_id uuid not null references public.loans (id) on delete cascade,
    installment_number integer not null check (installment_number > 0),
    due_date date not null,
    opening_principal numeric(18,2) not null,
    principal_due numeric(18,2) not null,
    interest_due numeric(18,2) not null,
    installment_amount numeric(18,2) not null,
    principal_paid numeric(18,2) not null default 0,
    interest_paid numeric(18,2) not null default 0,
    status public.schedule_status not null default 'pending',
    created_at timestamptz not null default now()
);

create unique index if not exists loan_schedules_unique_installment_key
    on public.loan_schedules (loan_id, installment_number);

create table if not exists public.journal_entries (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    reference text not null,
    description text,
    entry_date date not null default current_date,
    posted boolean not null default false,
    is_reversal boolean not null default false,
    reversed_journal_id uuid references public.journal_entries (id),
    source_type public.journal_source not null default 'adjustment',
    created_by uuid not null references auth.users (id),
    posted_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists journal_entries_tenant_entry_date_idx
    on public.journal_entries (tenant_id, entry_date desc);
create index if not exists journal_entries_tenant_created_at_idx
    on public.journal_entries (tenant_id, created_at desc);

create table if not exists public.journal_lines (
    id uuid primary key default gen_random_uuid(),
    journal_id uuid not null references public.journal_entries (id) on delete cascade,
    tenant_id uuid not null references public.tenants (id),
    account_id uuid not null references public.chart_of_accounts (id),
    member_account_id uuid references public.member_accounts (id),
    branch_id uuid references public.branches (id),
    debit numeric(18,2) not null default 0,
    credit numeric(18,2) not null default 0,
    created_at timestamptz not null default now(),
    constraint journal_lines_positive_amount_chk
        check (
            (debit > 0 and credit = 0)
            or (credit > 0 and debit = 0)
        )
);

create index if not exists journal_lines_journal_idx on public.journal_lines (journal_id);
create index if not exists journal_lines_account_idx on public.journal_lines (tenant_id, account_id);

create table if not exists public.account_balances (
    tenant_id uuid not null references public.tenants (id),
    account_id uuid not null references public.chart_of_accounts (id),
    balance numeric(18,2) not null default 0,
    updated_at timestamptz not null default now(),
    primary key (tenant_id, account_id)
);

create table if not exists public.member_account_transactions (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    member_account_id uuid not null references public.member_accounts (id),
    branch_id uuid not null references public.branches (id),
    journal_id uuid not null references public.journal_entries (id),
    transaction_type text not null,
    direction text not null check (direction in ('in', 'out')),
    amount numeric(18,2) not null check (amount > 0),
    running_balance numeric(18,2) not null,
    reference text,
    created_by uuid not null references auth.users (id),
    created_at timestamptz not null default now()
);

create index if not exists member_account_transactions_account_idx
    on public.member_account_transactions (member_account_id, created_at desc);

create table if not exists public.loan_account_transactions (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    loan_account_id uuid not null references public.loan_accounts (id),
    loan_id uuid not null references public.loans (id),
    member_id uuid not null references public.members (id),
    branch_id uuid not null references public.branches (id),
    journal_id uuid not null references public.journal_entries (id),
    transaction_type text not null,
    direction text not null check (direction in ('in', 'out')),
    amount numeric(18,2) not null check (amount > 0),
    principal_component numeric(18,2) not null default 0,
    interest_component numeric(18,2) not null default 0,
    running_principal_balance numeric(18,2) not null,
    running_interest_balance numeric(18,2) not null,
    reference text,
    created_by uuid not null references auth.users (id),
    created_at timestamptz not null default now()
);

create index if not exists loan_account_transactions_account_idx
    on public.loan_account_transactions (loan_account_id, created_at desc);

create table if not exists public.daily_account_snapshots (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    account_id uuid not null references public.chart_of_accounts (id),
    snapshot_date date not null,
    balance numeric(18,2) not null,
    created_at timestamptz not null default now()
);

create unique index if not exists daily_account_snapshots_unique_key
    on public.daily_account_snapshots (tenant_id, account_id, snapshot_date);

create table if not exists public.period_closures (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    period_end_date date not null,
    closed_by uuid not null references auth.users (id),
    journal_entries_count integer not null default 0,
    created_at timestamptz not null default now()
);

create unique index if not exists period_closures_unique_period_key
    on public.period_closures (tenant_id, period_end_date);

create table if not exists public.dividend_cycles (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    branch_id uuid references public.branches (id),
    period_label text not null,
    start_date date not null,
    end_date date not null,
    declaration_date date not null,
    record_date date,
    payment_date date,
    status public.dividend_cycle_status not null default 'draft',
    required_checker_count integer not null default 1 check (required_checker_count > 0),
    config_json jsonb not null default '{}'::jsonb,
    config_version integer not null default 1,
    config_hash text not null,
    totals_json jsonb not null default '{}'::jsonb,
    declaration_journal_id uuid references public.journal_entries (id),
    payment_journal_id uuid references public.journal_entries (id),
    created_by uuid not null references auth.users (id),
    approved_by uuid references auth.users (id),
    approved_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists dividend_cycles_tenant_status_idx
    on public.dividend_cycles (tenant_id, status, created_at desc);

create unique index if not exists dividend_cycles_tenant_label_version_key
    on public.dividend_cycles (tenant_id, period_label, config_version);

create table if not exists public.dividend_components (
    id uuid primary key default gen_random_uuid(),
    cycle_id uuid not null references public.dividend_cycles (id) on delete cascade,
    tenant_id uuid not null references public.tenants (id),
    type public.dividend_component_type not null,
    basis_method public.dividend_basis_method not null,
    distribution_mode public.dividend_distribution_mode not null,
    rate_percent numeric(9,4),
    pool_amount numeric(18,2),
    retained_earnings_account_id uuid not null references public.chart_of_accounts (id),
    dividends_payable_account_id uuid not null references public.chart_of_accounts (id),
    payout_account_id uuid references public.chart_of_accounts (id),
    reserve_account_id uuid references public.chart_of_accounts (id),
    eligibility_rules_json jsonb not null default '{}'::jsonb,
    rounding_rules_json jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists dividend_components_cycle_idx
    on public.dividend_components (cycle_id);

create table if not exists public.dividend_member_snapshots (
    id uuid primary key default gen_random_uuid(),
    cycle_id uuid not null references public.dividend_cycles (id) on delete cascade,
    tenant_id uuid not null references public.tenants (id),
    member_id uuid not null references public.members (id),
    eligibility_status boolean not null default false,
    eligibility_reason text,
    snapshot_json jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create unique index if not exists dividend_member_snapshots_cycle_member_key
    on public.dividend_member_snapshots (cycle_id, member_id);

create table if not exists public.dividend_allocations (
    id uuid primary key default gen_random_uuid(),
    cycle_id uuid not null references public.dividend_cycles (id) on delete cascade,
    component_id uuid not null references public.dividend_components (id) on delete cascade,
    tenant_id uuid not null references public.tenants (id),
    member_id uuid not null references public.members (id),
    basis_value numeric(18,2) not null default 0,
    payout_amount numeric(18,2) not null default 0,
    status public.dividend_allocation_status not null default 'pending',
    payment_ref text,
    paid_at timestamptz,
    created_at timestamptz not null default now()
);

create unique index if not exists dividend_allocations_cycle_component_member_key
    on public.dividend_allocations (cycle_id, component_id, member_id);

create index if not exists dividend_allocations_cycle_status_idx
    on public.dividend_allocations (cycle_id, status);

create table if not exists public.dividend_approvals (
    id uuid primary key default gen_random_uuid(),
    cycle_id uuid not null references public.dividend_cycles (id) on delete cascade,
    tenant_id uuid not null references public.tenants (id),
    approved_by uuid not null references auth.users (id),
    approved_at timestamptz not null default now(),
    decision text not null check (decision in ('approved', 'rejected')),
    notes text,
    signature_hash text
);

create unique index if not exists dividend_approvals_cycle_user_key
    on public.dividend_approvals (cycle_id, approved_by);

create table if not exists public.dividend_payments (
    id uuid primary key default gen_random_uuid(),
    cycle_id uuid not null references public.dividend_cycles (id) on delete cascade,
    tenant_id uuid not null references public.tenants (id),
    payment_method public.dividend_payment_method not null,
    total_amount numeric(18,2) not null check (total_amount >= 0),
    processed_by uuid not null references auth.users (id),
    processed_at timestamptz not null default now(),
    journal_entry_id uuid references public.journal_entries (id),
    reference text,
    notes text
);

create index if not exists dividend_payments_cycle_idx
    on public.dividend_payments (cycle_id, processed_at desc);

create table if not exists public.audit_logs (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    user_id uuid not null references auth.users (id),
    actor_user_id uuid references auth.users (id),
    "table" text not null,
    action text not null,
    entity_type text not null default 'unknown',
    entity_id uuid,
    before_data jsonb,
    after_data jsonb,
    ip text,
    user_agent text,
    created_at timestamptz not null default now(),
    timestamp timestamptz not null default now()
);

create index if not exists audit_logs_tenant_timestamp_idx
    on public.audit_logs (tenant_id, timestamp desc);
create index if not exists audit_logs_tenant_created_at_idx
    on public.audit_logs (tenant_id, created_at desc);
create index if not exists audit_logs_tenant_action_idx
    on public.audit_logs (tenant_id, action);

create trigger set_tenants_updated_at before update on public.tenants
for each row execute function public.set_updated_at();

create trigger set_subscriptions_updated_at before update on public.subscriptions
for each row execute function public.set_updated_at();

create trigger set_user_profiles_updated_at before update on public.user_profiles
for each row execute function public.set_updated_at();

create trigger set_chart_of_accounts_updated_at before update on public.chart_of_accounts
for each row execute function public.set_updated_at();

create trigger set_tenant_settings_updated_at before update on public.tenant_settings
for each row execute function public.set_updated_at();

create trigger set_branches_updated_at before update on public.branches
for each row execute function public.set_updated_at();

create trigger set_members_updated_at before update on public.members
for each row execute function public.set_updated_at();

create trigger set_member_accounts_updated_at before update on public.member_accounts
for each row execute function public.set_updated_at();

create trigger set_loans_updated_at before update on public.loans
for each row execute function public.set_updated_at();

create trigger set_loan_accounts_updated_at before update on public.loan_accounts
for each row execute function public.set_updated_at();

create trigger set_journal_entries_updated_at before update on public.journal_entries
for each row execute function public.set_updated_at();

create trigger set_dividend_cycles_updated_at before update on public.dividend_cycles
for each row execute function public.set_updated_at();

create or replace function public.validate_balanced_journal_entry()
returns trigger
language plpgsql
as $$
declare
    v_journal_id uuid := coalesce(new.journal_id, old.journal_id);
    v_total_debit numeric(18,2);
    v_total_credit numeric(18,2);
begin
    select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
      into v_total_debit, v_total_credit
      from public.journal_lines
     where journal_id = v_journal_id;

    if round(v_total_debit, 2) <> round(v_total_credit, 2) then
        raise exception 'Journal entry % is not balanced', v_journal_id;
    end if;

    return coalesce(new, old);
end;
$$;

create constraint trigger ensure_balanced_journal_entry
after insert or update or delete on public.journal_lines
deferrable initially deferred
for each row execute function public.validate_balanced_journal_entry();

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
as $$
    select tenant_id
      from public.user_profiles
     where user_id = auth.uid()
       and deleted_at is null
       and is_active = true
     limit 1
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
as $$
    select role::text
      from public.user_profiles
     where user_id = auth.uid()
       and deleted_at is null
       and is_active = true
     limit 1
$$;

create or replace function public.is_internal_ops()
returns boolean
language sql
stable
as $$
    select coalesce((auth.jwt() -> 'app_metadata' ->> 'platform_role') = 'internal_ops', false)
$$;

create or replace function public.has_role(p_roles text[])
returns boolean
language sql
stable
as $$
    select public.is_internal_ops()
        or exists (
            select 1
              from public.user_profiles
             where user_id = auth.uid()
               and deleted_at is null
               and is_active = true
               and role::text = any (p_roles)
        )
$$;

create or replace function public.has_branch_scope(p_branch_id uuid)
returns boolean
language sql
stable
as $$
    select public.is_internal_ops()
        or public.has_role(array['super_admin', 'auditor'])
        or exists (
            select 1
              from public.branch_staff_assignments
             where user_id = auth.uid()
               and branch_id = p_branch_id
               and deleted_at is null
        )
$$;

create or replace view public.trial_balance_view as
select
    coa.tenant_id,
    coa.id as account_id,
    coa.account_code,
    coa.account_name,
    coa.account_type,
    coalesce(ab.balance, 0)::numeric(18,2) as balance,
    case
        when coa.account_type in ('asset', 'expense') and coalesce(ab.balance, 0) >= 0 then coalesce(ab.balance, 0)
        when coa.account_type in ('liability', 'equity', 'income') and coalesce(ab.balance, 0) < 0 then abs(coalesce(ab.balance, 0))
        else 0
    end::numeric(18,2) as debit_balance,
    case
        when coa.account_type in ('liability', 'equity', 'income') and coalesce(ab.balance, 0) >= 0 then coalesce(ab.balance, 0)
        when coa.account_type in ('asset', 'expense') and coalesce(ab.balance, 0) < 0 then abs(coalesce(ab.balance, 0))
        else 0
    end::numeric(18,2) as credit_balance
from public.chart_of_accounts coa
left join public.account_balances ab
    on ab.tenant_id = coa.tenant_id
   and ab.account_id = coa.id
where coa.deleted_at is null;

create or replace view public.ledger_entries_view as
select
    je.tenant_id,
    je.id as journal_id,
    je.reference,
    je.description,
    je.entry_date,
    je.source_type,
    jl.id as journal_line_id,
    jl.account_id,
    coa.account_code,
    coa.account_name,
    jl.member_account_id,
    jl.branch_id,
    jl.debit,
    jl.credit,
    je.created_at
from public.journal_entries je
join public.journal_lines jl on jl.journal_id = je.id
join public.chart_of_accounts coa on coa.id = jl.account_id
where je.posted = true;

create or replace view public.member_statement_view as
select
    mat.tenant_id,
    mat.id as transaction_id,
    mat.member_account_id as account_id,
    ma.account_number,
    m.id as member_id,
    m.full_name as member_name,
    mat.transaction_type,
    mat.direction,
    mat.amount,
    mat.running_balance,
    mat.reference,
    mat.created_at::date as transaction_date,
    mat.created_at
from public.member_account_transactions mat
join public.member_accounts ma on ma.id = mat.member_account_id
join public.members m on m.id = ma.member_id;

create or replace view public.cash_position_view as
select
    ts.tenant_id,
    null::uuid as branch_id,
    'Head Office Treasury'::text as branch_name,
    coa.id as account_id,
    coa.account_code,
    coa.account_name,
    coalesce(ab.balance, 0)::numeric(18,2) as cash_balance
from public.tenant_settings ts
join public.chart_of_accounts coa on coa.id = ts.default_cash_account_id
left join public.account_balances ab
    on ab.tenant_id = ts.tenant_id
   and ab.account_id = ts.default_cash_account_id;

create or replace view public.loan_arrears_view as
with overdue as (
    select
        l.tenant_id,
        l.id as loan_id,
        l.loan_number,
        m.full_name as member_name,
        l.outstanding_principal,
        current_date as snapshot_date,
        coalesce(
            current_date - min(ls.due_date) filter (
                where (ls.principal_due - ls.principal_paid) + (ls.interest_due - ls.interest_paid) > 0
                  and ls.due_date < current_date
            ),
            0
        )::integer as days_past_due,
        coalesce(sum((ls.principal_due - ls.principal_paid) + (ls.interest_due - ls.interest_paid)) filter (
            where ls.due_date < current_date
        ), 0)::numeric(18,2) as overdue_amount
    from public.loans l
    join public.members m on m.id = l.member_id
    left join public.loan_schedules ls on ls.loan_id = l.id
    where l.status in ('active', 'in_arrears')
    group by l.tenant_id, l.id, l.loan_number, m.full_name, l.outstanding_principal
)
select
    tenant_id,
    loan_id,
    loan_number,
    member_name,
    outstanding_principal,
    overdue_amount,
    days_past_due,
    snapshot_date,
    case
        when days_past_due >= 90 then '90_plus'
        when days_past_due >= 60 then '60_89'
        when days_past_due >= 30 then '30_59'
        when days_past_due >= 1 then '1_29'
        else 'current'
    end as par_bucket
from overdue;

create or replace view public.loan_aging_view as
select
    tenant_id,
    par_bucket,
    case par_bucket
        when 'current' then 1
        when '1_29' then 2
        when '30_59' then 3
        when '60_89' then 4
        else 5
    end as bucket_order,
    count(*) as loan_count,
    sum(outstanding_principal)::numeric(18,2) as total_outstanding,
    sum(overdue_amount)::numeric(18,2) as total_overdue
from public.loan_arrears_view
group by tenant_id, par_bucket;
