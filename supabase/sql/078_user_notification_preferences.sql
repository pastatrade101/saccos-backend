create table if not exists public.user_notification_preferences (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    event_type text not null,
    in_app_enabled boolean not null default true,
    sms_enabled boolean not null default true,
    toast_enabled boolean not null default false,
    created_by uuid null references auth.users(id) on delete set null,
    updated_by uuid null references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (tenant_id, user_id, event_type)
);

create index if not exists idx_user_notification_preferences_user_event
on public.user_notification_preferences (user_id, event_type);

create index if not exists idx_user_notification_preferences_tenant_user
on public.user_notification_preferences (tenant_id, user_id);

drop trigger if exists set_user_notification_preferences_updated_at on public.user_notification_preferences;
create trigger set_user_notification_preferences_updated_at
before update on public.user_notification_preferences
for each row execute function public.set_updated_at();

alter table public.user_notification_preferences enable row level security;

revoke all on table public.user_notification_preferences from anon;
revoke all on table public.user_notification_preferences from authenticated;
