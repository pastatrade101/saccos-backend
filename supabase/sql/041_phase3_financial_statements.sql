-- Phase 3: Financial statements and period governance foundations.

create table if not exists public.financial_statement_runs (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    branch_id uuid references public.branches(id) on delete set null,
    statement_type text not null check (statement_type in ('balance_sheet', 'income_statement')),
    period_start_date date,
    period_end_date date,
    as_of_date date,
    format text not null default 'csv' check (format in ('csv', 'pdf')),
    report_key text not null,
    requested_by uuid not null references auth.users(id),
    generated_at timestamptz not null default timezone('utc', now()),
    row_count integer not null default 0 check (row_count >= 0),
    totals_json jsonb not null default '{}'::jsonb,
    comparative_totals_json jsonb,
    metadata_json jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists financial_statement_runs_tenant_type_generated_idx
    on public.financial_statement_runs (tenant_id, statement_type, generated_at desc);

create index if not exists financial_statement_runs_tenant_period_idx
    on public.financial_statement_runs (tenant_id, period_start_date, period_end_date, as_of_date);

create table if not exists public.financial_snapshot_periods (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    branch_id uuid references public.branches(id) on delete set null,
    branch_scope_key text not null default 'ALL',
    statement_type text not null check (statement_type in ('balance_sheet', 'income_statement')),
    period_start_date date not null,
    period_end_date date not null,
    snapshot_key text not null,
    snapshot_json jsonb not null default '{}'::jsonb,
    source_run_id uuid references public.financial_statement_runs(id) on delete set null,
    created_by uuid references auth.users(id),
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint financial_snapshot_periods_valid_range_chk
        check (period_end_date >= period_start_date),
    unique (tenant_id, branch_scope_key, statement_type, period_start_date, period_end_date)
);

alter table public.financial_snapshot_periods
    add column if not exists branch_scope_key text not null default 'ALL';

create index if not exists financial_snapshot_periods_tenant_type_idx
    on public.financial_snapshot_periods (tenant_id, branch_scope_key, statement_type, period_start_date desc, period_end_date desc);

drop trigger if exists set_financial_snapshot_periods_updated_at on public.financial_snapshot_periods;
create trigger set_financial_snapshot_periods_updated_at
before update on public.financial_snapshot_periods
for each row execute function public.set_updated_at();

create or replace function public.financial_statement_account_balances(
    p_tenant_id uuid,
    p_from_date date default null,
    p_to_date date default null,
    p_branch_ids uuid[] default null
)
returns table (
    account_id uuid,
    account_code text,
    account_name text,
    account_type public.account_type,
    amount numeric(18,2)
)
language sql
stable
security invoker
set search_path = public
as $$
with scoped_amounts as (
    select
        jl.account_id,
        sum(
            case
                when coa.account_type in ('asset', 'expense')
                    then coalesce(jl.debit, 0) - coalesce(jl.credit, 0)
                else
                    coalesce(jl.credit, 0) - coalesce(jl.debit, 0)
            end
        )::numeric(18,2) as amount
    from public.journal_lines jl
    join public.journal_entries je
      on je.id = jl.journal_id
     and je.tenant_id = p_tenant_id
     and je.posted = true
     and (p_from_date is null or je.entry_date >= p_from_date)
     and (p_to_date is null or je.entry_date <= p_to_date)
    join public.chart_of_accounts coa
      on coa.id = jl.account_id
     and coa.tenant_id = p_tenant_id
     and coa.deleted_at is null
    where jl.tenant_id = p_tenant_id
      and (p_branch_ids is null or jl.branch_id = any (p_branch_ids))
    group by jl.account_id
)
select
    coa.id as account_id,
    coa.account_code,
    coa.account_name,
    coa.account_type,
    coalesce(sa.amount, 0)::numeric(18,2) as amount
from public.chart_of_accounts coa
left join scoped_amounts sa
  on sa.account_id = coa.id
where coa.tenant_id = p_tenant_id
  and coa.deleted_at is null
order by coa.account_code;
$$;

create or replace function public.guard_closed_period_journal_entries()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    v_latest_closed_period_end_date date;
begin
    if coalesce(new.posted, false) = false then
        return new;
    end if;

    if coalesce(new.is_reversal, false) = true then
        return new;
    end if;

    select max(period_end_date)
      into v_latest_closed_period_end_date
      from public.period_closures
     where tenant_id = new.tenant_id;

    if v_latest_closed_period_end_date is null then
        return new;
    end if;

    if new.entry_date <= v_latest_closed_period_end_date then
        raise exception using
            errcode = 'P0001',
            message = format(
                'Journal entry date %s is in or before closed period ending %s.',
                new.entry_date,
                v_latest_closed_period_end_date
            ),
            detail = 'CLOSED_PERIOD_MUTATION_BLOCKED',
            hint = 'Use the controlled reversal workflow (is_reversal=true) in an open period.';
    end if;

    return new;
end;
$$;

drop trigger if exists guard_closed_period_journal_entries on public.journal_entries;
create trigger guard_closed_period_journal_entries
before insert or update on public.journal_entries
for each row execute function public.guard_closed_period_journal_entries();
