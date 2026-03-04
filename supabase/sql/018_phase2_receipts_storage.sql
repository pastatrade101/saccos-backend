insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

drop policy if exists receipts_objects_select_policy on storage.objects;
create policy receipts_objects_select_policy
    on storage.objects
    for select
    using (
        bucket_id = 'receipts'
        and split_part(name, '/', 2) = public.current_tenant_id()::text
        and (
            public.has_role(array['super_admin', 'branch_manager', 'teller', 'loan_officer', 'auditor'])
            or public.is_internal_ops()
        )
    );

drop policy if exists receipts_objects_insert_policy on storage.objects;
create policy receipts_objects_insert_policy
    on storage.objects
    for insert
    with check (
        bucket_id = 'receipts'
        and split_part(name, '/', 2) = public.current_tenant_id()::text
        and public.has_role(array['super_admin', 'branch_manager', 'teller', 'loan_officer'])
    );

drop policy if exists receipts_objects_update_policy on storage.objects;
create policy receipts_objects_update_policy
    on storage.objects
    for update
    using (
        bucket_id = 'receipts'
        and split_part(name, '/', 2) = public.current_tenant_id()::text
        and public.has_role(array['super_admin', 'branch_manager', 'teller', 'loan_officer'])
    )
    with check (
        bucket_id = 'receipts'
        and split_part(name, '/', 2) = public.current_tenant_id()::text
        and public.has_role(array['super_admin', 'branch_manager', 'teller', 'loan_officer'])
    );
