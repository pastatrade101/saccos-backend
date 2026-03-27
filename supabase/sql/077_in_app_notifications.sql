alter table public.notification_dispatches
    alter column target_user_id drop not null;

drop index if exists public.uq_notification_dispatches_event_target_channel;

create unique index if not exists uq_notification_dispatches_event_target_channel
on public.notification_dispatches (
    event_key,
    coalesce(target_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(target_phone, ''),
    channel
);

create table if not exists public.notifications (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    branch_id uuid null references public.branches(id) on delete set null,
    recipient_user_id uuid not null references auth.users(id) on delete cascade,
    recipient_role text null,
    event_type text not null,
    event_key text not null,
    title text not null,
    message text not null,
    severity text not null default 'info' check (severity in ('info', 'success', 'warning', 'critical')),
    status text not null default 'unread' check (status in ('unread', 'read', 'archived')),
    action_label text null,
    action_route text null,
    entity_type text null,
    entity_id uuid null,
    metadata jsonb not null default '{}'::jsonb,
    read_at timestamptz null,
    archived_at timestamptz null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists uq_notifications_event_recipient
on public.notifications (event_key, recipient_user_id);

create index if not exists idx_notifications_recipient_status_created_at
on public.notifications (recipient_user_id, status, created_at desc);

create index if not exists idx_notifications_tenant_created_at
on public.notifications (tenant_id, created_at desc);

create index if not exists idx_notifications_branch_created_at
on public.notifications (branch_id, created_at desc)
where branch_id is not null;

drop trigger if exists set_notifications_updated_at on public.notifications;
create trigger set_notifications_updated_at
before update on public.notifications
for each row execute function public.set_updated_at();

alter table public.notifications enable row level security;

revoke all on table public.notifications from anon;
revoke all on table public.notifications from authenticated;
