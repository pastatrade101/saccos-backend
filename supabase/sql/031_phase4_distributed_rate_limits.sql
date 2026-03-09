create table if not exists public.api_rate_limit_windows (
    scope_key text primary key,
    request_count integer not null default 0,
    window_started_at timestamptz not null,
    window_ends_at timestamptz not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists api_rate_limit_windows_window_ends_idx
    on public.api_rate_limit_windows (window_ends_at);

alter table public.api_rate_limit_windows enable row level security;

create or replace function public.consume_rate_limit(
    p_scope_key text,
    p_max_requests integer,
    p_window_ms integer
)
returns table (
    allowed boolean,
    retry_after_ms bigint,
    remaining integer,
    reset_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_now timestamptz := clock_timestamp();
    v_window_interval interval;
    v_count integer;
    v_window_ends_at timestamptz;
begin
    if p_scope_key is null or btrim(p_scope_key) = '' then
        raise exception 'p_scope_key is required' using errcode = '22023';
    end if;

    if coalesce(p_max_requests, 0) <= 0 or coalesce(p_window_ms, 0) <= 0 then
        return query select true, 0::bigint, 2147483647, v_now;
        return;
    end if;

    v_window_interval := (p_window_ms::text || ' milliseconds')::interval;

    perform pg_advisory_xact_lock(hashtext(p_scope_key), 0);

    select request_count, window_ends_at
    into v_count, v_window_ends_at
    from public.api_rate_limit_windows
    where scope_key = p_scope_key
    for update;

    if not found then
        v_window_ends_at := v_now + v_window_interval;

        insert into public.api_rate_limit_windows (
            scope_key,
            request_count,
            window_started_at,
            window_ends_at,
            updated_at
        )
        values (
            p_scope_key,
            1,
            v_now,
            v_window_ends_at,
            v_now
        );

        return query select true, 0::bigint, greatest(p_max_requests - 1, 0), v_window_ends_at;
        return;
    end if;

    if v_window_ends_at <= v_now then
        v_window_ends_at := v_now + v_window_interval;

        update public.api_rate_limit_windows
        set
            request_count = 1,
            window_started_at = v_now,
            window_ends_at = v_window_ends_at,
            updated_at = v_now
        where scope_key = p_scope_key;

        return query select true, 0::bigint, greatest(p_max_requests - 1, 0), v_window_ends_at;
        return;
    end if;

    if v_count < p_max_requests then
        update public.api_rate_limit_windows
        set
            request_count = request_count + 1,
            updated_at = v_now
        where scope_key = p_scope_key
        returning request_count, window_ends_at
        into v_count, v_window_ends_at;

        return query select true, 0::bigint, greatest(p_max_requests - v_count, 0), v_window_ends_at;
        return;
    end if;

    return query
    select
        false,
        greatest(0, ceil(extract(epoch from (v_window_ends_at - v_now)) * 1000)::bigint),
        0,
        v_window_ends_at;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public;
revoke all on function public.consume_rate_limit(text, integer, integer) from anon;
revoke all on function public.consume_rate_limit(text, integer, integer) from authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
