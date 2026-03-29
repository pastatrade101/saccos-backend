create table if not exists public.loan_disbursement_orders (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    branch_id uuid not null references public.branches(id) on delete cascade,
    application_id uuid not null references public.loan_applications(id) on delete cascade,
    member_id uuid not null references public.members(id) on delete restrict,
    created_by_user_id uuid not null,
    approval_request_id uuid references public.approval_requests(id) on delete set null,
    gateway text not null,
    channel text not null default 'mobile_money',
    provider text,
    msisdn text not null,
    amount numeric(18, 2) not null,
    currency text not null default 'TZS',
    status text not null default 'created',
    external_id text not null,
    provider_ref text,
    reference text,
    description text,
    gateway_request jsonb not null default '{}'::jsonb,
    gateway_response jsonb not null default '{}'::jsonb,
    latest_callback_payload jsonb not null default '{}'::jsonb,
    metadata jsonb not null default '{}'::jsonb,
    callback_received_at timestamptz,
    completed_at timestamptz,
    posted_at timestamptz,
    failed_at timestamptz,
    expired_at timestamptz,
    expires_at timestamptz,
    loan_id uuid references public.loans(id) on delete set null,
    journal_id uuid references public.journal_entries(id) on delete set null,
    error_code text,
    error_message text,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint loan_disbursement_orders_gateway_check check (gateway in ('snippe')),
    constraint loan_disbursement_orders_channel_check check (channel in ('mobile_money')),
    constraint loan_disbursement_orders_provider_check check (provider is null or provider in ('airtel', 'vodacom', 'tigo', 'halopesa', 'mpesa', 'mixx')),
    constraint loan_disbursement_orders_status_check check (status in ('created', 'pending', 'completed', 'failed', 'expired', 'posted')),
    constraint loan_disbursement_orders_amount_check check (amount > 0),
    constraint loan_disbursement_orders_currency_check check (char_length(currency) between 3 and 5)
);

create unique index if not exists loan_disbursement_orders_external_id_key
    on public.loan_disbursement_orders (external_id);

create unique index if not exists loan_disbursement_orders_provider_ref_key
    on public.loan_disbursement_orders (provider_ref)
    where provider_ref is not null;

create unique index if not exists loan_disbursement_orders_journal_id_key
    on public.loan_disbursement_orders (journal_id)
    where journal_id is not null;

create unique index if not exists loan_disbursement_orders_open_application_key
    on public.loan_disbursement_orders (application_id)
    where status in ('created', 'pending', 'completed');

create index if not exists loan_disbursement_orders_tenant_status_created_idx
    on public.loan_disbursement_orders (tenant_id, status, created_at desc);

create index if not exists loan_disbursement_orders_application_created_idx
    on public.loan_disbursement_orders (application_id, created_at desc);

create table if not exists public.loan_disbursement_order_callbacks (
    id uuid primary key default gen_random_uuid(),
    disbursement_order_id uuid references public.loan_disbursement_orders(id) on delete cascade,
    gateway text not null,
    source text not null default 'callback',
    external_id text,
    provider_ref text,
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default timezone('utc', now()),
    constraint loan_disbursement_order_callbacks_gateway_check check (gateway in ('snippe'))
);

create index if not exists loan_disbursement_order_callbacks_order_created_idx
    on public.loan_disbursement_order_callbacks (disbursement_order_id, created_at desc);

create index if not exists loan_disbursement_order_callbacks_gateway_external_idx
    on public.loan_disbursement_order_callbacks (gateway, external_id, created_at desc);

create index if not exists loan_disbursement_order_callbacks_gateway_provider_idx
    on public.loan_disbursement_order_callbacks (gateway, provider_ref, created_at desc);
