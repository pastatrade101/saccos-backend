alter table public.members
    add column if not exists first_name text,
    add column if not exists middle_name text,
    add column if not exists last_name text,
    add column if not exists gender text;

alter table public.members
    drop constraint if exists members_gender_check;

alter table public.members
    add constraint members_gender_check
    check (gender is null or gender in ('male', 'female', 'other'));

create index if not exists members_tenant_tin_no_idx
    on public.members (tenant_id, tin_no)
    where tin_no is not null and deleted_at is null;

create index if not exists members_tenant_nida_no_idx
    on public.members (tenant_id, nida_no)
    where nida_no is not null and deleted_at is null;

update public.members
set
    first_name = coalesce(first_name, nullif(split_part(trim(full_name), ' ', 1), '')),
    last_name = coalesce(
        last_name,
        case
            when trim(full_name) like '% %' then nullif(regexp_replace(trim(full_name), '^.*\s', ''), '')
            else null
        end
    ),
    middle_name = coalesce(
        middle_name,
        case
            when trim(full_name) like '% % %' then nullif(trim(regexp_replace(trim(full_name), '^\S+\s*|\s*\S+$', '', 'g')), '')
            else middle_name
        end
    )
where full_name is not null;

do $$
begin
    if not exists (
        select 1
        from public.members
        where tin_no is not null and deleted_at is null
        group by tenant_id, tin_no
        having count(*) > 1
    ) then
        execute 'create unique index if not exists members_tenant_tin_no_key on public.members (tenant_id, tin_no) where tin_no is not null and deleted_at is null';
    end if;

    if not exists (
        select 1
        from public.members
        where nida_no is not null and deleted_at is null
        group by tenant_id, nida_no
        having count(*) > 1
    ) then
        execute 'create unique index if not exists members_tenant_nida_no_key on public.members (tenant_id, nida_no) where nida_no is not null and deleted_at is null';
    end if;
end $$;
