create table if not exists public.webhook_events (
    id uuid primary key default gen_random_uuid(),
    event_id text not null unique,
    event_type text not null,
    payload jsonb not null default '{}'::jsonb,
    processed_at timestamptz,
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists webhook_events_event_type_idx
    on public.webhook_events (event_type);

create index if not exists webhook_events_processed_at_idx
    on public.webhook_events (processed_at desc nulls last);
