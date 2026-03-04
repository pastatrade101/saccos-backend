insert into storage.buckets (id, name, public)
values ('imports', 'imports', false)
on conflict (id) do nothing;

drop policy if exists imports_objects_select_policy on storage.objects;
create policy imports_objects_select_policy
    on storage.objects
    for select
    using (
        bucket_id = 'imports'
        and split_part(name, '/', 2) = public.current_tenant_id()::text
        and (
            public.has_role(array['super_admin', 'branch_manager', 'auditor'])
            or public.is_internal_ops()
        )
    );

drop policy if exists imports_objects_insert_policy on storage.objects;
create policy imports_objects_insert_policy
    on storage.objects
    for insert
    with check (
        bucket_id = 'imports'
        and split_part(name, '/', 2) = public.current_tenant_id()::text
        and public.has_role(array['super_admin', 'branch_manager'])
    );

drop policy if exists imports_objects_update_policy on storage.objects;
create policy imports_objects_update_policy
    on storage.objects
    for update
    using (
        bucket_id = 'imports'
        and split_part(name, '/', 2) = public.current_tenant_id()::text
        and public.has_role(array['super_admin', 'branch_manager'])
    )
    with check (
        bucket_id = 'imports'
        and split_part(name, '/', 2) = public.current_tenant_id()::text
        and public.has_role(array['super_admin', 'branch_manager'])
    );
