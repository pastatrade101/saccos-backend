alter table public.financial_statement_runs enable row level security;
alter table public.financial_snapshot_periods enable row level security;

drop policy if exists financial_statement_runs_select_policy on public.financial_statement_runs;
create policy financial_statement_runs_select_policy
on public.financial_statement_runs
for select
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
);

drop policy if exists financial_statement_runs_manage_policy on public.financial_statement_runs;
create policy financial_statement_runs_manage_policy
on public.financial_statement_runs
for all
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'auditor'])
)
with check (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'auditor'])
);

drop policy if exists financial_snapshot_periods_select_policy on public.financial_snapshot_periods;
create policy financial_snapshot_periods_select_policy
on public.financial_snapshot_periods
for select
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
);

drop policy if exists financial_snapshot_periods_manage_policy on public.financial_snapshot_periods;
create policy financial_snapshot_periods_manage_policy
on public.financial_snapshot_periods
for all
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'auditor'])
)
with check (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['super_admin', 'branch_manager', 'auditor'])
);
