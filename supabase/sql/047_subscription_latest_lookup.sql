-- Performance helper for platform tenant listing:
-- fetch latest tenant subscription row per tenant in one query.

create or replace function public.latest_tenant_subscriptions(p_tenant_ids uuid[])
returns table (
    tenant_id uuid,
    subscription_id uuid,
    plan_id uuid,
    status public.tenant_subscription_status,
    start_at timestamptz,
    expires_at timestamptz,
    created_at timestamptz,
    plan_code text,
    plan_name text,
    plan_description text
)
language sql
stable
security definer
set search_path = public
as $$
    select distinct on (ts.tenant_id)
        ts.tenant_id,
        ts.id as subscription_id,
        ts.plan_id,
        ts.status,
        ts.start_at,
        ts.expires_at,
        ts.created_at,
        p.code as plan_code,
        p.name as plan_name,
        p.description as plan_description
    from public.tenant_subscriptions ts
    left join public.plans p on p.id = ts.plan_id
    where ts.tenant_id = any(coalesce(p_tenant_ids, array[]::uuid[]))
    order by ts.tenant_id, ts.start_at desc nulls last, ts.created_at desc;
$$;

revoke all on function public.latest_tenant_subscriptions(uuid[]) from public;
revoke all on function public.latest_tenant_subscriptions(uuid[]) from anon;
revoke all on function public.latest_tenant_subscriptions(uuid[]) from authenticated;
grant execute on function public.latest_tenant_subscriptions(uuid[]) to service_role;
