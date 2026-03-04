alter table public.cash_control_settings enable row level security;
alter table public.teller_sessions enable row level security;
alter table public.teller_session_transactions enable row level security;
alter table public.receipt_policies enable row level security;
alter table public.transaction_receipts enable row level security;

drop policy if exists cash_control_settings_select_policy on public.cash_control_settings;
create policy cash_control_settings_select_policy
    on public.cash_control_settings
    for select
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_role(array['super_admin', 'branch_manager', 'teller', 'auditor'])
            or public.is_internal_ops()
        )
    );

drop policy if exists cash_control_settings_write_policy on public.cash_control_settings;
create policy cash_control_settings_write_policy
    on public.cash_control_settings
    for all
    using (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin', 'branch_manager'])
    )
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin', 'branch_manager'])
    );

drop policy if exists teller_sessions_select_policy on public.teller_sessions;
create policy teller_sessions_select_policy
    on public.teller_sessions
    for select
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_role(array['super_admin', 'branch_manager', 'auditor'])
            or teller_user_id = auth.uid()
            or public.has_branch_scope(branch_id)
        )
    );

drop policy if exists teller_sessions_insert_policy on public.teller_sessions;
create policy teller_sessions_insert_policy
    on public.teller_sessions
    for insert
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['teller', 'branch_manager'])
        and public.has_branch_scope(branch_id)
    );

drop policy if exists teller_sessions_update_policy on public.teller_sessions;
create policy teller_sessions_update_policy
    on public.teller_sessions
    for update
    using (
        tenant_id = public.current_tenant_id()
        and (
            teller_user_id = auth.uid()
            or public.has_role(array['super_admin', 'branch_manager'])
        )
    )
    with check (
        tenant_id = public.current_tenant_id()
        and (
            teller_user_id = auth.uid()
            or public.has_role(array['super_admin', 'branch_manager'])
        )
    );

drop policy if exists teller_session_transactions_select_policy on public.teller_session_transactions;
create policy teller_session_transactions_select_policy
    on public.teller_session_transactions
    for select
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_role(array['super_admin', 'branch_manager', 'auditor'])
            or recorded_by = auth.uid()
            or public.has_branch_scope(branch_id)
        )
    );

drop policy if exists teller_session_transactions_insert_policy on public.teller_session_transactions;
create policy teller_session_transactions_insert_policy
    on public.teller_session_transactions
    for insert
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['teller', 'branch_manager', 'super_admin'])
        and public.has_branch_scope(branch_id)
    );

drop policy if exists receipt_policies_select_policy on public.receipt_policies;
create policy receipt_policies_select_policy
    on public.receipt_policies
    for select
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_role(array['super_admin', 'branch_manager', 'teller', 'auditor'])
            or public.is_internal_ops()
        )
    );

drop policy if exists receipt_policies_write_policy on public.receipt_policies;
create policy receipt_policies_write_policy
    on public.receipt_policies
    for all
    using (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin', 'branch_manager'])
    )
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin', 'branch_manager'])
    );

drop policy if exists transaction_receipts_select_policy on public.transaction_receipts;
create policy transaction_receipts_select_policy
    on public.transaction_receipts
    for select
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_role(array['super_admin', 'branch_manager', 'auditor'])
            or uploaded_by = auth.uid()
            or public.has_branch_scope(branch_id)
        )
    );

drop policy if exists transaction_receipts_insert_policy on public.transaction_receipts;
create policy transaction_receipts_insert_policy
    on public.transaction_receipts
    for insert
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_role(array['super_admin', 'branch_manager', 'teller', 'loan_officer'])
        and public.has_branch_scope(branch_id)
    );

drop policy if exists transaction_receipts_update_policy on public.transaction_receipts;
create policy transaction_receipts_update_policy
    on public.transaction_receipts
    for update
    using (
        tenant_id = public.current_tenant_id()
        and (
            uploaded_by = auth.uid()
            or public.has_role(array['super_admin', 'branch_manager', 'teller', 'loan_officer'])
        )
    )
    with check (
        tenant_id = public.current_tenant_id()
        and (
            uploaded_by = auth.uid()
            or public.has_role(array['super_admin', 'branch_manager', 'teller', 'loan_officer'])
        )
    );
