alter table public.loan_products enable row level security;
alter table public.loan_policy_settings enable row level security;
alter table public.loan_applications enable row level security;
alter table public.loan_approvals enable row level security;
alter table public.loan_guarantors enable row level security;
alter table public.collateral_items enable row level security;

drop policy if exists loan_products_select_policy on public.loan_products;
create policy loan_products_select_policy
on public.loan_products
for select
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and deleted_at is null
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
);

drop policy if exists loan_products_manage_policy on public.loan_products;
create policy loan_products_manage_policy
on public.loan_products
for all
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager'])
)
with check (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager'])
);

drop policy if exists loan_policy_settings_select_policy on public.loan_policy_settings;
create policy loan_policy_settings_select_policy
on public.loan_policy_settings
for select
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
);

drop policy if exists loan_policy_settings_manage_policy on public.loan_policy_settings;
create policy loan_policy_settings_manage_policy
on public.loan_policy_settings
for all
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager'])
)
with check (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager'])
);

drop policy if exists loan_applications_select_policy on public.loan_applications;
create policy loan_applications_select_policy
on public.loan_applications
for select
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and (
        public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
        or exists (
            select 1
              from public.members m
             where m.id = member_id
               and m.user_id = auth.uid()
        )
    )
);

drop policy if exists loan_applications_staff_manage_policy on public.loan_applications;
create policy loan_applications_staff_manage_policy
on public.loan_applications
for all
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller'])
)
with check (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller'])
);

drop policy if exists loan_applications_member_insert_policy on public.loan_applications;
create policy loan_applications_member_insert_policy
on public.loan_applications
for insert
to authenticated
with check (
    tenant_id = public.current_tenant_id()
    and exists (
        select 1
          from public.members m
         where m.id = member_id
           and m.user_id = auth.uid()
    )
);

drop policy if exists loan_applications_member_update_policy on public.loan_applications;
create policy loan_applications_member_update_policy
on public.loan_applications
for update
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and status in ('draft', 'rejected')
    and exists (
        select 1
          from public.members m
         where m.id = member_id
           and m.user_id = auth.uid()
    )
)
with check (
    tenant_id = public.current_tenant_id()
    and status in ('draft', 'rejected')
    and exists (
        select 1
          from public.members m
         where m.id = member_id
           and m.user_id = auth.uid()
    )
);

drop policy if exists loan_approvals_select_policy on public.loan_approvals;
create policy loan_approvals_select_policy
on public.loan_approvals
for select
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'auditor'])
);

drop policy if exists loan_approvals_manage_policy on public.loan_approvals;
create policy loan_approvals_manage_policy
on public.loan_approvals
for all
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager'])
)
with check (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager'])
);

drop policy if exists loan_guarantors_select_policy on public.loan_guarantors;
create policy loan_guarantors_select_policy
on public.loan_guarantors
for select
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
);

drop policy if exists loan_guarantors_manage_policy on public.loan_guarantors;
create policy loan_guarantors_manage_policy
on public.loan_guarantors
for all
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller'])
)
with check (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller'])
);

drop policy if exists collateral_items_select_policy on public.collateral_items;
create policy collateral_items_select_policy
on public.collateral_items
for select
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
);

drop policy if exists collateral_items_manage_policy on public.collateral_items;
create policy collateral_items_manage_policy
on public.collateral_items
for all
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller'])
)
with check (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller'])
);
