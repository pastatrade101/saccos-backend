do $$
begin
    if not exists (
        select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'teller_session_status'
    ) then
        create type public.teller_session_status as enum ('open', 'closed_pending_review', 'reviewed');
    end if;

    if not exists (
        select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'receipt_record_status'
    ) then
        create type public.receipt_record_status as enum ('pending_upload', 'uploaded', 'confirmed', 'rejected');
    end if;
end
$$;

create table if not exists public.cash_control_settings (
    tenant_id uuid primary key references public.tenants (id),
    enforce_open_teller_session boolean not null default true,
    allow_session_bypass boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.teller_sessions (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    branch_id uuid not null references public.branches (id),
    teller_user_id uuid not null references auth.users (id),
    opened_by uuid not null references auth.users (id),
    opening_cash numeric(18,2) not null check (opening_cash >= 0),
    expected_cash numeric(18,2) not null default 0,
    closing_cash numeric(18,2),
    variance numeric(18,2),
    status public.teller_session_status not null default 'open',
    notes text,
    opened_at timestamptz not null default now(),
    closed_at timestamptz,
    reviewed_by uuid references auth.users (id),
    reviewed_at timestamptz,
    review_notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists teller_sessions_open_user_key
    on public.teller_sessions (tenant_id, teller_user_id)
    where status = 'open';

create index if not exists teller_sessions_branch_opened_idx
    on public.teller_sessions (tenant_id, branch_id, opened_at desc);

create table if not exists public.teller_session_transactions (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.teller_sessions (id) on delete cascade,
    tenant_id uuid not null references public.tenants (id),
    branch_id uuid not null references public.branches (id),
    journal_id uuid not null references public.journal_entries (id) on delete cascade,
    transaction_type text not null check (
        transaction_type in ('deposit', 'withdraw', 'share_contribution', 'loan_repay', 'loan_disburse')
    ),
    direction text not null check (direction in ('in', 'out')),
    amount numeric(18,2) not null check (amount > 0),
    recorded_by uuid not null references auth.users (id),
    created_at timestamptz not null default now()
);

create unique index if not exists teller_session_transactions_journal_key
    on public.teller_session_transactions (journal_id);

create index if not exists teller_session_transactions_session_created_idx
    on public.teller_session_transactions (session_id, created_at desc);

create table if not exists public.receipt_policies (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    branch_id uuid references public.branches (id),
    receipt_required boolean not null default false,
    required_threshold numeric(18,2) not null default 0,
    max_receipts_per_tx integer not null default 3 check (max_receipts_per_tx between 1 and 10),
    allowed_mime_types jsonb not null default '["image/jpeg","image/png","application/pdf"]'::jsonb,
    max_file_size_mb integer not null default 10 check (max_file_size_mb between 1 and 50),
    enforce_on_types jsonb not null default '["deposit","withdraw","loan_repay","loan_disburse"]'::jsonb,
    created_by uuid references auth.users (id),
    updated_by uuid references auth.users (id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists receipt_policies_tenant_default_key
    on public.receipt_policies (tenant_id)
    where branch_id is null;

create unique index if not exists receipt_policies_tenant_branch_key
    on public.receipt_policies (tenant_id, branch_id)
    where branch_id is not null;

create table if not exists public.transaction_receipts (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    branch_id uuid not null references public.branches (id),
    journal_id uuid references public.journal_entries (id) on delete set null,
    member_id uuid references public.members (id) on delete set null,
    transaction_type text not null check (
        transaction_type in ('deposit', 'withdraw', 'share_contribution', 'loan_repay', 'loan_disburse')
    ),
    draft_token uuid not null default gen_random_uuid(),
    storage_bucket text not null default 'receipts',
    storage_path text not null,
    file_name text not null,
    mime_type text not null,
    file_size_bytes bigint not null check (file_size_bytes > 0),
    checksum_sha256 text,
    status public.receipt_record_status not null default 'pending_upload',
    uploaded_by uuid not null references auth.users (id),
    confirmed_by uuid references auth.users (id),
    confirmed_at timestamptz,
    expires_at timestamptz not null default now() + interval '1 day',
    created_at timestamptz not null default now()
);

create index if not exists transaction_receipts_tenant_created_idx
    on public.transaction_receipts (tenant_id, created_at desc);

create index if not exists transaction_receipts_journal_idx
    on public.transaction_receipts (journal_id);

create index if not exists transaction_receipts_status_idx
    on public.transaction_receipts (tenant_id, status, created_at desc);

create trigger set_cash_control_settings_updated_at
before update on public.cash_control_settings
for each row execute function public.set_updated_at();

create trigger set_teller_sessions_updated_at
before update on public.teller_sessions
for each row execute function public.set_updated_at();

create trigger set_receipt_policies_updated_at
before update on public.receipt_policies
for each row execute function public.set_updated_at();

insert into public.cash_control_settings (tenant_id)
select id
from public.tenants
on conflict (tenant_id) do nothing;

insert into public.receipt_policies (tenant_id, branch_id, receipt_required, required_threshold, created_at, updated_at)
select id, null, false, 500000, now(), now()
from public.tenants t
where not exists (
    select 1
    from public.receipt_policies rp
    where rp.tenant_id = t.id
      and rp.branch_id is null
);

create or replace function public.seed_phase2_defaults(p_tenant_id uuid)
returns void
language plpgsql
as $$
begin
    insert into public.cash_control_settings (tenant_id)
    values (p_tenant_id)
    on conflict (tenant_id) do nothing;

    insert into public.receipt_policies (
        tenant_id,
        branch_id,
        receipt_required,
        required_threshold,
        max_receipts_per_tx,
        allowed_mime_types,
        max_file_size_mb,
        enforce_on_types
    )
    select
        p_tenant_id,
        null,
        false,
        500000,
        3,
        '["image/jpeg","image/png","application/pdf"]'::jsonb,
        10,
        '["deposit","withdraw","loan_repay","loan_disburse"]'::jsonb
    where not exists (
        select 1
        from public.receipt_policies
        where tenant_id = p_tenant_id
          and branch_id is null
    );
end;
$$;

create or replace view public.v_daily_cash_summary as
with session_totals as (
    select
        ts.id as session_id,
        ts.tenant_id,
        ts.branch_id,
        ts.teller_user_id,
        ts.opening_cash,
        ts.expected_cash,
        ts.closing_cash,
        ts.variance,
        ts.status,
        ts.opened_at::date as business_date,
        coalesce(sum(case when tst.direction = 'in' then tst.amount else 0 end), 0)::numeric(18,2) as inflow_total,
        coalesce(sum(case when tst.direction = 'out' then tst.amount else 0 end), 0)::numeric(18,2) as outflow_total
    from public.teller_sessions ts
    left join public.teller_session_transactions tst on tst.session_id = ts.id
    group by
        ts.id,
        ts.tenant_id,
        ts.branch_id,
        ts.teller_user_id,
        ts.opening_cash,
        ts.expected_cash,
        ts.closing_cash,
        ts.variance,
        ts.status,
        ts.opened_at::date
)
select
    tenant_id,
    branch_id,
    teller_user_id,
    business_date,
    count(*)::int as sessions_count,
    sum(opening_cash)::numeric(18,2) as opening_cash_total,
    sum(inflow_total)::numeric(18,2) as deposits_total,
    sum(outflow_total)::numeric(18,2) as withdrawals_total,
    sum(inflow_total - outflow_total)::numeric(18,2) as net_movement,
    sum(expected_cash)::numeric(18,2) as expected_cash_total,
    sum(coalesce(closing_cash, 0))::numeric(18,2) as closing_cash_total,
    sum(coalesce(variance, 0))::numeric(18,2) as variance_total,
    bool_or(status = 'open') as has_open_session
from session_totals
group by tenant_id, branch_id, teller_user_id, business_date;
