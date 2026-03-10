alter table public.approval_policies enable row level security;
alter table public.approval_requests enable row level security;
alter table public.approval_steps enable row level security;
alter table public.approval_decisions enable row level security;

drop policy if exists approval_policies_select_policy on public.approval_policies;
create policy approval_policies_select_policy
on public.approval_policies
for select
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
);

drop policy if exists approval_policies_manage_policy on public.approval_policies;
create policy approval_policies_manage_policy
on public.approval_policies
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

drop policy if exists approval_requests_select_policy on public.approval_requests;
create policy approval_requests_select_policy
on public.approval_requests
for select
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
);

drop policy if exists approval_requests_manage_policy on public.approval_requests;
create policy approval_requests_manage_policy
on public.approval_requests
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

drop policy if exists approval_steps_select_policy on public.approval_steps;
create policy approval_steps_select_policy
on public.approval_steps
for select
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
);

drop policy if exists approval_steps_manage_policy on public.approval_steps;
create policy approval_steps_manage_policy
on public.approval_steps
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

drop policy if exists approval_decisions_select_policy on public.approval_decisions;
create policy approval_decisions_select_policy
on public.approval_decisions
for select
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
);

drop policy if exists approval_decisions_manage_policy on public.approval_decisions;
create policy approval_decisions_manage_policy
on public.approval_decisions
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
