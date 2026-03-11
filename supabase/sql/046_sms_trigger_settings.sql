-- Tenant-scoped SMS trigger controls managed by tenant super admin.

create table if not exists public.sms_trigger_settings (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    event_type text not null,
    enabled boolean not null default true,
    created_by uuid null,
    updated_by uuid null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (tenant_id, event_type)
);

create index if not exists idx_sms_trigger_settings_tenant_event
on public.sms_trigger_settings (tenant_id, event_type);

drop trigger if exists set_sms_trigger_settings_updated_at on public.sms_trigger_settings;
create trigger set_sms_trigger_settings_updated_at
before update on public.sms_trigger_settings
for each row execute function public.set_updated_at();

alter table public.sms_trigger_settings enable row level security;

revoke all on table public.sms_trigger_settings from anon;
revoke all on table public.sms_trigger_settings from authenticated;
