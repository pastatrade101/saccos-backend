create table if not exists public.payment_orders (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    member_id uuid not null references public.members(id) on delete cascade,
    account_id uuid not null references public.member_accounts(id) on delete restrict,
    created_by_user_id uuid not null,
    gateway text not null,
    purpose text not null,
    provider text not null,
    msisdn text not null,
    amount numeric(18, 2) not null,
    currency text not null default 'TZS',
    status text not null default 'created',
    external_id text not null,
    provider_ref text,
    description text,
    gateway_request jsonb not null default '{}'::jsonb,
    gateway_response jsonb not null default '{}'::jsonb,
    latest_callback_payload jsonb not null default '{}'::jsonb,
    metadata jsonb not null default '{}'::jsonb,
    callback_received_at timestamptz,
    paid_at timestamptz,
    posted_at timestamptz,
    failed_at timestamptz,
    expired_at timestamptz,
    expires_at timestamptz,
    journal_id uuid references public.journal_entries(id) on delete set null,
    error_code text,
    error_message text,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint payment_orders_gateway_check check (gateway in ('azampay')),
    constraint payment_orders_purpose_check check (purpose in ('share_contribution')),
    constraint payment_orders_provider_check check (provider in ('airtel', 'vodacom', 'tigo', 'halopesa')),
    constraint payment_orders_status_check check (status in ('created', 'pending', 'paid', 'failed', 'expired', 'posted')),
    constraint payment_orders_amount_check check (amount > 0),
    constraint payment_orders_currency_check check (char_length(currency) between 3 and 5)
);

create unique index if not exists payment_orders_external_id_key
    on public.payment_orders (external_id);

create unique index if not exists payment_orders_provider_ref_key
    on public.payment_orders (provider_ref)
    where provider_ref is not null;

create unique index if not exists payment_orders_journal_id_key
    on public.payment_orders (journal_id)
    where journal_id is not null;

create index if not exists payment_orders_tenant_member_created_idx
    on public.payment_orders (tenant_id, member_id, created_at desc);

create index if not exists payment_orders_tenant_status_created_idx
    on public.payment_orders (tenant_id, status, created_at desc);

create index if not exists payment_orders_status_expires_idx
    on public.payment_orders (status, expires_at)
    where status in ('created', 'pending');

create table if not exists public.payment_order_callbacks (
    id uuid primary key default gen_random_uuid(),
    payment_order_id uuid references public.payment_orders(id) on delete cascade,
    gateway text not null,
    source text not null default 'callback',
    external_id text,
    provider_ref text,
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default timezone('utc', now()),
    constraint payment_order_callbacks_gateway_check check (gateway in ('azampay'))
);

create index if not exists payment_order_callbacks_order_created_idx
    on public.payment_order_callbacks (payment_order_id, created_at desc);

create index if not exists payment_order_callbacks_gateway_external_idx
    on public.payment_order_callbacks (gateway, external_id, created_at desc);

create index if not exists payment_order_callbacks_gateway_provider_idx
    on public.payment_order_callbacks (gateway, provider_ref, created_at desc);
