-- Phase 1: credit risk controls foundation
-- Adds default lifecycle, collections, restructures, writeoffs, recoveries, and guarantor enforcement entities.

do $$
begin
    create type public.default_case_status as enum (
        'delinquent',
        'in_recovery',
        'claim_ready',
        'restructured',
        'written_off',
        'recovered'
    );
exception
    when duplicate_object then null;
end $$;

do $$
begin
    create type public.collection_action_type as enum (
        'call',
        'visit',
        'notice',
        'legal_warning',
        'settlement_offer'
    );
exception
    when duplicate_object then null;
end $$;

do $$
begin
    create type public.collection_outcome_code as enum (
        'promised_to_pay',
        'partial_paid',
        'no_contact',
        'refused',
        'escalate'
    );
exception
    when duplicate_object then null;
end $$;

do $$
begin
    create type public.collection_action_status as enum (
        'open',
        'completed',
        'overdue',
        'cancelled'
    );
exception
    when duplicate_object then null;
end $$;

do $$
begin
    create type public.restructure_request_status as enum (
        'draft',
        'submitted',
        'approved',
        'rejected'
    );
exception
    when duplicate_object then null;
end $$;

do $$
begin
    create type public.loan_recovery_type as enum (
        'cash',
        'guarantor',
        'legal_settlement',
        'adjustment'
    );
exception
    when duplicate_object then null;
end $$;

do $$
begin
    create type public.guarantor_claim_status as enum (
        'draft',
        'submitted',
        'approved',
        'posted',
        'partial_settled',
        'settled',
        'waived'
    );
exception
    when duplicate_object then null;
end $$;

create table if not exists public.loan_default_cases (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id),
    branch_id uuid not null references public.branches(id),
    loan_id uuid not null references public.loans(id),
    member_id uuid not null references public.members(id),
    status public.default_case_status not null default 'delinquent',
    dpd_days integer not null default 0 check (dpd_days >= 0),
    opened_at timestamptz not null default now(),
    closed_at timestamptz,
    opened_by uuid references auth.users(id),
    closed_by uuid references auth.users(id),
    reason_code text,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists loan_default_cases_tenant_status_opened_idx
    on public.loan_default_cases (tenant_id, status, opened_at desc);

create index if not exists loan_default_cases_tenant_loan_idx
    on public.loan_default_cases (tenant_id, loan_id, created_at desc);

create unique index if not exists loan_default_cases_open_case_key
    on public.loan_default_cases (loan_id)
    where closed_at is null
      and status in ('delinquent', 'in_recovery', 'claim_ready');

create table if not exists public.collection_actions (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id),
    branch_id uuid not null references public.branches(id),
    default_case_id uuid not null references public.loan_default_cases(id) on delete cascade,
    loan_id uuid not null references public.loans(id),
    member_id uuid not null references public.members(id),
    action_type public.collection_action_type not null,
    owner_user_id uuid references auth.users(id),
    due_at timestamptz not null,
    completed_at timestamptz,
    outcome_code public.collection_outcome_code,
    status public.collection_action_status not null default 'open',
    priority smallint not null default 3 check (priority between 1 and 5),
    escalated_at timestamptz,
    escalation_reason text,
    notes text,
    created_by uuid references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists collection_actions_tenant_status_due_idx
    on public.collection_actions (tenant_id, status, due_at asc);

create index if not exists collection_actions_case_status_idx
    on public.collection_actions (default_case_id, status, created_at desc);

create table if not exists public.loan_restructures (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id),
    default_case_id uuid not null references public.loan_default_cases(id) on delete cascade,
    loan_id uuid not null references public.loans(id),
    request_status public.restructure_request_status not null default 'draft',
    old_terms_json jsonb not null default '{}'::jsonb,
    new_terms_json jsonb not null default '{}'::jsonb,
    effective_date date,
    request_reason text,
    approval_request_id uuid,
    approved_by uuid references auth.users(id),
    approved_at timestamptz,
    rejected_by uuid references auth.users(id),
    rejected_at timestamptz,
    rejection_reason text,
    created_by uuid references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists loan_restructures_tenant_status_created_idx
    on public.loan_restructures (tenant_id, request_status, created_at desc);

create index if not exists loan_restructures_case_idx
    on public.loan_restructures (default_case_id, created_at desc);

create table if not exists public.loan_writeoffs (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id),
    default_case_id uuid not null references public.loan_default_cases(id) on delete cascade,
    loan_id uuid not null references public.loans(id),
    principal_amount numeric(18,2) not null default 0 check (principal_amount >= 0),
    interest_amount numeric(18,2) not null default 0 check (interest_amount >= 0),
    fee_amount numeric(18,2) not null default 0 check (fee_amount >= 0),
    total_amount numeric(18,2) not null check (total_amount >= 0),
    writeoff_reason_code text not null,
    approval_request_id uuid,
    posted_journal_id uuid references public.journal_entries(id),
    written_off_by uuid references auth.users(id),
    written_off_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    check (total_amount >= principal_amount + interest_amount + fee_amount)
);

create index if not exists loan_writeoffs_tenant_written_off_idx
    on public.loan_writeoffs (tenant_id, written_off_at desc);

create index if not exists loan_writeoffs_case_idx
    on public.loan_writeoffs (default_case_id);

create table if not exists public.loan_recoveries (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id),
    default_case_id uuid not null references public.loan_default_cases(id) on delete cascade,
    loan_id uuid not null references public.loans(id),
    recovery_type public.loan_recovery_type not null default 'cash',
    amount numeric(18,2) not null check (amount > 0),
    reference text,
    notes text,
    posted_journal_id uuid references public.journal_entries(id),
    recovered_by uuid references auth.users(id),
    recovered_at timestamptz not null default now(),
    created_at timestamptz not null default now()
);

create index if not exists loan_recoveries_tenant_recovered_idx
    on public.loan_recoveries (tenant_id, recovered_at desc);

create index if not exists loan_recoveries_case_idx
    on public.loan_recoveries (default_case_id);

create table if not exists public.guarantor_exposures (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id),
    guarantor_member_id uuid not null references public.members(id),
    committed_amount numeric(18,2) not null default 0 check (committed_amount >= 0),
    invoked_amount numeric(18,2) not null default 0 check (invoked_amount >= 0),
    available_amount numeric(18,2) not null default 0 check (available_amount >= 0),
    last_recalculated_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (tenant_id, guarantor_member_id)
);

create index if not exists guarantor_exposures_tenant_available_idx
    on public.guarantor_exposures (tenant_id, available_amount desc);

create table if not exists public.guarantor_claims (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id),
    branch_id uuid not null references public.branches(id),
    default_case_id uuid not null references public.loan_default_cases(id) on delete cascade,
    loan_id uuid not null references public.loans(id),
    guarantor_member_id uuid not null references public.members(id),
    claim_amount numeric(18,2) not null check (claim_amount > 0),
    settled_amount numeric(18,2) not null default 0 check (settled_amount >= 0),
    status public.guarantor_claim_status not null default 'draft',
    claim_reference text,
    notes text,
    approval_request_id uuid,
    posted_journal_id uuid references public.journal_entries(id),
    claimed_by uuid references auth.users(id),
    claimed_at timestamptz not null default now(),
    settled_at timestamptz,
    waived_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (settled_amount <= claim_amount)
);

create index if not exists guarantor_claims_tenant_status_claimed_idx
    on public.guarantor_claims (tenant_id, status, claimed_at desc);

create index if not exists guarantor_claims_tenant_guarantor_status_idx
    on public.guarantor_claims (tenant_id, guarantor_member_id, status);

create trigger set_loan_default_cases_updated_at before update on public.loan_default_cases
for each row execute function public.set_updated_at();

create trigger set_collection_actions_updated_at before update on public.collection_actions
for each row execute function public.set_updated_at();

create trigger set_loan_restructures_updated_at before update on public.loan_restructures
for each row execute function public.set_updated_at();

create trigger set_guarantor_exposures_updated_at before update on public.guarantor_exposures
for each row execute function public.set_updated_at();

create trigger set_guarantor_claims_updated_at before update on public.guarantor_claims
for each row execute function public.set_updated_at();
