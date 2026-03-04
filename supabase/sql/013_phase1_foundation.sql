do $$
begin
    if not exists (
        select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'member_application_status'
    ) then
        create type public.member_application_status as enum (
            'draft',
            'submitted',
            'under_review',
            'approved',
            'rejected',
            'cancelled'
        );
    end if;

    if not exists (
        select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'kyc_status'
    ) then
        create type public.kyc_status as enum ('pending', 'verified', 'rejected', 'waived');
    end if;

    if not exists (
        select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'membership_status_code'
    ) then
        create type public.membership_status_code as enum ('pending', 'active', 'suspended', 'exited');
    end if;

    if not exists (
        select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'fee_rule_type'
    ) then
        create type public.fee_rule_type as enum ('membership_fee', 'withdrawal_fee', 'loan_processing_fee', 'other');
    end if;

    if not exists (
        select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'penalty_rule_type'
    ) then
        create type public.penalty_rule_type as enum ('late_repayment', 'arrears', 'other');
    end if;

    if not exists (
        select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'rule_calculation_method'
    ) then
        create type public.rule_calculation_method as enum ('flat', 'percentage', 'percentage_per_period');
    end if;

    if not exists (
        select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'posting_rule_scope'
    ) then
        create type public.posting_rule_scope as enum ('general', 'savings', 'shares', 'loans', 'dividends', 'membership');
    end if;
end
$$;

do $$
begin
    begin
        alter type public.journal_source add value 'membership_fee';
    exception
        when duplicate_object then null;
    end;

    begin
        alter type public.journal_source add value 'share_purchase';
    exception
        when duplicate_object then null;
    end;

    begin
        alter type public.journal_source add value 'share_refund';
    exception
        when duplicate_object then null;
    end;

    begin
        alter type public.journal_source add value 'loan_fee';
    exception
        when duplicate_object then null;
    end;

    begin
        alter type public.journal_source add value 'penalty';
    exception
        when duplicate_object then null;
    end;
end
$$;

alter table public.user_profiles
    add column if not exists last_login_at timestamptz;

alter table public.members
    add column if not exists dob date,
    add column if not exists address_line1 text,
    add column if not exists address_line2 text,
    add column if not exists city text,
    add column if not exists state text,
    add column if not exists country text,
    add column if not exists postal_code text,
    add column if not exists nida_no text,
    add column if not exists tin_no text,
    add column if not exists next_of_kin_name text,
    add column if not exists next_of_kin_phone text,
    add column if not exists next_of_kin_relationship text,
    add column if not exists employer text,
    add column if not exists kyc_status public.kyc_status not null default 'pending',
    add column if not exists kyc_reason text;

create table if not exists public.member_applications (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    branch_id uuid not null references public.branches (id),
    application_no text not null,
    status public.member_application_status not null default 'draft',
    kyc_status public.kyc_status not null default 'pending',
    kyc_reason text,
    full_name text not null,
    dob date,
    phone text,
    email text,
    address_line1 text,
    address_line2 text,
    city text,
    state text,
    country text,
    postal_code text,
    nida_no text,
    tin_no text,
    next_of_kin_name text,
    next_of_kin_phone text,
    next_of_kin_relationship text,
    employer text,
    member_no text,
    national_id text,
    notes text,
    membership_fee_amount numeric(18,2) not null default 0,
    membership_fee_paid numeric(18,2) not null default 0,
    approved_member_id uuid references public.members (id),
    created_by uuid not null references auth.users (id),
    reviewed_by uuid references auth.users (id),
    reviewed_at timestamptz,
    approved_by uuid references auth.users (id),
    approved_at timestamptz,
    rejected_by uuid references auth.users (id),
    rejected_at timestamptz,
    rejection_reason text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    deleted_by uuid references auth.users (id)
);

create unique index if not exists member_applications_tenant_application_no_key
    on public.member_applications (tenant_id, application_no)
    where deleted_at is null;

create table if not exists public.member_application_attachments (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    application_id uuid not null references public.member_applications (id) on delete cascade,
    storage_bucket text not null default 'receipts',
    storage_path text not null,
    file_name text not null,
    mime_type text,
    file_size_bytes bigint,
    uploaded_by uuid not null references auth.users (id),
    created_at timestamptz not null default now()
);

alter table public.members
    add column if not exists approved_application_id uuid references public.member_applications (id);

create table if not exists public.membership_status_history (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    member_id uuid not null references public.members (id) on delete cascade,
    application_id uuid references public.member_applications (id),
    status public.membership_status_code not null,
    reason text,
    changed_by uuid references auth.users (id),
    changed_at timestamptz not null default now()
);

create table if not exists public.savings_products (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    code text not null,
    name text not null,
    is_compulsory boolean not null default true,
    is_default boolean not null default false,
    min_opening_balance numeric(18,2) not null default 0,
    min_balance numeric(18,2) not null default 0,
    withdrawal_notice_days integer not null default 0,
    allow_withdrawals boolean not null default true,
    status text not null default 'active' check (status in ('active', 'inactive')),
    liability_account_id uuid not null references public.chart_of_accounts (id),
    fee_income_account_id uuid references public.chart_of_accounts (id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    deleted_by uuid references auth.users (id)
);

create unique index if not exists savings_products_tenant_code_key
    on public.savings_products (tenant_id, code)
    where deleted_at is null;

create unique index if not exists savings_products_tenant_default_key
    on public.savings_products (tenant_id, is_default)
    where is_default = true and deleted_at is null;

create table if not exists public.share_products (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    code text not null,
    name text not null,
    is_compulsory boolean not null default true,
    is_default boolean not null default false,
    minimum_shares numeric(18,2) not null default 0,
    maximum_shares numeric(18,2),
    allow_refund boolean not null default false,
    status text not null default 'active' check (status in ('active', 'inactive')),
    equity_account_id uuid not null references public.chart_of_accounts (id),
    fee_income_account_id uuid references public.chart_of_accounts (id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    deleted_by uuid references auth.users (id)
);

create unique index if not exists share_products_tenant_code_key
    on public.share_products (tenant_id, code)
    where deleted_at is null;

create unique index if not exists share_products_tenant_default_key
    on public.share_products (tenant_id, is_default)
    where is_default = true and deleted_at is null;

create table if not exists public.fee_rules (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    code text not null,
    name text not null,
    fee_type public.fee_rule_type not null,
    calculation_method public.rule_calculation_method not null,
    flat_amount numeric(18,2) not null default 0,
    percentage_value numeric(9,4) not null default 0,
    is_active boolean not null default true,
    income_account_id uuid not null references public.chart_of_accounts (id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    deleted_by uuid references auth.users (id)
);

create unique index if not exists fee_rules_tenant_code_key
    on public.fee_rules (tenant_id, code)
    where deleted_at is null;

create table if not exists public.penalty_rules (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    code text not null,
    name text not null,
    penalty_type public.penalty_rule_type not null,
    calculation_method public.rule_calculation_method not null,
    flat_amount numeric(18,2) not null default 0,
    percentage_value numeric(9,4) not null default 0,
    is_active boolean not null default true,
    income_account_id uuid not null references public.chart_of_accounts (id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    deleted_by uuid references auth.users (id)
);

create unique index if not exists penalty_rules_tenant_code_key
    on public.penalty_rules (tenant_id, code)
    where deleted_at is null;

create table if not exists public.posting_rules (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id),
    operation_code text not null,
    scope public.posting_rule_scope not null default 'general',
    description text,
    debit_account_id uuid not null references public.chart_of_accounts (id),
    credit_account_id uuid not null references public.chart_of_accounts (id),
    is_active boolean not null default true,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    deleted_by uuid references auth.users (id)
);

create unique index if not exists posting_rules_tenant_operation_key
    on public.posting_rules (tenant_id, operation_code)
    where deleted_at is null;

alter table public.member_accounts
    add column if not exists savings_product_id uuid references public.savings_products (id),
    add column if not exists share_product_id uuid references public.share_products (id);

create index if not exists member_accounts_savings_product_idx
    on public.member_accounts (tenant_id, savings_product_id)
    where savings_product_id is not null and deleted_at is null;

create index if not exists member_accounts_share_product_idx
    on public.member_accounts (tenant_id, share_product_id)
    where share_product_id is not null and deleted_at is null;

create index if not exists member_applications_tenant_status_idx
    on public.member_applications (tenant_id, status, created_at desc);

create index if not exists member_applications_branch_status_idx
    on public.member_applications (branch_id, status, created_at desc);

create index if not exists user_profiles_tenant_branch_idx
    on public.user_profiles (tenant_id, branch_id)
    where deleted_at is null;

create index if not exists membership_status_history_member_changed_idx
    on public.membership_status_history (member_id, changed_at desc);

create index if not exists posting_rules_tenant_scope_idx
    on public.posting_rules (tenant_id, scope, is_active);

create trigger set_member_applications_updated_at
before update on public.member_applications
for each row execute function public.set_updated_at();

create trigger set_savings_products_updated_at
before update on public.savings_products
for each row execute function public.set_updated_at();

create trigger set_share_products_updated_at
before update on public.share_products
for each row execute function public.set_updated_at();

create trigger set_fee_rules_updated_at
before update on public.fee_rules
for each row execute function public.set_updated_at();

create trigger set_penalty_rules_updated_at
before update on public.penalty_rules
for each row execute function public.set_updated_at();

create trigger set_posting_rules_updated_at
before update on public.posting_rules
for each row execute function public.set_updated_at();
