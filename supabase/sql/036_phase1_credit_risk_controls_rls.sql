alter table public.loan_default_cases enable row level security;
alter table public.collection_actions enable row level security;
alter table public.loan_restructures enable row level security;
alter table public.loan_writeoffs enable row level security;
alter table public.loan_recoveries enable row level security;
alter table public.guarantor_exposures enable row level security;
alter table public.guarantor_claims enable row level security;

drop policy if exists loan_default_cases_select_policy on public.loan_default_cases;
create policy loan_default_cases_select_policy
on public.loan_default_cases
for select
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
);

drop policy if exists loan_default_cases_manage_policy on public.loan_default_cases;
create policy loan_default_cases_manage_policy
on public.loan_default_cases
for all
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer'])
)
with check (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer'])
);

drop policy if exists collection_actions_select_policy on public.collection_actions;
create policy collection_actions_select_policy
on public.collection_actions
for select
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
);

drop policy if exists collection_actions_manage_policy on public.collection_actions;
create policy collection_actions_manage_policy
on public.collection_actions
for all
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer'])
)
with check (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer'])
);

drop policy if exists loan_restructures_select_policy on public.loan_restructures;
create policy loan_restructures_select_policy
on public.loan_restructures
for select
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'auditor'])
);

drop policy if exists loan_restructures_manage_policy on public.loan_restructures;
create policy loan_restructures_manage_policy
on public.loan_restructures
for all
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer'])
)
with check (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer'])
);

drop policy if exists loan_writeoffs_select_policy on public.loan_writeoffs;
create policy loan_writeoffs_select_policy
on public.loan_writeoffs
for select
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'auditor'])
);

drop policy if exists loan_writeoffs_manage_policy on public.loan_writeoffs;
create policy loan_writeoffs_manage_policy
on public.loan_writeoffs
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

drop policy if exists loan_recoveries_select_policy on public.loan_recoveries;
create policy loan_recoveries_select_policy
on public.loan_recoveries
for select
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
);

drop policy if exists loan_recoveries_manage_policy on public.loan_recoveries;
create policy loan_recoveries_manage_policy
on public.loan_recoveries
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

drop policy if exists guarantor_exposures_select_policy on public.guarantor_exposures;
create policy guarantor_exposures_select_policy
on public.guarantor_exposures
for select
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
);

drop policy if exists guarantor_exposures_manage_policy on public.guarantor_exposures;
create policy guarantor_exposures_manage_policy
on public.guarantor_exposures
for all
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer'])
)
with check (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer'])
);

drop policy if exists guarantor_claims_select_policy on public.guarantor_claims;
create policy guarantor_claims_select_policy
on public.guarantor_claims
for select
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
);

drop policy if exists guarantor_claims_manage_policy on public.guarantor_claims;
create policy guarantor_claims_manage_policy
on public.guarantor_claims
for all
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer'])
)
with check (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer'])
);
