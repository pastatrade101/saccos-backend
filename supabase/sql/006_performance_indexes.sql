create index if not exists tenant_subscriptions_tenant_start_at_idx
    on public.tenant_subscriptions (tenant_id, start_at desc);

create index if not exists tenant_subscriptions_plan_status_idx
    on public.tenant_subscriptions (plan_id, status, start_at desc);

create index if not exists branches_tenant_created_at_idx
    on public.branches (tenant_id, created_at desc)
    where deleted_at is null;

create index if not exists branches_tenant_name_idx
    on public.branches (tenant_id, name)
    where deleted_at is null;

create index if not exists branch_staff_assignments_user_branch_active_idx
    on public.branch_staff_assignments (user_id, branch_id)
    where deleted_at is null;

create index if not exists branch_staff_assignments_branch_user_active_idx
    on public.branch_staff_assignments (branch_id, user_id)
    where deleted_at is null;

create index if not exists members_tenant_created_at_idx
    on public.members (tenant_id, created_at desc)
    where deleted_at is null;

create index if not exists user_profiles_tenant_full_name_active_idx
    on public.user_profiles (tenant_id, full_name)
    where deleted_at is null;

create index if not exists members_branch_created_at_idx
    on public.members (branch_id, created_at desc)
    where deleted_at is null;

create index if not exists members_tenant_user_id_idx
    on public.members (tenant_id, user_id)
    where deleted_at is null;

create index if not exists member_accounts_tenant_member_active_idx
    on public.member_accounts (tenant_id, member_id)
    where deleted_at is null;

create index if not exists member_accounts_member_product_active_idx
    on public.member_accounts (member_id, product_type)
    where deleted_at is null;

create index if not exists member_account_transactions_tenant_account_created_idx
    on public.member_account_transactions (tenant_id, member_account_id, created_at desc);

create index if not exists member_account_transactions_tenant_created_idx
    on public.member_account_transactions (tenant_id, created_at desc);

create index if not exists loans_tenant_created_at_idx
    on public.loans (tenant_id, created_at desc);

create index if not exists loans_member_id_idx
    on public.loans (member_id);

create index if not exists loan_schedules_tenant_status_due_date_idx
    on public.loan_schedules (tenant_id, status, due_date);

create index if not exists loan_schedules_loan_due_date_idx
    on public.loan_schedules (loan_id, due_date);

create index if not exists loans_tenant_branch_status_idx
    on public.loans (tenant_id, branch_id, status, created_at desc);

create index if not exists loan_accounts_tenant_member_active_idx
    on public.loan_accounts (tenant_id, member_id)
    where deleted_at is null;

create index if not exists loan_accounts_branch_status_active_idx
    on public.loan_accounts (tenant_id, branch_id, status)
    where deleted_at is null;

create index if not exists loan_account_transactions_loan_created_idx
    on public.loan_account_transactions (loan_id, created_at desc);

create index if not exists loan_account_transactions_account_created_idx
    on public.loan_account_transactions (loan_account_id, created_at desc);

create index if not exists chart_of_accounts_tenant_system_tag_idx
    on public.chart_of_accounts (tenant_id, system_tag)
    where deleted_at is null;

create index if not exists dividend_cycles_tenant_branch_status_idx
    on public.dividend_cycles (tenant_id, branch_id, status, created_at desc);

create index if not exists dividend_allocations_cycle_created_at_idx
    on public.dividend_allocations (cycle_id, created_at desc);

create index if not exists dividend_member_snapshots_cycle_created_at_idx
    on public.dividend_member_snapshots (cycle_id, created_at desc);

create index if not exists dividend_approvals_cycle_approved_at_idx
    on public.dividend_approvals (cycle_id, approved_at desc);
