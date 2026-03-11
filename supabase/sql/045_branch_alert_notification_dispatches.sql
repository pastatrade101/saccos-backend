-- Phase 4 foundation: branch alert dispatch log for operational SMS notifications.

create table if not exists public.notification_dispatches (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    branch_id uuid null references public.branches(id) on delete set null,
    event_type text not null,
    event_key text not null,
    channel text not null default 'sms' check (channel in ('sms', 'email', 'in_app')),
    target_user_id uuid not null,
    target_phone text null,
    message text not null,
    metadata jsonb not null default '{}'::jsonb,
    status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
    sent_at timestamptz null,
    failed_at timestamptz null,
    error_message text null,
    provider_payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists uq_notification_dispatches_event_target_channel
on public.notification_dispatches (event_key, target_user_id, channel);

create index if not exists idx_notification_dispatches_tenant_created_at
on public.notification_dispatches (tenant_id, created_at desc);

create index if not exists idx_notification_dispatches_tenant_status
on public.notification_dispatches (tenant_id, status, created_at desc);

create index if not exists idx_notification_dispatches_branch_created_at
on public.notification_dispatches (branch_id, created_at desc)
where branch_id is not null;

drop trigger if exists set_notification_dispatches_updated_at on public.notification_dispatches;
create trigger set_notification_dispatches_updated_at
before update on public.notification_dispatches
for each row execute function public.set_updated_at();

alter table public.notification_dispatches enable row level security;

revoke all on table public.notification_dispatches from anon;
revoke all on table public.notification_dispatches from authenticated;
