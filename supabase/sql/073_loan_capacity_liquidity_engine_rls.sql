alter table public.loan_product_policies enable row level security;
alter table public.branch_liquidity_policy enable row level security;
alter table public.loan_fund_pool enable row level security;
alter table public.member_financial_profile enable row level security;
alter table public.loan_capacity_audit enable row level security;

drop policy if exists loan_product_policies_select_policy on public.loan_product_policies;
create policy loan_product_policies_select_policy
on public.loan_product_policies
for select
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor', 'member'])
);

drop policy if exists loan_product_policies_manage_policy on public.loan_product_policies;
create policy loan_product_policies_manage_policy
on public.loan_product_policies
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

drop policy if exists branch_liquidity_policy_select_policy on public.branch_liquidity_policy;
create policy branch_liquidity_policy_select_policy
on public.branch_liquidity_policy
for select
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
);

drop policy if exists branch_liquidity_policy_manage_policy on public.branch_liquidity_policy;
create policy branch_liquidity_policy_manage_policy
on public.branch_liquidity_policy
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

drop policy if exists loan_fund_pool_select_policy on public.loan_fund_pool;
create policy loan_fund_pool_select_policy
on public.loan_fund_pool
for select
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
);

drop policy if exists loan_fund_pool_manage_policy on public.loan_fund_pool;
create policy loan_fund_pool_manage_policy
on public.loan_fund_pool
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

drop policy if exists member_financial_profile_select_policy on public.member_financial_profile;
create policy member_financial_profile_select_policy
on public.member_financial_profile
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

drop policy if exists member_financial_profile_manage_policy on public.member_financial_profile;
create policy member_financial_profile_manage_policy
on public.member_financial_profile
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

drop policy if exists loan_capacity_audit_select_policy on public.loan_capacity_audit;
create policy loan_capacity_audit_select_policy
on public.loan_capacity_audit
for select
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'auditor'])
);

drop policy if exists loan_capacity_audit_manage_policy on public.loan_capacity_audit;
create policy loan_capacity_audit_manage_policy
on public.loan_capacity_audit
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
