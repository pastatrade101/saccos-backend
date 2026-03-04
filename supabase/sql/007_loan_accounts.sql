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

create index if not exists loan_accounts_tenant_member_active_idx
    on public.loan_accounts (tenant_id, member_id)
    where deleted_at is null;

create index if not exists loan_accounts_branch_status_active_idx
    on public.loan_accounts (tenant_id, branch_id, status)
    where deleted_at is null;

create index if not exists loan_account_transactions_loan_created_idx
    on public.loan_account_transactions (loan_id, created_at desc);

create index if not exists loan_account_transactions_account_created_idx
    on public.loan_account_transactions (loan_account_id, created_at desc);

drop trigger if exists set_loan_accounts_updated_at on public.loan_accounts;
create trigger set_loan_accounts_updated_at before update on public.loan_accounts
for each row execute function public.set_updated_at();

insert into public.loan_accounts (
    tenant_id,
    loan_id,
    member_id,
    branch_id,
    account_number,
    account_name,
    gl_account_id,
    status,
    principal_balance,
    accrued_interest_balance
)
select
    l.tenant_id,
    l.id,
    l.member_id,
    l.branch_id,
    'LA-' || to_char(coalesce(l.disbursed_at, l.created_at), 'YYYYMMDD') || '-' || substr(replace(l.id::text, '-', ''), 1, 8),
    m.full_name || ' Loan Account',
    ts.default_loan_portfolio_account_id,
    l.status,
    l.outstanding_principal,
    l.accrued_interest
from public.loans l
join public.members m on m.id = l.member_id
join public.tenant_settings ts on ts.tenant_id = l.tenant_id
where not exists (
    select 1
      from public.loan_accounts la
     where la.loan_id = l.id
)
and ts.default_loan_portfolio_account_id is not null;

alter table public.loan_accounts enable row level security;
alter table public.loan_account_transactions enable row level security;

drop policy if exists loan_accounts_select_policy on public.loan_accounts;
create policy loan_accounts_select_policy
on public.loan_accounts
for select
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and (
            public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
            and public.has_branch_scope(branch_id)
            or exists (
                select 1
                  from public.members m
                 where m.id = loan_accounts.member_id
                   and m.user_id = auth.uid()
            )
        )
    )
);

drop policy if exists loan_account_transactions_select_policy on public.loan_account_transactions;
create policy loan_account_transactions_select_policy
on public.loan_account_transactions
for select
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and (
            public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
            and public.has_branch_scope(branch_id)
            or exists (
                select 1
                  from public.members m
                 where m.id = loan_account_transactions.member_id
                   and m.user_id = auth.uid()
            )
        )
    )
);
