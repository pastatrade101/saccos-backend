alter table public.tenants enable row level security;
alter table public.subscriptions enable row level security;
alter table public.user_profiles enable row level security;
alter table public.chart_of_accounts enable row level security;
alter table public.tenant_settings enable row level security;
alter table public.branches enable row level security;
alter table public.branch_staff_assignments enable row level security;
alter table public.members enable row level security;
alter table public.member_accounts enable row level security;
alter table public.loans enable row level security;
alter table public.loan_accounts enable row level security;
alter table public.loan_schedules enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
alter table public.account_balances enable row level security;
alter table public.member_account_transactions enable row level security;
alter table public.loan_account_transactions enable row level security;
alter table public.daily_account_snapshots enable row level security;
alter table public.period_closures enable row level security;
alter table public.dividend_cycles enable row level security;
alter table public.dividend_components enable row level security;
alter table public.dividend_member_snapshots enable row level security;
alter table public.dividend_allocations enable row level security;
alter table public.dividend_approvals enable row level security;
alter table public.dividend_payments enable row level security;
alter table public.audit_logs enable row level security;

revoke all on public.journal_entries from anon, authenticated;
revoke all on public.journal_lines from anon, authenticated;
revoke all on public.account_balances from anon, authenticated;
revoke all on public.tenant_settings from anon, authenticated;
revoke all on public.subscriptions from anon, authenticated;
revoke all on public.dividend_cycles from anon, authenticated;
revoke all on public.dividend_components from anon, authenticated;
revoke all on public.dividend_member_snapshots from anon, authenticated;
revoke all on public.dividend_allocations from anon, authenticated;
revoke all on public.dividend_approvals from anon, authenticated;
revoke all on public.dividend_payments from anon, authenticated;

create policy tenants_select_policy
on public.tenants
for select
using (
    public.is_internal_ops()
    or exists (
        select 1
          from public.user_profiles up
         where up.user_id = auth.uid()
           and up.tenant_id = tenants.id
           and up.role = 'super_admin'
           and up.deleted_at is null
           and up.is_active = true
    )
);

create policy tenants_insert_policy
on public.tenants
for insert
with check (public.is_internal_ops());

create policy tenants_update_policy
on public.tenants
for update
using (
    public.is_internal_ops()
    or exists (
        select 1
          from public.user_profiles up
         where up.user_id = auth.uid()
           and up.tenant_id = tenants.id
           and up.role = 'super_admin'
           and up.deleted_at is null
           and up.is_active = true
    )
)
with check (
    public.is_internal_ops()
    or exists (
        select 1
          from public.user_profiles up
         where up.user_id = auth.uid()
           and up.tenant_id = tenants.id
           and up.role = 'super_admin'
           and up.deleted_at is null
           and up.is_active = true
    )
);

create policy subscriptions_select_policy
on public.subscriptions
for select
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin'])
    )
);

create policy subscriptions_write_policy
on public.subscriptions
for all
using (public.is_internal_ops())
with check (public.is_internal_ops());

create policy user_profiles_select_policy
on public.user_profiles
for select
using (
    user_id = auth.uid()
    or public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin'])
    )
);

create policy user_profiles_insert_policy
on public.user_profiles
for insert
with check (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin'])
    )
);

create policy user_profiles_update_policy
on public.user_profiles
for update
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin'])
    )
)
with check (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin'])
    )
);

create policy branches_select_policy
on public.branches
for select
using (
    public.is_internal_ops()
    or tenant_id = public.current_tenant_id()
);

create policy branches_insert_policy
on public.branches
for insert
with check (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin'])
    )
);

create policy branches_update_policy
on public.branches
for update
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin'])
    )
)
with check (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin'])
    )
);

create policy branch_staff_assignments_select_policy
on public.branch_staff_assignments
for select
using (
    public.is_internal_ops()
    or user_id = auth.uid()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin'])
    )
);

create policy branch_staff_assignments_write_policy
on public.branch_staff_assignments
for all
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin'])
    )
)
with check (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin'])
    )
);

create policy members_select_policy
on public.members
for select
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and (
            public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
            and public.has_branch_scope(branch_id)
            or user_id = auth.uid()
        )
    )
);

create policy members_insert_policy
on public.members
for insert
with check (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin', 'branch_manager', 'loan_officer'])
        and public.has_branch_scope(branch_id)
    )
);

create policy members_update_policy
on public.members
for update
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin', 'branch_manager', 'loan_officer'])
        and public.has_branch_scope(branch_id)
    )
)
with check (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin', 'branch_manager', 'loan_officer'])
        and public.has_branch_scope(branch_id)
    )
);

create policy chart_of_accounts_select_policy
on public.chart_of_accounts
for select
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin', 'auditor'])
    )
);

create policy member_accounts_select_policy
on public.member_accounts
for select
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and (
            public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
            and public.has_branch_scope(branch_id)
            or exists (
                select 1
                  from public.members m
                 where m.id = member_accounts.member_id
                   and m.user_id = auth.uid()
            )
        )
    )
);

create policy member_account_transactions_select_policy
on public.member_account_transactions
for select
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and (
            public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
            and public.has_branch_scope(branch_id)
            or exists (
                select 1
                  from public.member_accounts ma
                  join public.members m on m.id = ma.member_id
                 where ma.id = member_account_transactions.member_account_id
                   and m.user_id = auth.uid()
            )
        )
    )
);

create policy loans_select_policy
on public.loans
for select
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and (
            public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
            and public.has_branch_scope(branch_id)
            or exists (
                select 1
                  from public.members m
                 where m.id = loans.member_id
                   and m.user_id = auth.uid()
            )
        )
    )
);

create policy loan_accounts_select_policy
on public.loan_accounts
for select
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and (
            public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
            and public.has_branch_scope(branch_id)
            or exists (
                select 1
                  from public.members m
                 where m.id = loan_accounts.member_id
                   and m.user_id = auth.uid()
            )
        )
    )
);

create policy loan_schedules_select_policy
on public.loan_schedules
for select
using (
    public.is_internal_ops()
    or exists (
        select 1
          from public.loans l
         where l.id = loan_schedules.loan_id
           and l.tenant_id = public.current_tenant_id()
           and (
                public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
                and public.has_branch_scope(l.branch_id)
                or exists (
                    select 1
                      from public.members m
                     where m.id = l.member_id
                       and m.user_id = auth.uid()
                )
           )
    )
);

create policy loan_account_transactions_select_policy
on public.loan_account_transactions
for select
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and (
            public.has_role(array['super_admin', 'branch_manager', 'loan_officer', 'teller', 'auditor'])
            and public.has_branch_scope(branch_id)
            or exists (
                select 1
                  from public.members m
                 where m.id = loan_account_transactions.member_id
                   and m.user_id = auth.uid()
            )
        )
    )
);

create policy journal_entries_select_policy
on public.journal_entries
for select
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin', 'auditor'])
    )
);

create policy journal_lines_select_policy
on public.journal_lines
for select
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin', 'auditor'])
    )
);

create policy account_balances_select_policy
on public.account_balances
for select
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin', 'auditor'])
    )
);

create policy daily_account_snapshots_select_policy
on public.daily_account_snapshots
for select
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin', 'auditor'])
    )
);

create policy period_closures_select_policy
on public.period_closures
for select
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin', 'auditor'])
    )
);

create policy dividend_cycles_select_policy
on public.dividend_cycles
for select
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and (
            public.has_role(array['super_admin', 'branch_manager', 'auditor'])
            and (branch_id is null or public.has_branch_scope(branch_id))
        )
    )
);

create policy dividend_cycles_write_policy
on public.dividend_cycles
for all
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin', 'branch_manager'])
        and (branch_id is null or public.has_branch_scope(branch_id))
    )
)
with check (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin', 'branch_manager'])
        and (branch_id is null or public.has_branch_scope(branch_id))
    )
);

create policy dividend_components_select_policy
on public.dividend_components
for select
using (
    public.is_internal_ops()
    or exists (
        select 1
          from public.dividend_cycles dc
         where dc.id = dividend_components.cycle_id
           and dc.tenant_id = public.current_tenant_id()
           and (
                public.has_role(array['super_admin', 'branch_manager', 'auditor'])
                and (dc.branch_id is null or public.has_branch_scope(dc.branch_id))
           )
    )
);

create policy dividend_components_write_policy
on public.dividend_components
for all
using (
    public.is_internal_ops()
    or exists (
        select 1
          from public.dividend_cycles dc
         where dc.id = dividend_components.cycle_id
           and dc.tenant_id = public.current_tenant_id()
           and public.has_role(array['super_admin', 'branch_manager'])
           and (dc.branch_id is null or public.has_branch_scope(dc.branch_id))
    )
)
with check (
    public.is_internal_ops()
    or exists (
        select 1
          from public.dividend_cycles dc
         where dc.id = dividend_components.cycle_id
           and dc.tenant_id = public.current_tenant_id()
           and public.has_role(array['super_admin', 'branch_manager'])
           and (dc.branch_id is null or public.has_branch_scope(dc.branch_id))
    )
);

create policy dividend_member_snapshots_select_policy
on public.dividend_member_snapshots
for select
using (
    public.is_internal_ops()
    or exists (
        select 1
          from public.dividend_cycles dc
         where dc.id = dividend_member_snapshots.cycle_id
           and dc.tenant_id = public.current_tenant_id()
           and (
                public.has_role(array['super_admin', 'branch_manager', 'auditor'])
                and (dc.branch_id is null or public.has_branch_scope(dc.branch_id))
                or exists (
                    select 1
                      from public.members m
                     where m.id = dividend_member_snapshots.member_id
                       and m.user_id = auth.uid()
                )
           )
    )
);

create policy dividend_member_snapshots_write_policy
on public.dividend_member_snapshots
for all
using (
    public.is_internal_ops()
    or exists (
        select 1
          from public.dividend_cycles dc
         where dc.id = dividend_member_snapshots.cycle_id
           and dc.tenant_id = public.current_tenant_id()
           and public.has_role(array['super_admin', 'branch_manager'])
           and (dc.branch_id is null or public.has_branch_scope(dc.branch_id))
    )
)
with check (
    public.is_internal_ops()
    or exists (
        select 1
          from public.dividend_cycles dc
         where dc.id = dividend_member_snapshots.cycle_id
           and dc.tenant_id = public.current_tenant_id()
           and public.has_role(array['super_admin', 'branch_manager'])
           and (dc.branch_id is null or public.has_branch_scope(dc.branch_id))
    )
);

create policy dividend_allocations_select_policy
on public.dividend_allocations
for select
using (
    public.is_internal_ops()
    or exists (
        select 1
          from public.dividend_cycles dc
         where dc.id = dividend_allocations.cycle_id
           and dc.tenant_id = public.current_tenant_id()
           and (
                public.has_role(array['super_admin', 'branch_manager', 'auditor'])
                and (dc.branch_id is null or public.has_branch_scope(dc.branch_id))
                or exists (
                    select 1
                      from public.members m
                     where m.id = dividend_allocations.member_id
                       and m.user_id = auth.uid()
                       and dc.status in ('approved', 'paid', 'closed')
                )
           )
    )
);

create policy dividend_allocations_write_policy
on public.dividend_allocations
for all
using (
    public.is_internal_ops()
    or exists (
        select 1
          from public.dividend_cycles dc
         where dc.id = dividend_allocations.cycle_id
           and dc.tenant_id = public.current_tenant_id()
           and public.has_role(array['super_admin', 'branch_manager'])
           and (dc.branch_id is null or public.has_branch_scope(dc.branch_id))
    )
)
with check (
    public.is_internal_ops()
    or exists (
        select 1
          from public.dividend_cycles dc
         where dc.id = dividend_allocations.cycle_id
           and dc.tenant_id = public.current_tenant_id()
           and public.has_role(array['super_admin', 'branch_manager'])
           and (dc.branch_id is null or public.has_branch_scope(dc.branch_id))
    )
);

create policy dividend_approvals_select_policy
on public.dividend_approvals
for select
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin', 'branch_manager', 'auditor'])
    )
);

create policy dividend_approvals_write_policy
on public.dividend_approvals
for all
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin'])
    )
)
with check (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin'])
    )
);

create policy dividend_payments_select_policy
on public.dividend_payments
for select
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin', 'branch_manager', 'auditor'])
    )
);

create policy dividend_payments_write_policy
on public.dividend_payments
for all
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin'])
    )
)
with check (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin'])
    )
);

create policy audit_logs_select_policy
on public.audit_logs
for select
using (
    public.is_internal_ops()
    or (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin', 'auditor'])
    )
);
