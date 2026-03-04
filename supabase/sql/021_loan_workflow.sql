do $$
begin
    create type public.loan_application_status as enum (
        'draft',
        'submitted',
        'appraised',
        'approved',
        'rejected',
        'disbursed',
        'cancelled'
    );
exception
    when duplicate_object then null;
end $$;

do $$
begin
    create type public.loan_approval_decision as enum ('approved', 'rejected');
exception
    when duplicate_object then null;
end $$;

create table if not exists public.loan_products (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id),
    code text not null,
    name text not null,
    description text,
    interest_method text not null default 'reducing_balance' check (interest_method in ('reducing_balance', 'flat')),
    annual_interest_rate numeric(9,4) not null default 18 check (annual_interest_rate >= 0),
    min_amount numeric(18,2) not null default 0 check (min_amount >= 0),
    max_amount numeric(18,2) check (max_amount is null or max_amount >= min_amount),
    min_term_count integer not null default 1 check (min_term_count > 0),
    max_term_count integer check (max_term_count is null or max_term_count >= min_term_count),
    insurance_rate numeric(9,4) not null default 0 check (insurance_rate >= 0),
    required_guarantors_count integer not null default 0 check (required_guarantors_count >= 0),
    eligibility_rules_json jsonb not null default '{}'::jsonb,
    processing_fee_rule_id uuid references public.fee_rules(id),
    penalty_rule_id uuid references public.penalty_rules(id),
    receivable_account_id uuid not null references public.chart_of_accounts(id),
    interest_income_account_id uuid not null references public.chart_of_accounts(id),
    fee_income_account_id uuid references public.chart_of_accounts(id),
    penalty_income_account_id uuid references public.chart_of_accounts(id),
    is_default boolean not null default false,
    status text not null default 'active' check (status in ('active', 'inactive')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    deleted_by uuid references auth.users(id)
);

create unique index if not exists loan_products_tenant_code_key
    on public.loan_products (tenant_id, code)
    where deleted_at is null;

create table if not exists public.loan_policy_settings (
    tenant_id uuid primary key references public.tenants(id),
    default_repayment_order jsonb not null default '["penalty","fees","interest","principal"]'::jsonb,
    require_open_teller_session_for_disbursement boolean not null default true,
    multi_approval_required boolean not null default false,
    committee_approval_count integer not null default 1 check (committee_approval_count > 0),
    out_of_policy_requires_notes boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.loan_applications (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id),
    branch_id uuid not null references public.branches(id),
    member_id uuid not null references public.members(id),
    product_id uuid not null references public.loan_products(id),
    external_reference text,
    purpose text not null,
    requested_amount numeric(18,2) not null check (requested_amount > 0),
    requested_term_count integer not null check (requested_term_count > 0),
    requested_repayment_frequency public.repayment_frequency not null default 'monthly',
    requested_interest_rate numeric(9,4) check (requested_interest_rate is null or requested_interest_rate >= 0),
    created_via text not null default 'staff' check (created_via in ('member_portal', 'staff')),
    status public.loan_application_status not null default 'draft',
    requested_by uuid not null references auth.users(id),
    requested_on_behalf_by uuid references auth.users(id),
    submitted_at timestamptz,
    appraised_by uuid references auth.users(id),
    appraised_at timestamptz,
    appraisal_notes text,
    risk_rating text,
    recommended_amount numeric(18,2) check (recommended_amount is null or recommended_amount > 0),
    recommended_term_count integer check (recommended_term_count is null or recommended_term_count > 0),
    recommended_interest_rate numeric(9,4) check (recommended_interest_rate is null or recommended_interest_rate >= 0),
    recommended_repayment_frequency public.repayment_frequency,
    required_approval_count integer not null default 1 check (required_approval_count > 0),
    approval_count integer not null default 0 check (approval_count >= 0),
    approval_notes text,
    approved_by uuid references auth.users(id),
    approved_at timestamptz,
    disbursement_ready_at timestamptz,
    rejected_by uuid references auth.users(id),
    rejected_at timestamptz,
    rejection_reason text,
    disbursed_by uuid references auth.users(id),
    disbursed_at timestamptz,
    loan_id uuid references public.loans(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists loan_applications_tenant_status_idx
    on public.loan_applications (tenant_id, status, created_at desc);

create index if not exists loan_applications_member_idx
    on public.loan_applications (tenant_id, member_id, created_at desc);

create index if not exists loan_applications_branch_idx
    on public.loan_applications (tenant_id, branch_id, created_at desc);

create unique index if not exists loan_applications_loan_id_key
    on public.loan_applications (loan_id)
    where loan_id is not null;

create table if not exists public.loan_approvals (
    id uuid primary key default gen_random_uuid(),
    application_id uuid not null references public.loan_applications(id) on delete cascade,
    tenant_id uuid not null references public.tenants(id),
    approver_id uuid not null references auth.users(id),
    approval_level integer not null default 1,
    decision public.loan_approval_decision not null,
    notes text,
    created_at timestamptz not null default now(),
    unique (application_id, approver_id)
);

create index if not exists loan_approvals_application_idx
    on public.loan_approvals (application_id, created_at desc);

create table if not exists public.loan_guarantors (
    id uuid primary key default gen_random_uuid(),
    application_id uuid not null references public.loan_applications(id) on delete cascade,
    tenant_id uuid not null references public.tenants(id),
    member_id uuid not null references public.members(id),
    guaranteed_amount numeric(18,2) not null default 0 check (guaranteed_amount >= 0),
    consent_status text not null default 'pending' check (consent_status in ('pending', 'accepted', 'rejected')),
    consented_at timestamptz,
    notes text,
    created_at timestamptz not null default now(),
    unique (application_id, member_id)
);

create index if not exists loan_guarantors_application_idx
    on public.loan_guarantors (application_id);

create table if not exists public.collateral_items (
    id uuid primary key default gen_random_uuid(),
    application_id uuid not null references public.loan_applications(id) on delete cascade,
    tenant_id uuid not null references public.tenants(id),
    collateral_type text not null,
    description text not null,
    valuation_amount numeric(18,2) not null default 0 check (valuation_amount >= 0),
    lien_reference text,
    documents_json jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists collateral_items_application_idx
    on public.collateral_items (application_id);

alter table public.loans
    add column if not exists application_id uuid references public.loan_applications(id);

create unique index if not exists loans_application_id_key
    on public.loans (application_id)
    where application_id is not null;

create or replace function public.seed_phase3_defaults(p_tenant_id uuid)
returns void
language plpgsql
as $$
declare
    v_loan_portfolio_account_id uuid;
    v_interest_income_account_id uuid;
begin
    select default_loan_portfolio_account_id, default_interest_income_account_id
      into v_loan_portfolio_account_id, v_interest_income_account_id
      from public.tenant_settings
     where tenant_id = p_tenant_id;

    insert into public.loan_policy_settings (
        tenant_id,
        default_repayment_order,
        require_open_teller_session_for_disbursement,
        multi_approval_required,
        committee_approval_count,
        out_of_policy_requires_notes
    )
    values (
        p_tenant_id,
        '["penalty","fees","interest","principal"]'::jsonb,
        true,
        false,
        1,
        true
    )
    on conflict (tenant_id) do nothing;

    if v_loan_portfolio_account_id is not null and v_interest_income_account_id is not null then
        insert into public.loan_products (
            tenant_id,
            code,
            name,
            description,
            interest_method,
            annual_interest_rate,
            min_amount,
            max_amount,
            min_term_count,
            max_term_count,
            insurance_rate,
            required_guarantors_count,
            eligibility_rules_json,
            receivable_account_id,
            interest_income_account_id,
            fee_income_account_id,
            penalty_income_account_id,
            is_default,
            status
        )
        values (
            p_tenant_id,
            'STANDARD',
            'Standard Loan',
            'Default tenant loan product seeded for workflow operations.',
            'reducing_balance',
            18,
            100000,
            10000000,
            1,
            36,
            0,
            1,
            '{"min_membership_months": 3, "requires_active_member": true}'::jsonb,
            v_loan_portfolio_account_id,
            v_interest_income_account_id,
            v_interest_income_account_id,
            v_interest_income_account_id,
            true,
            'active'
        )
        on conflict (tenant_id, code) where deleted_at is null do nothing;
    end if;
end;
$$;

do $$
declare
    tenant_row record;
begin
    for tenant_row in select id from public.tenants where deleted_at is null loop
        perform public.seed_phase3_defaults(tenant_row.id);
    end loop;
end $$;

create trigger set_loan_products_updated_at before update on public.loan_products
for each row execute function public.set_updated_at();

create trigger set_loan_policy_settings_updated_at before update on public.loan_policy_settings
for each row execute function public.set_updated_at();

create trigger set_loan_applications_updated_at before update on public.loan_applications
for each row execute function public.set_updated_at();

grant execute on function public.seed_phase3_defaults(uuid) to service_role;
