do $$
begin
    if not exists (
        select 1
        from pg_type
        where typname = 'plan_feature_type'
          and typnamespace = 'public'::regnamespace
    ) then
        create type public.plan_feature_type as enum ('bool', 'int', 'string');
    end if;
end
$$;

do $$
begin
    if not exists (
        select 1
        from pg_type
        where typname = 'tenant_subscription_status'
          and typnamespace = 'public'::regnamespace
    ) then
        create type public.tenant_subscription_status as enum ('active', 'past_due', 'suspended', 'cancelled');
    end if;
end
$$;

do $$
begin
    begin
        alter type public.user_role add value 'platform_admin';
    exception
        when duplicate_object then null;
    end;
end
$$;

create table if not exists public.plans (
    id uuid primary key default gen_random_uuid(),
    code text not null unique check (code in ('starter', 'growth', 'enterprise')),
    name text not null,
    description text,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
);

create table if not exists public.plan_features (
    id uuid primary key default gen_random_uuid(),
    plan_id uuid not null references public.plans(id) on delete cascade,
    feature_key text not null,
    feature_type public.plan_feature_type not null,
    bool_value boolean,
    int_value bigint,
    string_value text,
    created_at timestamptz not null default now(),
    constraint plan_features_unique_key unique (plan_id, feature_key)
);

create table if not exists public.tenant_subscriptions (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id),
    plan_id uuid not null references public.plans(id),
    status public.tenant_subscription_status not null default 'active',
    start_at timestamptz not null default now(),
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
);

create index if not exists tenant_subscriptions_tenant_id_idx
    on public.tenant_subscriptions (tenant_id);

create index if not exists plan_features_plan_id_feature_key_idx
    on public.plan_features (plan_id, feature_key);

insert into public.plans (code, name, description)
values
    ('starter', 'Starter', 'Basic member, cash, and operational foundation.'),
    ('growth', 'Growth', 'Adds loans, dividends, contributions, and stronger reporting.'),
    ('enterprise', 'Enterprise', 'Adds higher governance controls and broader operational oversight.')
on conflict (code) do update
set
    name = excluded.name,
    description = excluded.description,
    is_active = true;

with plan_rows as (
    select id, code from public.plans
),
feature_seed as (
    select
        p.id as plan_id,
        v.feature_key,
        v.feature_type::public.plan_feature_type as feature_type,
        v.bool_value,
        v.int_value,
        v.string_value
    from plan_rows p
    join (
        values
            ('starter', 'loans_enabled', 'bool', false, null, null),
            ('starter', 'dividends_enabled', 'bool', false, null, null),
            ('starter', 'contributions_enabled', 'bool', false, null, null),
            ('starter', 'advanced_reports', 'bool', false, null, null),
            ('starter', 'maker_checker_enabled', 'bool', false, null, null),
            ('starter', 'multi_approval_enabled', 'bool', false, null, null),
            ('starter', 'max_branches', 'int', null, 1, null),
            ('starter', 'max_users', 'int', null, 5, null),
            ('starter', 'max_members', 'int', null, 500, null),
            ('growth', 'loans_enabled', 'bool', true, null, null),
            ('growth', 'dividends_enabled', 'bool', true, null, null),
            ('growth', 'contributions_enabled', 'bool', true, null, null),
            ('growth', 'advanced_reports', 'bool', true, null, null),
            ('growth', 'maker_checker_enabled', 'bool', true, null, null),
            ('growth', 'multi_approval_enabled', 'bool', false, null, null),
            ('growth', 'max_branches', 'int', null, 5, null),
            ('growth', 'max_users', 'int', null, 25, null),
            ('growth', 'max_members', 'int', null, 5000, null),
            ('enterprise', 'loans_enabled', 'bool', true, null, null),
            ('enterprise', 'dividends_enabled', 'bool', true, null, null),
            ('enterprise', 'contributions_enabled', 'bool', true, null, null),
            ('enterprise', 'advanced_reports', 'bool', true, null, null),
            ('enterprise', 'maker_checker_enabled', 'bool', true, null, null),
            ('enterprise', 'multi_approval_enabled', 'bool', true, null, null),
            ('enterprise', 'max_branches', 'int', null, 999999, null),
            ('enterprise', 'max_users', 'int', null, 999999, null),
            ('enterprise', 'max_members', 'int', null, 999999, null)
    ) as v(plan_code, feature_key, feature_type, bool_value, int_value, string_value)
        on v.plan_code = p.code
)
insert into public.plan_features (
    plan_id,
    feature_key,
    feature_type,
    bool_value,
    int_value,
    string_value
)
select
    plan_id,
    feature_key,
    feature_type,
    bool_value,
    int_value,
    string_value
from feature_seed
on conflict (plan_id, feature_key) do update
set
    feature_type = excluded.feature_type,
    bool_value = excluded.bool_value,
    int_value = excluded.int_value,
    string_value = excluded.string_value;
