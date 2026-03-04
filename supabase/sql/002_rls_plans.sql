create or replace function public.is_platform_admin()
returns boolean
language sql
stable
as $$
    select
        coalesce((auth.jwt() -> 'app_metadata' ->> 'platform_role') in ('internal_ops', 'platform_admin'), false)
        or exists (
            select 1
            from public.user_profiles
            where user_id = auth.uid()
              and deleted_at is null
              and is_active = true
              and role::text = 'platform_admin'
        )
$$;

alter table public.plans enable row level security;
alter table public.plan_features enable row level security;
alter table public.tenant_subscriptions enable row level security;

revoke all on public.plans from anon, authenticated;
revoke all on public.plan_features from anon, authenticated;
revoke all on public.tenant_subscriptions from anon, authenticated;

drop policy if exists plans_select_policy on public.plans;
create policy plans_select_policy
on public.plans
for select
using (
    public.is_platform_admin()
    or exists (
        select 1
        from public.tenant_subscriptions ts
        join public.user_profiles up
            on up.tenant_id = ts.tenant_id
        where ts.plan_id = plans.id
          and up.user_id = auth.uid()
          and up.deleted_at is null
          and up.is_active = true
    )
);

drop policy if exists plans_write_policy on public.plans;
create policy plans_write_policy
on public.plans
for all
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists plan_features_select_policy on public.plan_features;
create policy plan_features_select_policy
on public.plan_features
for select
using (
    public.is_platform_admin()
    or exists (
        select 1
        from public.tenant_subscriptions ts
        join public.user_profiles up
            on up.tenant_id = ts.tenant_id
        where ts.plan_id = plan_features.plan_id
          and up.user_id = auth.uid()
          and up.deleted_at is null
          and up.is_active = true
    )
);

drop policy if exists plan_features_write_policy on public.plan_features;
create policy plan_features_write_policy
on public.plan_features
for all
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists tenant_subscriptions_select_policy on public.tenant_subscriptions;
create policy tenant_subscriptions_select_policy
on public.tenant_subscriptions
for select
using (
    public.is_platform_admin()
    or exists (
        select 1
        from public.user_profiles up
        where up.tenant_id = tenant_subscriptions.tenant_id
          and up.user_id = auth.uid()
          and up.deleted_at is null
          and up.is_active = true
    )
);

drop policy if exists tenant_subscriptions_write_policy on public.tenant_subscriptions;
create policy tenant_subscriptions_write_policy
on public.tenant_subscriptions
for all
using (public.is_platform_admin())
with check (public.is_platform_admin());
