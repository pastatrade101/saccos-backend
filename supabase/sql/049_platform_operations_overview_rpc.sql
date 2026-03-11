-- DB-side aggregation for platform operations dashboard.
-- Purpose: avoid large row hydration in Node and reduce p95 + memory pressure.

create index if not exists idx_notification_dispatches_sms_created_at
    on public.notification_dispatches (created_at desc)
    where channel = 'sms';

create index if not exists idx_notification_dispatches_sms_tenant_created_at
    on public.notification_dispatches (tenant_id, created_at desc)
    where channel = 'sms';

create or replace function public.platform_operations_overview(
    p_tenant_id uuid default null,
    p_window_minutes integer default 60,
    p_sort_by text default 'traffic',
    p_sort_dir text default 'desc',
    p_errors_limit integer default 20,
    p_slow_limit integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_window_minutes integer := greatest(1, least(coalesce(p_window_minutes, 60), 10080));
    v_sort_by text := case when coalesce(p_sort_by, 'traffic') in ('traffic', 'errors', 'latency', 'sms')
        then coalesce(p_sort_by, 'traffic') else 'traffic' end;
    v_sort_dir text := case when lower(coalesce(p_sort_dir, 'desc')) = 'asc' then 'asc' else 'desc' end;
    v_errors_limit integer := greatest(1, least(coalesce(p_errors_limit, 20), 100));
    v_slow_limit integer := greatest(1, least(coalesce(p_slow_limit, 10), 100));
    v_bucket_minutes integer := greatest(1, ceil(v_window_minutes::numeric / 20.0)::integer);
    v_from timestamptz := timezone('utc', now()) - make_interval(mins => v_window_minutes);
    v_output jsonb;
begin
    with filtered_metrics as materialized (
        select
            am.tenant_id,
            am.user_id,
            am.endpoint,
            am.latency_ms,
            am.status_code,
            am.created_at,
            am.request_bytes,
            am.response_bytes
        from public.api_metrics am
        where am.created_at >= v_from
          and (p_tenant_id is null or am.tenant_id = p_tenant_id)
    ),
    system_summary as (
        select
            count(*)::bigint as request_count,
            coalesce(
                round((percentile_cont(0.95) within group (order by fm.latency_ms))::numeric, 3),
                0
            ) as p95_latency_ms,
            case
                when count(*) = 0 then 0
                else round((100.0 * sum(case when fm.status_code >= 500 then 1 else 0 end)::numeric / count(*))::numeric, 3)
            end as error_rate_pct,
            count(distinct fm.user_id)::bigint as active_users,
            count(distinct fm.tenant_id)::bigint as active_tenants,
            coalesce(
                round(
                    (
                        sum(coalesce(fm.request_bytes, 0) + coalesce(fm.response_bytes, 0))::numeric
                        * 8
                        / greatest(v_window_minutes * 60, 1)
                        / 1000000
                    ),
                    3
                ),
                0
            ) as network_mbps
        from filtered_metrics fm
    ),
    timeseries as (
        select
            date_bin(make_interval(mins => v_bucket_minutes), fm.created_at, '1970-01-01'::timestamptz) as bucket_ts,
            count(*)::bigint as bucket_count,
            coalesce(
                round((percentile_cont(0.95) within group (order by fm.latency_ms))::numeric, 3),
                0
            ) as p95_latency_ms,
            case
                when count(*) = 0 then 0
                else round((100.0 * sum(case when fm.status_code >= 500 then 1 else 0 end)::numeric / count(*))::numeric, 3)
            end as error_rate_pct
        from filtered_metrics fm
        group by bucket_ts
    ),
    sms_summary as (
        select
            count(*)::bigint as sms_total_count,
            count(*) filter (where nd.status = 'sent')::bigint as sms_sent_count,
            count(*) filter (where nd.status = 'failed')::bigint as sms_failed_count
        from public.notification_dispatches nd
        where nd.channel = 'sms'
          and nd.created_at >= v_from
          and (p_tenant_id is null or nd.tenant_id = p_tenant_id)
    ),
    tenant_sms as (
        select
            nd.tenant_id,
            count(*)::bigint as sms_total_count,
            count(*) filter (where nd.status = 'sent')::bigint as sms_sent_count,
            count(*) filter (where nd.status = 'failed')::bigint as sms_failed_count
        from public.notification_dispatches nd
        where nd.channel = 'sms'
          and nd.created_at >= v_from
          and (p_tenant_id is null or nd.tenant_id = p_tenant_id)
          and nd.tenant_id is not null
        group by nd.tenant_id
    ),
    tenant_metrics as (
        select
            fm.tenant_id,
            coalesce(t.name, 'Unknown tenant') as tenant_name,
            count(*)::bigint as request_count,
            sum(case when fm.status_code >= 500 then 1 else 0 end)::bigint as error_count,
            coalesce(round(avg(fm.latency_ms)::numeric, 3), 0) as avg_latency_ms,
            count(distinct fm.user_id)::bigint as active_users,
            coalesce(ts.sms_total_count, 0)::bigint as sms_total_count,
            coalesce(ts.sms_sent_count, 0)::bigint as sms_sent_count,
            coalesce(ts.sms_failed_count, 0)::bigint as sms_failed_count,
            case
                when coalesce(ts.sms_total_count, 0) = 0 then 0
                else round((100.0 * coalesce(ts.sms_sent_count, 0)::numeric / ts.sms_total_count)::numeric, 3)
            end as sms_delivery_rate_pct
        from filtered_metrics fm
        left join public.tenants t on t.id = fm.tenant_id
        left join tenant_sms ts on ts.tenant_id = fm.tenant_id
        where fm.tenant_id is not null
        group by
            fm.tenant_id,
            t.name,
            ts.sms_total_count,
            ts.sms_sent_count,
            ts.sms_failed_count
    ),
    slow_endpoints as (
        select
            fm.endpoint,
            coalesce(round(avg(fm.latency_ms)::numeric, 3), 0) as avg_latency_ms,
            count(*)::bigint as calls
        from filtered_metrics fm
        group by fm.endpoint
        order by avg_latency_ms desc, calls desc
        limit v_slow_limit
    ),
    recent_errors as (
        select
            ae.created_at as timestamp,
            ae.endpoint,
            ae.status_code,
            ae.tenant_id,
            coalesce(t.name, case when ae.tenant_id is null then 'System' else 'Unknown tenant' end) as tenant_name,
            ae.message
        from public.api_errors ae
        left join public.tenants t on t.id = ae.tenant_id
        where (p_tenant_id is null or ae.tenant_id = p_tenant_id)
        order by ae.created_at desc
        limit v_errors_limit
    )
    select jsonb_build_object(
        'window_minutes', v_window_minutes,
        'scope_tenant_id', p_tenant_id,
        'network_mbps', coalesce((select ss.network_mbps from system_summary ss), 0),
        'system', jsonb_build_object(
            'requests_per_sec',
            coalesce(
                round(((select ss.request_count from system_summary ss)::numeric / greatest(v_window_minutes * 60, 1))::numeric, 3),
                0
            ),
            'p95_latency_ms', coalesce((select ss.p95_latency_ms from system_summary ss), 0),
            'error_rate_pct', coalesce((select ss.error_rate_pct from system_summary ss), 0),
            'active_users', coalesce((select ss.active_users from system_summary ss), 0),
            'active_tenants', coalesce((select ss.active_tenants from system_summary ss), 0),
            'sms_total_count', coalesce((select sms.sms_total_count from sms_summary sms), 0),
            'sms_sent_count', coalesce((select sms.sms_sent_count from sms_summary sms), 0),
            'sms_failed_count', coalesce((select sms.sms_failed_count from sms_summary sms), 0),
            'sms_delivery_rate_pct',
            case
                when coalesce((select sms.sms_total_count from sms_summary sms), 0) = 0 then 0
                else round((
                    100.0
                    * coalesce((select sms.sms_sent_count from sms_summary sms), 0)::numeric
                    / nullif((select sms.sms_total_count from sms_summary sms), 0)
                )::numeric, 3)
            end,
            'window_minutes', v_window_minutes,
            'timeseries',
            coalesce(
                (
                    select jsonb_agg(
                        jsonb_build_object(
                            'timestamp', ts.bucket_ts,
                            'requests_per_sec', round((ts.bucket_count::numeric / greatest(v_bucket_minutes * 60, 1))::numeric, 3),
                            'p95_latency_ms', ts.p95_latency_ms,
                            'error_rate_pct', ts.error_rate_pct
                        )
                        order by ts.bucket_ts
                    )
                    from timeseries ts
                ),
                '[]'::jsonb
            )
        ),
        'tenants',
        coalesce(
            (
                select jsonb_agg(to_jsonb(tm) order by
                    case when v_sort_by = 'errors' and v_sort_dir = 'asc' then tm.error_count end asc,
                    case when v_sort_by = 'errors' and v_sort_dir = 'desc' then tm.error_count end desc,
                    case when v_sort_by = 'latency' and v_sort_dir = 'asc' then tm.avg_latency_ms end asc,
                    case when v_sort_by = 'latency' and v_sort_dir = 'desc' then tm.avg_latency_ms end desc,
                    case when v_sort_by = 'sms' and v_sort_dir = 'asc' then tm.sms_total_count end asc,
                    case when v_sort_by = 'sms' and v_sort_dir = 'desc' then tm.sms_total_count end desc,
                    case when v_sort_by = 'traffic' and v_sort_dir = 'asc' then tm.request_count end asc,
                    case when v_sort_by = 'traffic' and v_sort_dir = 'desc' then tm.request_count end desc,
                    tm.tenant_name asc
                )
                from tenant_metrics tm
            ),
            '[]'::jsonb
        ),
        'slow_endpoints',
        coalesce((select jsonb_agg(to_jsonb(se) order by se.avg_latency_ms desc, se.calls desc) from slow_endpoints se), '[]'::jsonb),
        'errors',
        coalesce((select jsonb_agg(to_jsonb(re) order by re.timestamp desc) from recent_errors re), '[]'::jsonb)
    )
    into v_output;

    return coalesce(v_output, '{}'::jsonb);
end;
$$;

revoke all on function public.platform_operations_overview(uuid, integer, text, text, integer, integer) from public;
revoke all on function public.platform_operations_overview(uuid, integer, text, text, integer, integer) from anon;
revoke all on function public.platform_operations_overview(uuid, integer, text, text, integer, integer) from authenticated;
grant execute on function public.platform_operations_overview(uuid, integer, text, text, integer, integer) to service_role;
